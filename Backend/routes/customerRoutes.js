const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { validateCustomer, hardDeleteCustomer } = require("../utils/customerHistory");
const { authenticate } = require("../middleware/auth");

async function nextCustomerId(conn, pad = 3) {
  const normalizedPrefix = "CUST";
  const [rows] = await conn.query(
    `SELECT CustomerID AS id FROM Customer WHERE CustomerID LIKE :pattern UNION SELECT historical_customer_id AS id FROM \`Order\` WHERE historical_customer_id LIKE :pattern UNION SELECT historical_customer_id AS id FROM Sales WHERE historical_customer_id LIKE :pattern`,
    { pattern: `${normalizedPrefix}%` }
  );

  let max = 0;
  const matcher = new RegExp(`^${normalizedPrefix}-?([0-9]+)$`);
  for (const row of rows) {
    const candidate = String(row.id || "").toUpperCase();
    const match = candidate.match(matcher);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isInteger(n) && n > max) max = n;
  }

  let next = max + 1;
  while (true) {
    const candidateId = `${normalizedPrefix}-${String(next).padStart(pad, "0")}`;
    const [existsRows] = await conn.query(
      `SELECT CustomerID AS id FROM Customer WHERE CustomerID = :id LIMIT 1`,
      { id: candidateId }
    );
    if (!existsRows[0]) return candidateId;
    next += 1;
  }
}

router.use(authenticate);
// GET /customers?search=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search, customerType } = req.query;
    let sql = `
      SELECT CustomerID AS id, CustomerName AS name, FirstName AS firstName, LastName AS lastName, CompanyName AS companyName, CustomerType AS type, ContactNo AS phone,
             Address AS address, Status AS status, CreatedAt AS created, UpdatedAt AS updated
      FROM Customer WHERE ContactNo != 'WALKIN' AND ContactNo != 'IMPORTED'`;
    const params = {};
    if (search) {
      sql += ` AND (CustomerName LIKE :s OR FirstName LIKE :s OR LastName LIKE :s OR ContactNo LIKE :s OR CustomerID = :sid)`;
      params.s = `%${search}%`;
      params.sid = String(search);
    }
    if (customerType && customerType !== 'All Customer Types') {
      if (!['Residential','Commercial'].includes(customerType)) throw new ApiError(400,'Invalid Customer Type filter.');
      sql += ' AND CustomerType=:customerType';
      params.customerType=customerType;
    }
    sql += ` ORDER BY CustomerID DESC`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT CustomerID AS id, CustomerName AS name, FirstName AS firstName, LastName AS lastName, CompanyName AS companyName, CustomerType AS type, ContactNo AS phone,
              Address AS address, Status AS status, CreatedAt AS created, UpdatedAt AS updated
       FROM Customer WHERE CustomerID = :id`,
      { id: req.params.id }
    );
    if (!rows[0]) throw new ApiError(404, "Customer not found.");
    res.json(rows[0]);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name, firstName, lastName, companyName, type, phone, address } = validateCustomer(req.body);

    const conn = await pool.getConnection();
    try {
      let createdId = null;

      for (let attempts = 0; attempts < 5; attempts += 1) {
        const customerId = await nextCustomerId(conn);
        try {
          await conn.query(
            `INSERT INTO Customer (CustomerID, CustomerName, FirstName, LastName, CompanyName, CustomerType, ContactNo, Address, Status)
             VALUES (:customerId, :name, :firstName, :lastName, :companyName, :type, :phone, :address, :status)`,
            {
              customerId,
              name,
              firstName, lastName, companyName, type,
              phone,
              address: address || "N/A",
              status: "Active",
            }
          );
          createdId = customerId;
          break;
        } catch (err) {
          if (err?.code !== "ER_DUP_ENTRY") throw err;
        }
      }

      if (!createdId) {
        throw new ApiError(409, "Could not generate a unique CustomerID. Please try again.");
      }

      res.status(201).json({ id: createdId });
    } finally {
      conn.release();
    }
  })
);

router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = validateCustomer(req.body);
    const [result] = await pool.query(
      `UPDATE Customer SET CustomerName=:name, FirstName=:firstName, LastName=:lastName, CompanyName=:companyName,
       ContactNo=:phone, Address=:address, CustomerType=:type WHERE CustomerID=:id`,
      {...data,id:req.params.id}
    );
    if (!result.affectedRows) throw new ApiError(404, "Customer not found.");
    res.json({ message: "Customer updated." });
  })
);

// Snapshots and FK decoupling are committed atomically with the hard delete.
router.delete("/:id", asyncHandler(async(req,res)=>{
  await hardDeleteCustomer(pool,req.params.id);
  res.json({message:"Customer permanently deleted. Transaction history preserved."});
}));
module.exports = router;
