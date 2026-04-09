# Platform super user (system operator)

Super users manage **all organizations**, **subscriptions**, and **other super users**. They do not need a row in `staff` unless they also use the hotel app.

## 1. Run migrations

Apply:

- `20260316000000_platform_superuser_organizations.sql` (adds missing `organizations` columns before seeding if the table already existed)
- `20260316000001_platform_admin_staff_read.sql`
- If you already hit **column "slug" does not exist**, run **`20260316000002_organizations_missing_columns.sql`** then continue the rest of `00000` from the subscription seed onward, or re-run the full updated `00000` in the SQL Editor.

## 2. Create the first super user

1. Create or pick a user in **Supabase → Authentication → Users** and copy their **UUID**.
2. In **SQL Editor** (runs as postgres, bypasses RLS), run:

```sql
INSERT INTO public.platform_admins (user_id, label)
VALUES ('PASTE_USER_UUID_HERE', 'Primary');
```

3. Sign in with that user. You should see the **Platform** console (Overview, Organizations, Subscription plans, Super users).

## 3. Add more super users

After the first admin exists, sign in as super user → **Super users** → paste another Auth user UUID → **Add platform admin**.

## 4. Same person: platform + property

If the user **also** has a row in `staff`, they get both **Platform** and **Property** sections in the sidebar.

## Tables (summary)

| Table | Purpose |
|-------|---------|
| `organizations` | Tenants / properties |
| `subscription_plans` | Starter, Professional, Enterprise (seeded) |
| `organization_subscriptions` | Plan + status + period per org |
| `platform_admins` | Super user accounts (`user_id` → `auth.users`) |

Existing staff are linked to the **Default property** org via `staff.organization_id` after migration.
