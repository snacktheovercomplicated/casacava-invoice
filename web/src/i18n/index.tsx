/**
 * Language and text direction for the whole app.
 *
 * Arabic renders right-to-left and English left-to-right, and the WHOLE
 * layout mirrors, not just the text alignment. That is done by setting `dir`
 * on the document and then using CSS logical properties everywhere in the
 * stylesheet (margin-inline-start rather than margin-left, and so on), so a
 * single attribute flips the entire interface.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import en, { type Strings } from "./en.ts";
import ar from "./ar.ts";

export type Lang = "ar" | "en";

const BUNDLES: Record<Lang, Strings> = { ar, en };
const STORAGE_KEY = "casacava.lang";

interface LanguageValue {
  lang: Lang;
  dir: "rtl" | "ltr";
  t: Strings;
  setLang: (lang: Lang) => void;
  /** Pick the Arabic or English field of a record, falling back to the other. */
  pick: (arValue?: string | null, enValue?: string | null) => string;
}

const LanguageContext = createContext<LanguageValue | null>(null);

function readStored(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "ar" || stored === "en") return stored;
  } catch {
    // private window, or storage blocked: fall through to the default
  }
  return "ar";
}

export function LanguageProvider(
  { children, onChange }: { children: ReactNode; onChange?: (lang: Lang) => void },
) {
  const [lang, setLangState] = useState<Lang>(readStored);

  const dir = lang === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // the choice still applies for this session
    }
    onChange?.(next);
  }, [onChange]);

  const pick = useCallback(
    (arValue?: string | null, enValue?: string | null): string => {
      const preferred = lang === "ar" ? arValue : enValue;
      const other = lang === "ar" ? enValue : arValue;
      return (preferred || other || "").trim();
    },
    [lang],
  );

  const value = useMemo<LanguageValue>(
    () => ({ lang, dir, t: BUNDLES[lang], setLang, pick }),
    [lang, dir, setLang, pick],
  );

  return <LanguageContext value={value}>{children}</LanguageContext>;
}

export function useI18n(): LanguageValue {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useI18n used outside LanguageProvider");
  return value;
}
