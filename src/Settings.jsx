import PageLayout, { PageHeader } from "./PageLayout";
import React, { useEffect, useRef, useState } from "react";
import { apiRequest } from "./api";
import { clearReceiptSettingsCache, DEFAULT_RECEIPT_HEADER } from "./utils/receipt";
import "./Settings.css";
import SettingsOperations from "./SettingsOperations";
import SettingsFinancial from "./SettingsFinancial";
import SettingsVehicleRates from "./SettingsVehicleRates";

const emptySettings = {
  companyName: "",
  address: "",
  contactEmail: "",
  phone: "",
  logoDataUrl: null,

  taxRate: 12,
  taxEnabled: true,
  currency: "PHP",
  roundUp: false,
  roundDown: false,
  twoDecimalStandard: true,

  receiptHeader: "",
  showLogoOnReceipt: true,
  showTaxBreakdown: true,
  footerMessage: "",
  printSize: "80mm",

  autoLogoutMinutes: 30,
  systemTimezone: "Asia/Manila",
  dateFormat: "MM/DD/YYYY",
  language: "en"
};

export default function Settings() {
  const [settings, setSettings] = useState(emptySettings);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [savingSection, setSavingSection] = useState(null); // 'profile' | 'tax' | 'receipt' | 'system'
  const [savedMessage, setSavedMessage] = useState("");
  const [saveError, setSaveError] = useState("");

  const fileInputRef = useRef(null);

  const load = () => {
    setIsLoading(true);
    apiRequest("/settings")
      .then((data) => {
        setSettings(data);
        setLoadError("");
      })
      .catch((err) => setLoadError(err.message || "Failed to load settings."))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const updateField = (field, value) => setSettings((prev) => ({ ...prev, [field]: value }));

  const flashSaved = (msg) => {
    setSavedMessage(msg);
    setSaveError("");
    window.setTimeout(() => setSavedMessage(""), 3000);
  };

  const saveSection = async (section, endpoint, payload) => {
    setSavingSection(section);
    setSaveError("");
    try {
      const result = await apiRequest(`/settings/${endpoint}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      clearReceiptSettingsCache();
      flashSaved(result.message);
    } catch (err) {
      setSaveError(err.message || "Failed to save settings.");
    } finally {
      setSavingSection(null);
    }
  };

  const handleDropzoneClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setSaveError("Please choose an image file.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setSaveError("Image is too large. Please choose one under 3MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      updateField("logoDataUrl", dataUrl);
      setSavingSection("logo");
      setSaveError("");
      try {
        const result = await apiRequest("/settings/logo", {
          method: "PUT",
          body: JSON.stringify({ logoDataUrl: dataUrl }),
        });
        clearReceiptSettingsCache();
        flashSaved(result.message);
      } catch (err) {
        setSaveError(err.message || "Failed to upload logo.");
      } finally {
        setSavingSection(null);
      }
    };
    reader.readAsDataURL(file);
  };

  if (isLoading) {
    return (
      <PageLayout className="settings-page">
        <PageHeader title="Settings" />
        <p>Loading…</p>
      </PageLayout>
    );
  }

  return (
    <PageLayout className="settings-page">
      <PageHeader title="Settings" />

      {loadError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{loadError}</p>}
      {saveError && <p style={{ color: "#dc2626", fontWeight: 600 }}>{saveError}</p>}
      {savedMessage && <p style={{ color: "#16a34a", fontWeight: 600 }}>{savedMessage}</p>}

      {/* ─── BUSINESS PROFILE ─── */}
      <div className="settings-card">
        <h2 className="card-title">Business Profile</h2>
        <div className="business-profile-grid">
          <div className="input-column">
            <div className="form-group">
              <label>Company Name</label>
              <input
                type="text"
                className="form-control"
                value={settings.companyName}
                onChange={(e) => updateField("companyName", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Address</label>
              <input
                type="text"
                className="form-control"
                value={settings.address}
                onChange={(e) => updateField("address", e.target.value)}
              />
            </div>
          </div>

          <div className="input-column">
            <div className="form-group">
              <label>Contact email</label>
              <input
                type="email"
                className="form-control"
                value={settings.contactEmail}
                onChange={(e) => updateField("contactEmail", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input
                type="text"
                className="form-control"
                value={settings.phone}
                onChange={(e) => updateField("phone", e.target.value)}
              />
            </div>
          </div>

          <div className="logo-upload-wrapper">
            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
            <div className="logo-dropzone" onClick={handleDropzoneClick}>
              {settings.logoDataUrl ? (
                <img src={settings.logoDataUrl} alt="Logo Preview" className="logo-preview-img" />
              ) : (
                <>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: "8px" }}>
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                    <line x1="12" y1="22.08" x2="12" y2="12"></line>
                  </svg>
                  <span className="choose-file-btn">{savingSection === "logo" ? "Uploading…" : "Choose file"}</span>
                </>
              )}
            </div>
            <span className="upload-label">Upload logo</span>
          </div>
        </div>
        <div className="card-actions">
          <button
            className="btn btn-primary"
            onClick={() =>
              saveSection("profile", "profile", {
                companyName: settings.companyName,
                address: settings.address,
                contactEmail: settings.contactEmail,
                phone: settings.phone,
              })
            }
            disabled={savingSection === "profile"}
          >
            {savingSection === "profile" ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* Business operations and financial settings */}
      <SettingsOperations settings={settings} disabled={!!loadError} onSaved={flashSaved} />
      <SettingsFinancial settings={settings} disabled={!!loadError} onSaved={flashSaved} />
      <SettingsVehicleRates settings={settings} disabled={!!loadError} onSaved={flashSaved} />

      {/* ─── RECEIPT AND POS OUTPUT ─── */}
      <div className="settings-card">
        <h2 className="card-title">Receipt and POS Output</h2>
        <div className="grid-2-col">
          <div className="input-column">
            <div className="form-group">
              <label>Receipt header text</label>
              <textarea
                rows={5}
                placeholder={DEFAULT_RECEIPT_HEADER}
                className="form-control"
                value={settings.receiptHeader}
                onChange={(e) => updateField("receiptHeader", e.target.value)}
              />
            </div>
            <div className="checkbox-group" style={{ marginTop: "8px" }}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.showLogoOnReceipt}
                  onChange={(e) => updateField("showLogoOnReceipt", e.target.checked)}
                />
                Show logo
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.showTaxBreakdown}
                  onChange={(e) => updateField("showTaxBreakdown", e.target.checked)}
                />
                Show tax breakdown
              </label>
            </div>
          </div>

          <div className="input-column">
            <div className="form-group">
              <label>Footer message</label>
              <input
                type="text"
                className="form-control"
                value={settings.footerMessage}
                onChange={(e) => updateField("footerMessage", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Print Size</label>
              <select
                className="form-control"
                value={settings.printSize}
                onChange={(e) => updateField("printSize", e.target.value)}
              >
                <option value="58mm">58mm</option>
                <option value="80mm">80mm</option>
              </select>
            </div>
          </div>
        </div>
        <div className="card-actions">
          <button
            className="btn btn-primary"
            onClick={() =>
              saveSection("receipt", "receipt", {
                receiptHeader: settings.receiptHeader,
                showLogoOnReceipt: settings.showLogoOnReceipt,
                showTaxBreakdown: settings.showTaxBreakdown,
                footerMessage: settings.footerMessage,
                printSize: settings.printSize,
              })
            }
            disabled={savingSection === "receipt"}
          >
            {savingSection === "receipt" ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {/* ─── SYSTEM BEHAVIOR RULES ─── */}
      <div className="settings-card">
        <h2 className="card-title">System Behavior Rules</h2>
        <div className="grid-3-col">
          <div className="input-column">
            <div className="form-group">
              <label>Auto logout timer (minutes)</label>
              <input
                type="number"
                className="form-control"
                value={settings.autoLogoutMinutes}
                onChange={(e) => updateField("autoLogoutMinutes", e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>System timezone</label>
              <select
                className="form-control"
                value={settings.systemTimezone}
                onChange={(e) => updateField("systemTimezone", e.target.value)}
              >
                <option value="Asia/Manila">Asia/Manila</option>
                <option value="UTC">UTC</option>
                <option value="America/Los_Angeles">PST (America/Los_Angeles)</option>
              </select>
            </div>
          </div>

          <div className="input-column">
            <div className="form-group">
              <label>Date format</label>
              <select
                className="form-control"
                value={settings.dateFormat}
                onChange={(e) => updateField("dateFormat", e.target.value)}
              >
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              </select>
            </div>
            <div className="form-group">
              <label>Language</label>
              <select
                className="form-control"
                value={settings.language}
                onChange={(e) => updateField("language", e.target.value)}
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
              </select>
            </div>
          </div>

          <div className="input-column" style={{ justifyContent: "flex-end" }}>
            <div className="card-actions-inline">
              <button
                className="btn btn-primary"
                onClick={() =>
                  saveSection("system", "system", {
                    autoLogoutMinutes: settings.autoLogoutMinutes,
                    systemTimezone: settings.systemTimezone,
                    dateFormat: settings.dateFormat,
                    language: settings.language,
                  })
                }
                disabled={savingSection === "system"}
              >
                {savingSection === "system" ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}



