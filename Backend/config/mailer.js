const nodemailer = require("nodemailer");
require("dotenv").config();

// Uses standard SMTP env vars — works with Gmail (with an App Password),
// SendGrid, Mailgun, or any SMTP provider. See the setup guide at the
// bottom of this file's usage for exact values to put in backend/.env.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true", // true for port 465, false for 587/25
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendMail({ to, subject, html, text }) {
  const from = process.env.SMTP_FROM || `"GasTrack" <${process.env.SMTP_USER}>`;
  return transporter.sendMail({ from, to, subject, html, text });
}

module.exports = { transporter, sendMail };