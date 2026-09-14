import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client.ts";
import { readThrough } from "../api/offline.ts";
import type { Item } from "../api/types.ts";
import { useI18n } from "../i18n/index.tsx";
import {
  EmptyState,
  Money,
  MoneyField,
  SearchField,
  Sheet,
  Skeleton,
  TextField,
  Toast,
} from "../ui/components.tsx";
import { IconPlus, IconProducts } from "../ui/icons.tsx";

const blank = (): Partial<Item> => ({
  name_ar: "",
  name_en: "",
  category_ar: "",
  category_en: "",
  unit_price_piastres: 0,
  wholesale_price_piastres: null,
  unit_ar: "",
  unit_en: "",
  vat_rate_bp: null,
  is_active: 1,
});

export default function Items() {
  const { t, pick } = useI18n();
  const [items, setItems] = useState<Item[] | null>(null);
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState<{ id: string; item: Partial<Item> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    readThrough(`items:${showHidden}`, () => api.listItems("", showHidden))
      .then((r) => setItems(r.value))
      .catch(() => setItems([]));
  }, [showHidden]);

  useEffect(load, [load]);

  const shown = (items ?? []).filter((item) => {
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return [item.name_ar, item.name_en, item.category_ar, item.category_en]
      .some((value) => (value ?? "").toLowerCase().includes(needle));
  });

  async function save() {
    if (!editing) return;
    try {
      await api.saveItem(editing.id, editing.item);
      setEditing(null);
      setError(null);
      load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t.errors.generic);
    }
  }

  async function hide(item: Item) {
    if (!confirm(t.items.deactivateConfirm)) return;
    await api.hideItem(item.id).catch(() => {});
    load();
  }

  return (
    <>
      <div className="row wrap">
        <h2 className="section-title grow">{t.items.title}</h2>
        <button
          type="button"
          className="btn primary"
          onClick={() => setEditing({ id: crypto.randomUUID(), item: blank() })}
        >
          <IconPlus size={18} />
          {t.items.newItem}
        </button>
      </div>

      <div className="card">
        <SearchField value={query} onChange={setQuery} placeholder={t.items.searchPlaceholder} />
        <label className="row" style={{ marginBlockStart: 10, gap: 8 }}>
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
          />
          <span>{t.items.showInactive}</span>
        </label>
      </div>

      {items === null ? <Skeleton rows={5} /> : shown.length === 0
        ? (
          <EmptyState
            glyph={<IconProducts size={24} />}
            message={t.items.empty}
            action={
              <button
                type="button"
                className="btn primary"
                onClick={() => setEditing({ id: crypto.randomUUID(), item: blank() })}
              >
                <IconPlus size={18} />
                {t.items.newItem}
              </button>
            }
          />
        )
        : (
          <div className="list">
            {shown.map((item) => (
              <button
                key={item.id}
                type="button"
                className="entry"
                onClick={() => setEditing({ id: item.id, item: { ...item } })}
              >
                <div className="grow">
                  <div className="title" dir="auto">{pick(item.name_ar, item.name_en)}</div>
                  <div className="meta">
                    {pick(item.category_ar, item.category_en)}
                    {item.is_active === 0 ? ` · ${t.items.hidden}` : ""}
                  </div>
                </div>
                <div className="end">
                  <Money piastres={item.unit_price_piastres} />
                  {item.wholesale_price_piastres !== null
                    ? (
                      <div className="tiny muted">
                        {t.items.wholesalePrice}:{" "}
                        <Money piastres={item.wholesale_price_piastres} />
                      </div>
                    )
                    : null}
                </div>
              </button>
            ))}
          </div>
        )}

      {editing
        ? (
          <Sheet title={t.items.newItem} onClose={() => setEditing(null)}>
            <div style={{ display: "grid", gap: 10 }}>
              <TextField
                label={t.items.nameAr}
                value={editing.item.name_ar ?? ""}
                hint={t.items.nameHelp}
                onChange={(value) =>
                  setEditing({ ...editing, item: { ...editing.item, name_ar: value } })}
              />
              <TextField
                label={t.items.nameEn}
                value={editing.item.name_en ?? ""}
                onChange={(value) =>
                  setEditing({ ...editing, item: { ...editing.item, name_en: value } })}
              />
              <TextField
                label={t.items.categoryAr}
                value={editing.item.category_ar ?? ""}
                onChange={(value) =>
                  setEditing({ ...editing, item: { ...editing.item, category_ar: value } })}
              />
              <TextField
                label={t.items.categoryEn}
                value={editing.item.category_en ?? ""}
                onChange={(value) =>
                  setEditing({ ...editing, item: { ...editing.item, category_en: value } })}
              />
              <MoneyField
                label={t.items.unitPrice}
                piastres={editing.item.unit_price_piastres ?? 0}
                onChange={(piastres) =>
                  setEditing({
                    ...editing,
                    item: { ...editing.item, unit_price_piastres: piastres },
                  })}
              />
              <MoneyField
                label={t.items.wholesalePrice}
                piastres={editing.item.wholesale_price_piastres ?? 0}
                onChange={(piastres) =>
                  setEditing({
                    ...editing,
                    item: { ...editing.item, wholesale_price_piastres: piastres },
                  })}
              />
              <TextField
                label={t.items.unitAr}
                value={editing.item.unit_ar ?? ""}
                onChange={(value) =>
                  setEditing({ ...editing, item: { ...editing.item, unit_ar: value } })}
              />
              <TextField
                label={t.items.unitEn}
                value={editing.item.unit_en ?? ""}
                onChange={(value) =>
                  setEditing({ ...editing, item: { ...editing.item, unit_en: value } })}
              />

              <div>
                <label htmlFor="vat-mode">{t.items.vatRate}</label>
                <select
                  id="vat-mode"
                  value={editing.item.vat_rate_bp === null ||
                      editing.item.vat_rate_bp === undefined
                    ? "inherit"
                    : "own"}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      item: {
                        ...editing.item,
                        vat_rate_bp: event.target.value === "inherit" ? null : 1400,
                      },
                    })}
                >
                  <option value="inherit">{t.items.vatInherit}</option>
                  <option value="own">{t.items.vatOwn}</option>
                </select>
                {editing.item.vat_rate_bp !== null &&
                    editing.item.vat_rate_bp !== undefined
                  ? (
                    <div className="field-num" style={{ marginBlockStart: 8 }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={String(editing.item.vat_rate_bp / 100)}
                        onChange={(event) => {
                          const percent = Number(event.target.value);
                          if (Number.isFinite(percent)) {
                            setEditing({
                              ...editing,
                              item: {
                                ...editing.item,
                                vat_rate_bp: Math.round(percent * 100),
                              },
                            });
                          }
                        }}
                      />
                    </div>
                  )
                  : null}
              </div>
            </div>

            {error ? <Toast message={error} tone="bad" onDone={() => setError(null)} /> : null}
            <div className="actions">
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                {t.common.cancel}
              </button>
              <button type="button" className="btn primary" onClick={save}>
                {t.common.save}
              </button>
            </div>
            {items?.some((i) => i.id === editing.id)
              ? (
                <button
                  type="button"
                  className="btn danger block"
                  style={{ marginBlockStart: 10 }}
                  onClick={() => {
                    const found = items.find((i) => i.id === editing.id);
                    if (found) {
                      setEditing(null);
                      hide(found);
                    }
                  }}
                >
                  {t.items.deactivate}
                </button>
              )
              : null}
          </Sheet>
        )
        : null}
    </>
  );
}
