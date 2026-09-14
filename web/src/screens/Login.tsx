import { useState } from "react";
import { api, ApiError } from "../api/client.ts";
import type { User } from "../api/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { TextField } from "../ui/components.tsx";
import { deriveClientSecret } from "../../../src/lib/password.ts";

export default function Login({ onSignedIn }: { onSignedIn: (user: User) => void }) {
  const { t, lang, setLang } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // The password is turned into a digest here, on the device, and the
      // password itself never leaves it. This takes a moment on a phone,
      // which is the point: it is what makes a short password expensive to
      // attack. See src/lib/password.ts.
      const clientSecret = await deriveClientSecret(password, email);
      const user = await api.login(email, clientSecret, navigator.userAgent.slice(0, 80));
      onSignedIn(user);
    } catch (caught) {
      if (caught instanceof ApiError && caught.isOffline) setError(t.login.offline);
      else setError(t.login.failed);
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <div className="header">
        <div>
          <h1>{t.appName}</h1>
          <div className="sub">{t.login.subtitle}</div>
        </div>
        <div className="spacer" />
        <button
          type="button"
          className="btn ghost"
          onClick={() => setLang(lang === "ar" ? "en" : "ar")}
        >
          {t.nav.language}
        </button>
      </div>

      <div className="main">
        <form className="card" onSubmit={submit}>
          <h2>{t.login.title}</h2>
          <div style={{ display: "grid", gap: 12 }}>
            <TextField
              label={t.login.email}
              value={email}
              onChange={setEmail}
              type="email"
              dir="ltr"
              disabled={busy}
            />
            <TextField
              label={t.login.password}
              value={password}
              onChange={setPassword}
              type="password"
              dir="ltr"
              disabled={busy}
            />
            {error ? <div className="banner bad">{error}</div> : null}
            <button className="btn primary block" type="submit" disabled={busy}>
              {busy ? t.login.working : t.login.submit}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
