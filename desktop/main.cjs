const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const { app, BrowserWindow, ipcMain } = require("electron");
const dbApi = require("./db.cjs");

let win = null;
let db = null;
let dbPath = null;

function getLocalBackupRetentionCount() {
  const raw = process.env.BOAT_BACKUP_RETENTION_COUNT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 30;
  }
  return Math.floor(parsed);
}

function formatBackupTimestamp(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

async function createLocalBackup() {
  if (!db || !dbPath) {
    throw new Error("Local database is not ready.");
  }
  const backupDir = path.join(path.dirname(dbPath), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFileName = `boat-backup-${formatBackupTimestamp(new Date())}.sqlite`;
  const backupPath = path.join(backupDir, backupFileName);

  db.pragma("wal_checkpoint(FULL)");
  if (typeof db.backup === "function") {
    await db.backup(backupPath);
  } else {
    fs.copyFileSync(dbPath, backupPath);
  }

  const backupFiles = fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith("boat-backup-") && name.endsWith(".sqlite"))
    .map((name) => ({
      name,
      fullPath: path.join(backupDir, name),
      stat: fs.statSync(path.join(backupDir, name)),
    }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  const retentionCount = getLocalBackupRetentionCount();
  const filesToDelete = backupFiles.slice(retentionCount);
  for (const file of filesToDelete) {
    try {
      fs.unlinkSync(file.fullPath);
    } catch (err) {
      console.warn(`[BOAT] Failed to delete old backup ${file.name}:`, err);
    }
  }

  return {
    ok: true,
    backupPath,
    backupFileName,
    createdAt: new Date().toISOString(),
  };
}

function getStableDeviceId() {
  const raw = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.release(),
    String(os.cpus()?.length || 0),
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function registerIpc() {
  ipcMain.handle("boat:health", () => {
    return {
      ok: true,
      sqlitePath: dbPath,
    };
  });

  ipcMain.handle("boat:license:get-device-id", () => {
    return { deviceId: getStableDeviceId() };
  });

  ipcMain.handle("boat:backup:create-local", async () => {
    return createLocalBackup();
  });

  ipcMain.handle("boat:pos:list-products", () => {
    return dbApi.listPosProducts(db);
  });

  ipcMain.handle("boat:pos:upsert-product", (_event, payload) => {
    dbApi.upsertPosProduct(db, payload);
    return { ok: true };
  });

  ipcMain.handle("boat:customers:list", () => {
    return dbApi.listHotelCustomers(db);
  });

  ipcMain.handle("boat:customers:create", (_event, payload) => {
    const row = dbApi.createHotelCustomer(db, payload || {});
    return row;
  });

  ipcMain.handle("boat:session:get-active", (_event, payload) => {
    return dbApi.getActiveCashierSession(db, payload?.opened_by || "");
  });

  ipcMain.handle("boat:session:open", (_event, payload) => {
    return dbApi.openCashierSession(db, payload || {});
  });

  ipcMain.handle("boat:session:close", (_event, payload) => {
    dbApi.closeCashierSession(db, payload || {});
    return { ok: true };
  });

  ipcMain.handle("boat:retail:sale:create", (_event, payload) => {
    return dbApi.createRetailSale(db, payload || {});
  });

  ipcMain.handle("boat:retail-customers:list", () => {
    return dbApi.listRetailCustomers(db);
  });

  ipcMain.handle("boat:retail-customers:create", (_event, payload) => {
    return dbApi.createRetailCustomer(db, payload || {});
  });

  ipcMain.handle("boat:retail-customers:update", (_event, payload) => {
    return dbApi.updateRetailCustomer(db, payload || {});
  });

  ipcMain.handle("boat:retail-customers:delete", (_event, payload) => {
    dbApi.deleteRetailCustomer(db, payload || {});
    return { ok: true };
  });

  ipcMain.handle("boat:sync-queue:list", () => {
    return dbApi.listSyncQueue(db);
  });

  ipcMain.handle("boat:sync-queue:list-pending", () => {
    return dbApi.listPendingSyncQueue(db);
  });

  ipcMain.handle("boat:sync-queue:set-status", (_event, payload) => {
    dbApi.updateSyncQueueStatus(db, payload || {});
    return { ok: true };
  });

  ipcMain.handle("boat:local-store:select", (_event, payload) => {
    return dbApi.localStoreSelect(db, payload || {});
  });
  ipcMain.handle("boat:local-store:upsert", (_event, payload) => {
    return dbApi.localStoreUpsert(db, payload || {});
  });
  ipcMain.handle("boat:local-store:update", (_event, payload) => {
    return dbApi.localStoreUpdate(db, payload || {});
  });
  ipcMain.handle("boat:local-store:delete", (_event, payload) => {
    return dbApi.localStoreDelete(db, payload || {});
  });
}

app.whenReady().then(() => {
  const state = dbApi.openDatabase(app.getPath("userData"));
  db = state.db;
  dbPath = state.dbPath;
  registerIpc();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (db) {
    db.close();
    db = null;
  }
});
