import React, { useState } from "react";
import { X } from "lucide-react";
import { apiRequest } from "./api";

export default function ForgotPasswordModal({ isOpen, onClose }) {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (!isOpen) return null;

  const reset = () => {
    setEmail("");
    setMessage("");
    setError("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    setIsSubmitting(true);
    setError("");
    setMessage("");
    try {
      const result = await apiRequest("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setMessage(result.message);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(17,24,39,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16,
      }}
      onClick={handleClose}
    >
      <div
        style={{
          background: "#fff", borderRadius: 16, padding: "28px 32px", width: "100%", maxWidth: 420,
          boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0, color: "#111827" }}>Forgot Password</h2>
            <p style={{ fontSize: "0.85rem", color: "#6b7280", margin: "6px 0 0 0" }}>
              Enter the email associated with your account and we'll send you a link to reset your password.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", flexShrink: 0 }}
          >
            <X size={20} />
          </button>
        </div>

        {message ? (
          <div style={{ marginTop: 20 }}>
            <p style={{ color: "#16a34a", fontWeight: 600, fontSize: "0.9rem" }}>{message}</p>
            <button
              type="button"
              onClick={handleClose}
              style={{
                marginTop: 12, width: "100%", padding: "11px 0", borderRadius: 8, border: "none",
                background: "#1e3a5f", color: "#fff", fontWeight: 700, cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ marginTop: 20 }}>
            {error && <p style={{ color: "#dc2626", fontWeight: 600, fontSize: "0.85rem", marginBottom: 12 }}>{error}</p>}

            <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#374151", display: "block", marginBottom: 6 }}>
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              style={{
                width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "11px 14px",
                fontSize: "0.9rem", boxSizing: "border-box",
              }}
              autoFocus
            />

            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                marginTop: 18, width: "100%", padding: "12px 0", borderRadius: 8, border: "none",
                background: "#1e3a5f", color: "#fff", fontWeight: 700, cursor: "pointer",
                opacity: isSubmitting ? 0.7 : 1,
              }}
            >
              {isSubmitting ? "Sending…" : "Send Reset Link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}