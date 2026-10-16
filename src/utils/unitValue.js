// Accept numeric values and legacy values that repeat their measurement unit.
export function numericUnitValue(value, unit) {
  if (value == null || String(value).trim() === '') return null;
  let text = String(value).trim();
  const suffix = String(unit || '').trim();
  if (suffix && text.toLowerCase().endsWith(suffix.toLowerCase())) text = text.slice(0, -suffix.length).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
export function formatUnitValue(value, unit) {
  const number = numericUnitValue(value, unit);
  return number == null || !unit ? '' : `${number} ${unit}`;
}
