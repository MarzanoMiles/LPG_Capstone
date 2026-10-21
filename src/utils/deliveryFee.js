export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Keep identical to Backend/utils/deliveryFee.js
export function calculateDeliveryFee(rate, distanceKm, orderTotal) {
  if (!rate || !Number.isFinite(Number(distanceKm))) return 0;
  const freeAt = Number(rate.freeDeliverySubtotal) || 0;
  if (freeAt > 0 && Number(orderTotal) >= freeAt) return 0;
  return round2(Number(rate.baseRate) + Number(rate.perKmRate) * Number(distanceKm));
}