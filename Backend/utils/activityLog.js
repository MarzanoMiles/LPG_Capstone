const {historicalDescription} = require('./activityDescriptions');
const MODULE_SEPARATOR = " — ";

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasFeature(moduleLabel) {
  return moduleLabel.includes(MODULE_SEPARATOR);
}

function detectInventoryFeature(action, description) {
  const context = `${action || ""} ${description || ""}`.toLowerCase();
  if (/\bstock[\s-]?in\b/.test(context)) return "Stock In";
  if (/\bstock[\s-]?out\b/.test(context)) return "Stock Out";
  if (/\btransfer\b/.test(context)) return "Transfer";
  if (/\btransaction\b/.test(context)) return "Inventory Transactions";
  return "";
}

function withFeature(base, feature) {
  if (!feature) return base;
  return `${base}${MODULE_SEPARATOR}${feature}`;
}

function resolveActivityModule(module, action, description) {
  const normalizedModule = normalizeWhitespace(module);
  if (!normalizedModule) return "General";
  if (hasFeature(normalizedModule)) return normalizedModule;

  const moduleKey = normalizedModule.toLowerCase();
  if (moduleKey === "inventory" || moduleKey === "inventory management") {
    return withFeature("Inventory", detectInventoryFeature(action, description));
  }

  return normalizedModule;
}

function toActivityTimestamp(value) {
  if (value == null) return null;

  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return Math.trunc(asNumber * 1000);
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function mapActivityRow(row, timestampField) {
  return {
    ...row,
    description: historicalDescription(row.description),
    module: resolveActivityModule(row.module, row.action, row.description),
    [timestampField]: toActivityTimestamp(row[timestampField]),
  };
}

module.exports = {
  mapActivityRow,
  resolveActivityModule,
};

