const router = require('express').Router();
const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const { authenticate } = require('../middleware/auth');
const { nextSequence } = require('../utils/generateNumbers');
const { recordStockIn } = require('../utils/inventoryMovements');
const { transporter } = require('../config/mailer');
const { purchaseOrderText, purchaseOrderPDF } = require('../utils/purchaseOrderDocument');
const { pricePurchaseOrderItems } = require('../utils/purchaseOrderCosts');
router.use(authenticate);
const scope = `JOIN UserHistory owner ON owner.UserID=po.CreatedByUserID`;
async function transaction(work) {
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); const result = await work(conn); await conn.commit(); return result; }
  catch (error) { await conn.rollback(); throw error; } finally { conn.release(); }
}
async function profile(conn, companyId) {
  const [rows] = await conn.query(`SELECT c.CompanyName AS name, COALESCE(NULLIF(s.Address,''),c.Address) AS address,
    s.ContactEmail AS email,s.Phone AS phone FROM Company c LEFT JOIN CompanySettings s ON s.CompanyID=c.CompanyID WHERE c.CompanyID=:companyId`,{companyId});
  return rows[0];
}
async function lockedPO(conn, req) {
  const [rows] = await conn.query(`SELECT po.* FROM PurchaseOrder po ${scope}
    WHERE po.PurchaseOrderID=:id AND owner.CompanyID=:companyId FOR UPDATE`,{id:req.params.id,companyId:req.user.companyId});
  if (!rows[0]) throw new ApiError(404,'Purchase order not found.');
  return rows[0];
}
router.get('/options',asyncHandler(async(req,res)=>{
  const [warehouses] = await pool.query(`SELECT WarehouseID AS id, WarehouseName AS name,Location AS address FROM Warehouse WHERE CompanyID=:companyId AND Status='Active'`,{companyId:req.user.companyId});
  const [suppliers] = await pool.query(`SELECT SupplierID AS id,SupplierName AS name,Email AS email,Contact AS phone,Address AS address FROM Supplier WHERE Status='Active'`);
  const [products] = await pool.query(`SELECT p.ProductID AS productId, p.ProductName AS productName, p.ProductName AS name,
    p.SupplierID AS supplierId, p.CostPrice AS unitCost, p.Unit AS unit, p.UnitValue AS unitValue,
    c.Category AS category, b.Brand AS brand FROM Product p
    JOIN Category c ON c.CategoryID=p.CategoryID JOIN Brand b ON b.BrandID=p.BrandID
    WHERE p.Status='Active' ORDER BY p.ProductName`);
  res.json({business:await profile(pool,req.user.companyId),warehouses,suppliers,products:products.map(product => ({
    ...product,
    // Legacy catalog values include the unit suffix (e.g. "11 kg").
    unitValue: Number.isFinite(parseFloat(product.unitValue)) ? String(parseFloat(product.unitValue)) : null,
  }))});
}));
router.get('/',asyncHandler(async(req,res)=>{
  const [rows] = await pool.query(`SELECT po.PurchaseOrderID AS id,po.PONo AS poNo,s.SupplierName AS supplier,po.OrderDate AS orderDate,
    po.Status AS status,po.TotalAmount AS totalAmount,po.PaymentEmailSentAt AS paymentEmailSentAt,(po.PaymentMethod IS NOT NULL AND NULLIF(po.PaymentReference,'') IS NOT NULL) AS paymentRecorded,COUNT(DISTINCT i.ProductID) AS itemCount,COALESCE(SUM(i.Quantity),0) AS totalQty
    FROM PurchaseOrder po ${scope} JOIN SupplierHistory s ON s.SupplierID=po.SupplierID
    LEFT JOIN PurchaseOrderItem i ON i.PurchaseOrderID=po.PurchaseOrderID WHERE owner.CompanyID=:companyId
    GROUP BY po.PurchaseOrderID,po.PONo,s.SupplierName,po.OrderDate,po.Status,po.TotalAmount,po.PaymentMethod,po.PaymentReference,po.PaymentEmailSentAt ORDER BY po.OrderDate DESC`,{companyId:req.user.companyId});
  res.json(rows);
}));
async function supplierDocument(conn, po, companyId) {
      const [suppliers]=await conn.query('SELECT Email,SupplierName FROM SupplierHistory WHERE SupplierID=:id',{id:po.SupplierID});
      const [warehouses]=await conn.query('SELECT WarehouseName,Location FROM Warehouse WHERE WarehouseID=:id AND CompanyID=:companyId',{id:po.WarehouseID,companyId:companyId});
      if(!warehouses[0]) throw new Error('Destination warehouse is invalid.');
      const [items]=await conn.query(`SELECT p.ProductName,i.Quantity,i.UnitCost,i.Subtotal FROM PurchaseOrderItem i JOIN ProductHistory p ON p.ProductID=i.ProductID WHERE i.PurchaseOrderID=:id`,{id:po.PurchaseOrderID});
      const business=await profile(conn,companyId);
  return {po, business, supplier:suppliers[0], warehouse:warehouses[0], items};
}
function respondPDF(res, pdf, filename) {
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename="${filename}.pdf"`);
  res.set('Cache-Control', 'no-store');
  res.send(pdf);
}
router.post('/document-preview', asyncHandler(async (req, res) => {
  const {supplierId, warehouseId, items, paymentMethod, referenceNo} = req.body;
  if (!supplierId || !warehouseId || !Array.isArray(items) || !items.length || items.length > 500) throw new ApiError(400, 'Select a supplier, warehouse and items before viewing the document.');
  const [suppliers] = await pool.query("SELECT SupplierName,Email FROM Supplier WHERE SupplierID=:supplierId AND Status='Active'", {supplierId});
  const [warehouses] = await pool.query("SELECT WarehouseName,Location FROM Warehouse WHERE WarehouseID=:warehouseId AND CompanyID=:companyId AND Status='Active'", {warehouseId, companyId:req.user.companyId});
  if (!suppliers[0] || !warehouses[0]) throw new ApiError(400, 'Select a valid supplier and warehouse.');
  const lines = [];
  const seen = new Set();
  for (const item of items) {
    if (!item.productId || seen.has(item.productId) || !Number.isSafeInteger(item.qty) || item.qty <= 0 || !Number.isFinite(item.unitCost) || item.unitCost < 0 || Math.abs(item.unitCost * 100 - Math.round(item.unitCost * 100)) > 0.00001) throw new ApiError(400, 'Select distinct products with positive whole quantities and valid costs.');
    seen.add(item.productId);
    const [products] = await pool.query("SELECT ProductName FROM Product WHERE ProductID=:productId AND SupplierID=:supplierId AND Status='Active'", {productId:item.productId, supplierId});
    if (!products[0]) throw new ApiError(400, 'Each product must belong to the selected supplier.');
    lines.push({ProductName:products[0].ProductName, Quantity:item.qty, UnitCost:item.unitCost, Subtotal:item.qty * Math.round(item.unitCost * 100) / 100});
  }
  const total = lines.reduce((sum, item) => sum + Math.round(item.Subtotal * 100), 0);
  if (!Number.isSafeInteger(total) || total > 999999999999) throw new ApiError(400, 'Total amount exceeds supported limits.');
  const business = await profile(pool, req.user.companyId);
  if (!business) throw new ApiError(400, 'Complete your business profile first.');
  const po = {PONo:'DRAFT - Assigned upon creation', TotalAmount:total / 100, PaymentMethod:paymentMethod, PaymentReference:referenceNo};
  respondPDF(res, await purchaseOrderPDF({po, business, supplier:suppliers[0], warehouse:warehouses[0], items:lines}), 'purchase-order-draft');
}));
router.get('/:id/document', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`SELECT po.* FROM PurchaseOrder po ${scope} WHERE po.PurchaseOrderID=:id AND owner.CompanyID=:companyId`, {id:req.params.id, companyId:req.user.companyId});
  if (!rows[0]) throw new ApiError(404, 'Purchase order not found.');
  respondPDF(res, await purchaseOrderPDF(await supplierDocument(pool, rows[0], req.user.companyId)), rows[0].PONo);
}));
router.get('/:id',asyncHandler(async(req,res)=>{
  const [rows] = await pool.query(`SELECT po.*,s.SupplierName,s.Email AS SupplierEmail,s.Contact AS SupplierPhone,s.Address AS SupplierAddress,w.WarehouseName,w.Location AS WarehouseAddress FROM PurchaseOrder po ${scope}
    JOIN SupplierHistory s ON s.SupplierID=po.SupplierID LEFT JOIN Warehouse w ON w.WarehouseID=po.WarehouseID
    WHERE po.PurchaseOrderID=:id AND owner.CompanyID=:companyId`,{id:req.params.id,companyId:req.user.companyId});
  if(!rows[0]) throw new ApiError(404,'Purchase order not found.');
  const [items] = await pool.query(`SELECT i.ProductID AS productId,p.ProductName AS productName,i.Quantity AS qty,i.ReceivedQuantity AS receivedQty,
    i.UnitCost AS costPrice,i.Subtotal AS subtotal FROM PurchaseOrderItem i JOIN ProductHistory p ON p.ProductID=i.ProductID WHERE i.PurchaseOrderID=:id`,{id:req.params.id});
  const [deliveries] = await pool.query(`SELECT t.TransactionID AS id,t.TransactionDate AS receivedAt,t.Quantity AS quantity,
    p.ProductName AS productName,w.WarehouseName AS warehouse,t.Reason AS reason
    FROM InventoryTransaction t JOIN Inventory inv ON inv.InventoryID=t.InventoryID
    JOIN ProductHistory p ON p.ProductID=inv.ProductID JOIN Warehouse w ON w.WarehouseID=inv.WarehouseID
    WHERE w.CompanyID=:companyId AND t.ReferenceNo=:poNo AND t.TransactionType='Stock In'
      AND t.Reason IN ('Supplier Delivery','Purchase')
      AND LEFT(t.Remarks,CHAR_LENGTH(:receiptPrefix))=:receiptPrefix
    ORDER BY t.TransactionDate DESC,t.TransactionID`, {companyId:req.user.companyId,poNo:rows[0].PONo,receiptPrefix:`PO ${rows[0].PurchaseOrderID} receipt `});
  res.json({...rows[0],items,deliveries,business:await profile(pool,req.user.companyId)});
}));
router.post('/',asyncHandler(async(req,res)=>{
  const {supplierId,warehouseId,paymentMethod,referenceNo,items,restockIds=[],requestKey} = req.body;
  if(!supplierId || !warehouseId || (paymentMethod != null && !['GCash','Card','Bank Transfer'].includes(paymentMethod)) || !Array.isArray(items) || !items.length || !/^[a-zA-Z0-9-]{16,64}$/.test(requestKey||'')) throw new ApiError(400,'Supplier, warehouse, items and request key are required.');
  if(!Array.isArray(restockIds) || (referenceNo && (typeof referenceNo!=='string'||referenceNo.length>100))) throw new ApiError(400,'Invalid reference or restock IDs.');
  const seen = new Set();
  for (const item of items) {
    if (!item.productId || seen.has(item.productId) || !Number.isSafeInteger(item.qty) || item.qty <= 0) throw new ApiError(400, 'Use distinct products and positive whole quantities.');
    seen.add(item.productId);
  }
  const result=await transaction(async conn=>{
    // Serialize number allocation and duplicate request checks across all PO creation.
    await conn.query('SELECT CompanyID FROM Company ORDER BY CompanyID FOR UPDATE');
    const [existing]=await conn.query(`SELECT po.PurchaseOrderID AS id,po.PONo AS poNo,po.Status AS status FROM PurchaseOrder po ${scope} WHERE po.RequestKey=:requestKey AND owner.CompanyID=:companyId`,{requestKey,companyId:req.user.companyId});
    if(existing[0]) return existing[0];
    const business=await profile(conn,req.user.companyId);
    if(!business||['name','address','email','phone'].some(k=>!String(business[k]||'').trim())) throw new ApiError(400,'Complete business name, address, email and phone in Settings before creating a PO.');
    const [ws]=await conn.query(`SELECT WarehouseID FROM Warehouse WHERE WarehouseID=:warehouseId AND CompanyID=:companyId AND Status='Active' FOR UPDATE`,{warehouseId,companyId:req.user.companyId});
    if(!ws[0]) throw new ApiError(400,'Select an active warehouse belonging to your business.');
    const [suppliers]=await conn.query(`SELECT SupplierID,Email FROM Supplier WHERE SupplierID=:supplierId AND Status='Active'`,{supplierId});
    if(!suppliers[0]?.Email) throw new ApiError(400,'Supplier must have a saved email address.');
    const { pricedItems, totalCents } = await pricePurchaseOrderItems(conn, supplierId, items);
    for(const id of restockIds) {
      const [r]=await conn.query(`SELECT ProductID FROM RestockRecommendation WHERE RestockID=:id AND SupplierID=:supplierId AND Status='Pending' FOR UPDATE`,{id,supplierId});
      if(!r[0]||!seen.has(r[0].ProductID)) throw new ApiError(409,'Restock selection is no longer available. Refresh and try again.');
    }
    const poNo=await nextSequence(conn,'PurchaseOrder','PONo','PO');
    const [ids]=await conn.query("SELECT PurchaseOrderID FROM PurchaseOrder WHERE PurchaseOrderID REGEXP '^PO-[0-9]+$'");
    const id=await require('../utils/entityIds').nextEntityId(conn,'PurchaseOrder');
    await conn.query(`INSERT INTO PurchaseOrder (PurchaseOrderID,SupplierID,RestockID,CreatedByUserID,PONo,OrderDate,Status,TotalAmount,WarehouseID,PaymentMethod,PaymentReference,RequestKey)
      VALUES (:id,:supplierId,:restockId,:userId,:poNo,NOW(),'Pending',:total,:warehouseId,:paymentMethod,:referenceNo,:requestKey)`,{id,supplierId,restockId:restockIds[0]||null,userId:req.user.userId,poNo,total:totalCents/100,warehouseId,paymentMethod:paymentMethod||null,referenceNo:referenceNo||null,requestKey});
    for(const item of pricedItems) await conn.query(`INSERT INTO PurchaseOrderItem (PurchaseOrderItemID,PurchaseOrderID,ProductID,Quantity,UnitCost,Subtotal) VALUES (:itemId,:id,:productId,:qty,:unitCost,:subtotal)`,{...item,itemId:await require('../utils/entityIds').nextEntityId(conn,'PurchaseOrderItem'),id,subtotal:item.qty*Math.round(item.unitCost*100)/100});
    for(const restockId of restockIds) await conn.query(`UPDATE RestockRecommendation SET Status='Converted' WHERE RestockID=:restockId`,{restockId});
    return {id,poNo,status:'Pending'};
  });
  // Persist before contacting SMTP. Failed delivery leaves a visible, retryable Pending PO.
  try { if(result.status==='Pending') await sendPO({...req,params:{id:result.id}}); }
  catch(error) { return res.status(201).json({...result,emailError:error.message}); }
  res.status(201).json({...result,status:result.status==='Pending'?'Sent':result.status});
}));
async function sendPO(req) {
  return transaction(async conn=>{
    const po=await lockedPO(conn,req);
    if(po.Status==='Sent') return {message:'Purchase order already sent.'};
    if(po.Status!=='Pending') throw new ApiError(409,'Only pending orders can be sent.');
    if(!po.WarehouseID) throw new ApiError(409,'Legacy PO has no destination warehouse; review it before dispatch.');
    try {
      if(!process.env.SMTP_HOST||!process.env.SMTP_USER||!process.env.SMTP_PASS) throw new Error('SMTP is not configured.');
      const document = await supplierDocument(conn, po, req.user.companyId);
      const text=purchaseOrderText(document);
      const pdf=purchaseOrderPDF(document);
      const result=await transporter.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to:document.supplier.Email,subject:`Purchase Order ${po.PONo}`,text,attachments:[{filename:`${po.PONo}.pdf`,content:await pdf}]});
      if(!result.accepted?.length) throw new Error('SMTP did not accept the supplier email.');
    } catch(error) { console.error(`PO ${po.PONo} email failed:`,error.message); throw new ApiError(502,'Supplier email failed or SMTP is unconfigured. PO remains Pending; retry Send after checking configuration.'); }
    await conn.query(`UPDATE PurchaseOrder SET Status='Sent' WHERE PurchaseOrderID=:id`,{id:po.PurchaseOrderID});
    return {message:'Purchase order sent.'};
  });
}
router.put('/:id/send',asyncHandler(async(req,res)=>res.json(await sendPO(req))));
for(const [action,from,to] of [['confirm','Sent','Approved'],['reject','Sent','Rejected'],['dispatch','Approved','Out for Delivery']]) router.put(`/:id/${action}`,asyncHandler(async(req,res)=>{
  res.json(await transaction(async conn=>{const po=await lockedPO(conn,req);if(po.Status!==from) throw new ApiError(409,`Only ${from} orders can become ${to}.`);
    await conn.query('UPDATE PurchaseOrder SET Status=:to WHERE PurchaseOrderID=:id',{to,id:po.PurchaseOrderID});return {status:to};}));
}));
router.put('/:id/payment', asyncHandler(async (req, res) => {
  const {paymentMethod, referenceNo, amountPaid} = req.body;
  const paidCents = Math.round(amountPaid * 100);
  if (typeof amountPaid !== 'number' || !Number.isFinite(amountPaid) || amountPaid <= 0 || !Number.isSafeInteger(paidCents) || paidCents > 999999999999 || Math.abs(amountPaid * 100 - paidCents) > 0.00001) throw new ApiError(400, 'Enter a positive amount paid with at most two decimal places.');
  if (!['GCash', 'Card', 'Bank Transfer'].includes(paymentMethod) || typeof referenceNo !== 'string' || !referenceNo.trim() || referenceNo.trim().length > 100) throw new ApiError(400, 'Select a payment method and enter a reference number (up to 100 characters).');
  res.json(await transaction(async conn => {
    const po = await lockedPO(conn, req);
    if (!['Approved','Paid'].includes(po.Status)) throw new ApiError(409, 'Only supplier-approved purchase orders can record payment.');
    if (po.PaymentEmailSentAt) throw new ApiError(409, 'Payment details cannot be changed after the document has been emailed to the supplier.');
    if (po.PaymentMethod === paymentMethod && po.PaymentReference === referenceNo.trim() && Math.round(Number(po.AmountPaid) * 100) === paidCents) return {message:'Payment already recorded.'};
    await conn.query("UPDATE PurchaseOrder SET PaymentMethod=:paymentMethod,PaymentReference=:referenceNo,AmountPaid=:amountPaid,Status='Paid' WHERE PurchaseOrderID=:id", {paymentMethod,referenceNo:referenceNo.trim(),amountPaid:paidCents/100,id:po.PurchaseOrderID});
    return {message:'Payment recorded.'};
  }));
}));
router.put('/:id/send-payment', asyncHandler(async (req, res) => {
  res.json(await transaction(async conn => {
    const po = await lockedPO(conn, req);
    if (po.PaymentEmailSentAt) return {message:'Payment document already sent to supplier.'};
    if (!['Approved','Paid','Out for Delivery','Received'].includes(po.Status) || !po.PaymentMethod || !po.PaymentReference) throw new ApiError(409, 'Record payment for an accepted purchase order before sending its acknowledgment.');
    const document = await supplierDocument(conn, po, req.user.companyId);
    if (!document.supplier?.Email) throw new ApiError(400, 'Supplier must have a saved email address.');
    try {
      if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) throw new Error('SMTP is not configured.');
      const pdf = await purchaseOrderPDF({...document,paymentReceipt:true});
      const result = await transporter.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to:document.supplier.Email,subject:`Payment Acknowledgment - ${po.PONo}`,text:`Dear ${document.supplier.SupplierName},\n\nPlease find attached the payment acknowledgment for purchase order ${po.PONo}.\nPayment Method: ${po.PaymentMethod}\nReference No.: ${po.PaymentReference}\nAmount Paid: ${po.AmountPaid == null ? 'Not recorded' : `PHP ${Number(po.AmountPaid).toFixed(2)}`}\n\nRegards,\n${document.business.name}`,attachments:[{filename:`${po.PONo}-payment.pdf`,content:pdf}]});
      if (!result.accepted?.length) throw new Error('SMTP did not accept the supplier email.');
    } catch (error) {
      console.error(`PO ${po.PONo} payment email failed:`,error.message);
      throw new ApiError(502, 'Payment document email failed. Your payment remains saved; retry sending after checking email configuration.');
    }
    await conn.query('UPDATE PurchaseOrder SET PaymentEmailSentAt=NOW() WHERE PurchaseOrderID=:id', {id:po.PurchaseOrderID});
    return {message:'Payment document sent to supplier.'};
  }));
}));
router.get('/:id/payment-document', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`SELECT po.* FROM PurchaseOrder po ${scope} WHERE po.PurchaseOrderID=:id AND owner.CompanyID=:companyId`, {id:req.params.id,companyId:req.user.companyId});
  if (!rows[0]) throw new ApiError(404, 'Purchase order not found.');
  if (!['Approved','Paid','Out for Delivery','Received'].includes(rows[0].Status) || !rows[0].PaymentMethod || !rows[0].PaymentReference) throw new ApiError(409, 'Confirm supplier acceptance and record payment before viewing the payment document.');
  const document = await supplierDocument(pool, rows[0], req.user.companyId);
  respondPDF(res, await purchaseOrderPDF({...document, paymentReceipt:true}), `${rows[0].PONo}-payment`);
}));
router.put('/:id/receive',asyncHandler(async(req,res)=>res.json(await transaction(async conn=>{
  const po=await lockedPO(conn,req);
  const requestKey=req.body.requestKey;
  if(!/^[a-zA-Z0-9-]{16,64}$/.test(requestKey||'')) throw new ApiError(400,'Receipt request key is required.');
  const receiptRemark=`PO ${po.PurchaseOrderID} receipt ${requestKey}`;
  const [previous]=await conn.query('SELECT TransactionID FROM InventoryTransaction WHERE ReferenceNo=:ref AND Remarks=:remarks LIMIT 1',{ref:po.PONo,remarks:receiptRemark});
  if(previous.length) return {status:po.Status,message:'Receipt already recorded.'};
  if(!['Paid','Out for Delivery'].includes(po.Status)) throw new ApiError(409,'Only Paid or Out for Delivery orders can be received.');
  const warehouseId=po.WarehouseID;
  if(req.body.warehouseId && req.body.warehouseId!==warehouseId) throw new ApiError(400,'Receipt warehouse must match the PO destination.');
  const [warehouses]=await conn.query(`SELECT WarehouseID FROM Warehouse WHERE WarehouseID=:warehouseId AND CompanyID=:companyId AND Status='Active' FOR UPDATE`,{warehouseId,companyId:req.user.companyId});
  if(!warehouses[0]) throw new ApiError(400,'PO destination warehouse is missing or inactive.');
  const [items]=await conn.query('SELECT * FROM PurchaseOrderItem WHERE PurchaseOrderID=:id FOR UPDATE',{id:po.PurchaseOrderID});
  const delivered=req.body.items;
  if(!items.length||!Array.isArray(delivered)||delivered.length!==items.length||new Set(delivered.map(i=>i.productId)).size!==items.length) throw new ApiError(400,'Provide delivered quantities for every PO item.');
  let credited=0;
  for(const item of items) {
    const qty=delivered.find(i=>i.productId===item.ProductID)?.qty;
    if(!Number.isSafeInteger(qty)||qty<0||qty>item.Quantity-item.ReceivedQuantity) throw new ApiError(400,'Delivered quantities must be whole numbers within the remaining ordered quantity.');
    if(!qty) continue;
    const [inventory]=await conn.query('SELECT InventoryID FROM Inventory WHERE WarehouseID=:warehouseId AND ProductID=:productId FOR UPDATE',{warehouseId,productId:item.ProductID});
    let inventoryId=inventory[0]?.InventoryID;
    if(!inventoryId) {inventoryId=await require('../utils/entityIds').nextEntityId(conn,'Inventory');await conn.query('INSERT INTO Inventory (InventoryID,WarehouseID,ProductID,StockOnHand) VALUES (:inventoryId,:warehouseId,:productId,0)',{inventoryId,warehouseId,productId:item.ProductID});}
    await recordStockIn(conn,{inventoryId,quantity:qty,userId:req.user.userId,reason:'Supplier Delivery',referenceNo:po.PONo,remarks:receiptRemark});
    await conn.query('UPDATE PurchaseOrderItem SET ReceivedQuantity=ReceivedQuantity+:qty WHERE PurchaseOrderItemID=:id',{qty,id:item.PurchaseOrderItemID});
    item.ReceivedQuantity+=qty;credited+=qty;
  }
  if(!credited) throw new ApiError(400,'Enter at least one newly delivered unit.');
  const status=items.every(i=>i.ReceivedQuantity===i.Quantity)?'Received':'Out for Delivery';
  await conn.query('UPDATE PurchaseOrder SET Status=:status WHERE PurchaseOrderID=:id',{status,id:po.PurchaseOrderID});
  return {status,message:status==='Received'?'Receipt completed.':'Partial receipt saved; PO remains Out for Delivery.'};
}))));
router.put('/:id/cancel',asyncHandler(async()=>{throw new ApiError(409,'Cancellation is unavailable in the linear PO workflow.');}));
module.exports=router;
