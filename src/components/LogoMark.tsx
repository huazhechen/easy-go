import { useId } from 'react';

export function LogoMark({ className = '' }: { className?: string }) {
  const clipId = useId();
  return (
    <svg className={`logo-mark ${className}`} viewBox="0 0 48 48" aria-label="Easy Go logo" role="img">
      <defs>
        <clipPath id={clipId}>
          <circle cx="12.5" cy="24" r="11" />
        </clipPath>
      </defs>
      <rect width="48" height="48" rx="9" fill="#e9bd7f" />
      <circle cx="24" cy="12.5" r="11" fill="#111715" />
      <circle cx="35.5" cy="24" r="11" fill="#f8fafc" />
      <circle cx="24" cy="35.5" r="11" fill="#111715" />
      <circle cx="12.5" cy="24" r="11" fill="#f8fafc" />
      <circle cx="24" cy="12.5" r="11" fill="#111715" clipPath={`url(#${clipId})`} />
    </svg>
  );
}
