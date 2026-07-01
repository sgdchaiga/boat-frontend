const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, ipcMain } = require("electron");
const settingsApi = require("./settings.cjs");

let win = null;
let db = null;
let dbPath = null;
let loadedDbApi = null;

function getDesktopDataMode() {
  const raw = String(process.env.VITE_DESKTOP_DATA_MODE || process.env.BOAT_DESKTOP_DATA_MODE || "").toLowerCase();
  if (raw === "api") {
    return "api";
  }
  return "sqlite";
}

function isApiDataMode() {
  return getDesktopDataMode() === "api";
}

function getDbApi() {
  if (!loadedDbApi) {
    loadedDbApi = require("./db.cjs");
  }
  return loadedDbApi;
}

const dbApi = new Proxy({}, {
  get(_target, prop) {
    return getDbApi()[prop];
  },
});

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

async function checkBoatApiHealth(baseUrl) {
  const normalized = settingsApi.normalizeApiBaseUrl(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${normalized}/health`, { signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    return {
      ok: res.ok && body?.ok !== false,
      status: res.status,
      baseUrl: normalized,
      service: body?.service || null,
      time: body?.time || null,
      message: res.ok ? null : body?.message || res.statusText,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      baseUrl: normalized,
      service: null,
      time: null,
      message: err instanceof Error ? err.message : "Unable to reach BOAT API.",
    };
  } finally {
    clearTimeout(timer);
  }
}

function imageExtFromMime(mime) {
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/bmp") return ".bmp";
  if (mime === "image/tiff") return ".tif";
  return ".jpg";
}

function runWindowsOcr(imagePath) {
  const ps = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$path = ${JSON.stringify(imagePath)}
$fileOp = [Windows.Storage.StorageFile]::GetFileFromPathAsync($path)
$file = [System.WindowsRuntimeSystemExtensions]::AsTask($fileOp).Result
$streamOp = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
$stream = [System.WindowsRuntimeSystemExtensions]::AsTask($streamOp).Result
$decoderOp = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
$decoder = [System.WindowsRuntimeSystemExtensions]::AsTask($decoderOp).Result
$bitmapOp = $decoder.GetSoftwareBitmapAsync()
$bitmap = [System.WindowsRuntimeSystemExtensions]::AsTask($bitmapOp).Result
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw "Windows OCR is not available for the current user language." }
$resultOp = $engine.RecognizeAsync($bitmap)
$result = [System.WindowsRuntimeSystemExtensions]::AsTask($resultOp).Result
$result.Text
`;
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error((stderr || stdout || `Windows OCR failed with exit code ${code}.`).trim()));
    });
  });
}

async function readImageOcr(payload) {
  const dataUrl = String(payload?.dataUrl || "");
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error("OCR expects an image data URL.");
  const [, mime, base64] = match;
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) throw new Error("OCR image is empty.");
  if (bytes.length > 15 * 1024 * 1024) throw new Error("OCR image is too large. Use an image under 15 MB.");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boat-ocr-"));
  const imagePath = path.join(dir, `source${imageExtFromMime(mime)}`);
  try {
    fs.writeFileSync(imagePath, bytes);
    const text = await runWindowsOcr(imagePath);
    return { ok: true, text };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn("[BOAT] Failed to clean OCR temp files:", err);
    }
  }
}

function registerIpc() {
  ipcMain.handle("boat:health", () => {
    return {
      ok: true,
      dataMode: getDesktopDataMode(),
      sqlitePath: dbPath || null,
    };
  });

  ipcMain.handle("boat:license:get-device-id", () => {
    return { deviceId: getStableDeviceId() };
  });

  ipcMain.handle("boat:settings:get", () => {
    return settingsApi.readSettings(app.getPath("userData"));
  });

  ipcMain.handle("boat:settings:update", (_event, payload) => {
    return settingsApi.updateSettings(app.getPath("userData"), payload || {});
  });

  ipcMain.handle("boat:api:health", async (_event, payload) => {
    const settings = settingsApi.readSettings(app.getPath("userData"));
    const baseUrl = payload?.baseUrl || settings.apiBaseUrl;
    if (!baseUrl) {
      return { ok: false, status: 0, baseUrl: "", service: null, time: null, message: "API server URL is not set." };
    }
    return checkBoatApiHealth(baseUrl);
  });

  ipcMain.handle("boat:bootstrap-admin:peek", () => {
    return settingsApi.readBootstrapAdmin(app.getPath("userData"));
  });

  ipcMain.handle("boat:bootstrap-admin:consume", () => {
    return settingsApi.consumeBootstrapAdmin(app.getPath("userData"));
  });

  ipcMain.handle("boat:backup:create-local", async () => {
    return createLocalBackup();
  });

  ipcMain.handle("boat:ocr:read-image", async (_event, payload) => {
    return readImageOcr(payload || {});
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

  ipcMain.handle("boat:customers:update", (_event, payload) => {
    return dbApi.updateHotelCustomer(db, payload || {});
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
  if (!isApiDataMode()) {
    const state = dbApi.openDatabase(app.getPath("userData"));
    db = state.db;
    dbPath = state.dbPath;
  }
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
