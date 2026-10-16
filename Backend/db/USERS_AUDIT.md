# Users settings and global audit

Run `npm run migrate:users-audit` from `Backend` before starting the updated API.
The migration was applied and rerun successfully against the configured development database.

## Database changes

- Nullable `BranchID` foreign keys on `User` and `Warehouse`; existing warehouse assignments remain intact. Existing warehouses stay unassigned to a branch until configured.
- `UserIdSequence` serializes user creation and registration using `U-001` style IDs. Existing user IDs are preserved; numbers naturally expand past 999.
- `UserActivity.CompanyID`, `ActorName`, `ActorRole`, and `Outcome`. Existing rows are backfilled from available user/role records. These older snapshots reflect migration-time identity because historical names cannot be reconstructed.
- An insert trigger supplies authenticated actor snapshots from `User`/`Role`. Update/delete triggers reject audit tampering. No audit mutation endpoints are exposed.
- New shared-service activity IDs use `AUD-` plus 16 random hexadecimal characters, within the existing 20-character column and independent of legacy numeric activity ID generators.

## Behavior and boundaries

- `/user-settings/roles`, `/user-settings/branches`, and `/user-settings/warehouses` provide authenticated reads and administrator-only writes. Branches and warehouses are company scoped. Roles remain global, matching the existing schema.
- Unique role names and all existing RBAC names remain protected. System role renaming is blocked because existing permissions depend on names. Custom role renames retain assigned users' stored module access. New custom roles follow the existing default of no module permissions.
- All foreign-key references are checked before deletion, including inactive users, warehouses under branches, inventory, transfers, purchase orders, and pickup claims. Database foreign keys also protect concurrent deletion.
- A warehouse may be unassigned to a branch. Assigned warehouses are filtered by the selected branch; unassigned warehouses remain available. Single warehouse assignment is preserved because the existing schema has no multi-assignment support.
- Form selections survive settings renames through record IDs. Settings updates refresh all dropdowns. Existing users can be assigned a branch without replacing their warehouse.
- Authenticated data writes are instrumented by `databaseAudit` in the shared pool. Existing transactions receive their audit before commit; individual autocommit writes run in short transactions with their audit. Logging failure rolls back the corresponding write. Acquired connections used without an explicit transaction are covered too.
- Explicit transactional audits (Users, settings, delivery lifecycle, force-deletes) suppress the generic audit for that transaction. Legacy post-write product audits are suppressed after an automatic atomic audit has already been recorded. A request containing several independent autocommit writes can have multiple genuine change entries.
- Module access is read from the database on every authenticated request and enforced together with existing role/ownership restrictions. Shared read-only lookup endpoints allow the modules that depend on them, such as POS product lookups and driver lists. Navigation uses the same saved module flags, refreshes on focus/every 30 seconds and after Users saves, and shows a no-access screen for all-off accounts. Roles do not reset module flags.
- Only administrators may change permissions or roles. Managers cannot create, edit, reset the password of, or deactivate administrator accounts. New users start with all modules off; the first administrator created during company registration receives bootstrap access.
- The Activity Log records committed data changes, not every click. Viewing records, opening modals, previews, exports, denied/failed requests, login/logout, and saving unchanged values do not create new entries. Updates to the separate Data Activity Log alone are excluded. Existing historical entries remain immutable.
- User/settings saves with no changed values skip explicit audit entries; shared SQL auditing ignores UPDATE results with zero changed rows. If a read triggers a real database change (for example an order expiring), that actual change is still audited.
- Descriptions use readable sentences, such as "Updated supplier name", "Previewed a purchase order document", and "Disabled Inventory access". They exclude SQL, HTTP methods/routes, credentials, request bodies and headers. Old method/path descriptions are presented in readable form when querying logs; immutable historical database rows are preserved.
- Database changes and their audit are atomic. External effects such as mail delivery and local browser-only interactions are outside those database transactions; this is not a recorder of every UI click.
- Audit rows retain actor snapshots, descriptions, target IDs, and success/failure outcomes. Bulk operations without a single target ID show an empty target. The log supports search, exact module/action filters, and the existing six-button Prev/Next pagination.
- Authentication reloads current actor role/company/status from the database, so stale JWT role claims and inactive accounts cannot authorize settings writes.

## Verification

- Production build passes; lint has only existing warnings outside changed files.
- Existing workflow suite plus added audit/auth tests passes: 97 passed, none skipped (including all optional MySQL scenarios, run sequentially to avoid shared-fixture lock contention).
- Run from `Backend` with `RUN_USERS_AUDIT_DB_TESTS`, `RUN_DELIVERY_DB_TESTS`, `RUN_PICKUP_DB_TESTS`, `RUN_PO_DATABASE_TESTS`, and `RUN_CUSTOMER_DB_TESTS` set to `1`: `node --test --test-concurrency=1 tests/*.test.js`.
- New live MySQL tests verify CRUD, uniqueness, linked-record deletion, create/edit assignments, role permission preservation, login/deactivation, audit filtering, immutable rows, identity snapshots, and ID sequencing. Fixtures use rollback-only transactions.
- Browser interaction was not exercised; build, API, unit, and live MySQL regression checks passed.

## Files changed

- `src/AddUserModal.jsx`
- `src/AddUserModal.css`
- `src/UserSettingsModal.jsx` (new)
- `src/Users.jsx`
- `Backend/server.js`
- `Backend/package.json`
- `Backend/routes/userRoutes.js`
- `Backend/routes/userSettingsRoutes.js` (new)
- `Backend/routes/authRoutes.js`
- `Backend/middleware/auth.js`
- `Backend/utils/activityLogger.js`
- `Backend/utils/userIds.js` (new)
- `Backend/db/migrate_users_audit.js` (new)
- `Backend/db/USERS_AUDIT.md` (new)
- `Backend/tests/usersAudit.test.js` (new)
- `Backend/tests/usersAudit.database.test.js` (new)

Additional files for the permission/audit corrections:

- `Backend/config/db.js`
- `Backend/utils/databaseAudit.js` (new)
- `Backend/utils/activityDescriptions.js` (new)
- `Backend/utils/activityLog.js`
- `Backend/utils/moduleAccess.js` (new)
- `Backend/utils/deliveryLifecycle.js`
- `Backend/tests/databaseAudit.test.js` (new)
- `Backend/tests/activityDescriptions.test.js` (new)
- `Backend/tests/moduleAccess.test.js` (new)
- `Backend/tests/apiSession.test.js` (new)
- `src/App.jsx`
- `src/Sidebar.jsx`
- `src/Login.jsx`
- `src/api.js`
- `src/rbac.js`
- `src/UserSettingsModal.css` (new)

The audit insert trigger now preserves validated `Success`/`Failure` outcomes. Rerun the migration on other databases before deploying the updated API. The updated migration was applied to the configured development database.
