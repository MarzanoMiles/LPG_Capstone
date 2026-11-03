import { useRef, useState } from "react";

// Read-only summary card + Edit button + modal with Save Changes.
// keys: settings fields the modal edits. save(draft, current) performs the requests and returns a message.
export default function SettingsEditCard({ title, settings, keys, summary, save, disabled, onSaved, children }) {
  const dialog = useRef(null);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const current = { ...settings, ...(saved || {}) };
  const titleId = `settings-edit-${title.replace(/\W+/g, "-").toLowerCase()}`;
  const update = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));

  const open = () => {
    setDraft(Object.fromEntries(keys.map((key) => [key, current[key]])));
    setError("");
    dialog.current.showModal();
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const message = await save(draft, current);
      setSaved((prev) => ({ ...(prev || {}), ...draft }));
      dialog.current.close();
      onSaved(message);
    } catch (err) {
      setError(err.message || "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="settings-card">
        <h2 className="card-title">{title}</h2>
        <dl className="operations-summary">
          {summary(current).map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
        <div className="card-actions">
          <button type="button" className="btn btn-primary" disabled={disabled} onClick={open}>Edit</button>
        </div>
      </div>
      <dialog ref={dialog} className="operations-dialog" aria-labelledby={titleId} onCancel={(e) => { if (saving) e.preventDefault(); }}>
        {draft && (
          <form onSubmit={submit}>
            <div className="operations-heading">
              <h2 id={titleId}>{title}</h2>
              <button type="button" aria-label="Close" disabled={saving} className="operations-close" onClick={() => dialog.current.close()}>×</button>
            </div>
            <fieldset className="operations-fields" disabled={saving}>{children(draft, update)}</fieldset>
            {error && <p className="operations-error" role="alert">{error}</p>}
            <div className="card-actions">
              <button type="button" className="btn operations-cancel" disabled={saving} onClick={() => dialog.current.close()}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}