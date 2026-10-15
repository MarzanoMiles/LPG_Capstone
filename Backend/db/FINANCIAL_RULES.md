# Financial and tax rules

Changed UI: `src/Settings.jsx`, `src/SettingsFinancial.jsx`, `src/Settings.css`.
Changed backend: `routes/settingsRoutes.js`, `routes/orderRoutes.js`, `routes/salesRoutes.js`, `routes/paymentRoutes.js`, `utils/financialRules.js`, `package.json`.
Database: `schema.sql`, `patch_company_settings.sql`, `migrate_financial_rules.js`, `patch_refund_ledger.sql`.
Tests: `tests/financialRules.test.js`, `tests/financialRules.database.test.js`.

Run from Backend:

```
npm.cmd run migrate:financial-rules
node --test tests/financialRules.test.js tests/financialRules.database.test.js
```

The additive migration is rerunnable. It adds four CompanySettings columns and RefundLedger. Both switches default to off. Disabling refunds or fees retains the saved fee configuration. Schema.sql is the full database reset script, not an upgrade migration.

The existing settings GET and PUT /settings/tax return the saved company configuration. The Settings card edits a draft; Cancel discards it. The original tax, currency, rounding and discount controls remain in the modal. The existing discount controls remain local-only, as before; this task does not change POS discounts.

POST /orders/:id/refund records a refund for an administrator or manager; GET /orders/:id/refund retrieves its ledger entry. These endpoints record the refund obligation; no payment provider or actual cash disbursement is integrated. Existing paid order cancellation, cancellation status updates, and sale voiding record the refund in the same transaction. They reject new paid cancellations if refunds are off, rather than deleting payments without an accounting record. Unpaid cancellations continue without a refund or fee.

Cancellation fees apply only to fully paid, non-completed orders being cancelled. Eligible amount is capped at the order total, excluding overpayment/change. Ordinary refunds and partially paid orders do not incur cancellation fees. There are no abandonment eligibility rules or delivery-attempt counters in this codebase, so abandonment is not automatically inferred. A qualifying abandonment rule must be defined before that trigger can be connected.

Order row locks serialize refunds. A unique OrderID ledger key prevents multiple refunds/fees even across concurrent requests. The ledger intentionally has no order/sale foreign key because existing cancellation deletes these records; company and user foreign keys remain. Replays while the order exists return the original record. After deletion, the refund remains accessible through GET /orders/:id/refund.

Verification: six automated tests cover both switches, both fee types, numeric validation, fee caps, cent rounding, authorization, unpaid/partial/completed exclusions, repeated refunds, settings API database round trips, migration reruns and concurrent duplicate ledger inserts. Integration settings writes roll back; synthetic ledger records are removed. Production build passes; lint reports existing warnings. Browser interaction, sign-out/sign-in and physical cash disbursement were not exercised.
