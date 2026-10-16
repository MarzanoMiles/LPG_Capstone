const ApiError = require('./apiError');

// Snapshot current catalog costs while creating the order transaction.
async function pricePurchaseOrderItems(conn, supplierId, items) {
  let totalCents = 0;
  const pricedItems = [];
  for (const item of items) {
    const [products] = await conn.query(`SELECT ProductID,CostPrice FROM Product WHERE ProductID=:productId AND SupplierID=:supplierId AND Status='Active' FOR UPDATE`, {productId:item.productId, supplierId});
    const product = products[0];
    if (!product) throw new ApiError(400, 'Each product must be active and belong to the selected supplier.');
    const cost = Number(product.CostPrice);
    const cents = Math.round(cost * 100);
    if (product.CostPrice == null || product.CostPrice === '' || !Number.isFinite(cost) || cost < 0 || !Number.isSafeInteger(cents) || Math.abs(cost * 100 - cents) > 0.00001) throw new ApiError(400, 'A selected product has an invalid cost price. Update its catalog cost before creating the order.');
    totalCents += item.qty * cents;
    if (!Number.isSafeInteger(totalCents) || totalCents > 999999999999) throw new ApiError(400, 'Total amount exceeds supported limits.');
    pricedItems.push({productId:item.productId, qty:item.qty, unitCost:cents / 100});
  }
  return {pricedItems, totalCents};
}
module.exports = {pricePurchaseOrderItems};
