/**
 * Passwords and session tokens.
 *
 * THE SHAPE OF THIS, and why it is shaped this way:
 *
 *   password  --(app: slow PBKDF2, 210k rounds)-->  CLIENT SECRET
 *             --(sent over HTTPS)-->
 *   server    --(server: salted PBKDF2 again)-->    VERIFIER  --> stored in D1
 *
 * Three separate properties, each of which matters:
 *
 *   1. The real password never leaves the device. The server cannot learn it,
 *      cannot log it by accident, and cannot leak it in a database dump.
 *
 *   2. The work factor is paid on the device, not on the Worker. Cloudflare's
 *      free plan allows 10 ms of CPU per request, which is nowhere near enough
 *      for a proper password hash. The device has no such limit.
 *
 *   3. THE STORED VALUE AND THE TRANSMITTED VALUE ARE NEVER THE SAME THING.
 *      The server hashes what it receives, with a per-user server-side salt,
 *      before comparing. If it stored the client secret directly, then anyone
 *      holding a copy of the database would hold a working password: they
 *      could send the stored value straight to the login endpoint and be let
 *      in. Hashing again is what stops that, and tests/password_test.ts
 *      proves it by actually attempting the attack.
 */

/** Rounds run on the device. Slow on purpose. */
export const CLIENT_ITERATIONS = 210_000;

/**
 * Rounds run on the Worker. Small on purpose: its input is already a
 * 256-bit high-entropy digest, not a human password, so there is nothing
 * here for an attacker to guess at. This only has to stay comfortably
 * inside the free plan's 10 ms CPU budget.
 */
export const SERVER_ITERATIONS = 600;

const KEY_BITS = 256;

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function pbkdf2(
  secret: Uint8Array | string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const material = typeof secret === "string" ? encoder.encode(secret) : secret;
  const key = await crypto.subtle.importKey(
    "raw",
    material as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/**
 * RUNS ON THE DEVICE (browser, desktop app, Android app).
 *
 * The salt is derived from the email rather than fetched from the server, so
 * logging in is a single request and an attacker cannot probe which addresses
 * are registered.
 */
export async function deriveClientSecret(
  password: string,
  email: string,
): Promise<string> {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("password is required");
  }
  const salt = encoder.encode(
    `casacava-invoice|v1|${email.trim().toLowerCase()}`,
  );
  return toHex(await pbkdf2(password, salt, CLIENT_ITERATIONS));
}

/** A fresh random server-side salt for one user. */
export function newServerSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * RUNS ON THE WORKER. Turns what the device sent into what gets stored.
 * This is the step that makes the database useless as a password file.
 */
export async function computeVerifier(
  clientSecret: string,
  serverSaltBase64: string,
  iterations: number = SERVER_ITERATIONS,
): Promise<string> {
  if (typeof clientSecret !== "string" || clientSecret.length === 0) {
    throw new Error("clientSecret is required");
  }
  const salt = fromBase64(serverSaltBase64);
  return toHex(await pbkdf2(clientSecret, salt, iterations));
}

/** Comparison that does not leak how much of the value matched, via timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface StoredCredential {
  passwordVerifier: string;
  passwordSalt: string;
  passwordIters: number;
}

/** Build the three columns that go into the users row. */
export async function createCredential(
  clientSecret: string,
): Promise<StoredCredential> {
  const passwordSalt = newServerSalt();
  return {
    passwordVerifier: await computeVerifier(
      clientSecret,
      passwordSalt,
      SERVER_ITERATIONS,
    ),
    passwordSalt,
    passwordIters: SERVER_ITERATIONS,
  };
}

/** Check a login attempt against the stored columns. */
export async function verifyCredential(
  clientSecret: string,
  stored: StoredCredential,
): Promise<boolean> {
  const candidate = await computeVerifier(
    clientSecret,
    stored.passwordSalt,
    stored.passwordIters,
  );
  return timingSafeEqual(candidate, stored.passwordVerifier);
}

/* -------------------------------------------------------------------------- */
/* Session tokens                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The token goes to the device. Only its SHA-256 is stored, for the same
 * reason as above: a database dump must not contain anything that can be
 * replayed as a live session.
 */
export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return toHex(new Uint8Array(digest));
}
