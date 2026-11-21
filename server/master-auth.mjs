const encoder = new TextEncoder();
const lifetimeSeconds = 4 * 60 * 60;

const liveCookie = "__Host-vitrine_master";
const localCookie = "vitrine_master";
const cookieName = (localPreview) => localPreview ? localCookie : liveCookie;
const fromHex = (value) => Uint8Array.from(value.match(/../g), (pair) => Number.parseInt(pair, 16));
const asHex = (bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

function configuration(env) {
  const verifier = typeof env.VITRINE_MASTER_PASSWORD_VERIFIER === "string"
    ? /^v1:([0-9a-f]{32}):([0-9a-f]{64})$/.exec(env.VITRINE_MASTER_PASSWORD_VERIFIER) : null;
  const key = typeof env.VITRINE_MASTER_SESSION_KEY === "string" ? env.VITRINE_MASTER_SESSION_KEY : "";
  const email = typeof env.VITRINE_MASTER_LOGIN_EMAIL === "string" ? env.VITRINE_MASTER_LOGIN_EMAIL.trim().toLowerCase() : "";
  return verifier && /^[0-9a-f]{64}$/.test(key) && email ? { salt: verifier[1], hash: verifier[2], key, email } : null;
}

export function masterLoginConfigured(env) {
  return Boolean(configuration(env));
}

export async function verifyMasterPassword(env, email, password) {
  const config = configuration(env);
  if (!config || typeof email !== "string" || typeof password !== "string" || !password || password.length > 256) return false;
  const passwordKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", iterations: 100000, salt: fromHex(config.salt) }, passwordKey, 256,
  ));
  const expected = fromHex(config.hash);
  let differences = 0;
  for (let i = 0; i < expected.length; i += 1) differences |= expected[i] ^ derived[i];
  return differences === 0 && email.trim().toLowerCase() === config.email;
}

async function getSigningKey(key) {
  return crypto.subtle.importKey("raw", fromHex(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function signedMessage(identity, expiresAt, nonce) {
  return encoder.encode(JSON.stringify(["vitrine-master-v1", identity.userId, expiresAt, nonce]));
}

function cookie(value, maxAge, localPreview) {
  return [cookieName(localPreview) + "=" + value, "Path=/", "Max-Age=" + maxAge,
    "HttpOnly", "SameSite=Strict", ...(localPreview ? [] : ["Secure"])].join("; ");
}

export async function createMasterCookie(env, identity, localPreview) {
  const config = configuration(env);
  const expiresAt = String(Math.floor(Date.now() / 1000) + lifetimeSeconds);
  const nonce = asHex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await getSigningKey(config.key);
  const signature = asHex(await crypto.subtle.sign("HMAC", key, signedMessage(identity, expiresAt, nonce)));
  return cookie([expiresAt, nonce, signature].join("."), lifetimeSeconds, localPreview);
}

export function clearMasterCookie(localPreview) {
  return cookie("", 0, localPreview);
}

export async function hasMasterSession(cookieHeader, env, identity, localPreview) {
  const config = configuration(env);
  if (!identity || !config || !cookieHeader) return false;
  const prefix = cookieName(localPreview) + "=";
  const entry = cookieHeader.split(";").map((value) => value.trim()).find((value) => value.startsWith(prefix));
  const token = entry && /^([0-9]{10})\.([0-9a-f]{32})\.([0-9a-f]{64})$/.exec(entry.slice(prefix.length));
  if (!token || Number(token[1]) <= Date.now() / 1000) return false;
  const [, expiresAt, nonce, signature] = token;
  const key = await getSigningKey(config.key);
  return crypto.subtle.verify("HMAC", key, fromHex(signature), signedMessage(identity, expiresAt, nonce));
}
