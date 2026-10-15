const { randomBytes } = require("crypto");
const ApiError = require("./apiError");
// Caller owns the transaction. Used by ordinary stock-in and pickup restoration.
async function recordStockIn(conn, {inventoryId, quantity, userId, reason, referenceNo, remarks, transactionId}) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new ApiError(400, "Stock-in quantity must be a positive whole number.");
  const [rows] = await conn.query("SELECT InventoryID FROM Inventory WHERE InventoryID=:id FOR UPDATE", {id:inventoryId});
  if (!rows[0]) throw new ApiError(409, "Original inventory row is missing; review stock movement history.");
  await conn.query("UPDATE Inventory SET StockOnHand = StockOnHand + :qty WHERE InventoryID = :id", {qty:quantity,id:inventoryId});
  await conn.query(`INSERT INTO InventoryTransaction (TransactionID, InventoryID, UserID, TransactionType, Quantity, Reason, ReferenceNo, Remarks)
    VALUES (:transactionId, :invId, :userId, 'Stock In', :qty, :reason, :ref, :remarks)`, {
    transactionId:transactionId || "T-"+randomBytes(9).toString("hex"),invId:inventoryId,userId,qty:quantity,reason,ref:referenceNo,remarks:remarks || null
  });
}
async function receiveEmptyCylinders(conn, {companyId,userId,warehouseId,items}) {
  const [warehouses]=await conn.query("SELECT WarehouseID FROM Warehouse WHERE WarehouseID=:warehouseId AND CompanyID=:companyId AND Status='Active' FOR UPDATE",{warehouseId,companyId});
  if(!warehouses.length) throw new ApiError(400,"Select an active warehouse belonging to your company.");
  await conn.query("SELECT CompanyID FROM Company WHERE CompanyID=:companyId FOR UPDATE",{companyId});
  const referenceNo=await require("./generateNumbers").nextSequence(conn,"InventoryTransaction","ReferenceNo","ECR");
  for(const item of items) {
    const [products]=await conn.query("SELECT p.ProductID FROM Product p JOIN Category c ON c.CategoryID=p.CategoryID WHERE p.ProductID=:productId AND c.Category='Cylinder' AND p.Status='Active' FOR UPDATE",{productId:item.productId});
    if(!products.length) throw new ApiError(400,"Only active products under Cylinder can be returned.");
    const [rows]=await conn.query("SELECT InventoryID FROM Inventory WHERE WarehouseID=:warehouseId AND ProductID=:productId FOR UPDATE",{warehouseId,productId:item.productId});
    let inventoryId=rows[0]?.InventoryID;
    if(!inventoryId) {
      inventoryId="INT-"+randomBytes(8).toString("hex");
      await conn.query("INSERT INTO Inventory (InventoryID,WarehouseID,ProductID,StockOnHand) VALUES (:inventoryId,:warehouseId,:productId,0)",{inventoryId,warehouseId,productId:item.productId});
    }
    await recordStockIn(conn,{inventoryId,quantity:item.qty,userId,reason:"Empty Cylinder Returned",referenceNo});
  }
  return referenceNo;
}
module.exports={recordStockIn,receiveEmptyCylinders};
