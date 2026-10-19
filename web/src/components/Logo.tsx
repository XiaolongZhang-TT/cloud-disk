import { useId } from 'react'

interface LogoMarkProps {
  size?: number
  className?: string
}

export function LogoMark({ size = 36, className = '' }: LogoMarkProps) {
  const gradientId = useId()
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={`logo-mark ${className}`}
      role="img"
      aria-label="Tern"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="0.55" stopColor="#7c6cf5" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#${gradientId})`} />
      <path
        d="M18 38.5c0-7.1 5.7-12.8 12.8-12.8 1.2-4.3 5.1-7.4 9.7-7.4 5.6 0 10.2 4.5 10.3 10 3.4.8 6 3.8 6 7.4 0 4.2-3.5 7.6-7.7 7.6H25.2c-4 0-7.2-3.2-7.2-7.2Z"
        fill="#ffffff"
        fillOpacity="0.95"
      />
      <path
        d="M19 48.5c4.3 2 8.6 2 12.9 0 4.3-2 8.6-2 13.1 0"
        stroke="#ffffff"
        strokeOpacity="0.6"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="47.5" cy="48.5" r="2.1" fill="#ffffff" fillOpacity="0.75" />
    </svg>
  )
}

interface LogoProps {
  size?: number
  showWordmark?: boolean
  className?: string
}

export function Logo({ size = 34, showWordmark = true, className = '' }: LogoProps) {
  return (
    <span className={`logo ${className}`}>
      <LogoMark size={size} />
      {showWordmark && (
        <span className="logo-text">
          <span className="logo-name">Tern</span>
          <span className="logo-sub">PRIVATE CLOUD</span>
        </span>
      )}
    </span>
  )
}
