# Local Bulk Import (SQLite)

This project includes a local importer for desktop SQLite master data.

## 1) Prepare your source file

- Use CSV or XLSX.
- Use one sheet/tab only (first sheet is imported).
- Start from templates in `docs/templates/local-import/`.

## 2) Find your local SQLite file

From BOAT Desktop, get the SQLite path from the local health endpoint in-app (or from desktop logs), then use that path with `--db`.

Typical Windows example:

`C:/Users/<YourUser>/AppData/Roaming/boat/boat_sqlite/boat.sqlite`

## 3) Run import

From project root:

```bash
npm run local:import -- --db "<absolute path to boat.sqlite>" --entity products --file "docs/templates/local-import/products.csv"
```

### Supported entities

- `products`
- `retail-customers`
- `hotel-customers`
- `vendors`
- `chart-of-accounts`

### More examples

```bash
npm run local:import -- --db "<db>" --entity retail-customers --file "docs/templates/local-import/retail-customers.csv"
npm run local:import -- --db "<db>" --entity hotel-customers --file "docs/templates/local-import/hotel-customers.csv"
npm run local:import -- --db "<db>" --entity vendors --file "docs/templates/local-import/vendors.csv"
npm run local:import -- --db "<db>" --entity chart-of-accounts --file "docs/templates/local-import/chart-of-accounts.csv"
```

## Notes

- Rows missing required fields are skipped:
  - `products`: requires `name`
  - `retail-customers`: requires `name`
  - `hotel-customers`: requires `first_name` and `last_name`
  - `vendors`: requires `name`
  - `chart-of-accounts`: requires `name`
- Leave `id` blank to auto-generate IDs.
- `vendors` and `chart-of-accounts` are stored in `local_records` under table names `vendors` and `gl_accounts`.
- This script imports into local SQLite only. It does not enqueue remote sync operations for all entities.
