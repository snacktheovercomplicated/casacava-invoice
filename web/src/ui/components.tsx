/** Small pieces used by every screen. No text is written here; it all comes from i18n. */
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  formatPiastres,
  formatQuantity,
  MoneyError,
  parseAmountToPiastres,
  parseQuantityToMilli,
} from "../../../src/lib/money.ts";
import { useI18n } from "../i18n/index.tsx";
import { IconSearch } from "./icons.tsx";

/** An amount, always left-to-right and right-aligned, even in an Arabic layout. */
export function Money({ piastres, bold }: { piastres: number; bold?: boolean }) {
  const { t } = useI18n();
  return (
    <span className="ltr nowrap" style={bold ? { fontWeight: 700 } : undefined}>
      {formatPiastres(piastres)} {t.common.egp}
    </span>
  );
}

export function Pill({ status }: { status: "draft" | "issued" | "cancelled" }) {
  const { t } = useI18n();
  return <span className={`pill ${status}`}>{t.invoices.docStatus[status]}</span>;
}

export function TextField(
  { label, value, onChange, hint, type = "text", placeholder, disabled, dir, multiline }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    hint?: string;
    type?: string;
    placeholder?: string;
    disabled?: boolean;
    dir?: "ltr" | "rtl" | "auto";
    multiline?: boolean;
  },
) {
  const id = useId();
  const shared = {
    id,
    value,
    dir: dir ?? "auto" as const,
    placeholder,
    disabled,
    onChange: (
      event: { target: { value: string } },
    ) => onChange(event.target.value),
  };
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {multiline ? <textarea {...shared} /> : <input type={type} {...shared} />}
      {hint ? <div className="tiny muted" style={{ marginBlockStart: 4 }}>{hint}</div> : null}
    </div>
  );
}

/**
 * Keep what a person is part-way through typing, while the parsed value lives
 * upstream. "12." and "" are not numbers yet, so the box must be allowed to
 * hold them without the parsed value jumping around underneath.
 *
 * Re-syncing during render is React's documented way to derive state from a
 * prop that changed: https://react.dev/reference/react/useState
 */
function useDraftText(external: string): [string, (value: string) => void] {
  const [text, setText] = useState(external);
  const lastExternal = useRef(external);
  if (lastExternal.current !== external) {
    lastExternal.current = external;
    setText(external);
  }
  return [text, setText];
}

function NumericField(
  { label, display, parse, onParsed, disabled }: {
    label: string;
    display: string;
    parse: (text: string) => number;
    onParsed: (value: number) => void;
    disabled?: boolean;
  },
) {
  const id = useId();
  const [text, setText] = useDraftText(display);

  return (
    <div className="field-num">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          try {
            onParsed(parse(next));
          } catch (error) {
            // Half-typed input is left alone until it parses. Anything that is
            // not a number problem is a real bug and must not be swallowed.
            if (!(error instanceof MoneyError)) throw error;
          }
        }}
        onBlur={() => setText(display)}
      />
    </div>
  );
}

/** A money box. The value is whole piastres; the box shows ordinary pounds. */
export function MoneyField(
  { label, piastres, onChange, disabled }: {
    label: string;
    piastres: number;
    onChange: (piastres: number) => void;
    disabled?: boolean;
  },
) {
  return (
    <NumericField
      label={label}
      display={formatPiastres(piastres, { grouping: false })}
      parse={parseAmountToPiastres}
      onParsed={onChange}
      disabled={disabled}
    />
  );
}

/** A quantity box. Up to three decimals, stored as thousandths. */
export function QuantityField(
  { label, milli, onChange, disabled }: {
    label: string;
    milli: number;
    onChange: (milli: number) => void;
    disabled?: boolean;
  },
) {
  return (
    <NumericField
      label={label}
      display={formatQuantity(milli)}
      parse={parseQuantityToMilli}
      onParsed={onChange}
      disabled={disabled}
    />
  );
}

export function Sheet(
  { title, children, onClose }: { title: string; children: ReactNode; onClose: () => void },
) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Loading() {
  const { t } = useI18n();
  return <div className="empty">{t.common.loading}</div>;
}

export function Empty({ message }: { message: string }) {
  return <div className="empty">{message}</div>;
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A short message that does not move anything.
 *
 * Confirmations used to be a banner inserted at the top of the screen, which
 * pushed everything down at the moment you were reading it. This floats above
 * instead and takes itself away.
 */
export function Toast(
  { message, tone = "plain", onDone }: {
    message: string;
    tone?: "plain" | "ok" | "bad";
    onDone: () => void;
  },
) {
  useEffect(() => {
    const timer = setTimeout(onDone, tone === "bad" ? 6000 : 3000);
    return () => clearTimeout(timer);
  }, [message, tone, onDone]);

  return (
    <div className="toast-wrap">
      <div className={`toast ${tone === "plain" ? "" : tone}`} role="status">
        {message}
      </div>
    </div>
  );
}

/** Grey shapes the size of what is coming, instead of the word "Loading". */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="list" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="skeleton"
          style={{ blockSize: 68, opacity: 1 - index * 0.12 }}
        />
      ))}
    </div>
  );
}

export function EmptyState(
  { glyph, message, action }: { glyph?: ReactNode; message: string; action?: ReactNode },
) {
  return (
    <div className="empty">
      {glyph ? <div className="glyph">{glyph}</div> : null}
      <div>{message}</div>
      {action}
    </div>
  );
}

/** A search box with the magnifier inside it. */
export function SearchField(
  { value, onChange, placeholder }: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  },
) {
  return (
    <div className="search">
      <IconSearch />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** Two or three choices shown side by side, for settings that are not lists. */
export function Segmented<T extends string>(
  { value, options, onChange }: {
    value: T;
    options: Array<{ value: T; label: string; icon?: ReactNode }>;
    onChange: (value: T) => void;
  },
) {
  return (
    <div className="seg" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
