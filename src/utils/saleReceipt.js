// Converts a GET /sales/:id response into the shape receipt.js expects.
export function buildSaleReceipt(full) {
  const items = (full.items || []).map((it) => ({
    name: it.name,
    qty: it.qty,
    unitPrice: Number(it.costPrice),
    subtotal: Number(it.subtotal),
  }));
  return {
    ...full,
    orderType: full.type,
    completed: true,
    items,
    subtotal: items.reduce((sum, it) => sum + it.subtotal, 0),
    discount: Number(full.discount || 0),
    deliveryFee: Number(full.deliveryFee || 0),
    totalAmount: Number(full.amount || 0),
  };
}