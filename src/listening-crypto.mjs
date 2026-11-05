/** WebCrypto helpers for encrypted, server-only Spotify connection state. */
const text = new TextEncoder();
const decode = new TextDecoder();

export function base64url(bytes) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function unbase64url(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("Invalid encoded value");
  const raw = atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function secureRandom(byteLength = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function digest(value) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", text.encode(value))));
}

export async function importEncryptionKey(value) {
  const bytes = unbase64url(value);
  if (bytes.byteLength !== 32) throw new Error("A 256-bit encryption key is required");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(value, key, purpose) {
  if (typeof value !== "string" || !value.length || value.length > 8192) throw new Error("Invalid plaintext");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({
    name: "AES-GCM", iv, additionalData: text.encode("devon-listening:" + purpose),
  }, key, text.encode(value));
  return base64url(iv) + "." + base64url(new Uint8Array(cipher));
}

export async function unseal(value, key, purpose) {
  if (typeof value !== "string" || value.length > 12000) throw new Error("Invalid ciphertext");
  const parts = value.split(".");
  if (parts.length !== 2) throw new Error("Invalid ciphertext");
  const iv = unbase64url(parts[0]);
  if (iv.byteLength !== 12) throw new Error("Invalid nonce");
  const ciphertext = unbase64url(parts[1]);
  const plain = await crypto.subtle.decrypt({
    name: "AES-GCM", iv, additionalData: text.encode("devon-listening:" + purpose),
  }, key, ciphertext);
  return decode.decode(plain);
}

export async function pkceChallenge(verifier) {
  return digest(verifier);
}
