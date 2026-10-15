export function validatePickupSchedule(details, now = new Date()) {
  const { pickupDate, pickupTime } = details || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate || "") || !/^\d{2}:\d{2}$/.test(pickupTime || "")) {
    return "Please select both Pickup Date and Pickup Time.";
  }
  const schedule = new Date(`${pickupDate}T${pickupTime}:00+08:00`);
  const [hours, minutes] = pickupTime.split(":").map(Number);
  if (!Number.isFinite(schedule.getTime()) || hours > 23 || minutes > 59) return "Please select a valid pickup schedule.";
  if (schedule <= now) return "Invalid pickup time. Please select an upcoming slot.";
  if (hours * 60 + minutes < 8 * 60 || hours * 60 + minutes > 18 * 60) return "Pickup time must be between 8:00 AM and 6:00 PM.";
  return "";
}
