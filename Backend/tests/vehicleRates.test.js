const test = require('node:test');
const assert = require('node:assert/strict');
const { validateVehicleRates } = require('../utils/vehicleRates');
const vehicle = { name: ' Truck ', capacityKg: 1000, baseRate: 0, perKmRate: 15.5, freeDeliverySubtotal: 5000 };
test('normalizes names and preserves zero rates and an empty matrix', () => {
  assert.deepEqual(validateVehicleRates([vehicle]), [{ ...vehicle, name: 'Truck' }]);
  assert.deepEqual(validateVehicleRates([]), []);
});
test('rejects duplicate classes regardless of casing or whitespace', () => {
  assert.throws(() => validateVehicleRates([vehicle, { ...vehicle, name: 'truck' }]), /unique/);
});
test('rejects missing, invalid, negative and oversized numeric fields', () => {
  for (const field of ['capacityKg', 'baseRate', 'perKmRate', 'freeDeliverySubtotal']) {
    for (const value of [undefined, null, '', '10', -1, Infinity, NaN, 1e20]) {
      assert.throws(() => validateVehicleRates([{ ...vehicle, [field]: value }]), /non-negative/);
    }
  }
});
test('requires a valid matrix and named vehicle records', () => {
  for (const value of [null, {}, [null], [{ ...vehicle, name: ' ' }], [{ ...vehicle, name: 'x'.repeat(101) }]]) {
    assert.throws(() => validateVehicleRates(value));
  }
});
