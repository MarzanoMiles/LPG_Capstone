const ApiError = require('./apiError');

function validateVehicleRates(rates) {
  if (!Array.isArray(rates) || rates.length > 100) throw new ApiError(400, 'Provide a vehicle matrix with at most 100 vehicles.');
  const names = new Set();
  return rates.map(rate => {
    const name = typeof rate?.name === 'string' ? rate.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 100) throw new ApiError(400, 'Vehicle name/class is required (maximum 100 characters).');
    const key = name.toLowerCase();
    if (names.has(key)) throw new ApiError(400, 'Vehicle names/classes must be unique.');
    names.add(key);
    const result = { name };
    for (const field of ['capacityKg', 'baseRate', 'perKmRate', 'freeDeliverySubtotal']) {
      const value = rate[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 9999999999.99) {
        throw new ApiError(400, 'All vehicle numeric fields must be non-negative numbers up to 9999999999.99.');
      }
      result[field] = value;
    }
    return result;
  });
}
module.exports = { validateVehicleRates };
