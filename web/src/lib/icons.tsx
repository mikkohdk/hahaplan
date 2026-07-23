/**
 * Lucide icons, inlined as tiny components so we depend on no icon package and
 * ship no extra runtime. The design system reserves unicode glyphs for keyboard
 * hints (⌘K, ↵) only — UI controls use these instead.
 */
type IconProps = { size?: number };

const svg = (size: number) =>
  ({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  }) as const;

export const ChevronUp = ({ size = 16 }: IconProps) => (
  <svg {...svg(size)}>
    <path d="m18 15-6-6-6 6" />
  </svg>
);

export const ChevronDown = ({ size = 16 }: IconProps) => (
  <svg {...svg(size)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const X = ({ size = 16 }: IconProps) => (
  <svg {...svg(size)}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);
