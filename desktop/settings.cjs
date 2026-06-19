const fs = require("node:fs");
const path = require("node:path");

const SETTINGS_FILE = "settings.json";
const BOOTSTRAP_ADMIN_FILE = "bootstrap-admin.json";

const DEFAULT_SETTINGS = {
  apiBaseUrl: "",
  deploymentMode: "lan",
  businessType: "school",
};

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function settingsPath(userDataPath) {
  return path.join(userDataPath, SETTINGS_FILE);
}

function normalizeApiBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const url = new URL(withProtocol);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function normalizeSettings(input) {
  const settings = { ...DEFAULT_SETTINGS, ...(input || {}) };
  let apiBaseUrl = "";
  if (settings.apiBaseUrl) {
    try {
      apiBaseUrl = normalizeApiBaseUrl(settings.apiBaseUrl);
    } catch {
      apiBaseUrl = String(settings.apiBaseUrl || "").trim();
    }
  }
  return {
    apiBaseUrl,
    deploymentMode: settings.deploymentMode === "wan" ? "wan" : settings.deploymentMode === "server" ? "server" : "lan",
    businessType: String(settings.businessType || "school").trim().toLowerCase() || "school",
  };
}

function readSettings(userDataPath) {
  const filePath = settingsPath(userDataPath);
  if (!fs.existsSync(filePath)) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return normalizeSettings(parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(userDataPath, settings) {
  ensureDir(userDataPath);
  const normalized = normalizeSettings(settings);
  fs.writeFileSync(settingsPath(userDataPath), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function updateSettings(userDataPath, patch) {
  const current = readSettings(userDataPath);
  return writeSettings(userDataPath, { ...current, ...(patch || {}) });
}

function bootstrapAdminPath(userDataPath) {
  return path.join(userDataPath, BOOTSTRAP_ADMIN_FILE);
}

function readBootstrapAdmin(userDataPath) {
  const filePath = bootstrapAdminPath(userDataPath);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function consumeBootstrapAdmin(userDataPath) {
  const filePath = bootstrapAdminPath(userDataPath);
  const value = readBootstrapAdmin(userDataPath);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  return value;
}

module.exports = {
  DEFAULT_SETTINGS,
  normalizeApiBaseUrl,
  readSettings,
  writeSettings,
  updateSettings,
  readBootstrapAdmin,
  consumeBootstrapAdmin,
};
