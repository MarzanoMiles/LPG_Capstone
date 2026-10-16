// Atomic allocation shared by all application instances. Values expand beyond 999.
const entities = {
 deliveryvehiclerate: ['VehicleID','V'],
 Branch: ['BranchID','BRH'], Brand: ['BrandID','BD'], Category: ['CategoryID','CTRGY'],
 Company: ['CompanyID','C'], ComplianceReport: ['ReportID','REP'], Customer: ['CustomerID','CUST'],
 DataActivityLog: ['DataActivityID','DA'], Delivery: ['DeliveryID','D'], Inventory: ['InventoryID','INT'],
 InventoryTransaction: ['TransactionID','T'], Order: ['OrderID','ORD'], OrderDetails: ['OrderDetailID','OD'],
 Payment: ['PaymentID','PAY'], PurchaseOrder: ['PurchaseOrderID','PO'], PurchaseOrderItem: ['PurchaseOrderItemID','POI'],
 RestockRecommendation: ['RestockID','R'], Role: ['RoleID','RL'], Sales: ['SaleID','S'],
 Supplier: ['SupplierID','SUP'], User: ['UserID','U'], UserActivity: ['UserActivityID','UAD'], Warehouse: ['WarehouseID','WH']
};
const quote = value => '`' + value.replace(/`/g, '``') + '`';
async function nextEntityId(conn, table) {
 table = table.replace(/`/g, '');
 const config = entities[table] || {Transfer:['TransferID','TF'],TransferDetail:['TransferDetailID','TD']}[table];
 if (!config) throw new Error('Unknown ID entity: ' + table);
 const [column,prefix] = config;
 const [result] = await conn.query(`INSERT INTO EntityIdSequence (Entity, NextValue)
 SELECT :entity, LAST_INSERT_ID(COALESCE(MAX(CAST(SUBSTRING(${quote(column)}, :start) AS UNSIGNED)),0)+1)
 FROM ${quote(table)} WHERE ${quote(column)} REGEXP :pattern
 ON DUPLICATE KEY UPDATE NextValue=LAST_INSERT_ID(GREATEST(NextValue+1,VALUES(NextValue)))`,
 {entity:table,start:prefix.length+2,pattern:'^'+prefix+'-[0-9]{3,9}$'});
 return prefix+'-'+String(result.insertId).padStart(3,'0');
}
module.exports = {entities,nextEntityId,quote};
