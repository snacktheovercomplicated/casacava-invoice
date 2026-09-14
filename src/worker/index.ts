/**
 * The whole API. One Worker serves both the app and /api/*, which is what
 * makes the browser build same-origin: it needs no CORS and can use an
 * ordinary session cookie. Only the packaged Tauri builds call in from
 * another origin, and they send a bearer token instead.
 */
import type { Env } from "./types.ts";
import {
  ApiError,
  badRequest,
  corsHeaders,
  json,
  notFound,
} from "./http.ts";
import { login, logout, me, requireUser, updateMe } from "./auth.ts";
import {
  deactivateCustomer,
  deactivateItem,
  getSettings,
  listCustomers,
  listItems,
  updateSettings,
  upsertCustomer,
  upsertItem,
} from "./catalogue.ts";
import {
  cancelInvoice,
  createCreditNote,
  deleteDraft,
  getInvoice,
  issueInvoice,
  listInvoices,
  listUnusedNumbers,
  saveDraft,
} from "./invoices.ts";

/** Ids are generated on the device, so they are checked before use. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function requireId(value: string): string {
  if (!ID.test(value)) throw badRequest("That id is not in a form this server accepts");
  return value;
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  if (!pathname.startsWith("/api/")) {
    // Everything that is not the API is the app itself.
    if (env.ASSETS) return await env.ASSETS.fetch(request);
    return notFoundResponse();
  }

  const segments = pathname.slice(5).split("/").filter(Boolean);
  const [area, id, action] = segments;

  if (area === "health") return json({ ok: true });

  /* ---- signing in ------------------------------------------------------ */
  if (area === "auth") {
    if (id === "login" && method === "POST") return await login(request, env);
    if (id === "logout" && method === "POST") return await logout(request, env);
    if (id === "me" && method === "GET") return await me(request, env);
    if (id === "me" && method === "PUT") return await updateMe(request, env);
    throw notFound();
  }

  /* ---- everything past here needs a signed-in user --------------------- */
  const user = await requireUser(request, env);

  if (area === "settings" && !id) {
    if (method === "GET") return await getSettings(env);
    if (method === "PUT") return await updateSettings(request, env);
    throw notFound();
  }

  if (area === "items") {
    if (!id && method === "GET") return await listItems(url, env);
    if (id && method === "PUT") return await upsertItem(request, env, requireId(id));
    if (id && method === "DELETE") return await deactivateItem(env, requireId(id));
    throw notFound();
  }

  if (area === "customers") {
    if (!id && method === "GET") return await listCustomers(url, env);
    if (id && method === "PUT") return await upsertCustomer(request, env, requireId(id));
    if (id && method === "DELETE") return await deactivateCustomer(env, requireId(id));
    throw notFound();
  }

  // Numbers that were handed out but never landed on a document. Shown in
  // the app so the gaps are visible without having to ask anyone.
  if (area === "unused-numbers" && !id && method === "GET") {
    return await listUnusedNumbers(env);
  }

  if (area === "invoices") {
    if (!id && method === "GET") return await listInvoices(url, env);
    if (id && !action && method === "GET") return await getInvoice(env, requireId(id));
    if (id && !action && method === "PUT") {
      return await saveDraft(request, env, user, requireId(id));
    }
    if (id && !action && method === "DELETE") return await deleteDraft(env, requireId(id));
    if (id && action === "issue" && method === "POST") {
      return await issueInvoice(env, user, requireId(id));
    }
    if (id && action === "cancel" && method === "POST") {
      return await cancelInvoice(request, env, user, requireId(id));
    }
    if (id && action === "credit-note" && method === "POST") {
      return await createCreditNote(request, env, user, requireId(id));
    }
    throw notFound();
  }

  throw notFound();
}

function notFoundResponse(): Response {
  return json({ error: { code: "not_found", message: "Not found" } }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      const response = await route(request, env);
      if (Object.keys(cors).length === 0) return response;
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(cors)) headers.set(key, value);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        return json(
          { error: { code: error.code, message: error.message, details: error.details } },
          error.status,
          cors,
        );
      }

      // A trigger firing is not a server fault: it is the database refusing to
      // let an issued document change. Say so in words rather than a 500.
      const message = error instanceof Error ? error.message : String(error);
      if (/immutable:/.test(message)) {
        return json({
          error: {
            code: "immutable",
            message:
              "This document has been issued and the database will not allow it to " +
              "change. Make a credit note instead.",
          },
        }, 409, cors);
      }
      if (/never go backwards/.test(message)) {
        return json({
          error: { code: "numbering", message: "Invoice numbers cannot be changed." },
        }, 409, cors);
      }
      if (/UNIQUE constraint failed: invoices.invoice_number/.test(message)) {
        return json({
          error: {
            code: "duplicate_number",
            message: "That invoice number is already in use.",
          },
        }, 409, cors);
      }

      console.error("unhandled", message);
      return json({
        error: { code: "server_error", message: "Something went wrong on the server." },
      }, 500, cors);
    }
  },
};
