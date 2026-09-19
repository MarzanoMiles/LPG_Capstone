import React, { useEffect, useMemo, useState } from "react";
import { Search, ChevronDown, ShoppingCart, ImageOff, Wallet, Minus, Plus, X } from "lucide-react";
import PaymentModal from "./PaymentModal";
import { apiRequest } from "./api";
import "./PosTerminal.css";

// ---------------------------------------------------------------------------
// Products are fetched from GET /products (backend/routes/productRoutes.js).
// Each row includes an aggregated `stock` field (sum across all warehouses)
// and a real numeric ProductID — never hardcode mock string IDs here.
// ---------------------------------------------------------------------------

const discountOptions = [
  { label: "No Discount", value: 0 },
  { label: "Senior/PWD (5%)", value: 0.05 },
  { label: "Member (10%)", value: 0.1 },
];

const paymentMethods = ["Cash", "GCash", "Card", "Bank Transfer"];
const customerTypes = ["Walk-in", "Regular Customer", "Business Account"];

const VAT_RATE = 0.12;

function formatPeso(amount) {
  return `₱${amount.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Product card
// ---------------------------------------------------------------------------

function ProductCard({ product, onAdd }) {
  const outOfStock = product.stock <= 0;
  return (
    <button
      type="button"
      className="product-card"
      onClick={() => onAdd(product)}
      disabled={outOfStock}
      style={outOfStock ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
    >
      <span className="product-category">{product.category}</span>
      <div className="product-image">
        {product.image ? (
          <img src={product.image} alt={product.name} className="product-image-img" />
        ) : (
          <ImageOff size={28} strokeWidth={1.5} />
        )}
      </div>
      <p className="product-name">{product.name}</p>
      <p className="product-stock">{outOfStock ? "Out of stock" : `Stock: ${product.stock}`}</p>
      <p className="product-price">{formatPeso(product.price)}</p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Cart line item
// ---------------------------------------------------------------------------

function CartItem({ item, onIncrement, onDecrement, onRemove }) {
  return (
    <div className="cart-item">
      <div className="cart-item-info">
        <p className="cart-item-name">{item.name}</p>
        <p className="cart-item-price">{formatPeso(item.price)} each</p>
      </div>
      <div className="cart-item-controls">
        <button type="button" className="qty-btn" onClick={() => onDecrement(item.id)} aria-label="Decrease quantity">
          <Minus size={14} />
        </button>
        <span className="qty-value">{item.qty}</span>
        <button type="button" className="qty-btn" onClick={() => onIncrement(item.id)} aria-label="Increase quantity">
          <Plus size={14} />
        </button>
      </div>
      <span className="cart-item-total">{formatPeso(item.price * item.qty)}</span>
      <button type="button" className="cart-item-remove" onClick={() => onRemove(item.id)} aria-label="Remove item">
        <X size={14} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Print receipt helper
// ---------------------------------------------------------------------------

function printSaleReceipt(sale, cartItems, customerType) {
  const printWindow = window.open("", "_blank", "width=380,height=600");
  if (!printWindow) {
    alert("Please allow popups for printing.");
    return;
  }
  const rows = cartItems
    .map(
      (it) =>
        `<tr><td>${it.name}</td><td>${it.qty}</td><td>₱${it.price.toFixed(2)}</td><td>₱${(it.qty * it.price).toFixed(2)}</td></tr>`
    )
    .join("");
  printWindow.document.write(`
    <html>
      <head><title>Receipt ${sale.saleNo}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 16px; max-width: 320px; margin: 0 auto; font-size: 13px; }
        h2 { text-align: center; margin-bottom: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { padding: 4px; text-align: left; border-bottom: 1px solid #ddd; }
        .totals { margin-top: 12px; text-align: right; }
        .totals p { margin: 2px 0; }
        .grand { font-weight: bold; font-size: 1.1em; }
      </style>
      </head>
      <body>
        <h2>GasTrack Receipt</h2>
        <p style="text-align:center;">${sale.saleNo}</p>
        <p>Customer Type: ${customerType}</p>
        <table>
          <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="totals">
          <p>Subtotal: ₱${sale.subtotal.toFixed(2)}</p>
          <p>Discount: ₱${sale.discount.toFixed(2)}</p>
          <p>VAT (12%): ₱${sale.vat.toFixed(2)}</p>
          <p class="grand">Total: ₱${sale.totalAmount.toFixed(2)}</p>
        </div>
        <p style="text-align:center; margin-top:20px;">Thank you!</p>
        <script>window.onload = function() { window.print(); window.close(); }<\/script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

// ---------------------------------------------------------------------------
// Main POS Terminal component
// ---------------------------------------------------------------------------

export default function PosTerminal() {
  const [products, setProducts] = useState([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [category, setCategory] = useState("All Categories");
  const [cart, setCart] = useState([]);
  const [discountValue, setDiscountValue] = useState(0);
  const [customerType, setCustomerType] = useState("Walk-in");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [posError, setPosError] = useState("");

  // Fetch real products (with live stock) from the backend
  useEffect(() => {
    let cancelled = false;
    setIsLoadingProducts(true);
    apiRequest("/products?status=Active")
      .then((data) => {
        if (cancelled) return;
        const mapped = data.map((p) => ({
          id: p.productId, // real numeric ProductID from the DB
          category: p.category,
          name: p.name,
          stock: Number(p.stock),
          price: Number(p.unitPrice),
          image: p.imageUrl ? `${import.meta.env.BASE_URL}${p.imageUrl}` : null,
        }));
        setProducts(mapped);
        setLoadError("");
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message || "Failed to load products.");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingProducts(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(
    () => ["All Categories", ...new Set(products.map((p) => p.category))],
    [products]
  );

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesCategory = category === "All Categories" || p.category === category;
      const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [products, searchTerm, category]);

  const addToCart = (product) => {
    if (product.stock <= 0) return;
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        if (existing.qty >= product.stock) return prev; // don't exceed available stock
        return prev.map((item) =>
          item.id === product.id ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...prev, { ...product, qty: 1 }];
    });
  };

  const incrementItem = (id) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        if (item.qty >= item.stock) return item; // cap at available stock
        return { ...item, qty: item.qty + 1 };
      })
    );
  };

  const decrementItem = (id) => {
    setCart((prev) =>
      prev
        .map((item) => (item.id === id ? { ...item, qty: item.qty - 1 } : item))
        .filter((item) => item.qty > 0)
    );
  };

  const removeItem = (id) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  const clearCart = () => setCart([]);

  const holdCart = () => {
    console.log("Order held:", cart);
  };

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.qty, 0), [cart]);
  const discount = subtotal * discountValue;
  const vat = (subtotal - discount) * VAT_RATE;
  const total = subtotal - discount + vat;

  const handlePay = () => {
    if (cart.length === 0) return;
    setPosError("");
    setShowPaymentModal(true);
  };

  const handleConfirmPayment = async ({ amountCollected, changeDue, printReceipt }) => {
    if (cart.length === 0) return;
    setIsProcessing(true);
    setPosError("");

    try {
      const response = await apiRequest("/sales", {
        method: "POST",
        body: JSON.stringify({
          customerType,
          items: cart.map((item) => ({
            productId: item.id,
            qty: item.qty,
            unitPrice: item.price,
          })),
          discount,
          paymentMethod: paymentMethod || "Cash",
          amountCollected,
        }),
      });

      if (printReceipt) {
        printSaleReceipt(response, cart, customerType);
      }

      setShowPaymentModal(false);
      clearCart();
      alert(`Sale ${response.saleNo} completed. Change due: ₱${response.changeDue?.toFixed(2) ?? "0.00"}`);

      // Refresh stock counts after a successful sale
      apiRequest("/products?status=Active")
        .then((data) => {
          const mapped = data.map((p) => ({
            id: p.productId,
            category: p.category,
            name: p.name,
            stock: Number(p.stock),
            price: Number(p.unitPrice),
            image: p.imageUrl ? `${import.meta.env.BASE_URL}${p.imageUrl}` : null,
          }));
          setProducts(mapped);
        })
        .catch(() => {});
    } catch (err) {
      setPosError(err.message || "Failed to process payment. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="pos">
      <div className="pos-inner">
        <h1 className="pos-title">POS Terminal</h1>

        {posError && (
          <p style={{ color: "#dc2626", fontWeight: 600, margin: "0 0 8px 0" }}>{posError}</p>
        )}

        {/* Tabs */}
        <div className="pos-tabs">
          <span className="pos-tab active">Cart</span>
        </div>

        <div className="pos-layout">
          {/* Left: product browser */}
          <div className="pos-main">
            <div className="pos-toolbar">
              <div className="pos-search">
                <Search size={16} className="pos-search-icon" />
                <input
                  type="text"
                  placeholder="Search Product"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pos-search-input"
                />
              </div>
              <div className="pos-select-wrap">
                <select
                  className="pos-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <ChevronDown size={16} className="pos-select-icon" />
              </div>
            </div>

            <div className="product-grid">
              {isLoadingProducts && <p className="no-results">Loading products…</p>}
              {!isLoadingProducts && loadError && (
                <p className="no-results" style={{ color: "#dc2626" }}>{loadError}</p>
              )}
              {!isLoadingProducts &&
                !loadError &&
                filteredProducts.map((product) => (
                  <ProductCard key={product.id} product={product} onAdd={addToCart} />
                ))}
              {!isLoadingProducts && !loadError && filteredProducts.length === 0 && (
                <p className="no-results">No products match your search.</p>
              )}
            </div>
          </div>

          {/* Right: cart + checkout */}
          <div className="pos-sidebar">
            {/* Cart Summary */}
            <div className="pos-panel">
              <div className="pos-panel-header">
                <ShoppingCart size={16} />
                <span>Cart Summary</span>
              </div>
              <div className="pos-panel-body">
                <div className="cart-actions">
                  <button type="button" className="cart-action-btn" onClick={holdCart}>
                    Hold
                  </button>
                  <button type="button" className="cart-action-btn" onClick={clearCart}>
                    Clear
                  </button>
                </div>

                <div className="cart-items">
                  {cart.length === 0 ? (
                    <p className="cart-empty">Cart is empty. Tap a product to add it.</p>
                  ) : (
                    cart.map((item) => (
                      <CartItem
                        key={item.id}
                        item={item}
                        onIncrement={incrementItem}
                        onDecrement={decrementItem}
                        onRemove={removeItem}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Checkout */}
            <div className="pos-panel">
              <div className="pos-panel-header">
                <Wallet size={16} />
                <span>Checkout</span>
              </div>
              <div className="pos-panel-body">
                <div className="pos-select-wrap full-width">
                  <select
                    className="pos-select"
                    value={customerType}
                    onChange={(e) => setCustomerType(e.target.value)}
                  >
                    {customerTypes.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} className="pos-select-icon" />
                </div>

                <div className="checkout-row-selects">
                  <div className="pos-select-wrap">
                    <select
                      className="pos-select"
                      value={discountValue}
                      onChange={(e) => setDiscountValue(Number(e.target.value))}
                    >
                      {discountOptions.map((d) => (
                        <option key={d.label} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={16} className="pos-select-icon" />
                  </div>

                  <div className="pos-select-wrap">
                    <select
                      className="pos-select"
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                    >
                      <option value="">Select Payment Method</option>
                      {paymentMethods.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={16} className="pos-select-icon" />
                  </div>
                </div>

                <div className="checkout-summary">
                  <div className="checkout-line">
                    <span>Subtotal:</span>
                    <span>{formatPeso(subtotal)}</span>
                  </div>
                  <div className="checkout-line">
                    <span>Discount:</span>
                    <span>{formatPeso(discount)}</span>
                  </div>
                  <div className="checkout-line">
                    <span>VAT (12%):</span>
                    <span>{formatPeso(vat)}</span>
                  </div>
                  <div className="checkout-line checkout-total">
                    <span>Total</span>
                    <span>{formatPeso(total)}</span>
                  </div>
                </div>

                <button
                  type="button"
                  className="pay-btn"
                  onClick={handlePay}
                  disabled={cart.length === 0 || isProcessing}
                >
                  {isProcessing ? "Processing…" : "Pay"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <PaymentModal
        isOpen={showPaymentModal}
        totalAmount={total}
        onCancel={() => setShowPaymentModal(false)}
        onConfirm={handleConfirmPayment}
      />
    </div>
  );
}