const router = require("express").Router();
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/apiError");
const { sendMail } = require("../config/mailer");

const RECIPIENT = process.env.CONTACT_RECIPIENT || "gastrack.inventory@gmail.com";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUBJECTS = {
  registration: "Registration Inquiry",
  technical: "Technical Support",
  sales: "Sales & Pricing",
  other: "Other Concerns",
};
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Simple per-IP limit: 5 messages per 15 minutes.
const hits = new Map();
function rateLimit(req) {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (recent.length >= 5) throw new ApiError(429, "Too many messages. Please try again later.");
  recent.push(now);
  hits.set(req.ip, recent);
}

// POST /contact (public)
router.post("/", asyncHandler(async (req, res) => {
  rateLimit(req);
  const { firstName, lastName, email, subject, message } = req.body || {};
  const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const first = text(firstName, 75), last = text(lastName, 75), from = text(email, 150), body = text(message, 3000);
  if (!first || !last || !body) throw new ApiError(400, "Name and message are required.");
  if (!EMAIL_PATTERN.test(from)) throw new ApiError(400, "Please enter a valid email address.");
  if (!SUBJECTS[subject]) throw new ApiError(400, "Please select a topic.");

  const title = `GasTrack Contact: ${SUBJECTS[subject]}`;
  try {
    await sendMail({
      to: RECIPIENT,
      replyTo: from,
      subject: title,
      text: `From: ${first} ${last} <${from}>\nTopic: ${SUBJECTS[subject]}\n\n${body}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px">
        <h3 style="color:#1e3a5f">${esc(title)}</h3>
        <p><strong>From:</strong> ${esc(first)} ${esc(last)} &lt;${esc(from)}&gt;</p>
        <p><strong>Topic:</strong> ${esc(SUBJECTS[subject])}</p>
        <p style="white-space:pre-wrap">${esc(body)}</p></div>`,
    });
  } catch (err) {
    console.error("Contact email failed:", err.message);
    throw new ApiError(502, "Your message could not be sent right now. Please try again later.");
  }
  res.status(201).json({ message: "Thank you! Your message has been sent." });
}));

module.exports = router;