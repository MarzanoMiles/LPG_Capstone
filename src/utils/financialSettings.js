export function financialSwitch(value) {
 return value === true || value === 1 || value === "1" || value === "true";
}
export function financialSettingsPayload(draft) {
 const payload = {...draft, taxRate: Number(draft.taxRate),
  allowIssueRefund: financialSwitch(draft.allowIssueRefund),
  enableCancellationFee: financialSwitch(draft.enableCancellationFee)};
 if (!payload.allowIssueRefund || !payload.enableCancellationFee) {
  // Hidden fee inputs must neither block saving nor overwrite the saved fee.
  delete payload.cancellationFeeType;
  delete payload.cancellationFeeValue;
  return payload;
 }
 const raw = draft.cancellationFeeValue;
 const value = Number(raw);
 if (raw == null || String(raw).trim() === "" || !Number.isFinite(value) || value < 0 || Math.abs(value * 100 - Math.round(value * 100)) > 0.0001) {
  throw new Error("Enter a cancellation fee of 0 or more with at most two decimal places.");
 }
 if (draft.cancellationFeeType === "Percentage" && value > 100) {
  throw new Error("Cancellation fee percentage must be between 0 and 100.");
 }
 if (value > 9999999999.99) throw new Error("Cancellation fee amount cannot exceed 9,999,999,999.99.");
 return {...payload, cancellationFeeValue: value};
}
