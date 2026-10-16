# Purchase order workflow

From Backend, run `npm run migrate:po-workflow`, then `npm run migrate:po-paid-status` before starting the updated API. The schema includes nullable AmountPaid and PaymentEmailSentAt fields. Separate rerunnable migrations are also available as `migrate:po-payment-amount` and `migrate:po-payment-email`. Existing payment amounts and email-send times are not inferred. No stock is changed by these migrations.

Creation snapshots each active product's database CostPrice within the order transaction. Browser-supplied costs are ignored. Quantities and stored unit costs determine item subtotals and the order total. Existing orders retain their original costs.

Creation saves Pending before SMTP. Successful email submission sets Sent. Failed email leaves a retryable Pending order. The purchase order PDF contains requested products, quantities and total item count. It excludes payment and price information.

Supplier acceptance sets Approved; supplier decline sets Rejected. Rejected orders remain in Supplier Purchase Order History and cannot proceed to payment or receipt. The payment step requires GCash, Card or Bank Transfer, a reference number, and a positive amount with at most two decimal places. Recording payment sets Paid. This records external payment; it does not charge an account or create a Payment ledger entry. Payment details can be corrected before the acknowledgment email is sent.

The payment PDF contains saved costs, item totals, Total Amount Due and Total Amount Paid. The preview and email attachment share one PDF generator. Successful payment email submission records PaymentEmailSentAt. The workflow icon disappears, repeat send requests return without another email, and payment details become immutable. The payment PDF remains available from Purchase Order Details.

The delivery icon for Paid orders opens Confirm Goods Received. Confirmation credits the outstanding quantities to the persisted destination warehouse with Stock In / Supplier Delivery movement records and sets Received. Legacy Out for Delivery receipts remain supported. PO and warehouse locking, receipt keys and transactional movement writes prevent duplicate stock; stock, receipt quantities and status roll back together on failure. Received, Cancelled and Rejected orders are excluded from the active table and retained in supplier history.

SMTP requires SMTP_HOST, SMTP_USER and SMTP_PASS, with SMTP_FROM optional. The purchasing business requires name, address, email and phone; suppliers require a saved email. SMTP acceptance confirms handoff rather than inbox delivery. SMTP cannot participate in a MySQL transaction: a connection or commit failure after acceptance can leave delivery uncertain. An outbox or provider idempotency would be needed to resolve that window.

Validation: `npm run check:po-database` checks the configured live database without changes. Run purchaseOrderWorkflow.test.js, purchaseOrderCosts.test.js and purchaseOrderDocument.test.js with node --test from the project root. The opt-in purchaseOrder.database.test.js performs an inventory stock-in inside a rolled-back transaction; run from Backend with RUN_PO_DATABASE_TESTS=1. No emails are sent by these tests.
