export function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg className={`logo-mark ${className}`} viewBox="0 0 48 48" aria-label="Easy Go logo" role="img">
      <rect width="48" height="48" rx="9" fill="#e9bd7f" />
      {/* 2x2 stone grid, each stone overlapping the next in a cycle
          (TR over TL, BR over TR, BL over BR, TL over BL). Every stone is a
          single path (circle minus its bite), so each pixel is painted once
          and no anti-aliased fill edge ever overlaps another. */}
      <path
        d="M 24 10.877 A 9.5 9.5 0 1 0 24 21.123 A 9.5 9.5 0 0 1 24 10.877 Z"
        fill="#111715"
      />
      <path
        d="M 26.877 24 A 9.5 9.5 0 1 1 37.123 24 A 9.5 9.5 0 0 0 26.877 24 Z"
        fill="#f8fafc"
      />
      <path
        d="M 24 26.877 A 9.5 9.5 0 1 1 24 37.123 A 9.5 9.5 0 0 0 24 26.877 Z"
        fill="#111715"
      />
      <path
        d="M 10.877 24 A 9.5 9.5 0 1 0 21.123 24 A 9.5 9.5 0 0 1 10.877 24 Z"
        fill="#f8fafc"
      />
    </svg>
  );
}
