import PageLayout, { PageHeader } from "./PageLayout";
import React, { useEffect, useState } from "react";
import { apiRequest } from "./api";
import { clearReceiptSettingsCache, DEFAULT_RECEIPT_HEADER } from "./utils/receipt";
import "./Settings.css";
import SettingsEditCard from "./SettingsEditCard";
import SettingsOperations from "./SettingsOperations";
import SettingsFinancial from "./SettingsFinancial";
import SettingsVehicleRates from "./SettingsVehicleRates";

const emptySettings = {
  companyName: "", address: "", contactEmail: "", phone: "", logoDataUrl: null,
  taxRate: 12, taxEnabled: true, currency: "PHP", roundUp: false, roundDown: false, twoDecimalStandard: true,
  receiptHeader: "", showLogoOnReceipt: true, showTaxBreakdown: true, footerMessage: "", printSize: "80mm",
  autoLogoutMinutes: 30, systemTimezone: "Asia/Manila", dateFormat: "MM/DD/YYYY", language: "en",
};

const yesNo = (value) => (value ? "Yes" : "No");
const show = (value) => (value === "" || value == null ? "Not set" : value);
const timezoneLabels = { "Asia/Manila": "Asia/Manila", UTC: "UTC", "America/Los_Angeles": "PST (America/Los_Angeles)" };
const languageLabels = { en: "English", es: "Spanish" };

const put = (endpoint, payload) =>
  apiRequest(`/settings/${endpoint}`, { method: "PUT", body: JSON.stringify(payload) });

export default function Settings() {
  const [settings, setSettings] = useState(emptySettings);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    apiRequest("/settings")
      .then((data) => { setSettings(data); setLoadError(""); })
      .catch((err) => setLoadError(err.message || "Failed to load settings."))
      .finally(() => setIsLoading(false));
  }, []);

  const flashSaved = (message) => {
    clearReceiptSettingsCache();
    setSavedMessage(message);
    window.setTimeout(() => setSavedMessage(""), 3000);
  };

  const readLogo = (file, update) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return window.alert("Please choose an image file.");
    if (file.size > 3 * 1024 * 1024) return window.alert("Image is too large. Please choose one under 3MB.");
    const reader = new FileReader();
    reader.onload = () => update("logoDataUrl", reader.result);
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
      {savedMessage && <p style={{ color: "#16a34a", fontWeight: 600 }}>{savedMessage}</p>}

      <SettingsEditCard
        title="Business Profile"
        settings={settings}
        disabled={!!loadError}
        onSaved={flashSaved}
        keys={["companyName", "address", "contactEmail", "phone", "logoDataUrl"]}
        summary={(s) => [
          ["Company Name", show(s.companyName)],
          ["Address", show(s.address)],
          ["Contact Email", show(s.contactEmail)],
          ["Phone", show(s.phone)],
          ["Logo", s.logoDataUrl ? <img src={s.logoDataUrl} alt="Company logo" style={{ maxHeight: 48, maxWidth: 120, objectFit: "contain" }} /> : "Not set"],
        ]}
        save={async (draft, current) => {
          if (draft.logoDataUrl && draft.logoDataUrl !== current.logoDataUrl) await put("logo", { logoDataUrl: draft.logoDataUrl });
          const result = await put("profile", {
            companyName: draft.companyName, address: draft.address, contactEmail: draft.contactEmail, phone: draft.phone,
          });
          return result.message;
        }}
      >
        {(d, update) => (
          <>
            <div className="form-group"><label htmlFor="profile-company">Company Name</label>
              <input id="profile-company" className="form-control" value={d.companyName} onChange={(e) => update("companyName", e.target.value)} /></div>
            <div className="form-group"><label htmlFor="profile-address">Address</label>
              <input id="profile-address" className="form-control" value={d.address} onChange={(e) => update("address", e.target.value)} /></div>
            <div className="form-group"><label htmlFor="profile-email">Contact email</label>
              <input id="profile-email" type="email" className="form-control" value={d.contactEmail} onChange={(e) => update("contactEmail", e.target.value)} /></div>
            <div className="form-group"><label htmlFor="profile-phone">Phone</label>
              <input id="profile-phone" className="form-control" value={d.phone} onChange={(e) => update("phone", e.target.value)} /></div>
            <div className="form-group"><label htmlFor="profile-logo">Logo</label>
              {d.logoDataUrl && <img src={d.logoDataUrl} alt="Logo preview" style={{ maxHeight: 64, maxWidth: 160, objectFit: "contain", marginBottom: 8 }} />}
              <input id="profile-logo" type="file" accept="image/*" onChange={(e) => { readLogo(e.target.files?.[0], update); e.target.value = ""; }} /></div>
          </>
        )}
      </SettingsEditCard>

      <SettingsOperations settings={settings} disabled={!!loadError} onSaved={flashSaved} />
      <SettingsFinancial settings={settings} disabled={!!loadError} onSaved={flashSaved} />
      <SettingsVehicleRates settings={settings} disabled={!!loadError} onSaved={flashSaved} />

      <SettingsEditCard
        title="Receipt and POS Output"
        settings={settings}
        disabled={!!loadError}
        onSaved={flashSaved}
        keys={["receiptHeader", "showLogoOnReceipt", "showTaxBreakdown", "footerMessage", "printSize"]}
        summary={(s) => [
          ["Receipt Header", <span style={{ whiteSpace: "pre-wrap" }}>{s.receiptHeader || "Default header"}</span>],
          ["Footer Message", show(s.footerMessage)],
          ["Show Logo", yesNo(s.showLogoOnReceipt)],
          ["Show Tax Breakdown", yesNo(s.showTaxBreakdown)],
          ["Print Size", s.printSize],
        ]}
        save={async (draft) => (await put("receipt", {
          receiptHeader: draft.receiptHeader, showLogoOnReceipt: draft.showLogoOnReceipt,
          showTaxBreakdown: draft.showTaxBreakdown, footerMessage: draft.footerMessage, printSize: draft.printSize,
        })).message}
      >
        {(d, update) => (
          <>
            <div className="form-group"><label htmlFor="receipt-header">Receipt header text</label>
              <textarea id="receipt-header" rows={5} className="form-control" placeholder={DEFAULT_RECEIPT_HEADER} value={d.receiptHeader} onChange={(e) => update("receiptHeader", e.target.value)} /></div>
            <div className="form-group"><label htmlFor="receipt-footer">Footer message</label>
              <input id="receipt-footer" className="form-control" value={d.footerMessage} onChange={(e) => update("footerMessage", e.target.value)} /></div>
            <div className="form-group"><label htmlFor="receipt-size">Print Size</label>
              <select id="receipt-size" className="form-control" value={d.printSize} onChange={(e) => update("printSize", e.target.value)}>
                <option value="58mm">58mm</option><option value="80mm">80mm</option></select></div>
            <div className="checkbox-group">
              <label className="checkbox-label"><input type="checkbox" checked={!!d.showLogoOnReceipt} onChange={(e) => update("showLogoOnReceipt", e.target.checked)} />Show logo</label>
              <label className="checkbox-label"><input type="checkbox" checked={!!d.showTaxBreakdown} onChange={(e) => update("showTaxBreakdown", e.target.checked)} />Show tax breakdown</label>
            </div>
          </>
        )}
      </SettingsEditCard>

      <SettingsEditCard
        title="System Behavior Rules"
        settings={settings}
        disabled={!!loadError}
        onSaved={flashSaved}
        keys={["autoLogoutMinutes", "systemTimezone", "dateFormat", "language"]}
        summary={(s) => [
          ["Auto Logout Timer", `${s.autoLogoutMinutes} minutes`],
          ["System Timezone", timezoneLabels[s.systemTimezone] || s.systemTimezone],
          ["Date Format", s.dateFormat],
          ["Language", languageLabels[s.language] || s.language],
        ]}
        save={async (draft) => {
          const minutes = Number(draft.autoLogoutMinutes);
          if (!Number.isInteger(minutes) || minutes < 1) throw new Error("Auto logout timer must be a whole number of minutes (1 or more).");
          return (await put("system", {
            autoLogoutMinutes: minutes, systemTimezone: draft.systemTimezone, dateFormat: draft.dateFormat, language: draft.language,
          })).message;
        }}
      >
        {(d, update) => (
          <>
            <div className="form-group"><label htmlFor="sys-logout">Auto logout timer (minutes)</label>
              <input id="sys-logout" type="number" min="1" step="1" className="form-control" value={d.autoLogoutMinutes} onChange={(e) => update("autoLogoutMinutes", e.target.value)} /></div>
            <div className="form-group"><label htmlFor="sys-tz">System timezone</label>
              <select id="sys-tz" className="form-control" value={d.systemTimezone} onChange={(e) => update("systemTimezone", e.target.value)}>
                <option value="Asia/Manila">Asia/Manila</option><option value="UTC">UTC</option>
                <option value="America/Los_Angeles">PST (America/Los_Angeles)</option></select></div>
            <div className="form-group"><label htmlFor="sys-date">Date format</label>
              <select id="sys-date" className="form-control" value={d.dateFormat} onChange={(e) => update("dateFormat", e.target.value)}>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option><option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option></select></div>
            <div className="form-group"><label htmlFor="sys-lang">Language</label>
              <select id="sys-lang" className="form-control" value={d.language} onChange={(e) => update("language", e.target.value)}>
                <option value="en">English</option><option value="es">Spanish</option></select></div>
          </>
        )}
      </SettingsEditCard>
    </PageLayout>
  );
}