/**
 * Signing in, staying signed in, and signing out.
 *
 * The password itself never reaches this file. The app sends a client secret
 * (a slow PBKDF2 digest of the password); this hashes that again with the
 * user's server-side salt and compares it to the stored verifier. See
 * src/lib/password.ts for why both steps exist.
 */
import {
  hashSessionToken,
  newSessionToken,
  type StoredCredential,
  verifyCredential,
} from "../lib/password.ts";
import type { D1Database, Env, SessionUser } from "./types.ts";
import {
  ApiError,
  badRequest,
  clearedSessionCookie,
  json,
  nowIso,
  readCookie,
  readJson,
  requireString,
  sessionCookie,
  unauthorized,
} from "./http.ts";

/** Six months. Long on purpose: nobody wants to log in while packing orders. */
export const SESSION_DAYS = 180;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

/**
 * How stale last_seen_at may get before we bother writing it again.
 * D1's free plan allows 100,000 row writes a day; touching a row on every
 * single request would spend that allowance on nothing.
 */
const TOUCH_AFTER_MS = 60 * 60 * 1000;

interface UserRow extends StoredCredential {
  id: string;
  email: string;
  display_name: string;
  ui_language: "ar" | "en";
  is_active: number;
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    ui_language: row.ui_language,
  };
}

export async function login(request: Request, env: Env): Promise<Response> {
  const body = await readJson<Record<string, unknown>>(request);
  const email = (requireString(body, "email", { maxLength: 200 }) ?? "").toLowerCase();
  const clientSecret = requireString(body, "clientSecret", { maxLength: 256 }) ?? "";
  const deviceLabel = requireString(body, "deviceLabel", {
    maxLength: 100,
    optional: true,
  });

  const row = await env.DB.prepare(
    `SELECT id, email, password_verifier, password_salt, password_iters,
            display_name, ui_language, is_active
     FROM users WHERE email = ?`,
  ).bind(email).first<
    UserRow & {
      password_verifier: string;
      password_salt: string;
      password_iters: number;
    }
  >();

  // Same answer whether the address is unknown or the password is wrong, so
  // this cannot be used to find out which addresses are registered.
  const failure = new ApiError(401, "Wrong email or password", "invalid_credentials");
  if (!row || row.is_active !== 1) throw failure;

  const ok = await verifyCredential(clientSecret, {
    passwordVerifier: row.password_verifier,
    passwordSalt: row.password_salt,
    passwordIters: row.password_iters,
  });
  if (!ok) throw failure;

  const token = newSessionToken();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_SECONDS * 1000);

  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, device_label, created_at,
                           last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    await hashSessionToken(token),
    row.id,
    deviceLabel,
    now.toISOString(),
    now.toISOString(),
    expires.toISOString(),
  ).run();

  return json(
    { user: toSessionUser(row), token, expiresAt: expires.toISOString() },
    200,
    { "set-cookie": sessionCookie(token, SESSION_SECONDS) },
  );
}

/**
 * The browser sends a cookie; the packaged apps send a bearer token. Both
 * carry the same value, and the server does not care which arrived. This is
 * what makes one login flow work in a browser and inside a Tauri webview
 * without OAuth redirects or third-party-cookie trouble.
 */
function presentedToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header && /^bearer /i.test(header)) return header.slice(7).trim() || null;
  return readCookie(request, "cc_session");
}

export async function currentUser(
  request: Request,
  env: Env,
): Promise<SessionUser | null> {
  const token = presentedToken(request);
  if (!token) return null;

  const tokenHash = await hashSessionToken(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.ui_language, u.is_active,
            s.expires_at, s.last_seen_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  ).bind(tokenHash).first<
    UserRow & { expires_at: string; last_seen_at: string }
  >();

  if (!row || row.is_active !== 1) return null;

  if (Date.parse(row.expires_at) <= Date.now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(tokenHash).run();
    return null;
  }

  if (Date.now() - Date.parse(row.last_seen_at) > TOUCH_AFTER_MS) {
    const expires = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
    await env.DB.prepare(
      "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?",
    ).bind(nowIso(), expires, tokenHash).run();
  }

  return toSessionUser(row);
}

export async function requireUser(request: Request, env: Env): Promise<SessionUser> {
  const user = await currentUser(request, env);
  if (!user) throw unauthorized();
  return user;
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const token = presentedToken(request);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await hashSessionToken(token)).run();
  }
  return json({ ok: true }, 200, { "set-cookie": clearedSessionCookie });
}

export async function me(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  return json({ user });
}

/** Changing the interface language is the one thing a user changes about themselves. */
export async function updateMe(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const language = body.ui_language;
  if (language !== "ar" && language !== "en") {
    throw badRequest("ui_language must be 'ar' or 'en'");
  }
  await env.DB.prepare(
    "UPDATE users SET ui_language = ?, updated_at = ? WHERE id = ?",
  ).bind(language, nowIso(), user.id).run();
  return json({ user: { ...user, ui_language: language } });
}

/** Expired rows are dead weight; clear them when one is noticed. */
export async function purgeExpiredSessions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(nowIso()).run();
}
