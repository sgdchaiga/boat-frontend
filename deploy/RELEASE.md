# BOAT - on-prem release (what is in the ZIP)

This archive contains the web app source, Fastify API (`server/`), deployment files (`deploy/`), SQL migrations (`supabase/migrations`), and sync scripts (`scripts/`). It does **not** include `node_modules` (run `npm install` after unzip).

---

## Prerequisites (what most clients need)

- **Windows 10/11** (steps below use PowerShell).
- **Node.js 20 LTS** (includes `npm`) - [https://nodejs.org](https://nodejs.org)
- **PostgreSQL** installed on the same PC (or reachable on the LAN) - [https://www.postgresql.org/download/windows/](https://www.postgresql.org/download/windows/)  
  During setup, note the **superuser password**, **port** (often `5432`), and create a **database** (e.g. `boat`) and a **user** with access to it.
- Internet for the first `npm install` and for cloud sync (if used).

**Docker Desktop** is **not** required. Use it only if your IT team prefers containers (see [Optional: Docker](#optional-docker-for-it-teams)).

---

## Recommended install (no Docker)

### 1. Unzip

Unzip to a folder, e.g. `C:\BOAT`. Open **PowerShell** in that folder (the one that contains `package.json`).

### 2. Install JavaScript dependencies

```powershell
npm install
```

### 3. Environment files

Copy the web app template if present:

```powershell
copy .env.example .env
```

Edit **`.env`** and set:

- `VITE_SUPABASE_URL` - your Supabase project URL (hosted or your own).
- `VITE_SUPABASE_ANON_KEY` - anon key from the Supabase dashboard.

Copy sync/API templates:

```powershell
copy deploy\sync.env.example deploy\sync.env
```

Edit **`deploy/sync.env`**:

- `DATABASE_URL` - must point at **your** Postgres, e.g.  
  `postgresql://YOUR_USER:YOUR_PASSWORD@127.0.0.1:5432/boat?schema=public`
- `CLOUD_SUPABASE_URL` and `CLOUD_SERVICE_ROLE_KEY` - only if you use LAN-to-cloud sync (service role key must stay server-side).

Create **`server/.env`** (same folder as `server/package.json`) with the same `DATABASE_URL` if you run the Fastify API on the machine:

```env
DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@127.0.0.1:5432/boat?schema=public
PORT=3001
HOST=0.0.0.0
```

You do **not** need **`deploy/compose.env`** unless you use Docker (see below).

### 4. Apply database schema (migrations)

BOAT ships SQL under **`supabase/migrations`**. Files must run in **lexical (filename) order** - the timestamp prefix keeps order correct.

**Important:** These migrations are written for **Supabase** (they reference `auth.users`, `auth.uid()`, RLS roles like `authenticated`, and extensions). They run cleanly against:

- Your **hosted Supabase** project (vendor applies migrations via Supabase CLI or dashboard), or  
- **Self-hosted Supabase** / Postgres that includes the same `auth` and helpers.

**Vanilla PostgreSQL only** (no Supabase) often **fails** until you add compatible stubs or a vendor-provided plain-Postgres migration pack. If you self-host the DB, prefer **Supabase’s Postgres image** or official **Supabase on-prem** docs rather than stock Postgres alone.

#### Option A - PowerShell helper (Windows, `psql` on PATH)

Install PostgreSQL (the installer adds **`psql`**). Create an empty database (e.g. `boat`), then from the **project root**:

```powershell
$env:PGPASSWORD = "YOUR_DB_PASSWORD"
.\scripts\apply-migrations.ps1 -Host 127.0.0.1 -Port 5432 -Database boat -User postgres
```

Or with a single URL:

```powershell
$env:PGPASSWORD = "YOUR_DB_PASSWORD"
.\scripts\apply-migrations.ps1 -DatabaseUrl "postgresql://postgres:YOUR_DB_PASSWORD@127.0.0.1:5432/boat"
```

(`PGPASSWORD` may be unnecessary if the URL already contains the password.)

#### Option B - Manual `psql`

```powershell
$env:PGPASSWORD = "YOUR_DB_PASSWORD"
cd supabase\migrations
Get-ChildItem *.sql | Sort-Object Name | ForEach-Object { psql -h 127.0.0.1 -p 5432 -U postgres -d boat -v ON_ERROR_STOP=1 -f $_.FullName }
```

(Run from a directory where paths resolve, or use full paths to each `.sql` file.)

#### Option C - Supabase CLI (when the database is a Supabase project)

If the client uses **Supabase** (cloud or local `supabase start`), use **`supabase db push`** / **`supabase migration up`** as documented by Supabase - do not duplicate steps here.

### 5. Start the API (Fastify)

From the **`server`** folder:

```powershell
cd server
npm install
npx prisma generate
npm run build
npm run start
```

Leave this running. Check [http://localhost:3001/health](http://localhost:3001/health) (or the `PORT` you set).

For development you can use `npm run dev` in **`server`** instead of `build` + `start`.

### 6. Start the web app

Open a **second** PowerShell window in the **project root** (not inside `server`):

```powershell
npm run dev
```

Open the URL Vite prints (usually **http://localhost:5173**).

### 7. Production build (optional)

To build static files for IIS, nginx, or another host:

```powershell
npm run build
```

Output is under **`dist/`**.

### 8. Background sync to cloud (optional)

If you use **`deploy/sync.env`** with `DATABASE_URL` and cloud keys, run the worker on a schedule (e.g. Task Scheduler) or use:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\install-windows.ps1
```

That script can also register a **scheduled task** to run **`npm run sync:worker`** every few minutes. It may offer Docker; you can decline if you are not using Docker.

---

## Optional: Docker (for IT teams)

Use this only if you already use Docker and want Postgres + the API in containers.

1. Install **Docker Desktop** and start it.
2. Copy **`deploy/compose.env.example`** to **`deploy/compose.env`** and set a strong **`POSTGRES_PASSWORD`**.
3. Set **`DATABASE_URL`** in **`deploy/sync.env`** to match the user, password, database, and host **`127.0.0.1`** and port mapped in **`compose.env`** (default Postgres port **5432**).
4. From the project root:

```powershell
npm run deploy:up
```

5. Still apply **migrations** to the Postgres instance inside Docker (same schema as without Docker).

Docker does **not** replace the need for **`npm install`** at the project root for the web app, unless you only ship pre-built **`dist/`** assets.

---

## What we send you

Your vendor should send a **ZIP** built with **`scripts/pack-release.ps1`** (often named like **`boat-onprem-*.zip`**). This file is included in that ZIP as **`RELEASE.md`**.

---

## Security

- Never email **service role** keys or database passwords in plain text.
- Treat **`.env`**, **`deploy/sync.env`**, **`deploy/compose.env`**, and **`server/.env`** as secrets on the client PC.
