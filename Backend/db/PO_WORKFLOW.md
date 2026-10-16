# Purchase order workflow

Run `npm run migrate:po-workflow` from `Backend` before starting the updated API. The migration is additive and rerunnable. It adds WarehouseID, PaymentMethod, PaymentReference and RequestKey to PurchaseOrder, ReceivedQuantity to PurchaseOrderItem, and a warehouse foreign key. Fresh installations receive the same fields from schema.sql. Existing Received orders are initialized as fully received. No stock is changed by this migration.

Existing POs have no stored destination warehouse. The migration deliberately leaves it NULL rather than guessing where stock should go. Review and backfill the correct business warehouse administratively before dispatch/receipt. Existing historical statuses and inventory movements are preserved; reconcile legacy Approved/Sent orders with actual supplier communications because the previous API did not verify email dispatch.

Configure the existing mail transport in Backend/.env:

- SMTP_HOST
- SMTP_PORT (587 by default)
- SMTP_SECURE=true for implicit TLS, normally port 465; false for STARTTLS on 587
- SMTP_USER
- SMTP_PASS
- SMTP_FROM (optional; defaults to SMTP_USER for PO emails)

The authenticated business profile needs business name, address, ContactEmail and Phone. Suppliers need a saved email. Supplier selection follows the existing selected recommendation/product supplier flow. Payment details record only method and an optional reference, without creating a payment/settlement or collecting card credentials.

Creation saves a Pending PO before contacting SMTP. Successful SMTP acceptance advances it to Sent. Failure is logged and displayed, and the saved Pending PO can be retried with Send. A PDF containing business, supplier, warehouse, items and payment summary is attached. SMTP acceptance confirms handoff, not supplier acceptance or delivery to the inbox. Approve is a separate confirmed user action, followed by confirmed dispatch to Out for Delivery.

Receiving requires Out for Delivery and an active destination warehouse owned by the authenticated company. Ordered quantities, previously received quantities and this delivery's actual units are shown. A partial receipt stays Out for Delivery; the PO becomes Received only when all units have arrived. Overdelivery is rejected.

The API locks the PO and warehouse and uses the existing recordStockIn helper within a single transaction. Inventory credit, Stock In / Purchase audit records, item receipt counters and final status commit together or all roll back. A receipt request key is recorded in the existing movement Remarks field and checked under the PO lock to prevent retries from duplicating stock. A creation request key and serialized ID allocation prevent duplicate creation and preserve existing PO ID/reference formats. Company scoping applies to PO list, details and mutations.

SMTP cannot participate in a MySQL transaction: a connection/commit failure after SMTP accepts mail can leave delivery uncertain and a retry may send another email. Inventory is unaffected. An outbox/provider idempotency design would require additional persisted delivery infrastructure.

Validation: `npm run build`; targeted oxlint on changed JavaScript/JSX; `node --test Backend/tests/purchaseOrderWorkflow.test.js`. Tests use isolated DB/SMTP adapters and the real stock-in helper; they cover full and partial receipts, duplicate retries, rollback after audit failure, invalid warehouse/state/quantity rejection, linear transitions and SMTP failure/success. No test fixtures are written to the application database. Live MySQL migration and real SMTP delivery must be verified in the configured deployment environment.
