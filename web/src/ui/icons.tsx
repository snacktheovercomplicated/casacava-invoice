/**
 * The few icons the interface needs, drawn inline.
 *
 * Inline rather than a font or a package: it is a dozen shapes, they inherit
 * the current colour so they theme for free, and they cost no download.
 *
 * Every icon is symmetric or direction-neutral except `back`, which flips with
 * the writing direction like everything else.
 */
type IconProps = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IconInvoices = ({ size = 22, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M15 3v4h4M9 12h6M9 16h4" />
  </svg>
);

export const IconProducts = ({ size = 22, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" />
    <path d="m3 7.5 9 4.5 9-4.5M12 12v9" />
  </svg>
);

export const IconCustomers = ({ size = 22, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
    <path d="M16 5.6a3.2 3.2 0 0 1 0 4.8M17.5 14.5a5.5 5.5 0 0 1 3 5.5" />
  </svg>
);

export const IconSettings = ({ size = 22, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
  </svg>
);

export const IconSun = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M22 12h-2M4 12H2M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4M19.1 19.1l-1.4-1.4M6.3 6.3 4.9 4.9" />
  </svg>
);

export const IconMoon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </svg>
);

export const IconAuto = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17Z" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPlus = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconSearch = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);

export const IconBack = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} style={{ transform: "scaleX(var(--flip, 1))" }}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const IconClose = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconTrash = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
  </svg>
);

export const IconCheck = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="m5 13 4.5 4.5L19 7" />
  </svg>
);

export const IconOffline = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M3 3l18 18M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4-2.6M19 12.9a10 10 0 0 0-6.5-2.9" />
    <circle cx="12" cy="20" r=".7" fill="currentColor" />
  </svg>
);

export const IconDocument = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M7 3h7l4 4v14H7V3Z" />
    <path d="M14 3v4h4" />
  </svg>
);

/** A small mark for the header: the steam from the Casa Cava logo. */
export const IconBrand = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className} strokeWidth={1.8}>
    <path d="M12 3.5c-2 2.2 1.6 3.6-.4 6.2M8.2 6.2c-1.6 1.8 1.3 2.9-.3 5" />
    <path d="M15.8 6.6c-1.3 1.5 1 2.4-.2 4.1" />
    <path d="M5.5 13.5a6.5 6.5 0 0 0 12.4 2.6" />
  </svg>
);
