import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client.ts";
import { readThrough } from "../api/offline.ts";
import type { Lang, Settings as SettingsRow } from "../api/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { Segmented, Skeleton, TextField, Toast } from "../ui/components.tsx";
import { useTheme } from "../ui/theme.tsx";
import { IconAuto, IconMoon, IconSun } from "../ui/icons.tsx";

/** Light, dark, or follow the device. */
function Appearance() {
  const { t } = useI18n();
  const { choice, setChoice } = useTheme();
  return (
    <>
      <Segmented
        value={choice}
        onChange={setChoice}
        options={[
          { value: "auto" as const, label: t.theme.auto, icon: <IconAuto size={16} /> },
          { value: "light" as const, label: t.theme.light, icon: <IconSun size={16} /> },
          { value: "dark" as const, label: t.theme.dark, icon: <IconMoon size={16} /> },
        ]}
      />
      <div className="tiny muted" style={{ marginBlockStart: 8 }}>{t.theme.autoHint}</div>
    </>
  );
}

/**
 * Two fields that are the same thing in two languages, side by side, with a
 * plain warning when one of them is empty.
 *
 * Every one of these prints on the invoice in the INVOICE's language, so an
 * empty English box means an English invoice quietly prints Arabic. That is
 * easy to miss when the app itself is in Arabic, so it is said out loud here.
 */
function BilingualPair(
  { label, arValue, enValue, onArChange, onEnChange, multiline }: {
    label: string;
    arValue: string;
    enValue: string;
    onArChange: (value: string) => void;
    onEnChange: (value: string) => void;
    multiline?: boolean;
  },
) {
  const { t } = useI18n();
  const missingEn = arValue.trim() !== "" && enValue.trim() === "";
  const missingAr = enValue.trim() !== "" && arValue.trim() === "";

  return (
    <div className="pair">
      <div className="label">{label}</div>
      <div className="pair-grid">
        <TextField
          label={t.settings.arabic}
          value={arValue}
          onChange={onArChange}
          multiline={multiline}
          dir="rtl"
        />
        <TextField
          label={t.settings.english}
          value={enValue}
          onChange={onEnChange}
          multiline={multiline}
          dir="ltr"
        />
      </div>
      {missingEn ? <div className="pair-warn">{t.settings.missingEnglish}</div> : null}
      {missingAr ? <div className="pair-warn">{t.settings.missingArabic}</div> : null}
    </div>
  );
}

export default function Settings({ onSignOut }: { onSignOut: () => void }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    readThrough("settings", () => api.getSettings())
      .then((r) => setSettings(r.value))
      .catch(() => setSettings(null));
  }, []);

  if (!settings) return <Skeleton rows={3} />;

  const set = (changes: Partial<SettingsRow>) => {
    setSettings({ ...settings, ...changes });
    setMessage(null);
  };

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveSettings(settings);
      setSettings(saved);
      setMessage(t.common.saved);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t.errors.generic);
    } finally {
      setSaving(false);
    }
  }

  function readLogo(file: File) {
    const reader = new FileReader();
    reader.onload = () => set({ logo_data_url: String(reader.result) });
    reader.readAsDataURL(file);
  }

  return (
    <>
      <h2 className="section-title">{t.settings.title}</h2>
      {message ? <Toast message={message} tone="ok" onDone={() => setMessage(null)} /> : null}
      {error ? <Toast message={error} tone="bad" onDone={() => setError(null)} /> : null}

      <div className="card">
        <h2>{t.theme.label}</h2>
        <Appearance />
      </div>

      <div className="card">
        <h2>{t.settings.company}</h2>
        <div style={{ display: "grid", gap: 14 }}>
          <div className="banner info small">{t.settings.bilingualHint}</div>
          <BilingualPair
            label={t.settings.tradeNameAr.replace(" (Arabic)", "").replace(" (عربي)", "")}
            arValue={settings.trade_name_ar ?? ""}
            enValue={settings.trade_name_en ?? ""}
            onArChange={(v) => set({ trade_name_ar: v })}
            onEnChange={(v) => set({ trade_name_en: v })}
          />
          <BilingualPair
            label={t.settings.legalNameAr.replace(" (Arabic)", "").replace(" (عربي)", "")}
            arValue={settings.legal_name_ar ?? ""}
            enValue={settings.legal_name_en ?? ""}
            onArChange={(v) => set({ legal_name_ar: v })}
            onEnChange={(v) => set({ legal_name_en: v })}
          />
          <BilingualPair
            label={t.settings.addressAr.replace(" (Arabic)", "").replace(" (عربي)", "")}
            arValue={settings.address_ar ?? ""}
            enValue={settings.address_en ?? ""}
            onArChange={(v) => set({ address_ar: v })}
            onEnChange={(v) => set({ address_en: v })}
            multiline
          />
          <TextField
            label={t.settings.phone}
            value={settings.phone ?? ""}
            dir="ltr"
            onChange={(v) => set({ phone: v })}
          />
          <TextField
            label={t.settings.email}
            value={settings.email ?? ""}
            dir="ltr"
            onChange={(v) => set({ email: v })}
          />

          <div>
            <span className="label">{t.settings.logo}</span>
            {settings.logo_data_url
              ? (
                <div className="row" style={{ marginBlockEnd: 8 }}>
                  <img
                    src={settings.logo_data_url}
                    alt=""
                    style={{ maxBlockSize: 60, maxInlineSize: 180 }}
                  />
                  <button
                    type="button"
                    className="btn ghost danger"
                    onClick={() => set({ logo_data_url: null })}
                  >
                    {t.settings.logoRemove}
                  </button>
                </div>
              )
              : null}
            <label className="btn sm">
              {t.settings.logoChoose}
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) readLogo(file);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>{t.settings.documents}</h2>
        <div style={{ display: "grid", gap: 14 }}>
          <div className="field-num">
            <label htmlFor="vat">{t.settings.defaultVat}</label>
            <input
              id="vat"
              type="text"
              inputMode="decimal"
              value={String(settings.default_vat_rate_bp / 100)}
              onChange={(event) => {
                const percent = Number(event.target.value);
                if (Number.isFinite(percent)) {
                  set({ default_vat_rate_bp: Math.round(percent * 100) });
                }
              }}
            />
            <div className="tiny muted" style={{ marginBlockStart: 4 }}>
              {t.settings.defaultVatHelp}
            </div>
          </div>

          <div>
            <label htmlFor="deflang">{t.settings.defaultLanguage}</label>
            <select
              id="deflang"
              value={settings.default_document_language}
              onChange={(event) =>
                set({ default_document_language: event.target.value as Lang })}
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </div>

          <BilingualPair
            label={t.settings.paymentTermsAr.replace(" (Arabic)", "").replace(" (عربي)", "")}
            arValue={settings.payment_terms_ar ?? ""}
            enValue={settings.payment_terms_en ?? ""}
            onArChange={(v) => set({ payment_terms_ar: v })}
            onEnChange={(v) => set({ payment_terms_en: v })}
          />
          <BilingualPair
            label={t.settings.footerAr.replace(" (Arabic)", "").replace(" (عربي)", "")}
            arValue={settings.footer_note_ar ?? ""}
            enValue={settings.footer_note_en ?? ""}
            onArChange={(v) => set({ footer_note_ar: v })}
            onEnChange={(v) => set({ footer_note_en: v })}
            multiline
          />
          <BilingualPair
            label={t.settings.termsAr.replace(" (Arabic)", "").replace(" (عربي)", "")}
            arValue={settings.terms_ar ?? ""}
            enValue={settings.terms_en ?? ""}
            onArChange={(v) => set({ terms_ar: v })}
            onEnChange={(v) => set({ terms_en: v })}
            multiline
          />
        </div>
      </div>

      <button type="button" className="btn primary block" disabled={saving} onClick={save}>
        {saving ? t.common.saving : t.common.save}
      </button>

      <button type="button" className="btn block" onClick={onSignOut}>
        {t.nav.signOut}
      </button>
    </>
  );
}
