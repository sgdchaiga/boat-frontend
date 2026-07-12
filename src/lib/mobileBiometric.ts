const KEY_PREFIX = "boat.mobile.biometric.v1";

function key(userId: string) { return `${KEY_PREFIX}:${userId}`; }
function bytes(value: string) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
function encoded(value: ArrayBuffer) { return btoa(String.fromCharCode(...new Uint8Array(value))); }

export function mobileBiometricAvailable() {
  return typeof window !== "undefined" && window.isSecureContext && "PublicKeyCredential" in window && "credentials" in navigator;
}

export function mobileBiometricEnrolled(userId: string) { return Boolean(localStorage.getItem(key(userId))); }

export async function enrollMobileBiometric(userId: string, displayName: string) {
  if (!mobileBiometricAvailable()) throw new Error("Biometric unlock requires a supported phone browser over HTTPS.");
  const credential = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: "BOAT" },
    user: { id: new TextEncoder().encode(userId), name: userId, displayName },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
    timeout: 60_000,
    attestation: "none",
  } }) as PublicKeyCredential | null;
  if (!credential) throw new Error("Biometric enrollment was cancelled.");
  localStorage.setItem(key(userId), encoded(credential.rawId));
  window.dispatchEvent(new CustomEvent("boat:biometric-changed"));
}

export async function verifyMobileBiometric(userId: string) {
  const stored = localStorage.getItem(key(userId));
  if (!stored) throw new Error("Biometric unlock is not enrolled on this phone.");
  const assertion = await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    allowCredentials: [{ type: "public-key", id: bytes(stored) }],
    userVerification: "required",
    timeout: 60_000,
  } });
  if (!assertion) throw new Error("Biometric verification was cancelled.");
}

export function removeMobileBiometric(userId: string) {
  localStorage.removeItem(key(userId));
  window.dispatchEvent(new CustomEvent("boat:biometric-changed"));
}
