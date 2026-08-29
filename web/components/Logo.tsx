/// The mark is a Y drawn as two separate arms meeting in a single stem — two
/// sides of a bet, one settlement. The arms carry different weights of the same
/// green because they are opposing positions, not a symmetric decoration.
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flexShrink: 0 }}
    >
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="18">
        <path d="M27 26 L50 52" stroke="var(--accent)" />
        <path d="M73 26 L50 52" stroke="var(--accent-deep)" />
        <path d="M50 52 L50 78" stroke="var(--accent)" />
      </g>
    </svg>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span className="logo" style={{ gap: size * 0.4 }}>
      <LogoMark size={size} />
      {/* The wordmark tracks the mark, so one size prop sets the lockup. */}
      <span className="logo-word" style={{ fontSize: size * 0.92 }}>
        youbet<span>.space</span>
      </span>
    </span>
  );
}
