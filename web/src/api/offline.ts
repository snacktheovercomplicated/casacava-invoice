/**
 * Working without a signal.
 *
 * What works offline:
 *   - reading the products, customers, settings and recent invoices, from a
 *     local copy written every time they are fetched successfully;
 *   - creating and editing DRAFTS, which are held in an outbox and sent when
 *     the connection comes back.
 *
 * What does not, deliberately:
 *   - ISSUING. An invoice number can only be handed out by the server. If a
 *     device could allocate one offline, two phones would eventually stamp the
 *     same number onto two different invoices, which is the one mistake that
 *     really matters. The app says so plainly instead of pretending.
 */
import { computeDocument, computeLine } from "../../../src/lib/money.ts";
import type { DraftInput, Invoice, InvoiceLine } from "./types.ts";

const DB_NAME = "casacava";
const DB_VERSION = 1;
const CACHE = "cache";
const OUTBOX = "outbox";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE);
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDb().then((db) =>
    new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = work(transaction.objectStore(store));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    })
  );
}

/* -------------------------------------------------------------------------- */
/* The read-through cache                                                     */
/* -------------------------------------------------------------------------- */

export const cache = {
  get: <T>(key: string): Promise<T | undefined> =>
    run<T | undefined>(CACHE, "readonly", (store) => store.get(key))
      .catch(() => undefined),

  set: (key: string, value: unknown): Promise<void> =>
    run<void>(CACHE, "readwrite", (store) => store.put(value, key))
      .then(() => undefined)
      .catch(() => undefined),
};

/**
 * Fetch, and fall back to the last good copy if the network is not there.
 * `fresh` says whether what came back is live or remembered, so the screen
 * can say so rather than silently showing stale numbers.
 */
export async function readThrough<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<{ value: T; fresh: boolean }> {
  try {
    const value = await fetcher();
    await cache.set(key, value);
    return { value, fresh: true };
  } catch (error) {
    const cached = await cache.get<T>(key);
    if (cached !== undefined) return { value: cached, fresh: false };
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* The draft outbox                                                           */
/* -------------------------------------------------------------------------- */

export interface OutboxEntry {
  id: string;
  draft: DraftInput;
  savedAt: string;
}

export const outbox = {
  /** Keyed by invoice id, so editing the same draft five times queues one send. */
  queue: (id: string, draft: DraftInput): Promise<void> =>
    run<void>(OUTBOX, "readwrite", (store) =>
      store.put({ id, draft, savedAt: new Date().toISOString() }, id)).then(() =>
        undefined
      ),

  all: (): Promise<OutboxEntry[]> =>
    run<OutboxEntry[]>(OUTBOX, "readonly", (store) => store.getAll())
      .catch(() => []),

  remove: (id: string): Promise<void> =>
    run<void>(OUTBOX, "readwrite", (store) => store.delete(id)).then(() => undefined),

  count: (): Promise<number> =>
    run<number>(OUTBOX, "readonly", (store) => store.count()).catch(() => 0),
};

/* -------------------------------------------------------------------------- */
/* Showing a draft that has not reached the server yet                        */
/* -------------------------------------------------------------------------- */

/**
 * Work out the totals on the device so an offline draft still shows real
 * numbers. This uses exactly the same module the Worker uses, so the figures
 * on screen match what the server will store — but the server still does its
 * own sum when the draft arrives. This is for display, not for trust.
 */
export function computeLocally(
  id: string,
  draft: DraftInput,
): { invoice: Invoice; lines: InvoiceLine[] } {
  const computed = draft.lines.map((line) =>
    computeLine({
      unitPricePiastres: line.unit_price_piastres,
      quantityMilli: line.quantity_milli,
      vatRateBp: line.vat_rate_bp,
      discountType: line.discount_type,
      discountValue: line.discount_value,
    })
  );
  const totals = computeDocument(computed);
  const now = new Date().toISOString();

  const lines: InvoiceLine[] = draft.lines.map((line, index) => ({
    id: `${id}-${index + 1}`,
    invoice_id: id,
    line_no: index + 1,
    item_id: line.item_id,
    name_ar: line.name_ar,
    name_en: line.name_en,
    unit_ar: line.unit_ar,
    unit_en: line.unit_en,
    unit_price_piastres: line.unit_price_piastres,
    vat_rate_bp: line.vat_rate_bp,
    quantity_milli: line.quantity_milli,
    discount_type: line.discount_type,
    discount_value: line.discount_value,
    gross_piastres: computed[index].grossPiastres,
    discount_piastres: computed[index].discountPiastres,
    net_piastres: computed[index].netPiastres,
    vat_piastres: computed[index].vatPiastres,
    total_piastres: computed[index].totalPiastres,
  }));

  const invoice: Invoice = {
    id,
    document_type: draft.document_type,
    references_invoice_id: draft.references_invoice_id ?? null,
    doc_status: "draft",
    eta_status: null,
    document_language: draft.document_language,
    price_tier: draft.price_tier,
    invoice_number: null,
    invoice_serial: null,
    invoice_year: null,
    issue_date: null,
    customer_id: draft.customer_id,
    customer_name_ar: draft.customer_name_ar,
    customer_name_en: draft.customer_name_en,
    customer_phone: draft.customer_phone,
    customer_address: draft.customer_address,
    customer_governorate: draft.customer_governorate,
    customer_type: draft.customer_type,
    customer_tax_registration_number: draft.customer_tax_registration_number,
    company_snapshot: null,
    subtotal_piastres: totals.subtotalPiastres,
    discount_total_piastres: totals.discountTotalPiastres,
    vat_total_piastres: totals.vatTotalPiastres,
    total_piastres: totals.totalPiastres,
    notes: draft.notes,
    payment_terms: draft.payment_terms,
    created_by: "",
    issued_by: null,
    cancelled_by: null,
    cancel_reason: null,
    created_at: now,
    updated_at: now,
    issued_at: null,
    cancelled_at: null,
  };

  return { invoice, lines };
}

/* -------------------------------------------------------------------------- */
/* Connection state                                                           */
/* -------------------------------------------------------------------------- */

type Listener = () => void;
const listeners = new Set<Listener>();

let online = typeof navigator === "undefined" ? true : navigator.onLine;

export function isOnline(): boolean {
  return online;
}

/**
 * navigator.onLine only knows whether there is a network interface, not
 * whether the Worker can actually be reached. A failed request is the more
 * honest signal, so the client reports one here.
 */
export function noteRequestFailed(): void {
  if (online) {
    online = false;
    listeners.forEach((listener) => listener());
  }
}

export function noteRequestSucceeded(): void {
  if (!online) {
    online = true;
    listeners.forEach((listener) => listener());
  }
}

export function watchConnection(listener: Listener): () => void {
  listeners.add(listener);
  const handleOnline = () => {
    online = true;
    listener();
  };
  const handleOffline = () => {
    online = false;
    listener();
  };
  globalThis.addEventListener("online", handleOnline);
  globalThis.addEventListener("offline", handleOffline);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener("online", handleOnline);
    globalThis.removeEventListener("offline", handleOffline);
  };
}
