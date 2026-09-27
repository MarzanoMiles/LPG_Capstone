import React, { useEffect, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { apiRequest } from "./api";
import "./Login.css";

function getTokenFromUrl() {
  // Supports both a hash-route link (#/reset-password?token=...) and a plain
  // query string (?token=...), since the exact routing setup can vary.
  const hashPart = window.location.hash.split("?")[1] || "";
  const hashParams = new URLSearchParams(hashPart);
  if (hashParams.get("token")) return hashParams.get("token");

  const queryParams = new URLSearchParams(window.location.search);
  return queryParams.get("token");
}

export default function ResetPasswordPage({ onDone }) {
  const [token] = useState(getTokenFromUrl);
  const [isValidating, setIsValidating] = useState(true);
  const [isTokenValid, setIsTokenValid] = useState(false);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!token) {
      setIsValidating(false);
      setIsTokenValid(false);
      return;
    }
    apiRequest(`/auth/reset-password/validate?token=${encodeURIComponent(token)}`)
      .then((res) => setIsTokenValid(res.valid))
      .catch(() => setIsTokenValid(false))
      .finally(() => setIsValidating(false));
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await apiRequest("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword: password }),
      });
      setSuccess(result.message);
    } catch (err) {
      setError(err.message || "Failed to reset password.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <main className="login-content">
        <div className="login-card">
          <h2 className="login-welcome">Reset Your Password</h2>

          {isValidating && <p className="login-subtitle">Checking your reset link…</p>}

          {!isValidating && !token && (
            <>
              <p className="login-error">No reset token was found in this link.</p>
              <button type="button" className="login-submit" onClick={onDone}>
                Back to Login
              </button>
            </>
          )}

          {!isValidating && token && !isTokenValid && !success && (
            <>
              <p className="login-error">
                This reset link is invalid or has expired. Please request a new one from the login page.
              </p>
              <button type="button" className="login-submit" onClick={onDone}>
                Back to Login
              </button>
            </>
          )}

          {!isValidating && isTokenValid && !success && (
            <form className="login-form" onSubmit={handleSubmit}>
              <p className="login-subtitle">Choose a new password for your account.</p>

              <div className="input-field-group">
                <Lock size={18} className="field-icon" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="New password (min. 8 characters)"
                  className="login-input has-toggle"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              <div className="input-field-group">
                <Lock size={18} className="field-icon" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Confirm new password"
                  className="login-input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              {error && <p className="login-error">{error}</p>}

              <button type="submit" className="login-submit" disabled={isSubmitting}>
                {isSubmitting ? "Resetting…" : "Reset Password"}
              </button>
            </form>
          )}

          {success && (
            <>
              <p style={{ color: "#16a34a", fontWeight: 600, fontSize: "0.9rem" }}>{success}</p>
              <button type="button" className="login-submit" onClick={onDone} style={{ marginTop: 12 }}>
                Go to Login
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}