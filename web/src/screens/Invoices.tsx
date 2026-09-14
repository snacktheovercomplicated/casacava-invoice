import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client.ts";
import { readThrough } from "../api/offline.ts";
import type { Invoice, UnexplainedNumber, UnusedNumber } from "../api/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { EmptyState, Money, Pill, SearchField, Skeleton } from "../ui/components.tsx";
import { IconDocument, IconPlus } from "../ui/icons.tsx";
import { navigate } from "../App.tsx";

export default function Invoices({ online }: { online: boolean }) {
  const { t, pick } = useI18n();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [fresh, setFresh] = useState(true);

  const load = useCallback(async () => {
    const params = { q: query, status, from, to, limit: "100" };
    const key = `invoices:${JSON.stringify(params)}`;
    try {
      const result = await readThrough(key, () => api.listInvoices(params));
      setInvoices(result.value.invoices);
      setFresh(result.fresh);
    } catch {
      setInvoices([]);
      setFresh(false);
    }
  }, [query, status, from, to]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  const filtering = Boolean(query || status || from || to);

  return (
    <>
      <div className="row wrap">
        <h2 className="section-title grow">{t.invoices.title}</h2>
        <button
          type="button"
          className="btn primary"
          onClick={() => navigate({ screen: "invoice", id: crypto.randomUUID() })}
        >
          <IconPlus size={18} />
          {t.invoices.newInvoice}
        </button>
      </div>

      <div className="card">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t.invoices.searchPlaceholder}
        />
        <div className="line-grid" style={{ marginBlockStart: 10 }}>
          <div>
            <label htmlFor="f-status">{t.invoices.filterStatus}</label>
            <select
              id="f-status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">{t.common.all}</option>
              <option value="draft">{t.invoices.docStatus.draft}</option>
              <option value="issued">{t.invoices.docStatus.issued}</option>
              <option value="cancelled">{t.invoices.docStatus.cancelled}</option>
            </select>
          </div>
          <div>
            <label htmlFor="f-from">{t.invoices.filterFrom}</label>
            <input
              id="f-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="f-to">{t.invoices.filterTo}</label>
            <input
              id="f-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          {filtering
            ? (
              <div style={{ alignSelf: "end" }}>
                <button
                  type="button"
                  className="btn block"
                  onClick={() => {
                    setQuery("");
                    setStatus("");
                    setFrom("");
                    setTo("");
                  }}
                >
                  {t.invoices.clearFilters}
                </button>
              </div>
            )
            : null}
        </div>
      </div>

      <UnusedNumbers online={online} />

      {invoices === null ? <Skeleton rows={4} /> : invoices.length === 0
        ? (
          <EmptyState
            glyph={<IconDocument size={24} />}
            message={filtering ? t.invoices.emptyFiltered : t.invoices.empty}
            action={filtering ? null : (
              <button
                type="button"
                className="btn primary"
                onClick={() => navigate({ screen: "invoice", id: crypto.randomUUID() })}
              >
                <IconPlus size={18} />
                {t.invoices.newInvoice}
              </button>
            )}
          />
        )
        : (
          <div className="list">
            {!fresh ? <div className="banner warn">{t.status.offline}</div> : null}
            {invoices.map((invoice) => (
              <button
                key={invoice.id}
                type="button"
                className="entry"
                onClick={() => navigate({ screen: "invoice", id: invoice.id })}
              >
                <div className="grow">
                  <div className="title" dir="auto">
                    {pick(invoice.customer_name_ar, invoice.customer_name_en) ||
                      t.common.unnamed}
                  </div>
                  <div className="meta">
                    <span className="ltr">
                      {invoice.invoice_number ?? t.invoices.draftNoNumber}
                    </span>
                    {invoice.issue_date
                      ? <span className="ltr">{" · " + invoice.issue_date}</span>
                      : null}
                    {invoice.document_type !== "invoice"
                      ? " · " + t.invoices.documentTypes[invoice.document_type]
                      : null}
                  </div>
                </div>
                <div className="end col" style={{ gap: 5, alignItems: "flex-end" }}>
                  <span className="amount">
                    <Money piastres={invoice.total_piastres} />
                  </span>
                  <Pill status={invoice.doc_status} />
                </div>
              </button>
            ))}
          </div>
        )}
    </>
  );
}

/**
 * Numbers that were handed out but never landed on a document.
 *
 * This is on the invoice list on purpose. A missing invoice number is the kind
 * of thing a tax inspector asks about, and the answer should be visible here
 * rather than something that has to be dug out.
 */
function UnusedNumbers({ online }: { online: boolean }) {
  const { t } = useI18n();
  const [data, setData] = useState<
    { recorded: UnusedNumber[]; unexplained: UnexplainedNumber[]; total: number } | null
  >(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!online) return;
    api.unusedNumbers().then(setData).catch(() => setData(null));
  }, [online]);

  if (!data || data.total === 0) return null;

  return (
    <div className="banner warn">
      <div className="row">
        <strong className="grow">{t.invoices.gaps.count(data.total)}</strong>
        <button type="button" className="btn ghost" onClick={() => setOpen(!open)}>
          {open ? t.invoices.gaps.hide : t.invoices.gaps.show}
        </button>
      </div>

      {open
        ? (
          <div style={{ marginBlockStart: 10 }}>
            <p className="small" style={{ marginBlockStart: 0 }}>
              {t.invoices.gaps.explain}
            </p>

            {data.recorded.length > 0
              ? (
                <>
                  <div className="label">{t.invoices.gaps.recorded}</div>
                  <div className="list">
                    {data.recorded.map((row) => (
                      <div key={row.id} className="card">
                        <div className="row">
                          <strong className="ltr grow">{row.invoice_number}</strong>
                          <span className="tiny muted ltr">{row.allocated_at}</span>
                        </div>
                        <div className="tiny muted" style={{ marginBlockStart: 4 }}>
                          {t.invoices.gaps.reason}: {row.failure_reason}
                        </div>
                        {row.allocated_by_name
                          ? (
                            <div className="tiny muted">
                              {t.invoices.issuedBy}: {row.allocated_by_name}
                            </div>
                          )
                          : null}
                      </div>
                    ))}
                  </div>
                </>
              )
              : null}

            {data.unexplained.length > 0
              ? (
                <div style={{ marginBlockStart: 12 }}>
                  <div className="label">{t.invoices.gaps.unexplained}</div>
                  <p className="tiny muted" style={{ marginBlockStart: 0 }}>
                    {t.invoices.gaps.unexplainedNote}
                  </p>
                  <div className="row wrap">
                    {data.unexplained.map((row) => (
                      <span key={row.invoice_number} className="pill ltr">
                        {row.invoice_number}
                      </span>
                    ))}
                  </div>
                </div>
              )
              : null}
          </div>
        )
        : null}
    </div>
  );
}
