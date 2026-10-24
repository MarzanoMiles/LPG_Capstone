const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate } = require("../middleware/auth");
const { getRestockPredictions } = require("../utils/mlClient");

async function nextId(conn, table) { return require("../utils/entityIds").nextEntityId(conn, table); }

router.use(authenticate);

const DEAD_STOCK_COVER_DAYS = 180;
const PRIORITY_RANK = { High: 0, Normal: 1, Low: 2 };
const rank = (r) => PRIORITY_RANK[r.priorityTag] ?? 1;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// One grouped query for every product. Windows are measured back from today
// (today excluded), matching ML/features.py and ML/train_model.py.
const SALES_WINDOWS_SQL = `
  SELECT ProductID,
    SUM(qty) AS sales_90d,
    SUM(IF(age <= 30, qty, 0)) AS sales_30d,
    SUM(IF(age <= 7, qty, 0)) AS sales_7d,
    SUM(IF(age BETWEEN 8 AND 14, qty, 0)) AS lag_1wk,
    SUM(IF(age BETWEEN 15 AND 21, qty, 0)) AS lag_2wk,
    SUM(IF(age BETWEEN 29 AND 35, qty, 0)) AS lag_4wk,
    SUM(IF(age <= 30, qty * qty, 0)) AS sumsq_30d
  FROM (
    SELECT od.ProductID, DATEDIFF(CURDATE(), DATE(MIN(o.OrderDate))) AS age, SUM(od.Quantity) AS qty
    FROM OrderDetails od JOIN \`Order\` o ON o.OrderID = od.OrderID
    WHERE o.OrderDate >= CURDATE() - INTERVAL 90 DAY AND o.OrderDate < CURDATE()
      AND o.OrderStatus NOT IN ('Cancelled','Unclaimed','Delivery Failed')
    GROUP BY od.ProductID, DATE(o.OrderDate)
  ) daily
  GROUP BY ProductID`;

// Observed supplier lead times (PO date to first supplier-delivery stock-in).
const LEAD_TIME_SQL = `
  SELECT supplierId, COUNT(*) AS n, STDDEV_POP(days) AS stdDays
  FROM (
    SELECT po.SupplierID AS supplierId, po.PurchaseOrderID AS poId,
           GREATEST(DATEDIFF(MIN(t.TransactionDate), MIN(po.OrderDate)), 0) AS days
    FROM PurchaseOrder po
    JOIN InventoryTransaction t ON t.ReferenceNo = po.PONo
      AND t.TransactionType = 'Stock In' AND t.Reason = 'Supplier Delivery'
    WHERE po.Status = 'Received'
    GROUP BY po.PurchaseOrderID, po.SupplierID
  ) x
  GROUP BY supplierId`;

async function loadProductInputs(companyId, productId = null) {
  const [products] = await pool.query(
    `SELECT p.ProductID AS productId, p.ProductName AS productName, p.SupplierID AS supplierId,
            sup.SupplierName AS supplierName, p.ReorderLevel AS reorderLevel, p.CostPrice AS costPrice,
            p.MinOrderQuantity AS minOrderQuantity, p.BudgetCap AS budgetCap, p.PriorityTag AS priorityTag,
            COALESCE(sup.LeadTimeDays, 3) AS leadTime
     FROM Product p JOIN Supplier sup ON sup.SupplierID = p.SupplierID
     WHERE p.Status = 'Active'${productId ? " AND p.ProductID = :productId" : ""}`,
    productId ? { productId } : {}
  );
  if (!products.length) return [];

  const [stockRows] = await pool.query(
    `SELECT i.ProductID AS productId, SUM(i.StockOnHand) AS stock
     FROM Inventory i JOIN Warehouse w ON w.WarehouseID = i.WarehouseID
     WHERE w.CompanyID = :companyId GROUP BY i.ProductID`, { companyId });
  const [salesRows] = await pool.query(SALES_WINDOWS_SQL);
  const [restockRows] = await pool.query(
    `SELECT i.ProductID AS productId, MAX(DATE(t.TransactionDate)) AS lastDate
     FROM InventoryTransaction t JOIN Inventory i ON i.InventoryID = t.InventoryID
     JOIN Warehouse w ON w.WarehouseID = i.WarehouseID
     WHERE w.CompanyID = :companyId AND t.TransactionType = 'Stock In'
       AND t.Reason IN ('Purchase','Supplier Delivery') AND t.TransactionDate < CURDATE()
     GROUP BY i.ProductID`, { companyId });
  const [leadRows] = await pool.query(LEAD_TIME_SQL);

  const stockBy = new Map(stockRows.map((r) => [r.productId, Number(r.stock)]));
  const salesBy = new Map(salesRows.map((r) => [r.ProductID, r]));
  const lastBy = new Map(restockRows.map((r) => [r.productId, r.lastDate]));
  const leadBy = new Map(leadRows.map((r) => [r.supplierId, r]));
  const today = new Date(); today.setHours(0, 0, 0, 0);

  return products.map((p) => {
    const s = salesBy.get(p.productId) || {};
    const num = (k) => Number(s[k] || 0);
    const meanDaily = num("sales_30d") / 30;
    const dailyStd = Math.sqrt(Math.max(num("sumsq_30d") / 30 - meanDaily ** 2, 0));
    const leadTime = Math.max(Math.round(Number(p.leadTime) || 3), 1);
    const lt = leadBy.get(p.supplierId);
    const leadStd = lt && Number(lt.n) >= 2 ? Number(lt.stdDays) || 0 : leadTime * 0.25;
    const last = lastBy.get(p.productId);
    const daysSince = last ? Math.max(Math.round((today - new Date(last)) / 86400000), 0) : 30;
    const stock = Number(stockBy.get(p.productId) || 0);
    const sales90 = num("sales_90d");
    const avg90 = sales90 / 90;
    const daysOfCover = avg90 > 0 ? stock / avg90 : null;
    return {
      productId: p.productId, productName: p.productName, supplierId: p.supplierId, supplierName: p.supplierName,
      reorderLevel: Number(p.reorderLevel) || 0, costPrice: Number(p.costPrice) || 0,
      minOrderQuantity: Math.max(Number(p.minOrderQuantity) || 1, 1),
      budgetCap: p.budgetCap == null ? null : Number(p.budgetCap),
      priorityTag: p.priorityTag || "Normal",
      stock, sales90d: sales90, daysOfCover,
      deadStock: stock > 0 && (sales90 === 0 || daysOfCover > DEAD_STOCK_COVER_DAYS),
      ml: {
        productId: p.productId, current_stock: stock, lead_time_days: leadTime, lead_time_std_days: leadStd,
        daily_demand_std: dailyStd, min_order_quantity: Math.max(Number(p.minOrderQuantity) || 1, 1),
        sales_7d: num("sales_7d"), sales_30d: num("sales_30d"), sales_90d: sales90,
        lag_1wk: num("lag_1wk"), lag_2wk: num("lag_2wk"), lag_4wk: num("lag_4wk"),
        days_since_last_restock: daysSince,
      },
    };
  });
}

// Minimum order floor is inside the forecast formula; the budget cap is applied here.
function applyProductConstraints(r) {
  let qty = Math.max(r.recommendedQty, r.minOrderQuantity);
  let capped = false;
  if (r.budgetCap > 0 && r.costPrice > 0 && qty * r.costPrice > r.budgetCap) {
    qty = Math.floor(r.budgetCap / r.costPrice);
    capped = true;
  }
  return { ...r, finalQty: qty, budgetCapped: capped };
}

async function buildRecommendations(companyId, productId = null) {
  const inputs = await loadProductInputs(companyId, productId);
  const predictions = await getRestockPredictions(inputs.map((i) => i.ml));
  const byId = new Map(predictions.map((p) => [p.productId, p]));
  return inputs.filter((i) => byId.has(i.productId)).map((i) => {
    const p = byId.get(i.productId);
    return applyProductConstraints({
      ...i, predictedDemand: p.predictedDemand, safetyStock: p.safetyStock,
      recommendedQty: p.recommendedQuantity, confidence: p.confidence,
    });
  });
}

// High-priority items are funded first when a total budget is supplied.
function allocate(recs, totalBudget) {
  const sorted = [...recs].sort((a, b) => rank(a) - rank(b) || b.confidence - a.confidence);
  let remaining = totalBudget;
  const out = [];
  for (const r of sorted) {
    let qty = r.finalQty;
    let capped = r.budgetCapped;
    if (remaining != null && r.costPrice > 0) {
      const affordable = Math.floor(remaining / r.costPrice);
      if (qty > affordable) { qty = affordable; capped = true; }
    }
    if (qty < 1) continue;
    if (remaining != null) remaining = round2(remaining - qty * r.costPrice);
    out.push({ ...r, finalQty: qty, budgetCapped: capped });
  }
  return out;
}

async function insertRecommendation(r) {
  const restockId = await nextId(pool, "RestockRecommendation");
  await pool.query(
    `INSERT INTO RestockRecommendation
      (RestockID, ProductID, SupplierID, StockOnHand, PredictedDemand, RecommendedQuantity, OriginalSuggestedQty,
       SafetyStock, DaysOfCover, Sales90d, DeadStockAlert, BudgetCapped, Confidence, ForecastDate, Status)
     VALUES (:restockId, :productId, :supplierId, :stock, :predictedDemand, :qty, :qty,
       :safetyStock, :daysOfCover, :sales90d, :deadStock, :budgetCapped, :confidence, CURDATE(), 'Pending')`,
    {
      restockId, productId: r.productId, supplierId: r.supplierId, stock: r.stock,
      predictedDemand: r.predictedDemand, qty: r.finalQty, safetyStock: r.safetyStock,
      daysOfCover: r.daysOfCover == null ? null : round2(r.daysOfCover), sales90d: r.sales90d,
      deadStock: Number(r.deadStock), budgetCapped: Number(r.budgetCapped), confidence: r.confidence,
    }
  );
  return restockId;
}

// Refreshes forecast fields on pending rows. A quantity the user has not
// overridden follows the new forecast; an overridden one is left alone.
async function rescorePending(companyId, { recs, onlyMissing = false } = {}) {
  const [rows] = await pool.query(
    `SELECT RestockID, ProductID, RecommendedQuantity, OriginalSuggestedQty FROM RestockRecommendation
     WHERE Status = 'Pending'${onlyMissing ? " AND (Confidence IS NULL OR SafetyStock IS NULL)" : ""}`
  );
  if (!rows.length) return 0;
  const byProduct = new Map((recs || (await buildRecommendations(companyId))).map((r) => [r.productId, r]));
  let updated = 0;
  for (const row of rows) {
    const r = byProduct.get(row.ProductID);
    if (!r) continue;
    const current = Number(row.RecommendedQuantity);
    const untouched = row.OriginalSuggestedQty != null && current === Number(row.OriginalSuggestedQty);
    const follow = untouched && r.finalQty >= 1;
    await pool.query(
      `UPDATE RestockRecommendation SET Confidence=:confidence, StockOnHand=:stock, PredictedDemand=:predictedDemand,
         SafetyStock=:safetyStock, DaysOfCover=:daysOfCover, Sales90d=:sales90d, DeadStockAlert=:deadStock,
         BudgetCapped=:budgetCapped, RecommendedQuantity=:qty, OriginalSuggestedQty=:original, ForecastDate=CURDATE()
       WHERE RestockID=:id`,
      {
        id: row.RestockID, confidence: r.confidence, stock: r.stock, predictedDemand: r.predictedDemand,
        safetyStock: r.safetyStock, daysOfCover: r.daysOfCover == null ? null : round2(r.daysOfCover),
        sales90d: r.sales90d, deadStock: Number(r.deadStock), budgetCapped: Number(r.budgetCapped),
        qty: follow ? r.finalQty : current, original: follow ? r.finalQty : (row.OriginalSuggestedQty ?? current),
      }
    );
    updated++;
  }
  return updated;
}

// GET /restocking?priority=&deadStock=true
router.get("/", asyncHandler(async (req, res) => {
  const { priority, deadStock } = req.query;

  if (String(deadStock) === "true") {
    const recs = await buildRecommendations(req.user.companyId);
    return res.json(
      recs.filter((r) => r.deadStock)
        .sort((a, b) => b.stock * b.costPrice - a.stock * a.costPrice)
        .map((r) => ({
          productId: r.productId, productName: r.productName, supplierName: r.supplierName,
          currentStock: r.stock, sales90d: r.sales90d,
          daysOfCover: r.daysOfCover == null ? null : round2(r.daysOfCover),
          reason: r.sales90d === 0 ? "No sales in the last 90 days" : `Over ${DEAD_STOCK_COVER_DAYS} days of cover`,
          costPrice: r.costPrice, stockValue: round2(r.stock * r.costPrice), priorityTag: r.priorityTag,
        }))
    );
  }

  try { await rescorePending(req.user.companyId, { onlyMissing: true }); }
  catch (err) { console.warn("Could not backfill restock forecasts:", err.message); }

  const [rows] = await pool.query(`
    SELECT r.RestockID AS restockId, r.ProductID AS productId, p.ProductName AS productName,
           p.Unit AS unit, p.CostPrice AS costPrice, r.SupplierID AS supplierId,
           s.SupplierName AS supplierName, r.StockOnHand AS currentStock, p.ReorderLevel AS reorderLevel,
           r.RecommendedQuantity AS suggestedQty, r.OriginalSuggestedQty AS originalSuggestedQty,
           r.PredictedDemand AS predictedDemand, r.SafetyStock AS safetyStock, r.DaysOfCover AS daysOfCover,
           r.BudgetCapped AS budgetCapped, r.Confidence AS confidence, r.Status AS status,
           r.ForecastDate AS forecastDate, p.PriorityTag AS priorityTag, p.MinOrderQuantity AS minOrderQuantity,
           CASE WHEN r.StockOnHand <= p.ReorderLevel THEN 'Critical' ELSE 'Low' END AS priority
    FROM RestockRecommendation r
    JOIN Product p ON p.ProductID = r.ProductID
    JOIN SupplierHistory s ON s.SupplierID = r.SupplierID
    WHERE r.Status = 'Pending' AND r.DeadStockAlert = 0
    ORDER BY FIELD(p.PriorityTag,'High','Normal','Low'), r.Confidence DESC, r.CreatedAt DESC`);
  res.json(priority ? rows.filter((r) => r.priority === priority) : rows);
}));

// POST /restocking/generate  { totalBudget? }
router.post("/generate", asyncHandler(async (req, res) => {
  const raw = req.body?.totalBudget;
  const totalBudget = raw == null || raw === "" ? null : Number(raw);
  if (totalBudget != null && (!Number.isFinite(totalBudget) || totalBudget <= 0)) {
    throw new ApiError(400, "Total budget must be a positive number.");
  }
  const recs = await buildRecommendations(req.user.companyId);
  const refreshed = await rescorePending(req.user.companyId, { recs });

  const [pendingRows] = await pool.query(`SELECT ProductID FROM RestockRecommendation WHERE Status = 'Pending'`);
  const pending = new Set(pendingRows.map((r) => r.ProductID));
  const candidates = recs.filter((r) =>
    !r.deadStock && !pending.has(r.productId) &&
    (r.stock <= r.reorderLevel || r.predictedDemand + r.safetyStock > r.stock)
  );

  const created = [];
  for (const r of allocate(candidates, totalBudget)) created.push(await insertRecommendation(r));
  res.status(201).json({ created: created.length, ids: created, refreshed });
}));

router.post("/rescore", asyncHandler(async (req, res) => {
  const refreshed = await rescorePending(req.user.companyId);
  res.json({ refreshed, message: `Re-scored ${refreshed} recommendation(s).` });
}));

// POST /restocking/:productId/quick (Dashboard reorder icon)
router.post("/:productId/quick", asyncHandler(async (req, res) => {
  const [existing] = await pool.query(
    `SELECT RestockID FROM RestockRecommendation WHERE ProductID = :pid AND Status = 'Pending'`,
    { pid: req.params.productId }
  );
  if (existing[0]) return res.json({ restockId: existing[0].RestockID, message: "Already queued for restocking." });

  const [r] = await buildRecommendations(req.user.companyId, req.params.productId);
  if (!r) throw new ApiError(404, "Active product not found.");
  if (r.deadStock) throw new ApiError(409, "This product is flagged as dead stock and was not queued.");
  if (r.finalQty < 1) throw new ApiError(409, "The product's budget cap is too low to order even one unit.");
  const restockId = await insertRecommendation(r);
  res.status(201).json({ restockId, message: "Added to the restocking queue." });
}));

// PUT /restocking/:id  { recommendedQuantity?, status?, overrideReason? }
router.put("/:id", asyncHandler(async (req, res) => {
  const { recommendedQuantity, status } = req.body;
  const reason = typeof req.body.overrideReason === "string" ? req.body.overrideReason.trim() : "";
  if (reason.length > 255) throw new ApiError(400, "Override reason must be at most 255 characters.");
  let qty = null;
  if (recommendedQuantity != null) {
    qty = Number(recommendedQuantity);
    if (!Number.isSafeInteger(qty) || qty < 1) throw new ApiError(400, "Quantity must be a positive whole number.");
  }
  if (status != null && (typeof status !== "string" || !status.trim() || status.length > 20)) {
    throw new ApiError(400, "Invalid status.");
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT r.RestockID, r.ProductID, r.RecommendedQuantity, r.OriginalSuggestedQty, r.Status,
              COALESCE(p.MinOrderQuantity, 1) AS moq
       FROM RestockRecommendation r LEFT JOIN Product p ON p.ProductID = r.ProductID
       WHERE r.RestockID = :id FOR UPDATE`, { id: req.params.id });
    const row = rows[0];
    if (!row) throw new ApiError(404, "Restock recommendation not found.");

    const current = Number(row.RecommendedQuantity);
    const qtyChanged = qty != null && qty !== current;
    const statusChanged = status != null && status !== row.Status;
    if (qtyChanged) {
      if (qty < Number(row.moq)) throw new ApiError(400, `The minimum order quantity for this product is ${row.moq}.`);
      if (!reason) throw new ApiError(400, "Enter a reason for changing the suggested quantity.");
    }
    if (!qtyChanged && !statusChanged) {
      await conn.commit();
      return res.json({ message: "No changes to save." });
    }

    const original = row.OriginalSuggestedQty ?? current;
    const finalQty = qtyChanged ? qty : current;
    const finalStatus = statusChanged ? status : row.Status;
    await conn.query(
      `UPDATE RestockRecommendation SET RecommendedQuantity=:finalQty, Status=:finalStatus,
         OriginalSuggestedQty=COALESCE(OriginalSuggestedQty,:original) WHERE RestockID=:id`,
      { id: req.params.id, finalQty, finalStatus, original }
    );
    await conn.query(
      `INSERT INTO RestockAuditLog (RestockID, ProductID, UserID, OriginalSuggestedQty, FinalQty, Status, OverrideReason)
       VALUES (:restockId, :productId, :userId, :original, :finalQty, :finalStatus, :reason)`,
      { restockId: row.RestockID, productId: row.ProductID, userId: req.user.userId, original, finalQty, finalStatus, reason: reason || null }
    );
    await conn.commit();
    res.json({ message: "Restock recommendation updated." });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

// DELETE: the removal is logged as a decision too (Status 'Deleted', FinalQty 0).
router.delete("/:id", asyncHandler(async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT RestockID, ProductID, RecommendedQuantity, OriginalSuggestedQty FROM RestockRecommendation WHERE RestockID=:id FOR UPDATE`,
      { id: req.params.id });
    const row = rows[0];
    if (!row) throw new ApiError(404, "Restock recommendation not found.");
    await conn.query(
      `INSERT INTO RestockAuditLog (RestockID, ProductID, UserID, OriginalSuggestedQty, FinalQty, Status, OverrideReason)
       VALUES (:restockId, :productId, :userId, :original, 0, 'Deleted', NULL)`,
      { restockId: row.RestockID, productId: row.ProductID, userId: req.user.userId, original: row.OriginalSuggestedQty ?? row.RecommendedQuantity }
    );
    await conn.query(`DELETE FROM RestockRecommendation WHERE RestockID=:id`, { id: req.params.id });
    await conn.commit();
    res.json({ message: "Restock recommendation deleted." });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));

module.exports = router;