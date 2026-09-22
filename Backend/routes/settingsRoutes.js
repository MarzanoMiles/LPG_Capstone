const router = require("express").Router();
const pool = require("../config/db");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { authenticate, authorize } = require("../middleware/auth");

router.use(authenticate);

function toBool(v) {
  return !!v;
}

function mapRow(row) {
  return {
    fullName: row.FullName || "",
    address: row.Address || "",
    contactEmail: row.ContactEmail || "",
    phone: row.Phone || "",
    logoDataUrl: row.LogoDataUrl || null,

    taxRate: Number(row.TaxRate),
    taxEnabled: toBool(row.TaxEnabled),
    currency: row.Currency,
    roundUp: toBool(row.RoundUp),
    roundDown: toBool(row.RoundDown),
    twoDecimalStandard: toBool(row.TwoDecimalStandard),

    receiptHeader: row.ReceiptHeader || "",
    showLogoOnReceipt: toBool(row.ShowLogoOnReceipt),
    showTaxBreakdown: toBool(row.ShowTaxBreakdown),
    footerMessage: row.FooterMessage || "",
    printSize: row.PrintSize,

    autoLogoutMinutes: row.AutoLogoutMinutes,
    systemTimezone: row.SystemTimezone,
    dateFormat: row.DateFormat,
    language: row.Language,
    theme: row.Theme,

    updatedAt: row.UpdatedAt,
  };
}

async function ensureRow(companyId) {
  const [rows] = await pool.query(`SELECT * FROM CompanySettings WHERE CompanyID = :companyId`, { companyId });
  if (rows[0]) return rows[0];
  await pool.query(`INSERT INTO CompanySettings (CompanyID) VALUES (:companyId)`, { companyId });
  const [created] = await pool.query(`SELECT * FROM CompanySettings WHERE CompanyID = :companyId`, { companyId });
  return created[0];
}

// GET /settings
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const row = await ensureRow(req.user.companyId);
    res.json(mapRow(row));
  })
);

// PUT /settings/profile
router.put(
  "/profile",
  authorize("Admin", "Manager"),
  asyncHandler(async (req, res) => {
    await ensureRow(req.user.companyId);
    const { fullName, address, contactEmail, phone } = req.body;
    await pool.query(
      `UPDATE CompanySettings SET
         FullName = COALESCE(:fullName, FullName),
         Address = COALESCE(:address, Address),
         ContactEmail = COALESCE(:contactEmail, ContactEmail),
         Phone = COALESCE(:phone, Phone)
       WHERE CompanyID = :companyId`,
      { companyId: req.user.companyId, fullName: fullName ?? null, address: address ?? null, contactEmail: contactEmail ?? null, phone: phone ?? null }
    );
    res.json({ message: "Business profile saved." });
  })
);

// PUT /settings/logo  { logoDataUrl }
router.put(
  "/logo",
  authorize("Admin", "Manager"),
  asyncHandler(async (req, res) => {
    const { logoDataUrl } = req.body;
    if (!logoDataUrl) throw new ApiError(400, "logoDataUrl is required.");
    if (logoDataUrl.length > 5 * 1024 * 1024) {
      throw new ApiError(400, "Logo image is too large. Please use an image under ~3MB.");
    }
    await ensureRow(req.user.companyId);
    await pool.query(`UPDATE CompanySettings SET LogoDataUrl = :logoDataUrl WHERE CompanyID = :companyId`, {
      companyId: req.user.companyId,
      logoDataUrl,
    });
    res.json({ message: "Logo updated." });
  })
);

// PUT /settings/tax
router.put(
  "/tax",
  authorize("Admin", "Manager"),
  asyncHandler(async (req, res) => {
    await ensureRow(req.user.companyId);
    const { taxRate, taxEnabled, currency, roundUp, roundDown, twoDecimalStandard } = req.body;
    await pool.query(
      `UPDATE CompanySettings SET
         TaxRate = COALESCE(:taxRate, TaxRate),
         TaxEnabled = COALESCE(:taxEnabled, TaxEnabled),
         Currency = COALESCE(:currency, Currency),
         RoundUp = COALESCE(:roundUp, RoundUp),
         RoundDown = COALESCE(:roundDown, RoundDown),
         TwoDecimalStandard = COALESCE(:twoDecimalStandard, TwoDecimalStandard)
       WHERE CompanyID = :companyId`,
      {
        companyId: req.user.companyId,
        taxRate: taxRate != null ? Number(taxRate) : null,
        taxEnabled: taxEnabled != null ? (taxEnabled ? 1 : 0) : null,
        currency: currency ?? null,
        roundUp: roundUp != null ? (roundUp ? 1 : 0) : null,
        roundDown: roundDown != null ? (roundDown ? 1 : 0) : null,
        twoDecimalStandard: twoDecimalStandard != null ? (twoDecimalStandard ? 1 : 0) : null,
      }
    );
    res.json({ message: "Financial & tax rules saved." });
  })
);

// PUT /settings/receipt
router.put(
  "/receipt",
  authorize("Admin", "Manager"),
  asyncHandler(async (req, res) => {
    await ensureRow(req.user.companyId);
    const { receiptHeader, showLogoOnReceipt, showTaxBreakdown, footerMessage, printSize } = req.body;
    await pool.query(
      `UPDATE CompanySettings SET
         ReceiptHeader = COALESCE(:receiptHeader, ReceiptHeader),
         ShowLogoOnReceipt = COALESCE(:showLogoOnReceipt, ShowLogoOnReceipt),
         ShowTaxBreakdown = COALESCE(:showTaxBreakdown, ShowTaxBreakdown),
         FooterMessage = COALESCE(:footerMessage, FooterMessage),
         PrintSize = COALESCE(:printSize, PrintSize)
       WHERE CompanyID = :companyId`,
      {
        companyId: req.user.companyId,
        receiptHeader: receiptHeader ?? null,
        showLogoOnReceipt: showLogoOnReceipt != null ? (showLogoOnReceipt ? 1 : 0) : null,
        showTaxBreakdown: showTaxBreakdown != null ? (showTaxBreakdown ? 1 : 0) : null,
        footerMessage: footerMessage ?? null,
        printSize: printSize ?? null,
      }
    );
    res.json({ message: "Receipt and POS output settings saved." });
  })
);

// PUT /settings/system
router.put(
  "/system",
  authorize("Admin"),
  asyncHandler(async (req, res) => {
    await ensureRow(req.user.companyId);
    const { autoLogoutMinutes, systemTimezone, dateFormat, language, theme } = req.body;
    await pool.query(
      `UPDATE CompanySettings SET
         AutoLogoutMinutes = COALESCE(:autoLogoutMinutes, AutoLogoutMinutes),
         SystemTimezone = COALESCE(:systemTimezone, SystemTimezone),
         DateFormat = COALESCE(:dateFormat, DateFormat),
         Language = COALESCE(:language, Language),
         Theme = COALESCE(:theme, Theme)
       WHERE CompanyID = :companyId`,
      {
        companyId: req.user.companyId,
        autoLogoutMinutes: autoLogoutMinutes != null ? Number(autoLogoutMinutes) : null,
        systemTimezone: systemTimezone ?? null,
        dateFormat: dateFormat ?? null,
        language: language ?? null,
        theme: theme ?? null,
      }
    );
    res.json({ message: "System behavior rules saved." });
  })
);

module.exports = router;