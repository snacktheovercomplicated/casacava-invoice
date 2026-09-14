/**
 * Talking to the Worker.
 *
 * In a browser the app is served by the same Worker, so it is same-origin and
 * the session cookie travels on its own. Inside the packaged Tauri apps the
 * origin is different, so the same session token is also kept here and sent
 * as a bearer header. Sending both costs nothing and means one code path
 * works in a browser, on Windows, on Linux and on Android.
 */
import type {
  Customer,
  DraftInput,
  Invoice,
  InvoiceLine,
  Item,
  Lang,
  Settings,
  UnexplainedNumber,
  UnusedNumber,
  User,
} from "./types.ts";

const TOKEN_KEY = "casacava.token";

/**
 * Empty in the browser, because the Worker serves the app and the API from the
 * same origin. The packaged Tauri builds are not same-origin, so they are built
 * with VITE_API_BASE set to the workers.dev URL.
 *
 * The cast is so that `deno check` (which does not know Vite's import.meta.env)
 * and Vite's own build both accept this line.
 */
const BASE: string =
  (import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE ?? "";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
  get isOffline(): boolean {
    return this.status === 0;
  }
  get isSignedOut(): boolean {
    return this.status === 401;
  }
}

function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // a session that lasts only until the tab closes is still a session
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const token = storedToken();
  if (token) headers["authorization"] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${BASE}/api${path}`, {
      method: options.method ?? "GET",
      headers,
      credentials: "include",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    // No network, DNS failure, the Worker unreachable. Status 0 means "we
    // never got an answer", which the caller treats as being offline.
    throw new ApiError(0, "offline", "offline");
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiError(response.status, error.code ?? "error", error.message ?? "error");
  }
  return payload as T;
}

/* -------------------------------------------------------------------------- */

export const api = {
  async login(email: string, clientSecret: string, deviceLabel: string) {
    const result = await request<{ user: User; token: string }>("/auth/login", {
      method: "POST",
      body: { email, clientSecret, deviceLabel },
    });
    setToken(result.token);
    return result.user;
  },

  async logout() {
    try {
      await request("/auth/logout", { method: "POST" });
    } finally {
      setToken(null);
    }
  },

  me: () => request<{ user: User }>("/auth/me").then((r) => r.user),

  setUiLanguage: (ui_language: Lang) =>
    request<{ user: User }>("/auth/me", { method: "PUT", body: { ui_language } }),

  getSettings: () => request<{ settings: Settings }>("/settings").then((r) => r.settings),

  saveSettings: (patch: Partial<Settings>) =>
    request<{ settings: Settings }>("/settings", { method: "PUT", body: patch })
      .then((r) => r.settings),

  listItems: (query = "", includeHidden = false) =>
    request<{ items: Item[] }>(
      `/items?q=${encodeURIComponent(query)}${includeHidden ? "&all=1" : ""}`,
    ).then((r) => r.items),

  saveItem: (id: string, item: Partial<Item>) =>
    request<{ item: Item }>(`/items/${id}`, { method: "PUT", body: item })
      .then((r) => r.item),

  hideItem: (id: string) => request(`/items/${id}`, { method: "DELETE" }),

  listCustomers: (query = "") =>
    request<{ customers: Customer[] }>(`/customers?q=${encodeURIComponent(query)}`)
      .then((r) => r.customers),

  saveCustomer: (id: string, customer: Partial<Customer>) =>
    request<{ customer: Customer }>(`/customers/${id}`, { method: "PUT", body: customer })
      .then((r) => r.customer),

  removeCustomer: (id: string) => request(`/customers/${id}`, { method: "DELETE" }),

  listInvoices: (params: Record<string, string>) => {
    const search = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== ""),
    );
    return request<{ invoices: Invoice[]; total: number }>(`/invoices?${search}`);
  },

  getInvoice: (id: string) =>
    request<{ invoice: Invoice; lines: InvoiceLine[] }>(`/invoices/${id}`),

  saveDraft: (id: string, draft: DraftInput) =>
    request<{ invoice: Invoice; lines: InvoiceLine[] }>(`/invoices/${id}`, {
      method: "PUT",
      body: draft,
    }),

  deleteDraft: (id: string) => request(`/invoices/${id}`, { method: "DELETE" }),

  issue: (id: string) =>
    request<{ invoice: Invoice; lines: InvoiceLine[] }>(`/invoices/${id}/issue`, {
      method: "POST",
    }),

  cancelInvoice: (id: string, reason: string) =>
    request<{ invoice: Invoice; lines: InvoiceLine[] }>(`/invoices/${id}/cancel`, {
      method: "POST",
      body: { reason },
    }),

  creditNote: (id: string, newId: string) =>
    request<{ invoice: Invoice; lines: InvoiceLine[] }>(`/invoices/${id}/credit-note`, {
      method: "POST",
      body: { id: newId },
    }),

  unusedNumbers: () =>
    request<{ recorded: UnusedNumber[]; unexplained: UnexplainedNumber[]; total: number }>(
      "/unused-numbers",
    ),
};
