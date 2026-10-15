# Customers refinement and transaction history

## Files changed

- `src/OrderAndDelivery.jsx`: exact six-column customer table, type filter, ten-row pagination coordinated with search, profile/history view, split-name add/edit forms, immutable ID display, permanent-delete confirmation and immediate list removal.
- `src/utils/customers.js`: shared filtering and pagination calculation.
- `Backend/routes/customerRoutes.js`: split-name validation, legacy POS full-name compatibility, automatic CUST IDs, customer type API filter and transactional hard deletion.
- `Backend/utils/customerHistory.js`: profile validation and atomic snapshot backfill / FK decoupling / hard deletion / rollback.
- `Backend/routes/orderRoutes.js`, `Backend/routes/salesRoutes.js`: snapshot-based order, sales and receipt data; history lookup by historical ID; customer ID allocation includes historical references.
- `Backend/routes/deliveryRoutes.js`, `Backend/utils/deliveryLifecycle.js`, `Backend/utils/pickupSettlement.js`: preserved customer identity for active delivery and settlement workflows.
- `Backend/db/schema.sql`, `Backend/db/migrate_customer_history.js`, `Backend/package.json`: fresh schema, repeatable upgrade and migration command.
- `Backend/tests/customerHistory.test.js`, `Backend/tests/fulfillmentQueues.test.js`: new coverage and updated snapshot query expectation.
- This report.

## Schema and migration

Run `npm.cmd run migrate:customer-history` from `Backend` for each existing database before deploying the changed APIs. The migration has been applied to the configured local `gastrack` database and rerun successfully.

- Customer gains nullable `FirstName` and `LastName` columns for legacy/system profile compatibility. Customer APIs require both nonblank components for add/edit, plus contact, address and an allowed type. VARCHAR limits match API and form limits. A DB CHECK constrains CustomerType to Residential or Commercial.
- Order, Sales, Payment and Delivery gain `historical_customer_id`, `customer_name`, `contact_number`, `address` and `customer_type`. Historical ID is a string with no customer FK.
- Order.CustomerID and Sales.CustomerID become nullable. Their customer foreign keys prohibit cascading deletion (RESTRICT).
- INSERT triggers capture customer snapshots for every write path, including POS and imports. Sales inherits the order snapshot; payments and deliveries inherit the sale snapshot, including after the customer has been deleted.
- Existing snapshots are preserved; missing fields are backfilled. Unexpected tables referencing Customer cause migration to fail for explicit review. MySQL schema DDL is not atomic: correct a migration failure and rerun before deploying APIs.
- Hard deletion locks the customer, fills missing order/sale snapshots, fills linked payment/delivery snapshots, nulls active customer references and deletes the profile within one DB transaction. Failure rolls back all data changes.
- There is no separate receipts table in this application. Receipt data is generated from the preserved sales/order snapshots.
- Missing legacy snapshots can only be reconstructed from the current customer profile. Profile values from earlier edits cannot be recovered when never recorded. No existing populated snapshot is replaced.

## Verification

- `npm.cmd run build`: passed (existing bundle-size warning).
- `npm.cmd run lint`: passed with existing unrelated warnings.
- Backend suite, run serially with RUN_CUSTOMER_DB_TESTS=1, RUN_DELIVERY_DB_TESTS=1 and RUN_PICKUP_DB_TESTS=1: **59 passed, zero failed, zero skipped**. Serial execution avoids shared database-fixture lock conflicts.
- New customer tests cover CUST formatting, required names/fields/types/lengths, legacy POS full-name requests, API search/type coordination, filter/pagination clamping, old vs new transaction snapshots after profile edits, missing-field backfill, injected deletion rollback, permanent removal from customer API results, historical order/sale/receipt queries and later payments after deletion.
- Database fixtures use transactions and roll back; no test customer or transaction is retained.
- Delivery, pickup, financial and walk-in/POS regression tests passed.
- UI compilation and filter/page logic were tested; interactive browser verification was not performed.
