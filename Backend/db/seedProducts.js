require("dotenv").config();
const pool = require("../config/db");

async function getOrCreate(table, idCol, matchCol, matchVal, extraCols = {}) {
  const [existing] = await pool.query(
    `SELECT ${idCol} AS id FROM ${table} WHERE ${matchCol} = :val LIMIT 1`,
    { val: matchVal }
  );
  if (existing[0]) return existing[0].id;

  const cols = [matchCol, ...Object.keys(extraCols)];
  const placeholders = cols.map((c) => `:${c}`);
  const params = { [matchCol]: matchVal, ...extraCols };
  const [result] = await pool.query(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`,
    params
  );
  return result.insertId;
}

async function seedProducts() {
  const categoryGasul = await getOrCreate("Category", "CategoryID", "Category", "Gasul LPG");
  const categoryCylinder = await getOrCreate("Category", "CategoryID", "Category", "Cylinder");
  const brandGasul = await getOrCreate("Brand", "BrandID", "Brand", "Gasul");

  const supplierId = await getOrCreate("Supplier", "SupplierID", "SupplierName", "ABC Company", {
    ContactPerson: "Juan Dela Cruz",
    Email: "abccompany@supplier.com",
    Address: "146 Makinang, Manila City",
    Contact: "09875412558",
    LeadTimeDays: 3,
    Status: "Active",
  });

  const [warehouseRows] = await pool.query(`SELECT WarehouseID FROM Warehouse LIMIT 1`);
  if (!warehouseRows[0]) {
    throw new Error("No warehouse found — run `npm run seed` first to create a company/warehouse.");
  }
  const warehouseId = warehouseRows[0].WarehouseID;

  const products = [
    { name: "Gasul LPG 2.7KG", categoryId: categoryGasul, unit: "kg", price: 249.0, cost: 217.0, reorder: 10, stock: 5, image: "assets/products/gasul-2.7kg.png" },
    { name: "Gasul LPG 7KG", categoryId: categoryGasul, unit: "kg", price: 603.0, cost: 491.07, reorder: 10, stock: 20, image: "assets/products/gasul-7kg.png" },
    { name: "Gasul LPG 11KG", categoryId: categoryGasul, unit: "kg", price: 907.0, cost: 809.82, reorder: 10, stock: 10, image: "assets/products/gasul-11kg.png" },
    { name: "Cylinder 2.7KG", categoryId: categoryCylinder, unit: "pcs", price: 1000.0, cost: 892.86, reorder: 5, stock: 10, image: null },
    { name: "Cylinder 7KG", categoryId: categoryCylinder, unit: "pcs", price: 1800.0, cost: 1600.0, reorder: 5, stock: 25, image: null },
    { name: "Cylinder 22KG", categoryId: categoryCylinder, unit: "pcs", price: 3800.0, cost: 3400.0, reorder: 5, stock: 25, image: null },
  ];

  for (const p of products) {
    const productId = await getOrCreate("Product", "ProductID", "ProductName", p.name, {
      CategoryID: p.categoryId,
      BrandID: brandGasul,
      SupplierID: supplierId,
      Unit: p.unit,
      UnitPrice: p.price,
      CostPrice: p.cost,
      ReorderLevel: p.reorder,
      ImageURL: p.image,
      Status: "Active",
    });

    const [invRows] = await pool.query(
      `SELECT InventoryID FROM Inventory WHERE WarehouseID = :wid AND ProductID = :pid`,
      { wid: warehouseId, pid: productId }
    );
    if (!invRows[0]) {
      await pool.query(
        `INSERT INTO Inventory (WarehouseID, ProductID, StockOnHand) VALUES (:wid, :pid, :stock)`,
        { wid: warehouseId, pid: productId, stock: p.stock }
      );
    }
    console.log(`Seeded product: ${p.name} (ProductID ${productId}), stock ${p.stock}`);
  }

  console.log("Product + inventory seed complete.");
  process.exit(0);
}

seedProducts().catch((err) => {
  console.error(err);
  process.exit(1);
});