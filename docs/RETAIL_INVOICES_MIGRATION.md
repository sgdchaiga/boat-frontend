# Apply retail invoices tables (Supabase)

If the app shows **“invoices tables are missing”**, your hosted database does not have `retail_invoices` / `retail_invoice_lines` (and related objects) yet.

## Quick fix (recommended)

1. In [Supabase Dashboard](https://supabase.com/dashboard) → your project → **SQL Editor**.
2. Open the file **`supabase/manual/apply_retail_invoices_complete.sql`** in this repo, copy **all** of it.
3. Paste into the SQL Editor and click **Run**.
4. Wait ~10–30 seconds, then reload BOAT and use **Retry loading invoices** on the Sales Invoices page.

The script is idempotent: it uses `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and `CREATE OR REPLACE` where safe. It ends with `NOTIFY pgrst, 'reload schema'` so PostgREST picks up new tables without a long delay.

## Prerequisites

- `organizations`, `staff`, `products`, and `hotel_customers` (formerly `guests` → `customers`) must already exist (standard BOAT schema).

## Alternative: migration files

If you use the Supabase CLI (`supabase db push`), the same logic lives under:

- `supabase/migrations/20260326000000_retail_invoices.sql`
- `supabase/migrations/20260327000000_retail_customers.sql`
- `supabase/migrations/20260329000000_retail_invoices_guest_id.sql`
- `supabase/migrations/20260331000001_rename_guests_to_customers.sql` (if upgrading from `guests`)
- `supabase/migrations/20260401000000_rename_guest_id_to_property_customer_id.sql` (renames `guest_id` → `property_customer_id` on reservations, stays, retail_invoices)
- `supabase/migrations/20260402000000_rename_customers_to_hotel_customers.sql` (renames `customers` → `hotel_customers`)

Run them **in that order** (skip renames you have already applied).
