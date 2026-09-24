import React, { useState } from "react";
import { Eye, EyeOff, User, Lock, Phone, Mail, Clock, ChevronDown } from "lucide-react";
import navLogo from "./assets/logo-login.png";
import cardLogo from "./assets/logo.png";
import { apiRequest } from "./api";
import "./Login.css";

// ---------------------------------------------------------------------------
// Registration field guards
//
// Two layers, deliberately kept separate:
//  1. "filters" run on every keystroke and strip characters that could never
//     be valid for that field (e.g. digits out of a name field), so the user
//     physically cannot type something wrong — this is the "should only
//     accept that type of input" behavior.
//  2. "patterns" run on submit (and live, once the user has tried to submit
//     once) to catch inputs that are made of valid characters but still
//     don't match the required shape (e.g. "AB1" is all valid characters for
//     a DTI number but too short) — these show an inline error message.
// ---------------------------------------------------------------------------

const filters = {
  companyName: (v) => v.replace(/[^A-Za-z0-9 .,&'-]/g, "").slice(0, 150),
  dtiSecNo: (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16),
  doeLicenseNo: (v) => v.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20),
  branchName: (v) => v.replace(/[^A-Za-z0-9 .,&'-]/g, "").slice(0, 100),
  cityMunicipality: (v) => v.replace(/[^A-Za-z .,'-]/g, "").slice(0, 100),
  completeAddress: (v) => v.slice(0, 255),
  firstName: (v) => v.replace(/[^A-Za-z\u00F1\u00D1' .-]/g, "").slice(0, 50),
  lastName: (v) => v.replace(/[^A-Za-z\u00F1\u00D1' .-]/g, "").slice(0, 50),
  email: (v) => v.replace(/\s/g, "").slice(0, 150),
  regPassword: (v) => v.slice(0, 64),
  confirmPassword: (v) => v.slice(0, 64),
};

const patterns = {
  companyName: { test: /^.{2,150}$/, message: "Company name must be at least 2 characters." },
  dtiSecNo: { test: /^[A-Z]{2,4}\d{6,12}$/, message: "Format: 2–4 letters followed by 6–12 digits, e.g. CS202412345." },
  doeLicenseNo: { test: /^DOE-LPG-\d{4}-\d{3,4}$/, message: "Format: DOE-LPG-YYYY-NNN, e.g. DOE-LPG-2026-001.", optional: true },
  branchName: { test: /^.{2,100}$/, message: "Branch name must be at least 2 characters." },
  cityMunicipality: { test: /^.{2,100}$/, message: "Please enter a valid city/municipality." },
  completeAddress: { test: /^.{5,255}$/, message: "Please enter a complete address (at least 5 characters)." },
  firstName: { test: /^[A-Za-z\u00F1\u00D1' .-]{2,50}$/, message: "First name must be at least 2 letters." },
  lastName: { test: /^[A-Za-z\u00F1\u00D1' .-]{2,50}$/, message: "Last name must be at least 2 letters." },
  email: { test: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Please enter a valid email address." },
  regPassword: { test: /^.{8,}$/, message: "Password must be at least 8 characters." },
};

const fieldHints = {
  dtiSecNo: "Format: 2–4 letters + 6–12 digits (e.g. CS202412345)",
  doeLicenseNo: "Format: DOE-LPG-YYYY-NNN (e.g. DOE-LPG-2026-001)",
};

function FieldError({ message }) {
  if (!message) return null;
  return <p style={{ color: "#dc2626", fontSize: "0.72rem", margin: "4px 0 0 0" }}>{message}</p>;
}

function FieldHint({ text }) {
  if (!text) return null;
  return <p style={{ color: "#9ca3af", fontSize: "0.72rem", margin: "4px 0 0 0" }}>{text}</p>;
}

function TopNav({ currentView, setCurrentView }) {
  return (
    <header className="login-nav">
      <div
        className="login-nav-brand"
        onClick={() => setCurrentView("login")}
        style={{ cursor: "pointer" }}
      >
        <img src={navLogo} alt="GasTrack Logo" className="login-nav-logo" />
      </div>
      <nav className="login-nav-links">
        <button
          type="button"
          className={`login-nav-link ${currentView === "login" ? "active" : ""}`}
          onClick={() => setCurrentView("login")}
        >
          Home
        </button>
        <button
          type="button"
          className={`login-nav-link ${currentView === "about" ? "active" : ""}`}
          onClick={() => setCurrentView("about")}
        >
          About
        </button>
        <button
          type="button"
          className={`login-nav-link ${currentView === "contact" ? "active" : ""}`}
          onClick={() => setCurrentView("contact")}
        >
          Contact
        </button>
      </nav>
      {currentView === "register" ? (
        <button
          type="button"
          className="login-nav-cta secondary"
          onClick={() => setCurrentView("login")}
        >
          Back to Login
        </button>
      ) : (
        <button
          type="button"
          className="login-nav-cta"
          onClick={() => setCurrentView("register")}
        >
          Register LPG Company
        </button>
      )}
    </header>
  );
}

export default function Login({ onLogin, onRegisterSuccess }) {
  // Navigation State: 'login' | 'register' | 'about' | 'contact'
  const [currentView, setCurrentView] = useState("login");

  // Login Form State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Registration Form State
  const [regForm, setRegForm] = useState({
    companyName: "",
    dtiSecNo: "",
    doeLicenseNo: "",
    branchName: "",
    cityMunicipality: "",
    completeAddress: "",
    firstName: "",
    lastName: "",
    email: "",
    regPassword: "",
    confirmPassword: "",
    termsAgreed: false,
  });
  const [regSubmitted, setRegSubmitted] = useState(false);
  const [regServerError, setRegServerError] = useState("");
  const [isRegSubmitting, setIsRegSubmitting] = useState(false);

  // Contact Form State
  const [contactForm, setContactForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    subject: "",
    message: "",
  });

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Please enter both email and password.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      if (onLogin) {
        await onLogin({ email, password });
      }
    } catch (err) {
      setError(err?.message || "Login failed. Please check your credentials.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (type === "checkbox") {
      setRegForm((prev) => ({ ...prev, [name]: checked }));
      return;
    }
    const filter = filters[name];
    const nextValue = filter ? filter(value) : value;
    setRegForm((prev) => ({ ...prev, [name]: nextValue }));
  };

  // Returns { fieldName: errorMessage } for every field currently invalid.
  const validateRegForm = (form) => {
    const errors = {};
    Object.entries(patterns).forEach(([field, { test, message, optional }]) => {
      const value = form[field] || "";
      if (optional && !value) return; // e.g. DOE license number is not required
      if (!test.test(value)) errors[field] = message;
    });
    if (form.regPassword && form.confirmPassword && form.regPassword !== form.confirmPassword) {
      errors.confirmPassword = "Passwords do not match.";
    }
    if (!form.confirmPassword) {
      errors.confirmPassword = "Please confirm your password.";
    }
    if (!form.termsAgreed) {
      errors.termsAgreed = "You must agree to the Terms of Service and Privacy Policy.";
    }
    return errors;
  };

  const regErrors = regSubmitted ? validateRegForm(regForm) : {};

  const handleRegSubmit = async (e) => {
    e.preventDefault();
    setRegServerError("");

    const errors = validateRegForm(regForm);
    setRegSubmitted(true);
    if (Object.keys(errors).length > 0) {
      return; // inline field errors will now render
    }

    setIsRegSubmitting(true);
    try {
      const data = await apiRequest("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          companyName: regForm.companyName,
          dtiSecNo: regForm.dtiSecNo,
          doeLicenseNo: regForm.doeLicenseNo || undefined,
          branchName: regForm.branchName,
          cityMunicipality: regForm.cityMunicipality,
          completeAddress: regForm.completeAddress,
          firstName: regForm.firstName,
          lastName: regForm.lastName,
          email: regForm.email,
          password: regForm.regPassword,
        }),
      });
      onRegisterSuccess?.(data);
    } catch (err) {
      setRegServerError(err?.message || "Registration failed. Please try again.");
    } finally {
      setIsRegSubmitting(false);
    }
  };

  const handleContactChange = (e) => {
    const { name, value } = e.target;
    setContactForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleContactSubmit = (e) => {
    e.preventDefault();
    alert("Thank you! Your message has been sent.");
    setContactForm({ firstName: "", lastName: "", email: "", subject: "", message: "" });
  };

  return (
    <div className="login-page">
      <TopNav currentView={currentView} setCurrentView={setCurrentView} />

      <main className="login-content">
        {/* LOGIN VIEW */}
        {currentView === "login" && (
          <div className="login-card">
            <img src={cardLogo} alt="GasTrack" className="login-card-logo-img" />
            <h2 className="login-welcome">Welcome to GasTrack!</h2>
            <p className="login-subtitle">Login to your account</p>

            <form className="login-form" onSubmit={handleLoginSubmit}>
              <div className="input-field-group">
                <User size={18} className="field-icon" />
                <input
                  type="text"
                  placeholder="Email"
                  className="login-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>

              <div className="input-field-group">
                <Lock size={18} className="field-icon" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password"
                  className="login-input has-toggle"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {error && <p className="login-error">{error}</p>}

              <div className="forgot-wrap">
                <button type="button" className="login-forgot">
                  Forgot your password?
                </button>
              </div>

              <button type="submit" className="login-submit" disabled={isSubmitting}>
                {isSubmitting ? "LOGGING IN..." : "LOGIN"}
              </button>
            </form>
          </div>
        )}

        {/* REGISTER VIEW */}
        {currentView === "register" && (
          <div className="register-layout-container">
            <div className="register-sidebar-col">
              <div className="register-stepper-card">
                <h2 className="register-stepper-title">
                  Register your LPG<br />Company
                </h2>
                <div className="register-stepper-divider"></div>
                <p className="register-stepper-desc">
                  Join GasTrack to digitize your inventory management and gain real-time visibility across all your branches.
                </p>

                <div className="stepper-list">
                  <div className="stepper-step">
                    <div className="stepper-badge active">1</div>
                    <div className="stepper-step-info">
                      <strong>Company details</strong>
                      <span>Fill in your registered business information.</span>
                    </div>
                  </div>
                  <div className="stepper-step">
                    <div className="stepper-badge">2</div>
                    <div className="stepper-step-info">
                      <strong>Admin account</strong>
                      <span>Create the primary administrator login.</span>
                    </div>
                  </div>
                  <div className="stepper-step">
                    <div className="stepper-badge">3</div>
                    <div className="stepper-step-info">
                      <strong>Review and submit</strong>
                      <span>Create the primary administrator login.</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="register-reqs-card">
                <h3 className="register-reqs-title">Requirements</h3>
                <ul className="register-reqs-list">
                  <li>DTI / SEC business registration</li>
                  <li>BIR Certificate of Registration</li>
                  <li>DOE LPG dealer license</li>
                  <li>Valid government-issued ID (authorized representative)</li>
                  <li>Active company email address</li>
                </ul>
              </div>
            </div>

            <div className="register-main-card">
              <h1 className="register-heading">Company registration</h1>
              <p className="register-subheading">All fields are required unless marked optional.</p>

              {regServerError && (
                <p style={{ color: "#dc2626", fontWeight: 600, marginBottom: 16 }}>{regServerError}</p>
              )}

              <form onSubmit={handleRegSubmit} className="register-form" noValidate>
                <div className="register-section">
                  <h3 className="register-section-title">COMPANY INFORMATION</h3>
                  <div className="reg-field full-width">
                    <label className="reg-label">Registered Company Name</label>
                    <input
                      type="text"
                      name="companyName"
                      placeholder="e.g. Acme Gas Corporation"
                      value={regForm.companyName}
                      onChange={handleRegChange}
                      className="reg-input"
                      required
                    />
                    <FieldError message={regErrors.companyName} />
                  </div>
                  <div className="reg-grid two-col">
                    <div className="reg-field">
                      <label className="reg-label">DTI/SEC registration no.</label>
                      <input
                        type="text"
                        name="dtiSecNo"
                        placeholder="e.g. CS202412345"
                        value={regForm.dtiSecNo}
                        onChange={handleRegChange}
                        className="reg-input"
                        required
                      />
                      <FieldHint text={fieldHints.dtiSecNo} />
                      <FieldError message={regErrors.dtiSecNo} />
                    </div>
                    <div className="reg-field">
                      <label className="reg-label">DOE distributor license no. (optional)</label>
                      <input
                        type="text"
                        name="doeLicenseNo"
                        placeholder="e.g. DOE-LPG-2026-001"
                        value={regForm.doeLicenseNo}
                        onChange={handleRegChange}
                        className="reg-input"
                      />
                      <FieldHint text={fieldHints.doeLicenseNo} />
                      <FieldError message={regErrors.doeLicenseNo} />
                    </div>
                  </div>
                </div>

                <div className="register-section">
                  <h3 className="register-section-title">BRANCH / LOCATION</h3>
                  <div className="reg-grid two-col">
                    <div className="reg-field">
                      <label className="reg-label">Primary Branch Name</label>
                      <input
                        type="text"
                        name="branchName"
                        placeholder="e.g. Main Branch"
                        value={regForm.branchName}
                        onChange={handleRegChange}
                        className="reg-input"
                        required
                      />
                      <FieldError message={regErrors.branchName} />
                    </div>
                    <div className="reg-field">
                      <label className="reg-label">City/Municipality</label>
                      <input
                        type="text"
                        name="cityMunicipality"
                        placeholder="e.g. Quezon City, Metro Manila"
                        value={regForm.cityMunicipality}
                        onChange={handleRegChange}
                        className="reg-input"
                        required
                      />
                      <FieldError message={regErrors.cityMunicipality} />
                    </div>
                  </div>
                  <div className="reg-field full-width">
                    <label className="reg-label">Complete Address</label>
                    <input
                      type="text"
                      name="completeAddress"
                      placeholder="e.g. Building No., Street Name, Barangay"
                      value={regForm.completeAddress}
                      onChange={handleRegChange}
                      className="reg-input"
                      required
                    />
                    <FieldError message={regErrors.completeAddress} />
                  </div>
                </div>

                <div className="register-section">
                  <h3 className="register-section-title">ADMINISTRATOR ACCOUNT</h3>
                  <div className="reg-grid three-col">
                    <div className="reg-field">
                      <label className="reg-label">First name</label>
                      <input
                        type="text"
                        name="firstName"
                        placeholder="First name"
                        value={regForm.firstName}
                        onChange={handleRegChange}
                        className="reg-input"
                        required
                      />
                      <FieldError message={regErrors.firstName} />
                    </div>
                    <div className="reg-field">
                      <label className="reg-label">Last name</label>
                      <input
                        type="text"
                        name="lastName"
                        placeholder="Last name"
                        value={regForm.lastName}
                        onChange={handleRegChange}
                        className="reg-input"
                        required
                      />
                      <FieldError message={regErrors.lastName} />
                    </div>
                    <div className="reg-field">
                      <label className="reg-label">Email address</label>
                      <input
                        type="email"
                        name="email"
                        placeholder="admin@company.com"
                        value={regForm.email}
                        onChange={handleRegChange}
                        className="reg-input"
                        required
                      />
                      <FieldError message={regErrors.email} />
                    </div>
                  </div>
                  <div className="reg-grid two-col">
                    <div className="reg-field">
                      <label className="reg-label">Password</label>
                      <input
                        type="password"
                        name="regPassword"
                        placeholder="Min. 8 characters"
                        value={regForm.regPassword}
                        onChange={handleRegChange}
                        className="reg-input"
                        required
                      />
                      <FieldError message={regErrors.regPassword} />
                    </div>
                    <div className="reg-field">
                      <label className="reg-label">Confirm password</label>
                      <input
                        type="password"
                        name="confirmPassword"
                        placeholder="Re-enter password"
                        value={regForm.confirmPassword}
                        onChange={handleRegChange}
                        className="reg-input"
                        required
                      />
                      <FieldError message={regErrors.confirmPassword} />
                    </div>
                  </div>
                </div>

                <div className="reg-checkbox-wrap">
                  <input
                    type="checkbox"
                    id="termsAgreed"
                    name="termsAgreed"
                    checked={regForm.termsAgreed}
                    onChange={handleRegChange}
                    className="reg-checkbox"
                  />
                  <label htmlFor="termsAgreed" className="reg-checkbox-label">
                    I confirm that the information provided is accurate and that I am authorized to register this company. I agree to the{" "}
                    <a href="#terms" className="reg-link">Terms of Service</a> and{" "}
                    <a href="#privacy" className="reg-link">Privacy Policy</a> in accordance with RA 10173.
                  </label>
                </div>
                <FieldError message={regErrors.termsAgreed} />

                <button type="submit" className="reg-submit-btn" disabled={isRegSubmitting}>
                  {isRegSubmitting ? "Submitting…" : "Submit registration"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ABOUT VIEW */}
        {currentView === "about" && (
          <div className="about-card">
            <div className="about-left">
              <span className="about-tag">ABOUT GASTRACK</span>
              <h1 className="about-title">
                Managing LPG inventory <span className="about-highlight">smarter</span>, not harder.
              </h1>
              <p className="about-description">
                GasTrack is a purpose-built inventory management system for LPG companies in the Philippines. We help LPG dealers track cylinder movements, deliveries, and stock levels across branches — in real time.
              </p>
            </div>

            <div className="about-right">
              <div className="about-stat-box">
                <span className="stat-number">2</span>
                <span className="stat-label">Active branches</span>
              </div>
              <div className="about-stat-box">
                <span className="stat-number">100%</span>
                <span className="stat-label">LPG focused</span>
              </div>
            </div>
          </div>
        )}

        {/* CONTACT VIEW */}
        {currentView === "contact" && (
          <div className="contact-layout-container">
            <div className="contact-sidebar">
              <h2 className="contact-sidebar-title">Get in touch</h2>
              <div className="contact-sidebar-divider"></div>
              <p className="contact-sidebar-desc">
                Have questions about GasTrack or want to register your LPG company? Our team is here to help.
              </p>

              <div className="contact-info-list">
                <div className="contact-info-card">
                  <div className="info-icon-wrapper">
                    <Phone size={18} />
                  </div>
                  <div className="info-text">
                    <strong>Phone</strong>
                    <span>+63 9 8453 1234</span>
                  </div>
                </div>

                <div className="contact-info-card">
                  <div className="info-icon-wrapper">
                    <Mail size={18} />
                  </div>
                  <div className="info-text">
                    <strong>Email</strong>
                    <span>gastrack.inventory@gmail.com</span>
                  </div>
                </div>

                <div className="contact-info-card">
                  <div className="info-icon-wrapper">
                    <Clock size={18} />
                  </div>
                  <div className="info-text">
                    <strong>Office hours</strong>
                    <span>Mon - Sat, 8:00AM - 5:00PM</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="contact-main-card">
              <h1 className="contact-heading">Send us a message</h1>
              <p className="contact-subheading">We'll get back to you within one business day.</p>

              <form onSubmit={handleContactSubmit} className="contact-form">
                <div className="reg-grid two-col">
                  <div className="reg-field">
                    <label className="reg-label">First name</label>
                    <input
                      type="text"
                      name="firstName"
                      placeholder="Juan"
                      value={contactForm.firstName}
                      onChange={handleContactChange}
                      className="reg-input"
                      required
                    />
                  </div>
                  <div className="reg-field">
                    <label className="reg-label">Last name</label>
                    <input
                      type="text"
                      name="lastName"
                      placeholder="Dela Cruz"
                      value={contactForm.lastName}
                      onChange={handleContactChange}
                      className="reg-input"
                      required
                    />
                  </div>
                </div>

                <div className="reg-field full-width">
                  <label className="reg-label">Email address</label>
                  <input
                    type="email"
                    name="email"
                    placeholder="juandelacruz@gmail.com"
                    value={contactForm.email}
                    onChange={handleContactChange}
                    className="reg-input"
                    required
                  />
                </div>

                <div className="reg-field full-width">
                  <label className="reg-label">Subject</label>
                  <div className="select-wrapper">
                    <select
                      name="subject"
                      value={contactForm.subject}
                      onChange={handleContactChange}
                      className="reg-input reg-select"
                      required
                    >
                      <option value="" disabled hidden>Select a topic</option>
                      <option value="registration">Registration Inquiry</option>
                      <option value="technical">Technical Support</option>
                      <option value="sales">Sales & Pricing</option>
                      <option value="other">Other Concerns</option>
                    </select>
                    <ChevronDown size={18} className="select-chevron" />
                  </div>
                </div>

                <div className="reg-field full-width">
                  <label className="reg-label">Message</label>
                  <textarea
                    name="message"
                    rows="4"
                    placeholder="Describe your inquiry or concern..."
                    value={contactForm.message}
                    onChange={handleContactChange}
                    className="reg-input contact-textarea"
                    required
                  ></textarea>
                </div>

                <button type="submit" className="contact-submit-btn">
                  Send Message
                </button>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}