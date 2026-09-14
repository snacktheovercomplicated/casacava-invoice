import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client.ts";
import { computeLocally, outbox, readThrough } from "../api/offline.ts";
import type {
  Customer,
  DraftInput,
  DraftLineInput,
  Invoice,
  InvoiceLine,
  Item,
  Lang,
  Settings as SettingsRow,
  User,
} from "../api/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { governorateName } from "../i18n/governorates.ts";
import {
  Empty,
  Loading,
  Money,
  MoneyField,
  Pill,
  QuantityField,
  Sheet,
  TextField,
} from "../ui/components.tsx";
import { computeDocument, computeLine } from "../../../src/lib/money.ts";
import { amountInArabicWords } from "../../../src/lib/words_ar.ts";
import { amountInEnglishWords } from "../../../src/lib/words_en.ts";
import { navigate } from "../App.tsx";

/**
 * Which name the single visible box is editing. `pick` shows whichever name
 * exists, so the box must write back to that same one — otherwise editing the
 * Arabic name of an Arabic-only product while the app is in English would
 * silently create an English name holding Arabic text.
 */
function nameFieldFor(
  line: { name_ar: string | null; name_en: string | null },
  lang: Lang,
): "name_ar" | "name_en" {
  if (line.name_ar && !line.name_en) return "name_ar";
  if (line.name_en && !line.name_ar) return "name_en";
  return lang === "ar" ? "name_ar" : "name_en";
}

function emptyDraft(settings: SettingsRow | null): DraftInput {
  return {
    document_type: "invoice",
    document_language: settings?.default_document_language ?? "ar",
    price_tier: "retail",
    customer_id: null,
    customer_name_ar: null,
    customer_name_en: null,
    customer_phone: null,
    customer_address: null,
    customer_governorate: null,
    customer_type: "individual",
    customer_tax_registration_number: null,
    notes: null,
    payment_terms: null,
    lines: [],
  };
}

function toDraft(invoice: Invoice, lines: InvoiceLine[]): DraftInput {
  return {
    document_type: invoice.document_type,
    references_invoice_id: invoice.references_invoice_id,
    document_language: invoice.document_language,
    price_tier: invoice.price_tier,
    customer_id: invoice.customer_id,
    customer_name_ar: invoice.customer_name_ar,
    customer_name_en: invoice.customer_name_en,
    customer_phone: invoice.customer_phone,
    customer_address: invoice.customer_address,
    customer_governorate: invoice.customer_governorate,
    customer_type: invoice.customer_type,
    customer_tax_registration_number: invoice.customer_tax_registration_number,
    notes: invoice.notes,
    payment_terms: invoice.payment_terms,
    lines: lines.map((line) => ({
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
    })),
  };
}

export default function Editor(
  { id, online, onQueued, user }: {
    id: string;
    online: boolean;
    onQueued: () => void;
    user: User;
  },
) {
  const { t, lang, pick } = useI18n();

  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [status, setStatus] = useState<"draft" | "issued" | "cancelled">("draft");
  const [server, setServer] = useState<Invoice | null>(null);
  const [serverLines, setServerLines] = useState<InvoiceLine[]>([]);
  const [form, setForm] = useState<DraftInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"issue" | "cancel" | "product" | "customer" | null>(
    null,
  );
  const [cancelReason, setCancelReason] = useState("");
  const [makingPdf, setMakingPdf] = useState(false);

  const readOnly = status !== "draft";

  useEffect(() => {
    let live = true;
    (async () => {
      const loaded = await readThrough("settings", () => api.getSettings())
        .then((r) => r.value).catch(() => null);
      if (!live) return;
      setSettings(loaded);

      try {
        const found = await api.getInvoice(id);
        if (!live) return;
        setServer(found.invoice);
        setServerLines(found.lines);
        setStatus(found.invoice.doc_status);
        setForm(toDraft(found.invoice, found.lines));
      } catch (caught) {
        if (!live) return;
        if (caught instanceof ApiError && caught.status === 404) {
          setForm(emptyDraft(loaded)); // a brand new invoice
        } else {
          // Offline, or the server is unreachable: look for a queued copy.
          const queued = (await outbox.all()).find((entry) => entry.id === id);
          setForm(queued ? queued.draft : emptyDraft(loaded));
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [id]);

  const patch = useCallback((changes: Partial<DraftInput>) => {
    setForm((current) => (current ? { ...current, ...changes } : current));
    setMessage(null);
  }, []);

  const patchLine = useCallback((index: number, changes: Partial<DraftLineInput>) => {
    setForm((current) => {
      if (!current) return current;
      const lines = current.lines.slice();
      lines[index] = { ...lines[index], ...changes };
      return { ...current, lines };
    });
    setMessage(null);
  }, []);

  /** Worked out here for display, using the same module the server uses. */
  const totals = useMemo(() => {
    if (!form) return null;
    try {
      const computed = form.lines.map((line) =>
        computeLine({
          unitPricePiastres: line.unit_price_piastres,
          quantityMilli: line.quantity_milli,
          vatRateBp: line.vat_rate_bp,
          discountType: line.discount_type,
          discountValue: line.discount_value,
        })
      );
      return { lines: computed, document: computeDocument(computed) };
    } catch {
      return null; // a line is mid-edit and does not add up yet
    }
  }, [form]);

  async function save(): Promise<boolean> {
    if (!form) return false;
    setSaving(true);
    setError(null);
    try {
      const result = await api.saveDraft(id, form);
      setServer(result.invoice);
      setServerLines(result.lines);
      setStatus(result.invoice.doc_status);
      setMessage(t.common.saved);
      return true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.isOffline) {
        // Held on the device and sent when the connection comes back.
        await outbox.queue(id, form);
        onQueued();
        setMessage(t.status.offline);
        return true;
      }
      setError(caught instanceof ApiError ? caught.message : t.errors.generic);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function issue() {
    setDialog(null);
    if (!online) {
      setError(t.editor.issueOffline);
      return;
    }
    if (!form || form.lines.length === 0) {
      setError(t.errors.needsLine);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.saveDraft(id, form);
      const result = await api.issue(id);
      setServer(result.invoice);
      setServerLines(result.lines);
      setStatus(result.invoice.doc_status);
      setForm(toDraft(result.invoice, result.lines));
      setMessage(t.editor.issuedNotice);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  async function cancelInvoice() {
    setDialog(null);
    setSaving(true);
    try {
      const result = await api.cancelInvoice(id, cancelReason);
      setServer(result.invoice);
      setServerLines(result.lines);
      setStatus(result.invoice.doc_status);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  async function removeDraft() {
    if (!confirm(t.editor.deleteDraftConfirm)) return;
    try {
      await api.deleteDraft(id);
    } catch {
      // a draft that never reached the server just goes from the outbox
    }
    await outbox.remove(id);
    onQueued();
    navigate({ screen: "invoices" });
  }

  /**
   * The PDF code, the embedded Arabic font and the two drawing libraries are
   * about half a megabyte, and most visits never make a PDF. Loading them only
   * when the button is pressed keeps the app quick to open on mobile data.
   */
  async function makePdf() {
    if (!form) return;
    setMakingPdf(true);
    setError(null);
    try {
      const { saveInvoicePdf } = await import("../pdf/generate.ts");
      // An issued invoice prints the company details as they were on the day
      // it was issued; a draft previews with today's.
      const company = server?.company_snapshot ?? settings ?? {};
      const shown = server && server.doc_status !== "draft"
        ? { invoice: server, lines: serverLines }
        : computeLocally(id, form);
      await saveInvoicePdf({
        invoice: shown.invoice,
        lines: shown.lines,
        settings: company,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.errors.generic);
    } finally {
      setMakingPdf(false);
    }
  }

  async function makeCreditNote() {
    const newId = crypto.randomUUID();
    try {
      await api.creditNote(id, newId);
      navigate({ screen: "invoice", id: newId });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t.errors.generic);
    }
  }

  if (loading || !form) return <Loading />;

  /**
   * The words under the total are in the INVOICE's language, which is chosen
   * per invoice and is not the language the app happens to be in. Working in
   * Arabic and sending an English invoice is the normal case.
   */
  const words = totals
    ? form.document_language === "ar"
      ? amountInArabicWords(totals.document.totalPiastres)
      : amountInEnglishWords(totals.document.totalPiastres)
    : "";

  return (
    <>
      <div className="row wrap">
        <div className="grow">
          <h2 style={{ margin: 0, fontSize: 18 }}>
            {readOnly
              ? t.editor.viewTitle
              : server
              ? t.editor.editTitle
              : t.editor.newTitle}
          </h2>
          {server?.invoice_number
            ? <div className="muted small ltr">{server.invoice_number}</div>
            : null}
        </div>
        <Pill status={status} />
      </div>

      {message ? <div className="banner info">{message}</div> : null}
      {error ? <div className="banner bad">{error}</div> : null}
      {readOnly ? <div className="banner">{t.editor.readOnly}</div> : null}
      {server?.references_invoice_id
        ? (
          <div className="banner">
            {t.editor.references}: <span className="ltr">{server.references_invoice_id}</span>
          </div>
        )
        : null}

      {/* ---- how this document behaves ---- */}
      <div className="card">
        <div className="line-grid">
          <div>
            <label htmlFor="doc-lang">{t.editor.documentLanguage}</label>
            <select
              id="doc-lang"
              value={form.document_language}
              disabled={readOnly}
              onChange={(event) =>
                patch({ document_language: event.target.value as Lang })}
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
            <div className="tiny muted" style={{ marginBlockStart: 4 }}>
              {t.editor.documentLanguageHelp}
            </div>
          </div>
          <div>
            <label htmlFor="tier">{t.editor.priceTier}</label>
            <select
              id="tier"
              value={form.price_tier}
              disabled={readOnly}
              onChange={(event) =>
                patch({ price_tier: event.target.value as "retail" | "wholesale" })}
            >
              <option value="retail">{t.editor.tierRetail}</option>
              <option value="wholesale">{t.editor.tierWholesale}</option>
            </select>
          </div>
        </div>
      </div>

      {/* ---- who it is for ---- */}
      <div className="card">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>{t.editor.customer}</h2>
          {!readOnly
            ? (
              <button
                type="button"
                className="btn ghost"
                onClick={() => setDialog("customer")}
              >
                {t.editor.chooseCustomer}
              </button>
            )
            : null}
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          <TextField
            label={t.customers.nameAr}
            value={form.customer_name_ar ?? ""}
            disabled={readOnly}
            onChange={(value) => patch({ customer_name_ar: value || null, customer_id: null })}
          />
          <TextField
            label={t.customers.nameEn}
            value={form.customer_name_en ?? ""}
            disabled={readOnly}
            onChange={(value) => patch({ customer_name_en: value || null, customer_id: null })}
          />
          <TextField
            label={t.customers.phone}
            value={form.customer_phone ?? ""}
            dir="ltr"
            disabled={readOnly}
            onChange={(value) => patch({ customer_phone: value || null })}
          />
          <TextField
            label={t.customers.address}
            value={form.customer_address ?? ""}
            disabled={readOnly}
            onChange={(value) => patch({ customer_address: value || null })}
          />
          {form.customer_governorate
            ? (
              <div className="small muted">
                {t.customers.governorate}:{" "}
                {governorateName(form.customer_governorate, lang)}
              </div>
            )
            : null}
        </div>
      </div>

      {/* ---- what is on it ---- */}
      <div className="card">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>{t.editor.lines}</h2>
          {!readOnly
            ? (
              <button
                type="button"
                className="btn"
                onClick={() => setDialog("product")}
              >
                {t.editor.addLine}
              </button>
            )
            : null}
        </div>

        {form.lines.length === 0
          ? <Empty message={t.editor.noLines} />
          : (
            <div className="lines">
              {form.lines.map((line, index) => (
                <div className="line" key={index}>
                  <div className="line-head">
                    <div className="grow">
                      <TextField
                        label={t.editor.lineName}
                        value={pick(line.name_ar, line.name_en)}
                        disabled={readOnly}
                        onChange={(value) =>
                          patchLine(index, {
                            ...(nameFieldFor(line, lang) === "name_ar"
                              ? { name_ar: value || null }
                              : { name_en: value || null }),
                            // typing over a picked product detaches it
                            item_id: null,
                          })}
                      />
                    </div>
                    {!readOnly
                      ? (
                        <button
                          type="button"
                          className="btn ghost danger"
                          aria-label={t.common.remove}
                          onClick={() =>
                            patch({ lines: form.lines.filter((_, i) => i !== index) })}
                        >
                          ×
                        </button>
                      )
                      : null}
                  </div>

                  <div className="line-grid">
                    <QuantityField
                      label={t.editor.quantity +
                        (pick(line.unit_ar, line.unit_en)
                          ? ` (${pick(line.unit_ar, line.unit_en)})`
                          : "")}
                      milli={line.quantity_milli}
                      disabled={readOnly}
                      onChange={(milli) => patchLine(index, { quantity_milli: milli })}
                    />
                    <MoneyField
                      label={t.editor.unitPrice}
                      piastres={line.unit_price_piastres}
                      disabled={readOnly}
                      onChange={(piastres) =>
                        patchLine(index, { unit_price_piastres: piastres })}
                    />
                    <div>
                      <label htmlFor={`disc-${index}`}>{t.editor.discount}</label>
                      <select
                        id={`disc-${index}`}
                        value={line.discount_type}
                        disabled={readOnly}
                        onChange={(event) =>
                          patchLine(index, {
                            discount_type: event.target.value as DraftLineInput[
                              "discount_type"
                            ],
                            discount_value: 0,
                          })}
                      >
                        <option value="none">{t.editor.discountNone}</option>
                        <option value="percent">{t.editor.discountPercent}</option>
                        <option value="amount">{t.editor.discountAmount}</option>
                      </select>
                    </div>
                    {line.discount_type === "percent"
                      ? (
                        <div className="field-num">
                          <label htmlFor={`dv-${index}`}>%</label>
                          <input
                            id={`dv-${index}`}
                            type="text"
                            inputMode="decimal"
                            disabled={readOnly}
                            value={String(line.discount_value / 100)}
                            onChange={(event) => {
                              const percent = Number(event.target.value);
                              if (Number.isFinite(percent)) {
                                patchLine(index, {
                                  discount_value: Math.round(percent * 100),
                                });
                              }
                            }}
                          />
                        </div>
                      )
                      : line.discount_type === "amount"
                      ? (
                        <MoneyField
                          label={t.editor.discount}
                          piastres={line.discount_value}
                          disabled={readOnly}
                          onChange={(piastres) =>
                            patchLine(index, { discount_value: piastres })}
                        />
                      )
                      : <div />}
                  </div>

                  <div className="line-total">
                    <span className="muted small">
                      {t.editor.vatRate}{" "}
                      <span className="ltr">{line.vat_rate_bp / 100}%</span>
                    </span>
                    <Money piastres={totals?.lines[index]?.totalPiastres ?? 0} />
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* ---- what it comes to ---- */}
      {totals
        ? (
          <div className="card">
            <div className="totals">
              <div className="r">
                <span>{t.editor.subtotal}</span>
                <Money piastres={totals.document.subtotalPiastres} />
              </div>
              {totals.document.discountTotalPiastres > 0
                ? (
                  <div className="r">
                    <span>{t.editor.discountTotal}</span>
                    <Money piastres={totals.document.discountTotalPiastres} />
                  </div>
                )
                : null}
              <div className="r">
                <span>{t.editor.vatTotal}</span>
                <Money piastres={totals.document.vatTotalPiastres} />
              </div>
              <div className="r grand">
                <span>{t.editor.grandTotal}</span>
                <Money piastres={totals.document.totalPiastres} bold />
              </div>
            </div>
            <div className="words" dir={form.document_language === "ar" ? "rtl" : "ltr"}>
              <div className="tiny muted">{t.editor.amountInWords}</div>
              {words}
            </div>
          </div>
        )
        : null}

      <div className="card">
        <div style={{ display: "grid", gap: 10 }}>
          <TextField
            label={t.editor.notes}
            value={form.notes ?? ""}
            multiline
            disabled={readOnly}
            onChange={(value) => patch({ notes: value || null })}
          />
          <TextField
            label={t.editor.paymentTerms}
            value={form.payment_terms ?? ""}
            disabled={readOnly}
            onChange={(value) => patch({ payment_terms: value || null })}
          />
        </div>
      </div>

      {/* ---- what you can do with it ---- */}
      <div className="card">
        <div style={{ display: "grid", gap: 10 }}>
          <button
            type="button"
            className="btn block"
            id="btn-pdf"
            disabled={makingPdf || form.lines.length === 0}
            onClick={makePdf}
          >
            {makingPdf ? t.common.loading : t.invoices.openPdf}
          </button>
          {!readOnly
            ? (
              <>
                <button
                  type="button"
                  className="btn block"
                  disabled={saving}
                  onClick={save}
                >
                  {saving ? t.common.saving : t.editor.saveDraft}
                </button>
                <button
                  type="button"
                  className="btn primary block"
                  disabled={saving || form.lines.length === 0}
                  onClick={() => (online ? setDialog("issue") : setError(t.editor.issueOffline))}
                >
                  {t.editor.issue}
                </button>
                <button type="button" className="btn danger block" onClick={removeDraft}>
                  {t.editor.deleteDraft}
                </button>
              </>
            )
            : (
              <>
                {status === "issued"
                  ? (
                    <button
                      type="button"
                      className="btn danger block"
                      onClick={() => setDialog("cancel")}
                    >
                      {t.editor.cancelInvoice}
                    </button>
                  )
                  : null}
                <button type="button" className="btn block" onClick={makeCreditNote}>
                  {t.editor.creditNote}
                </button>
              </>
            )}
        </div>
      </div>

      {dialog === "issue"
        ? (
          <Sheet title={t.editor.issueTitle} onClose={() => setDialog(null)}>
            <p>{t.editor.issueBody}</p>
            <div className="actions">
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                {t.common.cancel}
              </button>
              <button type="button" className="btn primary" onClick={issue}>
                {t.editor.issueConfirm}
              </button>
            </div>
          </Sheet>
        )
        : null}

      {dialog === "cancel"
        ? (
          <Sheet title={t.editor.cancelTitle} onClose={() => setDialog(null)}>
            <p>{t.editor.cancelBody}</p>
            <TextField
              label={t.editor.cancelReason}
              value={cancelReason}
              onChange={setCancelReason}
            />
            <div className="actions">
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                {t.common.cancel}
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={!cancelReason.trim()}
                onClick={cancelInvoice}
              >
                {t.editor.cancelConfirm}
              </button>
            </div>
          </Sheet>
        )
        : null}

      {dialog === "product"
        ? (
          <ProductPicker
            tier={form.price_tier}
            defaultVatBp={settings?.default_vat_rate_bp ?? 0}
            onClose={() => setDialog(null)}
            onPick={(line) => {
              patch({ lines: [...form.lines, line] });
              setDialog(null);
            }}
          />
        )
        : null}

      {dialog === "customer"
        ? (
          <CustomerPicker
            onClose={() => setDialog(null)}
            onPick={(customer) => {
              patch({
                customer_id: customer.id,
                customer_name_ar: customer.name_ar,
                customer_name_en: customer.name_en,
                customer_phone: customer.phone,
                customer_address: customer.address,
                customer_governorate: customer.governorate,
                customer_type: customer.customer_type,
                customer_tax_registration_number: customer.tax_registration_number,
                document_language: customer.preferred_document_language,
              });
              setDialog(null);
            }}
          />
        )
        : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */

function ProductPicker(
  { tier, defaultVatBp, onPick, onClose }: {
    tier: "retail" | "wholesale";
    defaultVatBp: number;
    onPick: (line: DraftLineInput) => void;
    onClose: () => void;
  },
) {
  const { t, pick } = useI18n();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    readThrough("items", () => api.listItems())
      .then((r) => setItems(r.value))
      .catch(() => setItems([]));
  }, []);

  const shown = (items ?? []).filter((item) => {
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return [item.name_ar, item.name_en, item.category_ar, item.category_en]
      .some((value) => (value ?? "").toLowerCase().includes(needle));
  });

  function choose(item: Item) {
    const wholesale = item.wholesale_price_piastres;
    onPick({
      item_id: item.id,
      name_ar: item.name_ar,
      name_en: item.name_en,
      unit_ar: item.unit_ar,
      unit_en: item.unit_en,
      // The wholesale toggle sets the default; the line can still be edited.
      unit_price_piastres: tier === "wholesale" && wholesale !== null
        ? wholesale
        : item.unit_price_piastres,
      vat_rate_bp: item.vat_rate_bp ?? defaultVatBp,
      quantity_milli: 1000,
      discount_type: "none",
      discount_value: 0,
    });
  }

  return (
    <Sheet title={t.editor.pickProduct} onClose={onClose}>
      <input
        type="search"
        value={query}
        placeholder={t.items.searchPlaceholder}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div style={{ marginBlockStart: 10 }}>
        {items === null ? <Loading /> : shown.map((item) => (
          <button
            key={item.id}
            type="button"
            className="picker-item"
            onClick={() => choose(item)}
          >
            <div className="row">
              <span className="grow">{pick(item.name_ar, item.name_en)}</span>
              <Money
                piastres={tier === "wholesale" && item.wholesale_price_piastres !== null
                  ? item.wholesale_price_piastres
                  : item.unit_price_piastres}
              />
            </div>
          </button>
        ))}
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={() =>
            onPick({
              item_id: null,
              name_ar: null,
              name_en: null,
              unit_ar: null,
              unit_en: null,
              unit_price_piastres: 0,
              vat_rate_bp: defaultVatBp,
              quantity_milli: 1000,
              discount_type: "none",
              discount_value: 0,
            })}
        >
          {t.editor.freeText}
        </button>
      </div>
    </Sheet>
  );
}

function CustomerPicker(
  { onPick, onClose }: { onPick: (customer: Customer) => void; onClose: () => void },
) {
  const { t, pick } = useI18n();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    readThrough("customers", () => api.listCustomers())
      .then((r) => setCustomers(r.value))
      .catch(() => setCustomers([]));
  }, []);

  const shown = (customers ?? []).filter((customer) => {
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return [customer.name_ar, customer.name_en, customer.phone]
      .some((value) => (value ?? "").toLowerCase().includes(needle));
  });

  return (
    <Sheet title={t.editor.chooseCustomer} onClose={onClose}>
      <input
        type="search"
        value={query}
        placeholder={t.customers.searchPlaceholder}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div style={{ marginBlockStart: 10 }}>
        {customers === null ? <Loading /> : shown.length === 0
          ? <Empty message={t.customers.empty} />
          : shown.map((customer) => (
            <button
              key={customer.id}
              type="button"
              className="picker-item"
              onClick={() => onPick(customer)}
            >
              <div className="title">{pick(customer.name_ar, customer.name_en)}</div>
              <div className="meta ltr">{customer.phone ?? ""}</div>
            </button>
          ))}
      </div>
    </Sheet>
  );
}
