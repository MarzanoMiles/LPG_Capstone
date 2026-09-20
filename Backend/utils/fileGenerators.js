const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");

// Builds a CSV string from an array of column headers and an array of row arrays.
function buildCsv(headers, rows) {
  const escape = (val) => {
    const str = val === null || val === undefined ? "" : String(val);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [headers.map(escape).join(",")];
  rows.forEach((row) => lines.push(row.map(escape).join(",")));
  return lines.join("\n");
}

// Builds an .xlsx file (as a Buffer) from a sheet name, headers, and rows.
async function buildXlsx(sheetName, headers, rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31) || "Sheet1");

  worksheet.addRow(headers);
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1E3A5F" },
  };
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

  rows.forEach((row) => worksheet.addRow(row));

  worksheet.columns.forEach((column) => {
    let maxLength = 10;
    column.eachCell({ includeEmpty: true }, (cell) => {
      const len = cell.value ? String(cell.value).length : 0;
      if (len > maxLength) maxLength = len;
    });
    column.width = Math.min(maxLength + 2, 40);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// Builds a simple tabular PDF (as a Buffer) from a title, headers + rows.
function buildPdf(title, headers, rows) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(title, { align: "center" });
    doc.moveDown();

    const colCount = headers.length;
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = pageWidth / colCount;
    const startX = doc.page.margins.left;
    let y = doc.y;

    doc.fontSize(9).font("Helvetica-Bold");
    headers.forEach((h, i) => {
      doc.text(String(h), startX + i * colWidth, y, { width: colWidth - 4 });
    });
    y += 16;
    doc.moveTo(startX, y).lineTo(startX + pageWidth, y).stroke();
    y += 4;

    doc.font("Helvetica").fontSize(8);
    rows.forEach((row) => {
      if (y > doc.page.height - doc.page.margins.bottom - 20) {
        doc.addPage({ margin: 30, size: "A4", layout: "landscape" });
        y = doc.page.margins.top;
      }
      row.forEach((cell, i) => {
        doc.text(cell === null || cell === undefined ? "" : String(cell), startX + i * colWidth, y, {
          width: colWidth - 4,
        });
      });
      y += 14;
    });

    doc.end();
  });
}

module.exports = { buildCsv, buildXlsx, buildPdf };