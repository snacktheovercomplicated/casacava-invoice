/**
 * The slice of the Cloudflare Workers API this project actually uses.
 *
 * Written by hand rather than pulling in @cloudflare/workers-types, to keep
 * the dependency list (and the file count) down. This is the whole surface:
 * if a call is not described here, the code does not make it.
 */

export interface D1Meta {
  changes: number;
  last_row_id: number;
  rows_read: number;
  rows_written: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]>;
}

export interface Env {
  DB: D1Database;
  /** Static assets binding. The SPA is served from the same Worker. */
  ASSETS?: { fetch(request: Request): Promise<Response> };
  /** Comma-separated extra origins allowed to call the API (the Tauri builds). */
  ALLOWED_APP_ORIGINS?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
  ui_language: "ar" | "en";
}

export type DocumentLanguage = "ar" | "en";
export type DocumentType = "invoice" | "credit_note" | "debit_note";
export type DocStatus = "draft" | "issued" | "cancelled";
export type PriceTier = "retail" | "wholesale";
