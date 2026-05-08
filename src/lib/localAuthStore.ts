export const LOCAL_AUTH_ACCOUNTS_KEY = "boat.local.auth.accounts.v1";
export const LOCAL_AUTH_SESSION_KEY = "boat.local.auth.session.v1";
export const LOCAL_ACCESS_SESSIONS_KEY = "boat.local.access.sessions.v1";
export const LOCAL_ACTIVE_ACCESS_SESSION_KEY = "boat.local.access.activeSession.v1";
export const LOCAL_TERMINAL_ID_KEY = "boat.local.terminal.id.v1";
const LOCAL_AUTH_CHANGED_EVENT = "boat.local.auth.changed";

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;
export const PIN_MAX_FAILED_ATTEMPTS = 5;
export const PIN_LOCK_MS = 15 * 60 * 1000;
export const PIN_FORCE_CHANGE_DAYS = 90;

export type LocalAuthAccount = {
  id: string;
  email: string;
  password: string;
  staff_code?: string;
  pin?: string;
  pin_set_at?: string;
  pin_changed_at?: string;
  pin_change_required?: boolean;
  pin_failed_attempts?: number;
  pin_locked_until?: string | null;
  full_name?: string;
  role?: string;
  phone?: string;
  created_at: string;
};

export type LocalAccessSession = {
  id: string;
  staff_id: string;
  staff_code?: string;
  staff_name?: string;
  role?: string;
  login_time: string;
  logout_time?: string | null;
  terminal_used: string;
  login_method: "password" | "pin";
  status: "active" | "locked" | "closed";
  locked_at?: string | null;
  lock_reason?: string | null;
  transactions_processed: number;
};

export function readLocalAccounts(): LocalAuthAccount[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_AUTH_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalAuthAccount[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function normalizeStaffCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

export function normalizePin(value: string): string {
  return value.trim();
}

export function validatePin(pin: string): string | null {
  if (!/^\d+$/.test(pin)) return "PIN must contain digits only.";
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    return `PIN must be ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits.`;
  }
  return null;
}

export function generateStaffCode(fullName: string, email: string, existing: LocalAuthAccount[]): string {
  const source = (fullName || email.split("@")[0] || "staff").trim().toUpperCase();
  const prefix = (source.replace(/[^A-Z0-9]/g, "") || "STAFF").slice(0, 4).padEnd(4, "0");
  const used = new Set(existing.map((a) => normalizeStaffCode(a.staff_code || "")));
  for (let i = existing.length + 1; i < existing.length + 1000; i += 1) {
    const code = `${prefix}${String(i).padStart(3, "0")}`;
    if (!used.has(code)) return code;
  }
  return `${prefix}${Date.now().toString().slice(-5)}`;
}

export function readLocalAccessSessions(): LocalAccessSession[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_ACCESS_SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalAccessSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeLocalAccessSessions(sessions: LocalAccessSession[]): void {
  window.localStorage.setItem(LOCAL_ACCESS_SESSIONS_KEY, JSON.stringify(sessions));
  window.dispatchEvent(new CustomEvent(LOCAL_AUTH_CHANGED_EVENT));
}

export function getLocalTerminalId(): string {
  try {
    const existing = window.localStorage.getItem(LOCAL_TERMINAL_ID_KEY);
    if (existing) return existing;
    const next = `TERM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    window.localStorage.setItem(LOCAL_TERMINAL_ID_KEY, next);
    return next;
  } catch {
    return "TERM-LOCAL";
  }
}

export function readActiveAccessSession(): LocalAccessSession | null {
  try {
    const activeId = window.localStorage.getItem(LOCAL_ACTIVE_ACCESS_SESSION_KEY);
    if (!activeId) return null;
    return readLocalAccessSessions().find((s) => s.id === activeId) ?? null;
  } catch {
    return null;
  }
}

export function startLocalAccessSession(account: LocalAuthAccount, loginMethod: "password" | "pin"): LocalAccessSession {
  const now = new Date().toISOString();
  const prior = readLocalAccessSessions().map((s) =>
    s.status === "active" && s.staff_id === account.id
      ? { ...s, status: "closed" as const, logout_time: s.logout_time ?? now }
      : s
  );
  const session: LocalAccessSession = {
    id: crypto.randomUUID(),
    staff_id: account.id,
    staff_code: account.staff_code,
    staff_name: account.full_name,
    role: account.role,
    login_time: now,
    logout_time: null,
    terminal_used: getLocalTerminalId(),
    login_method: loginMethod,
    status: "active",
    locked_at: null,
    lock_reason: null,
    transactions_processed: 0,
  };
  writeLocalAccessSessions([...prior, session]);
  window.localStorage.setItem(LOCAL_ACTIVE_ACCESS_SESSION_KEY, session.id);
  return session;
}

export function closeActiveAccessSession(): void {
  const active = readActiveAccessSession();
  if (!active) return;
  const now = new Date().toISOString();
  writeLocalAccessSessions(
    readLocalAccessSessions().map((s) =>
      s.id === active.id ? { ...s, status: "closed", logout_time: s.logout_time ?? now } : s
    )
  );
  window.localStorage.removeItem(LOCAL_ACTIVE_ACCESS_SESSION_KEY);
}

export function lockActiveAccessSession(reason: string): LocalAccessSession | null {
  const active = readActiveAccessSession();
  if (!active) return null;
  const now = new Date().toISOString();
  const next = { ...active, status: "locked" as const, locked_at: now, lock_reason: reason };
  writeLocalAccessSessions(readLocalAccessSessions().map((s) => (s.id === active.id ? next : s)));
  return next;
}

export function unlockActiveAccessSession(): LocalAccessSession | null {
  const active = readActiveAccessSession();
  if (!active) return null;
  const next = { ...active, status: "active" as const, locked_at: null, lock_reason: null };
  writeLocalAccessSessions(readLocalAccessSessions().map((s) => (s.id === active.id ? next : s)));
  return next;
}

export function incrementActiveAccessTransactions(count = 1): void {
  const active = readActiveAccessSession();
  if (!active || active.status === "closed") return;
  writeLocalAccessSessions(
    readLocalAccessSessions().map((s) =>
      s.id === active.id ? { ...s, transactions_processed: Math.max(0, s.transactions_processed + count) } : s
    )
  );
}

export function isPinChangeDue(account: LocalAuthAccount): boolean {
  if (!account.pin) return false;
  if (account.pin_change_required) return true;
  const changedAt = account.pin_changed_at || account.pin_set_at;
  if (!changedAt) return true;
  return Date.now() - new Date(changedAt).getTime() > PIN_FORCE_CHANGE_DAYS * 24 * 60 * 60 * 1000;
}

export function recordPinFailure(accountId: string): { lockedUntil: string | null; attempts: number } {
  let result = { lockedUntil: null as string | null, attempts: 0 };
  const next = readLocalAccounts().map((a) => {
    if (a.id !== accountId) return a;
    const attempts = (a.pin_failed_attempts ?? 0) + 1;
    const lockedUntil = attempts >= PIN_MAX_FAILED_ATTEMPTS ? new Date(Date.now() + PIN_LOCK_MS).toISOString() : null;
    result = { attempts, lockedUntil };
    return { ...a, pin_failed_attempts: attempts, pin_locked_until: lockedUntil };
  });
  writeLocalAccounts(next);
  return result;
}

export function clearPinFailures(accountId: string): void {
  writeLocalAccounts(
    readLocalAccounts().map((a) =>
      a.id === accountId ? { ...a, pin_failed_attempts: 0, pin_locked_until: null } : a
    )
  );
}

export function writeLocalAccounts(accounts: LocalAuthAccount[]): void {
  window.localStorage.setItem(LOCAL_AUTH_ACCOUNTS_KEY, JSON.stringify(accounts));
  window.dispatchEvent(new CustomEvent(LOCAL_AUTH_CHANGED_EVENT));
}

export function readLocalSessionEmail(): string | null {
  try {
    return window.localStorage.getItem(LOCAL_AUTH_SESSION_KEY);
  } catch {
    return null;
  }
}

export function writeLocalSessionEmail(email: string | null): void {
  if (!email) {
    window.localStorage.removeItem(LOCAL_AUTH_SESSION_KEY);
    window.dispatchEvent(new CustomEvent(LOCAL_AUTH_CHANGED_EVENT));
    return;
  }
  window.localStorage.setItem(LOCAL_AUTH_SESSION_KEY, email);
  window.dispatchEvent(new CustomEvent(LOCAL_AUTH_CHANGED_EVENT));
}

export function localAuthChangedEventName(): string {
  return LOCAL_AUTH_CHANGED_EVENT;
}
