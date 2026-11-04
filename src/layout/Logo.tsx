export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="2" y="2" width="13" height="13" rx="3" fill="var(--v-teal)" />
      <rect x="17" y="2" width="13" height="13" rx="3" fill="var(--v-ochre-tint)" />
      <rect x="2" y="17" width="13" height="13" rx="3" fill="var(--v-terracotta)" />
      <rect x="17" y="17" width="13" height="13" rx="3" fill="var(--v-indigo)" />
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
