/** Classic yellow rubber duck, side profile. Inline SVG so it looks the same on every platform. */
export function DuckIcon({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      {/* tail */}
      <path d="M8 38 L6 26 L18 34 Z" fill="#F5C531" />
      {/* body */}
      <ellipse cx="30" cy="42" rx="24" ry="14" fill="#F5C531" />
      {/* wing */}
      <path d="M18 42 q10 -8 20 0 q-10 6 -20 0z" fill="#E8B321" />
      {/* head */}
      <circle cx="42" cy="22" r="13" fill="#F5C531" />
      {/* beak */}
      <path d="M53 20 L64 23 L53 28 Z" fill="#F08A24" />
      {/* eye */}
      <circle cx="46" cy="19" r="2.4" fill="#2B2A26" />
      <circle cx="46.8" cy="18.3" r="0.8" fill="#fff" />
    </svg>
  );
}
