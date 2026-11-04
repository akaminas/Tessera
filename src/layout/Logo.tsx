/**
 * The Tessera mark. Fixed brand colours on a white tile, so it looks the same
 * on the blue top bar, a board photo and a white page, and matches the browser
 * tab icon (`public/favicon.svg`; a test keeps the two in sync).
 */
export const LOGO_TILE = '#FFFFFF';
export const LOGO_SQUARES = ['#419BA0', '#DAC9A6', '#A1644F', '#415688'] as const;

export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill={LOGO_TILE} />
      <rect x="5" y="5" width="10" height="10" rx="2.5" fill={LOGO_SQUARES[0]} />
      <rect x="17" y="5" width="10" height="10" rx="2.5" fill={LOGO_SQUARES[1]} />
      <rect x="5" y="17" width="10" height="10" rx="2.5" fill={LOGO_SQUARES[2]} />
      <rect x="17" y="17" width="10" height="10" rx="2.5" fill={LOGO_SQUARES[3]} />
    </svg>
  );
}

/** `onDark`: white wordmark, for the top bar. */
export function Logo({ compact, onDark, className }: { compact?: boolean; onDark?: boolean; className?: string }) {
  return (
    <span className={className ?? 'inline-flex items-center gap-2'} style={className ? { alignItems: 'center', gap: '0.5rem' } : undefined}>
      <LogoMark />
      {!compact && <span className={onDark ? 'font-title text-lg font-bold leading-none text-white' : 'font-title text-xl leading-none text-ink'}>Tessera</span>}
    </span>
  );
}
