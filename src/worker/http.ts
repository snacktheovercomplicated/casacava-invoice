/** Request and response plumbing: JSON, errors, CORS, cookies, dates. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string = "error",
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (m: string, details?: unknown) =>
  new ApiError(400, m, "bad_request", details);
export const unauthorized = (m = "Not signed in") => new ApiError(401, m, "unauthorized");
export const notFound = (m = "Not found") => new ApiError(404, m, "not_found");
export const conflict = (m: string, code = "conflict") => new ApiError(409, m, code);

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

/**
 * The browser app is served by this same Worker, so it is same-origin and
 * needs no CORS at all. Only the packaged Tauri builds call in from another
 * origin, and those are the only origins allowed.
 */
const TAURI_ORIGINS = [
  "tauri://localhost", // macOS, iOS
  "http://tauri.localhost", // Windows
  "https://tauri.localhost",
  "http://localhost", // Linux, Android
];

export function allowedOrigins(env: { ALLOWED_APP_ORIGINS?: string }): string[] {
  const extra = (env.ALLOWED_APP_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...TAURI_ORIGINS, ...extra];
}

export function corsHeaders(
  request: Request,
  env: { ALLOWED_APP_ORIGINS?: string },
): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-max-age": "86400",
    "vary": "origin",
  };
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  // SameSite=Lax is enough because the browser app is same-origin.
  // The packaged apps do not use the cookie at all; they send a bearer token.
  return [
    `cc_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export const clearedSessionCookie =
  "cc_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";

/** An ISO timestamp, which is what every *_at column stores. */
export const nowIso = (): string => new Date().toISOString();

/**
 * Today's date in Cairo, not in UTC. An invoice issued at 1am Cairo time on
 * 1 January is a January invoice and belongs to the new year's series; UTC
 * would still say December and would hand out a number from the old series.
 */
export function cairoToday(at: Date = new Date()): { date: string; year: number } {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return { date, year: Number(date.slice(0, 4)) };
}

/** Body parsing that fails with a useful message rather than a stack trace. */
export async function readJson<T>(request: Request): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest("The request body is not valid JSON");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw badRequest("The request body must be a JSON object");
  }
  return body as T;
}

export function requireString(
  source: Record<string, unknown>,
  field: string,
  { maxLength = 2000, optional = false } = {},
): string | null {
  const value = source[field];
  if (value === undefined || value === null || value === "") {
    if (optional) return null;
    throw badRequest(`${field} is required`);
  }
  if (typeof value !== "string") throw badRequest(`${field} must be text`);
  const trimmed = value.trim();
  if (!optional && trimmed === "") throw badRequest(`${field} is required`);
  if (trimmed.length > maxLength) {
    throw badRequest(`${field} is longer than ${maxLength} characters`);
  }
  return trimmed === "" ? null : trimmed;
}

export function requireInteger(
  source: Record<string, unknown>,
  field: string,
  { min = 0, max = Number.MAX_SAFE_INTEGER, fallback }: {
    min?: number;
    max?: number;
    fallback?: number;
  } = {},
): number {
  const value = source[field];
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw badRequest(`${field} is required`);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw badRequest(`${field} must be a whole number`);
  }
  if (value < min || value > max) {
    throw badRequest(`${field} must be between ${min} and ${max}`);
  }
  return value;
}

export function requireEnum<T extends string>(
  source: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  fallback?: T,
): T {
  const value = source[field];
  if (value === undefined || value === null || value === "") {
    if (fallback !== undefined) return fallback;
    throw badRequest(`${field} is required`);
  }
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw badRequest(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}
