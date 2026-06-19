# BOAT School Server

This is the phase 3 operator path for a school using BOAT Desktop with a central PostgreSQL server.

SQLite desktop mode is unchanged. Use this only for the server-backed school desktop build.

## Roles

## Phase 4: Carry-One-File Installer

## Phase 5: Offline Prerequisites

For low-internet client sites, put prerequisite installers in:

```text
deploy\prerequisites
```

Recommended filenames:

```text
node-v20.x.x-x64.msi
Docker Desktop Installer.exe
```

Then build the one-file installer:

```powershell
npm run pack:school-server-onefile
```

The generated `.ps1` carries those installers inside its payload. On the client server it installs bundled Node.js and Docker first; only if they are missing from the payload does it fall back to `winget`. To force offline-only behavior, run the generated installer with `-OfflineOnly`.

## Phase 6: Full Offline Runtime Bundle

If the client server has no reliable internet, build the installer on a packaging PC that already has BOAT dependencies and Docker available:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\pack-school-server-onefile.ps1 -IncludeNodeModules -IncludeDockerImages -OfflineOnly
```

This adds:

- root `node_modules`
- `server\node_modules`
- a Docker image archive under `deploy\docker-images`
- `docker-compose.offline.yml`, which runs the prebuilt `boat-api:school-offline` image instead of building the API at the client site

Use this when you want the client installer to avoid:

- `npm install`
- pulling `postgres:16-alpine`
- building the API image from the internet

The generated file will be much larger. That is expected.

Build the technician file from the BOAT repo:

```powershell
npm run pack:school-server-onefile
```

Output:

```text
release\school-server-installer\BOAT-School-Server-Installer-YYYYMMDD-HHmmss.ps1
```

Carry that one `.ps1` file to the client's server PC. Run it with PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\BOAT-School-Server-Installer-YYYYMMDD-HHmmss.ps1
```

The file self-extracts BOAT to `C:\BOAT-School`, runs the one-click installer, starts the local server stack, and creates the `BOAT School` desktop icon.

## Folder-Based One-Click Server Install

For the simplest client server setup, copy the BOAT release folder to the server PC and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\install-school-server-oneclick.ps1
```

The installer:

- installs/verifies Node.js and Docker when `winget` is available,
- initializes and starts Postgres + `boat-server`,
- applies SQL migrations,
- builds the school API desktop bundle,
- writes the local Electron API setting,
- creates a desktop shortcut named `BOAT School`.

If Docker Desktop is newly installed, Windows may require a reboot before the installer can continue. Re-run the same file after reboot.

- Server PC: runs PostgreSQL and `boat-server`.
- Client PCs: run BOAT Desktop built with `VITE_DESKTOP_DATA_MODE=api`.
- LAN mode: clients connect to the server PC IP, for example `http://192.168.1.20:3001`.
- WAN mode: publish the API behind a VPN, reverse proxy, or firewall rule, then set a fixed HTTPS origin.

## Quick Start

From the repo root on the server PC:

```powershell
npm run school-server:init
npm run school-server:start
npm run school-server:migrate
npm run school-server:status
```

Then open BOAT Desktop school API mode on each client and set:

```text
http://SERVER-LAN-IP:3001
```

The desktop connection screen stores that URL in the local Electron settings file.

## LAN Install

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\school-server.ps1 -Action init -Mode lan -ApiPort 3001
powershell -ExecutionPolicy Bypass -File .\scripts\school-server.ps1 -Action start
powershell -ExecutionPolicy Bypass -File .\scripts\school-server.ps1 -Action migrate
```

The script creates `deploy\compose.env` if it does not exist and generates a database password when the example password is still present.

## WAN Install

Use WAN only when the business has a real network plan: VPN, reverse proxy with TLS, or a locked-down firewall rule. Avoid exposing raw port `3001` directly to the public internet.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\school-server.ps1 -Action init -Mode wan -CorsOrigin "https://school.example.com"
powershell -ExecutionPolicy Bypass -File .\scripts\school-server.ps1 -Action start
```

Set desktop clients to the HTTPS URL that reaches the reverse proxy.

## Daily Commands

```powershell
npm run school-server:status
npm run school-server:backup
npm run school-server:stop
npm run school-server:start
```

Backups are written to `.runtime\school-server-backups`.

## Firewall

The script does not open Windows Firewall automatically by default. To add a local inbound rule:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\school-server.ps1 -Action init -AllowFirewall
```

Use this only on the server PC and only for the intended network profile.

## Desktop Builds

- Server-backed school desktop: `npm run desktop:dist:school-api`
- Existing local SQLite desktop: `npm run desktop:dist:local`
