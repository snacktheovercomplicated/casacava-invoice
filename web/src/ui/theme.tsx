/**
 * Light, dark, or follow the phone.
 *
 * Three states rather than two: "auto" is the default and tracks the device,
 * which is what most people expect when their phone switches at sunset. The
 * other two are deliberate overrides that stick.
 *
 * The choice is written to the document root as data-theme, and every colour
 * in styles.css comes from a token that is redefined there — so nothing in any
 * component needs to know which theme is on.
 *
 * The printed invoice is deliberately NOT themed. It sets its own colours in
 * PAPER_CSS because it is a document, not a screen: an invoice is white paper
 * with dark ink whatever the app looks like.
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

export type ThemeChoice = "auto" | "light" | "dark";

const STORAGE_KEY = "casacava.theme";

interface ThemeValue {
  choice: ThemeChoice;
  /** What is actually on screen right now, once "auto" is resolved. */
  resolved: "light" | "dark";
  setChoice: (choice: ThemeChoice) => void;
  /** Step through auto → light → dark → auto, for the header button. */
  cycle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function readStored(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "auto" || stored === "light" || stored === "dark") return stored;
  } catch {
    // private window or storage blocked: fall through to auto
  }
  return "auto";
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStored);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // Follow the device while the choice is "auto".
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const resolved: "light" | "dark" = choice === "auto"
    ? (systemDark ? "dark" : "light")
    : choice;

  useEffect(() => {
    const root = document.documentElement;
    if (choice === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", choice);
    // So form controls, scrollbars and the address bar match.
    root.style.colorScheme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      // The bar above the app matches the header it sits on, not the brand.
      meta.setAttribute("content", resolved === "dark" ? "#1b1714" : "#faf7f3");
    }
  }, [choice, resolved]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // the choice still applies for this session
    }
  }, []);

  const cycle = useCallback(() => {
    setChoice(choice === "auto" ? "light" : choice === "light" ? "dark" : "auto");
  }, [choice, setChoice]);

  const value = useMemo<ThemeValue>(
    () => ({ choice, resolved, setChoice, cycle }),
    [choice, resolved, setChoice, cycle],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme used outside ThemeProvider");
  return value;
}
