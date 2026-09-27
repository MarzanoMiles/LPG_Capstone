// Builds the DOE Annex AR-E-2 "Annual Update Report on LPG Supply and Demand
// Balance" for a given brand and year, using live InventoryTransaction data
// to reconstruct month-by-month Beginning/Purchases/Sales/Ending balances.

const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

// The DOE form only has fixed columns for these ten cylinder sizes (kg).
const STANDARD_SIZES = [50, 22, 11, 7, 6, 5, 2.7, 1, 0.17, 0.22];

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Matches "11KG", "2.7 kg", "0.17Kg", etc. in a product name and snaps it to
// the nearest standard DOE cylinder size (within a small tolerance), since
// the form's columns are fixed and can't display an arbitrary size.
function extractStandardSize(productName) {
  const match = productName.match(/(\d+(?:\.\d+)?)\s*kg/i);
  if (!match) return null;
  const raw = parseFloat(match[1]);
  const closest = STANDARD_SIZES.find((s) => Math.abs(s - raw) < 0.01);
  return closest ?? null;
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Data assembly
// ---------------------------------------------------------------------------

async function getAnnualReportData(pool, brandId, year) {
  const [[brandRow]] = await pool.query(`SELECT Brand FROM Brand WHERE BrandID = :id`, { id: brandId });
  if (!brandRow) throw new Error("Brand not found.");

  const [products] = await pool.query(
    `SELECT ProductID, ProductName FROM Product WHERE BrandID = :brandId`,
    { brandId }
  );

  // Map each product to a standard size; group product IDs by size.
  const sizeToProductIds = new Map();
  for (const p of products) {
    const size = extractStandardSize(p.ProductName);
    if (size == null) continue;
    if (!sizeToProductIds.has(size)) sizeToProductIds.set(size, []);
    sizeToProductIds.get(size).push(p.ProductID);
  }

  const usedSizes = STANDARD_SIZES.filter((s) => sizeToProductIds.has(s));
  if (usedSizes.length === 0) {
    throw new Error(
      "No products under this brand have a recognizable DOE cylinder size in their name (e.g. \"11KG\")."
    );
  }

  const allProductIds = usedSizes.flatMap((s) => sizeToProductIds.get(s));

  const [currentStockRows] = await pool.query(
    `SELECT ProductID, SUM(StockOnHand) AS stock FROM Inventory
     WHERE ProductID IN (${allProductIds.map(() => "?").join(",")})
     GROUP BY ProductID`,
    allProductIds
  );
  const currentStockByProduct = new Map(currentStockRows.map((r) => [r.ProductID, Number(r.stock)]));

  const [txRows] = await pool.query(
    `SELECT i.ProductID AS productId, t.TransactionType AS type, t.Quantity AS qty, t.TransactionDate AS date
     FROM InventoryTransaction t
     JOIN Inventory i ON i.InventoryID = t.InventoryID
     WHERE i.ProductID IN (${allProductIds.map(() => "?").join(",")})`,
    allProductIds
  );

  const yearStart = new Date(`${year}-01-01T00:00:00`);
  const yearEnd = new Date(`${year}-12-31T23:59:59`);
  const now = new Date();

  // Bucket every transaction by product, signed (+in, -out).
  const productIdToSize = new Map();
  for (const s of usedSizes) {
    for (const pid of sizeToProductIds.get(s)) productIdToSize.set(pid, s);
  }

  // netAfterYearEnd[size] = (stockIn - stockOut) for transactions strictly after Dec 31 of `year`
  // netDuringYear[month][size] = { purchases, sales } for that calendar month of `year`
  const netAfterYearEnd = Object.fromEntries(usedSizes.map((s) => [s, 0]));
  const monthlyBySizeAndMonth = {};
  usedSizes.forEach((s) => {
    monthlyBySizeAndMonth[s] = Array.from({ length: 12 }, () => ({ purchases: 0, sales: 0 }));
  });

  for (const tx of txRows) {
    const size = productIdToSize.get(tx.productId);
    if (size == null) continue;
    const date = new Date(tx.date);
    const signedQty = tx.type === "Stock In" ? Number(tx.qty) : -Number(tx.qty);

    if (date > yearEnd && date <= now) {
      netAfterYearEnd[size] += signedQty;
    } else if (date >= yearStart && date <= yearEnd) {
      const monthIdx = date.getMonth();
      if (tx.type === "Stock In") monthlyBySizeAndMonth[size][monthIdx].purchases += Number(tx.qty);
      else monthlyBySizeAndMonth[size][monthIdx].sales += Number(tx.qty);
    }
  }

  // currentStock = stockAtYearEnd + netAfterYearEnd  =>  stockAtYearEnd = currentStock - netAfterYearEnd
  // Beginning of January = stockAtYearEnd_prevYear = stockAtYearEnd(this year) - (purchases - sales) for the whole year
  const currentStockBySize = {};
  usedSizes.forEach((s) => {
    currentStockBySize[s] = sizeToProductIds.get(s).reduce(
      (sum, pid) => sum + (currentStockByProduct.get(pid) || 0),
      0
    );
  });

  const stockAtYearEndBySize = {};
  usedSizes.forEach((s) => {
    stockAtYearEndBySize[s] = currentStockBySize[s] - netAfterYearEnd[s];
  });

  const netDuringYearBySize = {};
  usedSizes.forEach((s) => {
    netDuringYearBySize[s] = monthlyBySizeAndMonth[s].reduce(
      (sum, m) => sum + (m.purchases - m.sales),
      0
    );
  });

  const beginningOfJanBySize = {};
  usedSizes.forEach((s) => {
    beginningOfJanBySize[s] = stockAtYearEndBySize[s] - netDuringYearBySize[s];
  });

  // Walk forward month by month to build the full ledger per size.
  const months = [];
  const runningBeginning = { ...beginningOfJanBySize };
  for (let m = 0; m < 12; m++) {
    const beginning = { ...runningBeginning };
    const purchases = {};
    const sales = {};
    const ending = {};
    usedSizes.forEach((s) => {
      purchases[s] = monthlyBySizeAndMonth[s][m].purchases;
      sales[s] = monthlyBySizeAndMonth[s][m].sales;
      ending[s] = beginning[s] + purchases[s] - sales[s];
      runningBeginning[s] = ending[s];
    });
    months.push({ label: MONTH_LABELS[m], beginning, purchases, sales, ending });
  }

  const nextJanBeginning = { ...runningBeginning };

  return {
    brandName: brandRow.Brand,
    year,
    usedSizes,
    months,
    nextJanBeginning,
  };
}

// ---------------------------------------------------------------------------
// Excel (.xlsx) generator — replicates the AR-E-2 structure with live formulas
// ---------------------------------------------------------------------------

async function buildAnnualReportXlsx(data, meta) {
  const { brandName, year, usedSizes, months, nextJanBeginning } = data;
  const { companyName, contactEmail, preparedBy } = meta;

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet(`AR-E-2 ${brandName}`.slice(0, 31));

  const groups = ["Beginning Inventory", "Purchases", "Sales", "Ending Inventory"];
  const colsPerGroup = usedSizes.length + 1; // + Total in KG
  const totalCols = 1 + groups.length * colsPerGroup; // + Month column

  // ---- Title block ----
  ws.getCell(1, 1).value = "Department of Energy";
  ws.getCell(1, 1).font = { bold: true };
  ws.getCell(2, 1).value = "Annex AR-E-2";
  ws.getCell(2, 1).font = { italic: true };
  ws.getCell(3, 1).value = "LPG DEALER";
  ws.getCell(3, 1).font = { bold: true, size: 12 };

  ws.mergeCells(4, 1, 4, totalCols);
  ws.getCell(4, 1).value = `ANNUAL UPDATE REPORT ON LPG SUPPLY AND DEMAND BALANCE (TRADEMARK NAME OR BRAND: ${brandName})`;
  ws.getCell(4, 1).font = { bold: true };
  ws.getCell(4, 1).alignment = { horizontal: "center" };

  ws.getCell(6, 1).value = "Company Name:";
  ws.getCell(6, 2).value = companyName || "";
  ws.getCell(6, 5).value = "Contact Details (email):";
  ws.getCell(6, 6).value = contactEmail || "";
  ws.getCell(6, 9).value = "Covered Year:";
  ws.getCell(6, 10).value = year;

  ws.getCell(7, 1).value = "Prepared By:";
  ws.getCell(7, 2).value = preparedBy || "";
  ws.getCell(8, 1).value = "(Name, Position & Signature)";
  ws.getCell(8, 1).font = { italic: true, size: 8 };
  ws.getCell(7, 5).value = "Approved By:";
  ws.getCell(8, 5).value = "(Position and Signature over Printed Name)";
  ws.getCell(8, 5).font = { italic: true, size: 8 };
  ws.getCell(7, 9).value = "Deadline of Submission:";
  ws.getCell(8, 9).value = "Not later than the 20th calendar day of January of the succeeding year";
  ws.getCell(8, 9).font = { italic: true, size: 8 };

  // ---- Table headers ----
  const headerRow1 = 10; // group titles
  const headerRow2 = 11; // "Size in kilograms" label / "Total in KG"
  const headerRow3 = 12; // numeric size reference row (used by formulas)
  const firstDataRow = 13;

  ws.mergeCells(headerRow1, 1, headerRow3, 1);
  ws.getCell(headerRow1, 1).value = "MONTH";
  ws.getCell(headerRow1, 1).font = { bold: true };
  ws.getCell(headerRow1, 1).alignment = { vertical: "middle", horizontal: "center" };

  let col = 2;
  const groupStartCol = {};
  groups.forEach((groupName) => {
    groupStartCol[groupName] = col;
    ws.mergeCells(headerRow1, col, headerRow1, col + colsPerGroup - 1);
    const cell = ws.getCell(headerRow1, col);
    cell.value = groupName;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.alignment = { horizontal: "center" };

    ws.mergeCells(headerRow2, col, headerRow2, col + usedSizes.length - 1);
    const sizeLabelCell = ws.getCell(headerRow2, col);
    sizeLabelCell.value = "Size in kilograms";
    sizeLabelCell.font = { bold: true, size: 9 };
    sizeLabelCell.alignment = { horizontal: "center" };

    usedSizes.forEach((size, i) => {
      const sizeCell = ws.getCell(headerRow3, col + i);
      sizeCell.value = size;
      sizeCell.font = { bold: true };
      sizeCell.alignment = { horizontal: "center" };
    });

    ws.mergeCells(headerRow2, col + usedSizes.length, headerRow3, col + usedSizes.length);
    const totalHeaderCell = ws.getCell(headerRow2, col + usedSizes.length);
    totalHeaderCell.value = "Total in KG";
    totalHeaderCell.font = { bold: true, size: 9 };
    totalHeaderCell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };

    col += colsPerGroup;
  });

  ws.getRow(headerRow1).eachCell({ includeEmpty: false }, (cell) => {
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  });

  // ---- Data rows ----
  function sizeRefAddr(groupName, sizeIdx) {
    return `$${colLetter(groupStartCol[groupName] + sizeIdx)}$${headerRow3}`;
  }

  months.forEach((month, mIdx) => {
    const r = firstDataRow + mIdx;
    ws.getCell(r, 1).value = mIdx === 0 ? "1st January" : month.label;

    // Beginning Inventory: January is a hard value (reconstructed from the
    // ledger); every later month carries forward the previous month's Ending.
    const beginCol = groupStartCol["Beginning Inventory"];
    usedSizes.forEach((size, i) => {
      const cell = ws.getCell(r, beginCol + i);
      if (mIdx === 0) {
        cell.value = month.beginning[size];
      } else {
        const prevEndCol = groupStartCol["Ending Inventory"] + i;
        cell.value = { formula: `${colLetter(prevEndCol)}${r - 1}` };
      }
    });
    const beginTotalCol = beginCol + usedSizes.length;
    ws.getCell(r, beginTotalCol).value = {
      formula: usedSizes
        .map((size, i) => `${colLetter(beginCol + i)}${r}*${sizeRefAddr("Beginning Inventory", i)}`)
        .join("+"),
    };

    // Purchases (actual ledger data for the month)
    const purchCol = groupStartCol["Purchases"];
    usedSizes.forEach((size, i) => {
      ws.getCell(r, purchCol + i).value = month.purchases[size];
    });
    const purchTotalCol = purchCol + usedSizes.length;
    ws.getCell(r, purchTotalCol).value = {
      formula: usedSizes
        .map((size, i) => `${colLetter(purchCol + i)}${r}*${sizeRefAddr("Purchases", i)}`)
        .join("+"),
    };

    // Sales (actual ledger data for the month)
    const salesCol = groupStartCol["Sales"];
    usedSizes.forEach((size, i) => {
      ws.getCell(r, salesCol + i).value = month.sales[size];
    });
    const salesTotalCol = salesCol + usedSizes.length;
    ws.getCell(r, salesTotalCol).value = {
      formula: usedSizes
        .map((size, i) => `${colLetter(salesCol + i)}${r}*${sizeRefAddr("Sales", i)}`)
        .join("+"),
    };

    // Ending Inventory = Beginning + Purchases - Sales (formula, like the original)
    const endCol = groupStartCol["Ending Inventory"];
    usedSizes.forEach((size, i) => {
      const b = colLetter(beginCol + i);
      const p = colLetter(purchCol + i);
      const s = colLetter(salesCol + i);
      ws.getCell(r, endCol + i).value = { formula: `${b}${r}+${p}${r}-${s}${r}` };
    });
    const endTotalCol = endCol + usedSizes.length;
    ws.getCell(r, endTotalCol).value = {
      formula: usedSizes
        .map((size, i) => `${colLetter(endCol + i)}${r}*${sizeRefAddr("Ending Inventory", i)}`)
        .join("+"),
    };
  });

  // ---- "Jan Nxt Yr" continuation + annual totals row ----
  const continuationRow = firstDataRow + 12;
  ws.getCell(continuationRow, 1).value = "Jan (Next Year)";
  ws.getCell(continuationRow, 1).font = { italic: true };

  const beginCol = groupStartCol["Beginning Inventory"];
  const endCol = groupStartCol["Ending Inventory"];
  usedSizes.forEach((size, i) => {
    const cell = ws.getCell(continuationRow, beginCol + i);
    cell.value = { formula: `${colLetter(endCol + i)}${continuationRow - 1}` };
  });

  ["Beginning Inventory", "Purchases", "Sales", "Ending Inventory"].forEach((groupName) => {
    const totalCol = groupStartCol[groupName] + usedSizes.length;
    const letter = colLetter(totalCol);
    ws.getCell(continuationRow, totalCol).value = {
      formula: `SUM(${letter}${firstDataRow}:${letter}${firstDataRow + 11})`,
    };
    ws.getCell(continuationRow, totalCol).font = { bold: true };
  });
  ws.getRow(continuationRow).font = { bold: true };

  // ---- Borders + column widths for the whole table ----
  for (let r = headerRow1; r <= continuationRow; r++) {
    for (let c = 1; c <= totalCols; c++) {
      const cell = ws.getCell(r, c);
      cell.border = {
        top: { style: "thin", color: { argb: "FFD1D5DB" } },
        bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
        left: { style: "thin", color: { argb: "FFD1D5DB" } },
        right: { style: "thin", color: { argb: "FFD1D5DB" } },
      };
      if (r >= firstDataRow && c > 1) cell.alignment = { horizontal: "center" };
    }
  }
  ws.getColumn(1).width = 16;
  for (let c = 2; c <= totalCols; c++) ws.getColumn(c).width = 9;

  // ---- Footer notes (matches the original's reminder block) ----
  const noteRow = continuationRow + 3;
  ws.getCell(noteRow, 1).value = "Reminder/Instruction:";
  ws.getCell(noteRow, 1).font = { bold: true };
  ws.getCell(noteRow + 1, 1).value = "1. Submission of this report shall be on a per Trademark or Tradename basis.";
  ws.getCell(noteRow + 2, 1).value =
    "2. Beginning Inventory, Purchases, Sales and Ending Inventory are reconstructed from recorded inventory transactions.";

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ---------------------------------------------------------------------------
// PDF generator — same structure, values only (no live formulas in a PDF)
// ---------------------------------------------------------------------------

function buildAnnualReportPdf(data, meta) {
  const { brandName, year, usedSizes, months, nextJanBeginning } = data;
  const { companyName, contactEmail, preparedBy } = meta;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 24, size: "A4", layout: "landscape" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(9).text("Department of Energy", { align: "left" });
    doc.fontSize(8).font("Helvetica-Oblique").text("Annex AR-E-2", { align: "right" });
    doc.font("Helvetica-Bold").fontSize(11).text("LPG DEALER", { align: "left" });
    doc.moveDown(0.3);
    doc
      .fontSize(10)
      .text(
        `ANNUAL UPDATE REPORT ON LPG SUPPLY AND DEMAND BALANCE (TRADEMARK NAME OR BRAND: ${brandName})`,
        { align: "center" }
      );
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(8);
    doc.text(`Company Name: ${companyName || "—"}      Contact: ${contactEmail || "—"}      Covered Year: ${year}`);
    doc.text(`Prepared By: ${preparedBy || "—"}`);
    doc.moveDown(0.6);

    const groups = ["Beginning Inventory", "Purchases", "Sales", "Ending Inventory"];
    const colsPerGroup = usedSizes.length + 1;
    const monthColWidth = 65;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const dataColWidth = (pageWidth - monthColWidth) / (groups.length * colsPerGroup);
    const startX = doc.page.margins.left;
    let y = doc.y;

    function colX(groupIdx, colIdx) {
      return startX + monthColWidth + (groupIdx * colsPerGroup + colIdx) * dataColWidth;
    }

    // Group header row
    doc.font("Helvetica-Bold").fontSize(7);
    doc.rect(startX, y, monthColWidth, 14).fillAndStroke("#1e3a5f", "#1e3a5f");
    doc.fillColor("#ffffff").text("MONTH", startX + 2, y + 4, { width: monthColWidth - 4 });
    groups.forEach((g, gi) => {
      const x = colX(gi, 0);
      const w = dataColWidth * colsPerGroup;
      doc.rect(x, y, w, 14).fillAndStroke("#1e3a5f", "#1e3a5f");
      doc.fillColor("#ffffff").text(g, x + 2, y + 4, { width: w - 4, align: "center" });
    });
    y += 14;

    // Size sub-header row
    doc.fillColor("#111827").font("Helvetica-Bold").fontSize(6.5);
    groups.forEach((g, gi) => {
      usedSizes.forEach((size, si) => {
        const x = colX(gi, si);
        doc.rect(x, y, dataColWidth, 12).stroke("#d1d5db");
        doc.text(String(size), x, y + 3, { width: dataColWidth, align: "center" });
      });
      const totalX = colX(gi, usedSizes.length);
      doc.rect(totalX, y, dataColWidth, 12).stroke("#d1d5db");
      doc.fontSize(5.5).text("Total KG", totalX, y + 2, { width: dataColWidth, align: "center" });
      doc.fontSize(6.5);
    });
    doc.rect(startX, y, monthColWidth, 12).stroke("#d1d5db");
    y += 12;

    // Data rows
    doc.font("Helvetica").fontSize(6.5);
    const rows = months.map((m, i) => ({
      label: i === 0 ? "1st January" : m.label,
      beginning: m.beginning,
      purchases: m.purchases,
      sales: m.sales,
      ending: m.ending,
    }));
    rows.push({
      label: "Jan (Next Year)",
      beginning: nextJanBeginning,
      purchases: null,
      sales: null,
      ending: null,
    });

    const totalsBySize = { purchases: 0, sales: 0 };
    const totalsInKg = { beginning: 0, purchases: 0, sales: 0, ending: 0 };
    months.forEach((m) => {
      usedSizes.forEach((size) => {
        totalsInKg.purchases += m.purchases[size] * size;
        totalsInKg.sales += m.sales[size] * size;
      });
    });

    rows.forEach((row, rIdx) => {
      if (y > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage({ margin: 24, size: "A4", layout: "landscape" });
        y = doc.page.margins.top;
      }
      const isLast = rIdx === rows.length - 1;
      doc.rect(startX, y, monthColWidth, 12).stroke("#d1d5db");
      doc.font(isLast ? "Helvetica-Bold" : "Helvetica").text(row.label, startX + 2, y + 3, { width: monthColWidth - 4 });

      groups.forEach((g, gi) => {
        const dataKey = { "Beginning Inventory": "beginning", Purchases: "purchases", Sales: "sales", "Ending Inventory": "ending" }[g];
        const rowData = row[dataKey];
        let groupTotalKg = 0;
        usedSizes.forEach((size, si) => {
          const x = colX(gi, si);
          doc.rect(x, y, dataColWidth, 12).stroke("#d1d5db");
          const val = rowData ? rowData[size] ?? "" : "";
          if (rowData) groupTotalKg += Number(val) * size;
          doc.text(String(val), x, y + 3, { width: dataColWidth, align: "center" });
        });
        const totalX = colX(gi, usedSizes.length);
        doc.rect(totalX, y, dataColWidth, 12).stroke("#d1d5db");
        if (isLast) {
          const kgVal = dataKey === "purchases" ? totalsInKg.purchases : dataKey === "sales" ? totalsInKg.sales : "";
          doc.font("Helvetica-Bold").text(kgVal === "" ? "" : kgVal.toFixed(1), totalX, y + 3, { width: dataColWidth, align: "center" });
        } else {
          doc.text(rowData ? groupTotalKg.toFixed(1) : "", totalX, y + 3, { width: dataColWidth, align: "center" });
        }
      });
      y += 12;
    });

    doc.moveDown(1.5);
    doc.font("Helvetica").fontSize(7);
    doc.text("Reminder/Instruction:", startX, y + 10);
    doc.text("1. Submission of this report shall be on a per Trademark or Tradename basis.", startX, y + 22);
    doc.text(
      "2. Beginning Inventory, Purchases, Sales and Ending Inventory are reconstructed from recorded inventory transactions.",
      startX,
      y + 34
    );

    doc.end();
  });
}

module.exports = { getAnnualReportData, buildAnnualReportXlsx, buildAnnualReportPdf, STANDARD_SIZES, extractStandardSize };