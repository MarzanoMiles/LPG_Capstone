import { formatUnitValue } from "./unitValue.js";
const normalize = value => String(value || "").trim().toLowerCase();
const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const weightOf = product => formatUnitValue(product.unitValue, product.unit);

export function getItemChoices(products, item) {
  const categoryProducts = products.filter(product => product.category === item.category);
  const derived = ["cylinder", "gasul lpg"].includes(normalize(item.category));
  const brandProducts = categoryProducts.filter(product => product.brand === item.brand);
  return {
    categories: unique(products.map(product => product.category)),
    categoryProducts,
    brandProducts,
    derived,
    brands: unique(categoryProducts.map(product => product.brand)),
    weights: unique(brandProducts.map(weightOf)),
    matches: brandProducts.filter(product => weightOf(product) === item.weight),
  };
}

export function updateItemSelection(products, item, field, value) {
  const next = { ...item, [field]: value, quantity: "" };
  if (field === "category") Object.assign(next, { brand: "", weight: "", productId: "" });
  if (field === "brand") Object.assign(next, { weight: "", productId: "" });
  const choices = getItemChoices(products, next);
  if (choices.derived) {
    const selectedMatch = field === "productId" && choices.matches.find(product => String(product.productId) === String(value));
    next.productId = next.brand && next.weight
      ? selectedMatch ? String(selectedMatch.productId) : choices.matches.length === 1 ? String(choices.matches[0].productId) : ""
      : "";
  } else if (!choices.brandProducts.some(product => String(product.productId) === String(next.productId))) {
    next.productId = "";
  }
  return next;
}
