Before deploying these routes to another database, run `npm run migrate:product-history` from Backend after creating/seeding the schema. Run again after recreating Product. The repeatable migration requires CREATE TABLE, TRIGGER and ALTER privileges.

Product is the catalog. ProductHistory mirrors inserted/updated products with database triggers and retains deleted rows. Transaction foreign keys reference ProductHistory; historical queries use it. Catalog queries use Product. Transaction rows remain intact. Product descriptions retain their last catalog values at deletion; transaction prices and quantities remain on the original transaction rows.

Run `node db/verify_product_history.js` from Backend to verify decimal persistence and deletion in a transaction that always rolls back.
