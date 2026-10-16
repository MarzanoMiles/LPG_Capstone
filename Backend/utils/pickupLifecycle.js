const ApiError = require("./apiError");
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function localDate(value) {
  return new Date(String(value).replace(" ", "T").replace(/(?:Z|[+]08:00)$/, "") + "+08:00");
}
// The scheduled day is day zero. Expiration is closing time on the Nth subsequent business day.
function expiration(schedule, settings) {
  const days = String(settings.BusinessDays || "").split(",");
  const count = Number(settings.PickupExpirationDays);
  if (!days.some(day => weekdays.includes(day)) || !Number.isInteger(count) || count < 1 || !settings.ClosingTime || !settings.OpeningTime || settings.OpeningTime >= settings.ClosingTime) throw new ApiError(409, "Configure pickup expiration and operating hours in Settings.");
  const date = new Date(localDate(schedule).getTime() + 8 * 3600000);
  if (!Number.isFinite(date.getTime())) throw new ApiError(409, "Pickup schedule is missing or invalid.");
  let remaining = count;
  // Skip whole business weeks to keep large configured thresholds bounded.
  const perWeek = new Set(days.filter(day => weekdays.includes(day))).size;
  const weeks = Math.floor((remaining - 1) / perWeek);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  remaining -= weeks * perWeek;
  while (remaining) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (days.includes(weekdays[date.getUTCDay()])) remaining--;
  }
  return localDate(date.toISOString().slice(0, 10) + "T" + settings.ClosingTime);
}
function validateSchedule(details, settings, now = new Date()) {
  const { pickupDate, pickupTime } = details || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate || "") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(pickupTime || "")) throw new ApiError(400, "Select a valid pickup date and time.");
  const value = pickupDate + " " + pickupTime + ":00";
  const date = localDate(value);
  if (new Date(date.getTime() + 8 * 3600000).toISOString().slice(0,10) !== pickupDate || date <= now) throw new ApiError(400, "Pickup schedule must be a valid future date.");
  expiration(value, settings);
  if (!settings.BusinessDays.split(",").includes(weekdays[new Date(date.getTime() + 8 * 3600000).getUTCDay()]) || pickupTime < settings.OpeningTime.slice(0,5) || pickupTime > settings.ClosingTime.slice(0,5)) throw new ApiError(400, "Select a pickup schedule within configured business days and operating hours.");
  return value;
}
function transition(current, target, paid) {
  if (!paid) throw new ApiError(409, "Pickup must be paid before changing status.");
  if (!["Ready for Pickup", "Completed", "Cancelled"].includes(target)) throw new ApiError(400, "Invalid pickup action.");
  if (current === target) return false;
  if (!({Preparing: ["Ready for Pickup", "Cancelled"], "Ready for Pickup": ["Completed", "Cancelled"]}[current] || []).includes(target)) throw new ApiError(409, "Invalid pickup transition. Expired orders require Restock & Settle.");
  return true;
}
async function evaluate(conn, companyId, now = new Date()) {
  const [settings] = await conn.query("SELECT * FROM CompanySettings WHERE CompanyID = :companyId", {companyId});
  const [orders] = await conn.query(`SELECT o.OrderID, o.PickupScheduledAt FROM \`Order\` o WHERE o.OrderType='Pickup' AND o.PickupStatus IN ('Preparing','Ready for Pickup') AND EXISTS (SELECT 1 FROM Sales s JOIN UserHistory u ON u.UserID=s.UserID WHERE s.OrderID=o.OrderID AND u.CompanyID=:companyId AND (SELECT COALESCE(SUM(p.AmountPaid),0) FROM Payment p WHERE p.SaleID=s.SaleID)>=o.TotalAmount)`, {companyId});
  for (const order of orders) {
    if (!order.PickupScheduledAt) continue; // Legacy rows need a verified schedule; never invent one.
    if (!settings[0]) throw new ApiError(409, "Configure pickup policies in Settings.");
    if (now >= expiration(order.PickupScheduledAt, settings[0])) await conn.query("UPDATE `Order` SET PickupStatus='Unclaimed', OrderStatus='Unclaimed', PickupSettlementPending=1 WHERE OrderID=:id AND PickupStatus IN ('Preparing','Ready for Pickup')", {id: order.OrderID});
  }
}
module.exports = { expiration, validateSchedule, transition, evaluate };
