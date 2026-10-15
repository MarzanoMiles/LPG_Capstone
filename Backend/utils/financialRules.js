const ApiError = require("./apiError");
function settingsBoolean(value, fallback, name) {
 if (value === undefined && fallback !== undefined) value = fallback;
 if (value === true || value === 1 || value === "1" || value === "true") return true;
 if (value === false || value === 0 || value === "0" || value === "false") return false;
 throw new ApiError(400, `${name} must be true or false.`);
}
function validateSettings(body, saved) {
 const allowIssueRefund = settingsBoolean(body.allowIssueRefund, saved?.AllowIssueRefund, "Allow Issue Refund");
 const enableCancellationFee = settingsBoolean(body.enableCancellationFee, saved?.EnableCancellationFee, "Enable Cancellation Fee");
 // An inactive fee retains its database configuration, including when a
 // hidden draft input was cleared or its type was changed before disabling.
 const inactive = saved && !(allowIssueRefund && enableCancellationFee);
 const cancellationFeeType = inactive ? saved.CancellationFeeType : body.cancellationFeeType;
 const cancellationFeeValue = inactive ? Number(saved.CancellationFeeValue) : body.cancellationFeeValue;
 if (!["Fixed", "Percentage"].includes(cancellationFeeType)) throw new ApiError(400, "Choose Fixed or Percentage fee type.");
 if (typeof cancellationFeeValue !== "number" || !Number.isFinite(cancellationFeeValue) || cancellationFeeValue < 0 || cancellationFeeValue > (cancellationFeeType === "Percentage" ? 100 : 9999999999.99) || Math.abs(cancellationFeeValue * 100 - Math.round(cancellationFeeValue * 100)) > 0.0001) throw new ApiError(400, "Enter a nonnegative fee with at most two decimals; percentages cannot exceed 100.");
 if (body.taxRate != null && (typeof body.taxRate !== "number" || !Number.isFinite(body.taxRate) || body.taxRate < 0 || body.taxRate > 100)) throw new ApiError(400, "Tax rate must be between 0 and 100.");
 for (const key of ["taxEnabled", "roundUp", "roundDown", "twoDecimalStandard"]) if (body[key] != null && typeof body[key] !== "boolean") throw new ApiError(400, `${key} must be a boolean.`);
 if (body.currency != null && !/^[A-Z]{3}$/.test(body.currency)) throw new ApiError(400, "Currency must be a three-letter uppercase code.");
 return {allowIssueRefund: Number(allowIssueRefund), enableCancellationFee: Number(enableCancellationFee), cancellationFeeType, cancellationFeeValue};
}
function calculateRefund(eligible, settings, qualifies) {
 const cents = Math.round(Number(eligible) * 100);
 if (!Number.isSafeInteger(cents) || cents <= 0) throw new ApiError(400, "No eligible prepaid amount to refund.");
 let fee = 0;
 if (settings.AllowIssueRefund && settings.EnableCancellationFee && qualifies) fee = settings.CancellationFeeType === "Percentage" ? Math.round(cents * Number(settings.CancellationFeeValue) / 100) : Math.round(Number(settings.CancellationFeeValue) * 100);
 fee = Math.max(0, Math.min(cents, fee));
 return {eligibleAmount: cents / 100, cancellationFee: fee / 100, refundAmount: (cents - fee) / 100};
}
// Call inside the caller's transaction. Order locking plus the unique ledger key
// makes the same operation safe across concurrent requests and later retries.
async function issueRefund(conn, user, orderId, reason) {
 const [orders] = await conn.query(`SELECT o.* FROM \`Order\` o WHERE o.OrderID = :orderId FOR UPDATE`, {orderId});
 if (!orders[0]) throw new ApiError(404, "Order not found.");
 const [sales] = await conn.query(`SELECT s.SaleID FROM Sales s JOIN User u ON u.UserID = s.UserID WHERE s.OrderID = :orderId AND u.CompanyID = :companyId FOR UPDATE`, {orderId, companyId: user.companyId});
 if (!sales.length) throw new ApiError(404, "Sale not found for this company.");
 const [existing] = await conn.query("SELECT * FROM RefundLedger WHERE OrderID = :orderId AND CompanyID = :companyId", {orderId, companyId: user.companyId});
 if (existing[0]) return existing[0];
 const [rows] = await conn.query("SELECT * FROM CompanySettings WHERE CompanyID = :companyId FOR UPDATE", {companyId: user.companyId});
 const settings = rows[0];
 if (!settings?.AllowIssueRefund) throw new ApiError(409, "Refunds are disabled in Financial & Tax Rules.");
 if (!["Admin", "Administrator", "Manager", "Operations Supervisor"].some(role => role.toLowerCase() === String(user.roleName).toLowerCase())) throw new ApiError(403, "Only administrators and managers can issue refunds.");
 const [payments] = await conn.query("SELECT p.AmountPaid FROM Payment p JOIN Sales s ON s.SaleID = p.SaleID WHERE s.OrderID = :orderId AND p.PaymentType = 'Sale' FOR UPDATE", {orderId});
 const paid = payments.reduce((sum, p) => sum + Number(p.AmountPaid), 0);
 const amount = Math.min(Number(orders[0].TotalAmount), paid);
 const qualifies = reason === "Cancellation" && orders[0].OrderStatus !== "Completed" && paid >= Number(orders[0].TotalAmount);
 const result = calculateRefund(amount, settings, qualifies);
 await conn.query(`INSERT INTO RefundLedger (CompanyID, OrderID, UserID, Reason, EligibleAmount, FeeType, FeeValue, CancellationFee, RefundAmount) VALUES (:companyId, :orderId, :userId, :reason, :eligibleAmount, :feeType, :feeValue, :cancellationFee, :refundAmount)`, {...result, companyId: user.companyId, orderId, userId: user.userId, reason, feeType: settings.CancellationFeeType, feeValue: settings.CancellationFeeValue});
 return result;
}
async function settleCancellation(conn, user, orderId) {
 const [payments] = await conn.query("SELECT p.AmountPaid FROM Payment p JOIN Sales s ON s.SaleID = p.SaleID WHERE s.OrderID = :orderId AND p.PaymentType = 'Sale' FOR UPDATE", {orderId});
 if (!payments.some(p => Number(p.AmountPaid) > 0)) return null;
 return issueRefund(conn, user, orderId, "Cancellation");
}
module.exports = {validateSettings, calculateRefund, issueRefund, settleCancellation};
