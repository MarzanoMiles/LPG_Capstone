import React, { useEffect, useMemo, useState } from "react";
import { Search, ChevronDown, ShoppingCart, ImageOff, Wallet, Minus, Plus, X, PauseCircle } from "lucide-react";
import PaymentModal from "./PaymentModal";
import { apiRequest } from "./api";
import { printReceipt } from "./utils/receipt";
import "./PosTerminal.css";

const discountOptions = [
  { label: "No Discount", value: 0 },
  { label: "Senior/PWD (5%)", value: 0.05 },
  { label: "Member (10%)", value: 0.1 },
];

const paymentMethods = ["Cash", "GCash", "Card", "Bank Transfer"];
const customerTypes = ["Walk-in", "Regular Customer", "Business Account"];
const HELD_CARTS_KEY = "gastrack_held_carts";

function formatPeso(amount) {
  return `₱${amount.toFixed(2)}`;
}

function loadHeldCarts() {
  try {
    const raw = localStorage.getItem(HELD_CARTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHeldCarts(carts) {
  try {
    localStorage.setItem(HELD_CARTS_KEY, JSON.stringify(carts));
  } catch {
    /* storage unavailable — held carts just won't persist across reloads */
  }
}

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
// Held Carts modal — view / restore / discard carts put on hold
// ---------------------------------------------------------------------------

function HeldCartsModal({ isOpen, onClose, heldCarts, onRestore, onDiscard }) {
  if (!isOpen) return null;
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 12, padding: "24px 28px", width: "100%", maxWidth: 460, maxHeight: "80vh", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: "1.15rem", fontWeight: 800, margin: 0 }}>Held Transactions</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <X size={20} />
          </button>
        </div>

        {heldCarts.length === 0 && (
          <p style={{ color: "#9ca3af", fontSize: "0.85rem", padding: "20px 0", textAlign: "center" }}>
            No held transactions. Tap "Hold" on a cart to save it for later.
          </p>
        )}

        {heldCarts.map((held) => {
          const total = held.items.reduce((sum, it) => sum + it.price * it.qty, 0);
          return (
            <div key={held.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{new Date(held.heldAt).toLocaleString()}</span>
                <span style={{ fontWeight: 700, color: "#2563eb" }}>{formatPeso(total)}</span>
              </div>
              <p style={{ margin: "0 0 8px 0", fontSize: "0.8rem", color: "#6b7280" }}>
                {held.items.length} item(s) · {held.customerType}
              </p>
              <ul style={{ margin: "0 0 10px 0", paddingLeft: 18, fontSize: "0.78rem", color: "#374151" }}>
                {held.items.slice(0, 4).map((it) => (
                  <li key={it.id}>{it.name} × {it.qty}</li>
                ))}
                {held.items.length > 4 && <li>+ {held.items.length - 4} more…</li>}
              </ul>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => onRestore(held)}
                  style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "none", background: "#1d6bf3", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.8rem" }}
                >
                  Restore
                </button>
                <button
                  type="button"
                  onClick={() => onDiscard(held.id)}
                  style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "1px solid #fca5a5", background: "#fff", color: "#dc2626", fontWeight: 700, cursor: "pointer", fontSize: "0.8rem" }}
                >
                  Discard
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

  const [heldCarts, setHeldCarts] = useState(() => loadHeldCarts());
  const [showHeldModal, setShowHeldModal] = useState(false);

  useEffect(() => {
    saveHeldCarts(heldCarts);
  }, [heldCarts]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingProducts(true);
    apiRequest("/products?status=Active")
      .then((data) => {
        if (cancelled) return;
        const mapped = data.map((p) => ({
          id: p.productId,
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
        if (existing.qty >= product.stock) return prev;
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
        if (item.qty >= item.stock) return item;
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
    if (cart.length === 0) {
      setPosError("Cart is empty — nothing to hold.");
      return;
    }
    setPosError("");
    const held = {
      id: `held-${Date.now()}`,
      heldAt: new Date().toISOString(),
      items: cart,
      customerType,
      discountValue,
      paymentMethod,
    };
    setHeldCarts((prev) => [held, ...prev]);
    clearCart();
  };

  const restoreHeldCart = (held) => {
    if (cart.length > 0) {
      const confirmed = window.confirm(
        "You have items in the current cart. Restoring will replace them. Continue?"
      );
      if (!confirmed) return;
    }
    setCart(held.items);
    setCustomerType(held.customerType || "Walk-in");
    setDiscountValue(held.discountValue || 0);
    setPaymentMethod(held.paymentMethod || "");
    setHeldCarts((prev) => prev.filter((h) => h.id !== held.id));
    setShowHeldModal(false);
  };

  const discardHeldCart = (heldId) => {
    const confirmed = window.confirm("Discard this held transaction? This cannot be undone.");
    if (!confirmed) return;
    setHeldCarts((prev) => prev.filter((h) => h.id !== heldId));
  };

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.qty, 0), [cart]);
  const discount = subtotal * discountValue;

  const handlePay = () => {
    if (cart.length === 0) return;
    setPosError("");
    setShowPaymentModal(true);
  };

  const handleConfirmPayment = async ({ amountCollected, changeDue, printReceipt: shouldPrint }) => {
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

      if (shouldPrint) {
        printReceipt({
          saleNo: response.saleNo,
          datetime: new Date(),
          orderType: "Walk-in",
          customerName: customerType,
          items: cart.map((it) => ({ name: it.name, qty: it.qty, unitPrice: it.price, subtotal: it.qty * it.price })),
          subtotal: response.subtotal,
          discount: response.discount,
          vat: response.vat,
          taxRate: response.taxRate,
          totalAmount: response.totalAmount,
          amountCollected,
          changeDue: response.changeDue,
        });
      }

      setShowPaymentModal(false);
      clearCart();
      alert(`Sale ${response.saleNo} completed. Change due: ₱${response.changeDue?.toFixed(2) ?? "0.00"}`);

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

        <div className="pos-tabs">
          <span className="pos-tab active">Cart</span>
        </div>

        <div className="pos-layout">
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
                    <option key={c} value={c}>{c}</option>
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

          <div className="pos-sidebar">
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
                  <button
                    type="button"
                    className="cart-action-btn"
                    onClick={() => setShowHeldModal(true)}
                    style={{ position: "relative" }}
                  >
                    <PauseCircle size={14} style={{ marginRight: 4, verticalAlign: "-2px" }} />
                    Restore
                    {heldCarts.length > 0 && (
                      <span
                        style={{
                          position: "absolute", top: -6, right: -6, background: "#ef4444", color: "#fff",
                          fontSize: "0.65rem", fontWeight: 700, borderRadius: 999, minWidth: 16, height: 16,
                          display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
                        }}
                      >
                        {heldCarts.length}
                      </span>
                    )}
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
                      <option key={c} value={c}>{c}</option>
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
                        <option key={d.label} value={d.value}>{d.label}</option>
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
                        <option key={m} value={m}>{m}</option>
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
                  <div className="checkout-line checkout-total">
                    <span>Total (incl. tax at checkout)</span>
                    <span>—</span>
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
        totalAmount={subtotal - discount}
        onCancel={() => setShowPaymentModal(false)}
        onConfirm={handleConfirmPayment}
      />

      <HeldCartsModal
        isOpen={showHeldModal}
        onClose={() => setShowHeldModal(false)}
        heldCarts={heldCarts}
        onRestore={restoreHeldCart}
        onDiscard={discardHeldCart}
      />
    </div>
  );
}