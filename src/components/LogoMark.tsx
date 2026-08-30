export function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg className={`logo-mark ${className}`} viewBox="0 0 48 48" aria-label="Easy Go logo" role="img">
      <rect width="48" height="48" rx="9" fill="#e9bd7f" />
      <circle cx="15" cy="15" r="11" fill="#111715" />
      <circle cx="33" cy="15" r="11" fill="#f8fafc" />
      <circle cx="33" cy="33" r="11" fill="#111715" />
      <circle cx="15" cy="33" r="11" fill="#f8fafc" />
    </svg>
  );
}
