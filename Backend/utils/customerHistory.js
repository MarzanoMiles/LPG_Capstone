const ApiError = require('./apiError');
const fields = ['historical_customer_id','customer_name','contact_number','address','customer_type'];
function validateCustomer(body) {
  // Existing POS clients submit a full name; require both components there too.
  if (body.firstName === undefined && body.lastName === undefined && typeof body.name === 'string') {
    const [firstName,...rest] = body.name.trim().split(/\s+/);
    body = {...body,firstName,lastName:rest.join(' ')};
  }
  const limits = {firstName:75,lastName:75,phone:30,address:255};
  const data = {};
  for (const [key,max] of Object.entries(limits)) {
    if (typeof body[key] !== 'string' || !body[key].trim() || body[key].trim().length > max)
      throw new ApiError(400, `${key} is required and must be at most ${max} characters.`);
    data[key] = body[key].trim();
  }
  if (!['Residential','Commercial'].includes(body.customerType)) throw new ApiError(400,'Customer Type must be Residential or Commercial.');
  if (data.phone === 'WALKIN' || data.phone === 'IMPORTED') throw new ApiError(400,'Contact number is reserved.');
  if (`${data.firstName} ${data.lastName}`.length > 150) throw new ApiError(400,'Full name must be at most 150 characters.');
  let companyName = null;
  if (body.customerType === 'Commercial') {
    if (typeof body.companyName !== 'string' || !body.companyName.trim() || body.companyName.trim().length > 150)
      throw new ApiError(400,'Company Name is required for commercial customers and must be at most 150 characters.');
    companyName = body.companyName.trim();
  }
  return {...data,companyName,name:companyName || `${data.firstName} ${data.lastName}`,type:body.customerType};
}
async function hardDeleteCustomer(pool,id) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM Customer WHERE CustomerID=:id FOR UPDATE',{id});
    if (!rows[0]) throw new ApiError(404,'Customer not found.');
    if (['WALKIN','IMPORTED'].includes(rows[0].ContactNo)) throw new ApiError(409,'System customers cannot be deleted.');
    // Existing snapshots always win; fill only missing values before decoupling.
    for (const table of ['Order','Sales']) {
      await conn.query(`UPDATE \`${table}\` t JOIN Customer c ON c.CustomerID=t.CustomerID SET
        t.historical_customer_id=COALESCE(t.historical_customer_id,c.CustomerID),
        t.customer_name=COALESCE(t.customer_name,c.CustomerName),
        t.contact_number=COALESCE(t.contact_number,c.ContactNo),
        t.address=COALESCE(t.address,c.Address),
        t.customer_type=COALESCE(t.customer_type,c.CustomerType) WHERE t.CustomerID=:id`,{id});
    }
    for (const table of ['Payment','Delivery']) {
      await conn.query(`UPDATE \`${table}\` t JOIN Sales s ON s.SaleID=t.SaleID SET ${fields.map(f=>`t.${f}=COALESCE(t.${f},s.${f})`).join(',')} WHERE s.CustomerID=:id`,{id});
    }
    await conn.query('UPDATE `Order` SET CustomerID=NULL WHERE CustomerID=:id',{id});
    await conn.query('UPDATE Sales SET CustomerID=NULL WHERE CustomerID=:id',{id});
    await conn.query('DELETE FROM Customer WHERE CustomerID=:id',{id});
    await conn.commit();
  } catch(err) {
    await conn.rollback();
    if (err instanceof ApiError) throw err;
    throw new ApiError(409,'Customer deletion failed; all changes rolled back. Check customer snapshot migration and dependent references.');
  } finally {conn.release();}
}
module.exports={validateCustomer,hardDeleteCustomer,fields};
