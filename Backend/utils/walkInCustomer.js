const ApiError=require('./apiError');
async function resolveWalkInCustomer(conn) {
  const [rows]=await conn.query("SELECT CustomerID,CustomerName,ContactNo FROM Customer WHERE CustomerID='CUST-001' LIMIT 1");
  if(rows[0]) {
    if (rows[0].CustomerName === 'Walk-in Customer' && rows[0].ContactNo === 'N/A') {
      await conn.query("UPDATE Customer SET ContactNo='WALKIN' WHERE CustomerID='CUST-001'");
      return 'CUST-001';
    }
    if(rows[0].ContactNo && rows[0].ContactNo!=='WALKIN') throw new ApiError(409,'CUST-001 is reserved for walk-in orders but belongs to another customer.');
    return 'CUST-001';
  }
  await conn.query("INSERT INTO Customer(CustomerID,CustomerName,CustomerType,ContactNo,Address,Status) VALUES('CUST-001','','Residential','WALKIN','Walk-in','Active')");
  return 'CUST-001';
}
module.exports={resolveWalkInCustomer};
