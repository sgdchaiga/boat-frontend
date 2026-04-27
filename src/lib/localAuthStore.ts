export const LOCAL_AUTH_ACCOUNTS_KEY = "boat.local.auth.accounts.v1";
export const LOCAL_AUTH_SESSION_KEY = "boat.local.auth.session.v1";
const LOCAL_AUTH_CHANGED_EVENT = "boat.local.auth.changed";

export type LocalAuthAccount = {
  id: string;
  email: string;
  password: string;
  full_name?: string;
  role?: string;
  phone?: string;
  created_at: string;
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
