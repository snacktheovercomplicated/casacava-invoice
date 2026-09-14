import { type ReactNode, useCallback, useEffect, useState } from "react";
import { api, ApiError, setToken } from "./api/client.ts";
import { isOnline, outbox, watchConnection } from "./api/offline.ts";
import type { Lang, User } from "./api/types.ts";
import { LanguageProvider, useI18n } from "./i18n/index.tsx";
import { ThemeProvider, useTheme } from "./ui/theme.tsx";
import { Skeleton } from "./ui/components.tsx";
import {
  IconAuto,
  IconBrand,
  IconCustomers,
  IconInvoices,
  IconMoon,
  IconOffline,
  IconProducts,
  IconSettings,
  IconSun,
} from "./ui/icons.tsx";
import Login from "./screens/Login.tsx";
import Invoices from "./screens/Invoices.tsx";
import Editor from "./screens/Editor.tsx";
import Items from "./screens/Items.tsx";
import Customers from "./screens/Customers.tsx";
import Settings from "./screens/Settings.tsx";

/* -------------------------------------------------------------------------- */
/* Routing                                                                    */
/* -------------------------------------------------------------------------- */

export type Route =
  | { screen: "invoices" }
  | { screen: "invoice"; id: string }
  | { screen: "items" }
  | { screen: "customers" }
  | { screen: "settings" };

/**
 * Hash routing, not paths. It behaves identically when the app is served by
 * the Worker and when it is loaded from a file inside the packaged Windows,
 * Linux and Android builds, where there is no server to rewrite a path.
 */
function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "items") return { screen: "items" };
  if (parts[0] === "customers") return { screen: "customers" };
  if (parts[0] === "settings") return { screen: "settings" };
  if (parts[0] === "invoices" && parts[1]) return { screen: "invoice", id: parts[1] };
  return { screen: "invoices" };
}

export function navigate(route: Route): void {
  const hash = route.screen === "invoice"
    ? `#/invoices/${route.id}`
    : `#/${route.screen}`;
  if (globalThis.location.hash !== hash) globalThis.location.hash = hash;
}

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(globalThis.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(globalThis.location.hash));
    globalThis.addEventListener("hashchange", onChange);
    return () => globalThis.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/* -------------------------------------------------------------------------- */
/* Syncing drafts that were written offline                                   */
/* -------------------------------------------------------------------------- */

function useSync(signedIn: boolean) {
  const [online, setOnline] = useState(isOnline());
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshCount = useCallback(() => {
    outbox.count().then(setPending);
  }, []);

  const flush = useCallback(async () => {
    if (!signedIn || syncing) return;
    const entries = await outbox.all();
    if (entries.length === 0) return;

    setSyncing(true);
    for (const entry of entries) {
      try {
        await api.saveDraft(entry.id, entry.draft);
        await outbox.remove(entry.id);
      } catch (error) {
        // Offline again: stop and keep the rest for next time.
        if (error instanceof ApiError && error.isOffline) break;
        // The server refused it — most likely the draft was issued on the
        // other device meanwhile. Drop it rather than retrying forever.
        if (error instanceof ApiError && error.status === 409) {
          await outbox.remove(entry.id);
          continue;
        }
        break;
      }
    }
    setSyncing(false);
    refreshCount();
  }, [signedIn, syncing, refreshCount]);

  useEffect(() => {
    refreshCount();
    return watchConnection(() => {
      const now = isOnline();
      setOnline(now);
      if (now) flush();
    });
  }, [flush, refreshCount]);

  useEffect(() => {
    if (signedIn && online) flush();
  }, [signedIn, online, flush]);

  return { online, pending, syncing, refreshCount, flush };
}

/* -------------------------------------------------------------------------- */

function Shell({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const { t, lang, setLang } = useI18n();
  const route = useRoute();
  const sync = useSync(true);

  const tabs: Array<{ screen: Route["screen"]; label: string; icon: ReactNode }> = [
    { screen: "invoices", label: t.nav.invoices, icon: <IconInvoices /> },
    { screen: "items", label: t.nav.items, icon: <IconProducts /> },
    { screen: "customers", label: t.nav.customers, icon: <IconCustomers /> },
    { screen: "settings", label: t.nav.settings, icon: <IconSettings /> },
  ];

  const current = route.screen === "invoice" ? "invoices" : route.screen;

  return (
    <div className="app">
      {/*
        On a phone the title bar is at the top and the tabs are a separate bar
        at the bottom, so this wrapper is `display: contents` and does nothing.
        On a desktop the two become one bar at the top, and they have to stick
        together — two separately sticky bars both pinned to zero landed on top
        of each other and the tabs disappeared under the title on the first
        scroll.
      */}
      <div className="topbar">
        <header className="header">
          <div className="brand-mark"><IconBrand /></div>
          <div className="grow truncate">
            <h1>{t.appName}</h1>
            <div className="sub">{t.appSection}</div>
          </div>
          <ThemeButton />
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            aria-label={t.nav.switchToArabic}
          >
            {t.nav.language}
          </button>
        </header>

        <nav className="nav">
          {tabs.map((tab) => (
            <button
              key={tab.screen}
              type="button"
              aria-current={current === tab.screen ? "page" : undefined}
              onClick={() => navigate({ screen: tab.screen } as Route)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <main className="main">
        {!sync.online
          ? (
            <div className="banner warn">
              <IconOffline />
              <span>{t.status.offline}</span>
            </div>
          )
          : sync.pending > 0
          ? (
            <div className="banner info">
              <span>
                {sync.syncing ? t.status.syncing : t.status.pendingChanges(sync.pending)}
              </span>
            </div>
          )
          : null}

        {route.screen === "invoices" ? <Invoices online={sync.online} /> : null}
        {route.screen === "invoice"
          ? (
            <Editor
              id={route.id}
              online={sync.online}
              onQueued={sync.refreshCount}
              user={user}
            />
          )
          : null}
        {route.screen === "items" ? <Items /> : null}
        {route.screen === "customers" ? <Customers /> : null}
        {route.screen === "settings" ? <Settings onSignOut={onSignOut} /> : null}
      </main>

    </div>
  );
}

/** Steps through automatic, light and dark, showing where it currently is. */
function ThemeButton() {
  const { t } = useI18n();
  const { choice, cycle } = useTheme();
  const icon = choice === "auto"
    ? <IconAuto />
    : choice === "light"
    ? <IconSun />
    : <IconMoon />;
  const label = choice === "auto" ? t.theme.auto : choice === "light" ? t.theme.light : t.theme.dark;

  return (
    <button
      type="button"
      className={`icon-btn ${choice === "auto" ? "" : "on"}`}
      onClick={cycle}
      aria-label={`${t.theme.change} (${label})`}
      title={`${t.theme.label}: ${label}`}
    >
      {icon}
    </button>
  );
}

function Root() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const { setLang } = useI18n();

  useEffect(() => {
    api.me()
      .then((found) => {
        setUser(found);
        // The interface language is remembered per user, on the server, so it
        // follows them from the phone to the laptop.
        setLang(found.ui_language);
      })
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
    // setLang is stable enough here; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = useCallback(() => {
    api.logout().finally(() => {
      setToken(null);
      setUser(null);
    });
  }, []);

  if (checking) {
    return <div className="main"><Skeleton rows={4} /></div>;
  }
  if (!user) {
    return (
      <Login
        onSignedIn={(found) => {
          setUser(found);
          setLang(found.ui_language);
        }}
      />
    );
  }
  return <Shell user={user} onSignOut={signOut} />;
}

export default function App() {
  const [pendingLang, setPendingLang] = useState<Lang | null>(null);

  // Remember the choice on the server too, so it survives to the other device.
  useEffect(() => {
    if (!pendingLang) return;
    api.setUiLanguage(pendingLang).catch(() => {
      // Offline, or not signed in yet. The local choice still applies.
    });
    setPendingLang(null);
  }, [pendingLang]);

  return (
    <ThemeProvider>
      <LanguageProvider onChange={setPendingLang}>
        <Root />
      </LanguageProvider>
    </ThemeProvider>
  );
}
