# Offline Prerequisites

Put Windows prerequisite installers here before running:

```powershell
npm run pack:school-server-onefile
```

The generated one-file BOAT School Server installer will carry these files inside its payload and use them before falling back to `winget`.

Recommended files:

```text
node-v20.x.x-x64.msi
postgresql-16.x-windows-x64.exe
Docker Desktop Installer.exe
```

Accepted patterns:

```text
node-v*-x64.msi
node-*-x64.msi
node*.msi
postgresql-*-windows-x64.exe
postgresql*.exe
Docker Desktop Installer.exe
Docker*.exe
```

Do not commit the actual installers. This folder is ignored except for this README and `.gitkeep`.

Installer behavior:

- If Node.js is missing, bundled Node MSI is installed silently with `msiexec /qn /norestart`.
- If PostgreSQL is missing, bundled PostgreSQL is installed silently before any `winget` fallback.
- If Docker is missing, bundled Docker Desktop installer is run in quiet install mode.
- If a bundled installer is absent, the installer falls back to `winget` unless run with `-OfflineOnly`.
- Docker Desktop may still require Windows reboot/WSL setup on a fresh machine.
