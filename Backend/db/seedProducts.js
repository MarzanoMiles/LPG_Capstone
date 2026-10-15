require("dotenv").config();
const pool = require("../config/db");

async function seedProducts() {
  const categoryGasul = "CTGRY-001";
  const categoryCylinder = "CTGRY-002";
  const brandGasul = "BD-001";
  const supplierId = "SUP-001";
  const warehouseId = "WH-001";

  // Seed Supplier
  await pool.query(
    `INSERT INTO Supplier (SupplierID, SupplierName, ContactPerson, Email, Address, Contact, LeadTimeDays, Status)
     VALUES (:sid, 'ABC Company', 'Juan Dela Cruz', 'abccompany@supplier.com', '146 Makinang, Manila City', '09875412558', 3, 'Active')
     ON DUPLICATE KEY UPDATE SupplierName = VALUES(SupplierName)`,
    { sid: supplierId }
  );

  const products = [
    { id: "P-001", invId: "INV-001", name: "Gasul LPG 2.7KG", categoryId: categoryGasul, unit: "kg", price: 249.0, cost: 217.0, reorder: 10, stock: 5, image: "assets/products/gasul-2.7kg.png" },
    { id: "P-002", invId: "INV-002", name: "Gasul LPG 7KG", categoryId: categoryGasul, unit: "kg", price: 603.0, cost: 491.07, reorder: 10, stock: 20, image: "assets/products/gasul-7kg.png" },
    { id: "P-003", invId: "INV-003", name: "Gasul LPG 11KG", categoryId: categoryGasul, unit: "kg", price: 907.0, cost: 809.82, reorder: 10, stock: 10, image: "assets/products/gasul-11kg.png" },
    { id: "P-004", invId: "INV-004", name: "Cylinder 2.7KG", categoryId: categoryCylinder, unit: "pcs", price: 1000.0, cost: 892.86, reorder: 5, stock: 10, image: null },
    { id: "P-005", invId: "INV-005", name: "Cylinder 7KG", categoryId: categoryCylinder, unit: "pcs", price: 1800.0, cost: 1600.0, reorder: 5, stock: 25, image: null },
    { id: "P-006", invId: "INV-006", name: "Cylinder 22KG", categoryId: categoryCylinder, unit: "pcs", price: 3800.0, cost: 3400.0, reorder: 5, stock: 25, image: null },
  ];

  for (const p of products) {
    await pool.query(
      `INSERT INTO Product (ProductID, ProductName, CategoryID, BrandID, SupplierID, Unit, UnitPrice, CostPrice, ReorderLevel, ImageURL, Status)
       VALUES (:id, :name, :cat, :brand, :sup, :unit, :price, :cost, :reorder, :img, 'Active')
       ON DUPLICATE KEY UPDATE UnitPrice = VALUES(UnitPrice)`,
      { id: p.id, name: p.name, cat: p.categoryId, brand: brandGasul, sup: supplierId, unit: p.unit, price: p.price, cost: p.cost, reorder: p.reorder, img: p.image }
    );

    await pool.query(
      `INSERT INTO Inventory (InventoryID, WarehouseID, ProductID, StockOnHand)
       VALUES (:invid, :wid, :pid, :stock)
       ON DUPLICATE KEY UPDATE StockOnHand = VALUES(StockOnHand)`,
      { invid: p.invId, wid: warehouseId, pid: p.id, stock: p.stock }
    );

    console.log(`Seeded product: ${p.name} (${p.id}), stock ${p.stock}`);
  }

  console.log("Product + inventory seed complete.");
  process.exit(0);
}

seedProducts().catch((err) => {
  console.error(err);
  process.exit(1);
});
