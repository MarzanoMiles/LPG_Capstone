const ApiError=require("./apiError");
async function resolvePickupCustomer(conn,body) {
  const direct=body.customerId,nested=body.pickupDetails?.customerId;
  if(direct && nested && direct!==nested)throw new ApiError(400,"Pickup customer selection does not match.");
  const id=direct || nested;
  if(typeof id!=="string" || !id.trim())throw new ApiError(400,"Please select a customer for this pickup.");
  const [rows]=await conn.query("SELECT CustomerID,CustomerName,ContactNo FROM Customer WHERE CustomerID=:id AND Status='Active'",{id:id.trim()});
  if(!rows[0] || !String(rows[0].CustomerName || "").trim() || rows[0].ContactNo==='WALKIN')throw new ApiError(400,"Please select an active pickup customer with a name.");
  return rows[0].CustomerID;
}
module.exports={resolvePickupCustomer};
