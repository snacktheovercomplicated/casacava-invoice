import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client.ts";
import { readThrough } from "../api/offline.ts";
import type { Customer, Lang } from "../api/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { GOVERNORATES } from "../i18n/governorates.ts";
import { Empty, Loading, Sheet, TextField } from "../ui/components.tsx";

const blank = (): Partial<Customer> => ({
  name_ar: "",
  name_en: "",
  phone: "",
  address: "",
  governorate: "",
  customer_type: "individual",
  tax_registration_number: "",
  preferred_document_language: "ar",
});

export default function Customers() {
  const { t, pick, lang } = useI18n();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<
    { id: string; customer: Partial<Customer> } | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    readThrough("customers", () => api.listCustomers())
      .then((r) => setCustomers(r.value))
      .catch(() => setCustomers([]));
  }, []);

  useEffect(load, [load]);

  const shown = (customers ?? []).filter((customer) => {
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return [customer.name_ar, customer.name_en, customer.phone]
      .some((value) => (value ?? "").toLowerCase().includes(needle));
  });

  async function save() {
    if (!editing) return;
    const c = editing.customer;
    if (c.customer_type === "business" && !c.tax_registration_number?.trim()) {
      setError(t.customers.taxNumberRequired);
      return;
    }
    try {
      await api.saveCustomer(editing.id, c);
      setEditing(null);
      setError(null);
      load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t.errors.generic);
    }
  }

  return (
    <>
      <div className="row wrap">
        <h2 className="grow" style={{ margin: 0, fontSize: 18 }}>{t.customers.title}</h2>
        <button
          type="button"
          className="btn primary"
          onClick={() => setEditing({ id: crypto.randomUUID(), customer: blank() })}
        >
          {t.customers.newCustomer}
        </button>
      </div>

      <div className="card">
        <input
          type="search"
          value={query}
          placeholder={t.customers.searchPlaceholder}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {customers === null ? <Loading /> : shown.length === 0
        ? <Empty message={t.customers.empty} />
        : (
          <div className="list">
            {shown.map((customer) => (
              <button
                key={customer.id}
                type="button"
                className="entry"
                onClick={() => setEditing({ id: customer.id, customer: { ...customer } })}
              >
                <div className="grow">
                  <div className="title">{pick(customer.name_ar, customer.name_en)}</div>
                  <div className="meta ltr">{customer.phone ?? ""}</div>
                </div>
                <span className="pill">
                  {customer.customer_type === "business"
                    ? t.customers.typeBusiness
                    : t.customers.typeIndividual}
                </span>
              </button>
            ))}
          </div>
        )}

      {editing
        ? (
          <Sheet title={t.customers.newCustomer} onClose={() => setEditing(null)}>
            <div style={{ display: "grid", gap: 10 }}>
              {error ? <div className="banner bad">{error}</div> : null}
              <TextField
                label={t.customers.nameAr}
                value={editing.customer.name_ar ?? ""}
                onChange={(value) =>
                  setEditing({
                    ...editing,
                    customer: { ...editing.customer, name_ar: value },
                  })}
              />
              <TextField
                label={t.customers.nameEn}
                value={editing.customer.name_en ?? ""}
                onChange={(value) =>
                  setEditing({
                    ...editing,
                    customer: { ...editing.customer, name_en: value },
                  })}
              />
              <TextField
                label={t.customers.phone}
                value={editing.customer.phone ?? ""}
                dir="ltr"
                onChange={(value) =>
                  setEditing({ ...editing, customer: { ...editing.customer, phone: value } })}
              />
              <TextField
                label={t.customers.address}
                value={editing.customer.address ?? ""}
                multiline
                onChange={(value) =>
                  setEditing({
                    ...editing,
                    customer: { ...editing.customer, address: value },
                  })}
              />

              <div>
                <label htmlFor="gov">{t.customers.governorate}</label>
                <select
                  id="gov"
                  value={editing.customer.governorate ?? ""}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      customer: { ...editing.customer, governorate: event.target.value },
                    })}
                >
                  <option value="">{t.common.none}</option>
                  {GOVERNORATES.map((g) => (
                    <option key={g.code} value={g.code}>{g[lang]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="ctype">{t.customers.type}</label>
                <select
                  id="ctype"
                  value={editing.customer.customer_type ?? "individual"}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      customer: {
                        ...editing.customer,
                        customer_type: event.target.value as "business" | "individual",
                      },
                    })}
                >
                  <option value="individual">{t.customers.typeIndividual}</option>
                  <option value="business">{t.customers.typeBusiness}</option>
                </select>
              </div>

              {editing.customer.customer_type === "business"
                ? (
                  <TextField
                    label={t.customers.taxNumber}
                    value={editing.customer.tax_registration_number ?? ""}
                    dir="ltr"
                    hint={t.customers.taxNumberRequired}
                    onChange={(value) =>
                      setEditing({
                        ...editing,
                        customer: {
                          ...editing.customer,
                          tax_registration_number: value,
                        },
                      })}
                  />
                )
                : null}

              <div>
                <label htmlFor="plang">{t.customers.preferredLanguage}</label>
                <select
                  id="plang"
                  value={editing.customer.preferred_document_language ?? "ar"}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      customer: {
                        ...editing.customer,
                        preferred_document_language: event.target.value as Lang,
                      },
                    })}
                >
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>

            <div className="actions">
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                {t.common.cancel}
              </button>
              <button type="button" className="btn primary" onClick={save}>
                {t.common.save}
              </button>
            </div>
          </Sheet>
        )
        : null}
    </>
  );
}
