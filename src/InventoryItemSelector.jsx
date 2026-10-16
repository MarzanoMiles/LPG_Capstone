import { formatUnitValue } from "./utils/unitValue.js";
import { getItemChoices, updateItemSelection } from "./utils/inventoryItemSelection";
import "./InventoryItemSelector.css";

export default function InventoryItemSelector({ products, item, onChange, rowNumber }) {
  const { categories, derived, categoryProducts, brandProducts, brands, weights, matches } = getItemChoices(products, item);
  const change = (field, value) => onChange(updateItemSelection(products, item, field, value));
  const chooseMatchingProduct = derived && matches.length > 1;
  const selected = categoryProducts.find(product => String(product.productId) === String(item.productId));
  return (
    <>
      <td className="movement-category-cell">
        <select aria-label={`Category for item ${rowNumber}`} value={item.category || ""} onChange={event => change("category", event.target.value)}>
          <option value="">Select category</option>
          {categories.map(category => <option key={category}>{category}</option>)}
        </select>
      </td>
      
        <td className="movement-brand-cell">
          <select aria-label={`Brand for item ${rowNumber}`} value={item.brand || ""} disabled={!item.category} onChange={event => change("brand", event.target.value)}>
            <option value="">Select brand</option>
            {brands.map(brand => <option key={brand}>{brand}</option>)}
          </select>
        </td>
        <td className="movement-weight-cell">
        {derived ? <>
          <select aria-label={`Unit value for item ${rowNumber}`} value={item.weight || ""} disabled={!item.brand} onChange={event => change("weight", event.target.value)}>
            <option value="">Select unit value</option>
            {weights.map(weight => <option key={weight}>{weight}</option>)}
          </select>
        </> : <output aria-live="polite">{formatUnitValue(selected?.unitValue, selected?.unit) || "?"}</output>}
        </td>
      <td className="movement-product-cell">{derived && !chooseMatchingProduct ? <>
        <output aria-live="polite">{selected?.name || (item.brand && item.weight ? "No matching product available." : "Choose brand and unit value")}</output>
      </> : <>
        <select aria-label={`Product for item ${rowNumber}`} value={item.productId} disabled={!item.category || !item.brand} onChange={event => change("productId", event.target.value)}>
          <option value="">{chooseMatchingProduct ? "Select cylinder variant" : "Select product"}</option>
          {(chooseMatchingProduct ? matches : brandProducts).map(product => <option key={product.productId} value={product.productId}>{product.name}</option>)}
        </select>
      </>}</td>
    </>
  );
}
