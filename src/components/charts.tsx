/**
 * Small SVG charts following Vellum's anatomy: claim title (sentence), muted
 * unit line, hairline horizontal grid, bottom axis only, direct labels, no
 * frames or legends for ≤4 series, tone colours in slot order, terracotta for
 * the single highlighted item, tabular numerals.
 */
import { useId, useMemo, type ReactNode } from 'react';
import type { Family } from '@/data/types';

export const SLOT: Family[] = ['teal', 'terracotta', 'indigo', 'ochre', 'mauve', 'moss'];
const tone = (f: Family) => `var(--v-${f})`;
const tint = (f: Family) => `var(--v-${f}-tint)`;

export function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(+v.toFixed(10));
  if (ticks[ticks.length - 1] < max) ticks.push(+(ticks[ticks.length - 1] + step).toFixed(10));
  return ticks;
}

export function compactNumber(n: number, digits = 1): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(digits).replace(/\.0+$/, '')} M`;
  if (abs >= 1e4) return `${sign}${(abs / 1e3).toFixed(digits).replace(/\.0+$/, '')} k`;
  return `${sign}${abs.toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
}

export function ChartFrame({ title, subtitle, unit, footer, children }: { title: string; subtitle?: string; unit?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <figure className="flex flex-col gap-1">
      <figcaption>
        <p className="font-title text-[17px] leading-snug text-ink">{title}</p>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </figcaption>
      {unit && <p className="mt-1 text-[11px] text-muted">{unit}</p>}
      {children}
      {footer && <p className="text-[10px] text-muted">{footer}</p>}
    </figure>
  );
}

/** Horizontal bars, sorted by value; one optional highlighted row. */
export function HBarChart({
  data,
  format = compactNumber,
  highlight,
  height = 22,
  max: forcedMax,
  reference,
}: {
  data: { label: string; value: number; secondary?: number }[];
  format?: (n: number) => string;
  highlight?: string;
  height?: number;
  max?: number;
  reference?: { value: number; label: string };
}) {
  const width = 560;
  const labelW = 150;
  const valueW = 70;
  const plotW = width - labelW - valueW;
  const max = forcedMax ?? Math.max(1, ...data.map((d) => Math.max(d.value, d.secondary ?? 0)), reference?.value ?? 0);
  const ticks = niceTicks(max);
  const scaleMax = ticks[ticks.length - 1];
  const x = (v: number) => labelW + (v / scaleMax) * plotW;
  const h = data.length * height + 18;
  return (
    <svg viewBox={`0 0 ${width} ${h}`} className="w-full" role="img" aria-label={data.map((d) => `${d.label}: ${format(d.value)}`).join('; ')}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={0} y2={h - 16} stroke="var(--v-grid)" strokeWidth={0.6} />
          <text x={x(t)} y={h - 4} textAnchor="middle" fontSize={10} fill="var(--v-muted)" className="num">
            {format(t)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const y = i * height + 3;
        const isHi = highlight === d.label;
        return (
          <g key={d.label + i}>
            <text x={labelW - 8} y={y + height / 2} dominantBaseline="middle" textAnchor="end" fontSize={11} fill="var(--v-ink)">
              {d.label.length > 24 ? d.label.slice(0, 23) + '…' : d.label}
              <title>{d.label}</title>
            </text>
            {d.secondary !== undefined && (
              <rect x={labelW} y={y + 2} width={Math.max(0, x(d.secondary) - labelW)} height={height - 8} fill={tint('teal')} opacity={0.55} />
            )}
            <rect
              x={labelW}
              y={y + (d.secondary !== undefined ? 6 : 2)}
              width={Math.max(0, x(d.value) - labelW)}
              height={d.secondary !== undefined ? height - 16 : height - 8}
              fill={isHi ? tone('terracotta') : d.secondary !== undefined ? tone('teal') : tint('teal')}
            />
            <text x={Math.max(x(d.value), d.secondary !== undefined ? x(d.secondary) : 0) + 6} y={y + height / 2} dominantBaseline="middle" fontSize={11} fill="var(--v-ink)" className="num">
              {format(d.value)}
            </text>
          </g>
        );
      })}
      {reference && (
        <g>
          <line x1={x(reference.value)} x2={x(reference.value)} y1={0} y2={h - 16} stroke={tone('ochre')} strokeWidth={0.9} strokeDasharray="1 3" />
          <text x={x(reference.value) + 3} y={9} fontSize={10} fill="var(--v-muted)">
            {reference.label}
          </text>
        </g>
      )}
      <line x1={labelW} x2={width - valueW} y1={h - 16} y2={h - 16} stroke="var(--v-grid)" strokeWidth={0.8} />
    </svg>
  );
}

/** Stacked or grouped columns over categories (e.g. years, periods). */
export function ColumnChart({
  categories,
  series,
  stacked = true,
  format = compactNumber,
}: {
  categories: string[];
  series: { name: string; values: number[]; color?: Family }[];
  stacked?: boolean;
  format?: (n: number) => string;
}) {
  const width = 560;
  const height = 220;
  const left = 46;
  const bottom = 22;
  const top = 8;
  const plotH = height - bottom - top;
  const plotW = width - left - 90;
  const totals = categories.map((_, i) => (stacked ? series.reduce((s, x) => s + (x.values[i] ?? 0), 0) : Math.max(0, ...series.map((x) => x.values[i] ?? 0))));
  const ticks = niceTicks(Math.max(1, ...totals));
  const max = ticks[ticks.length - 1];
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const slot = plotW / Math.max(1, categories.length);
  const barW = slot * 0.6;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={`Chart of ${series.map((s) => s.name).join(', ')}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} stroke="var(--v-grid)" strokeWidth={0.6} />
          <text x={left - 6} y={y(t)} dominantBaseline="middle" textAnchor="end" fontSize={10} fill="var(--v-muted)" className="num">
            {format(t)}
          </text>
        </g>
      ))}
      {categories.map((c, i) => {
        const x0 = left + i * slot + (slot - barW) / 2;
        let acc = 0;
        return (
          <g key={c}>
            {series.map((s, si) => {
              const v = s.values[i] ?? 0;
              const color = tone(s.color ?? SLOT[si % 6]);
              if (stacked) {
                const r = <rect key={s.name} x={x0} y={y(acc + v)} width={barW} height={Math.max(0, y(acc) - y(acc + v) - (si < series.length - 1 ? 1.2 : 0))} fill={color} />;
                acc += v;
                return r;
              }
              const w = barW / series.length;
              return <rect key={s.name} x={x0 + si * w} y={y(v)} width={w - 1.2} height={Math.max(0, y(0) - y(v))} fill={color} />;
            })}
            <text x={x0 + barW / 2} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--v-muted)">
              {c}
            </text>
          </g>
        );
      })}
      <line x1={left} x2={left + plotW} y1={y(0)} y2={y(0)} stroke="var(--v-grid)" strokeWidth={0.8} />
      {series.length <= 6 &&
        series.map((s, si) => {
          // direct labels at the right end of the last column (stacked) or legend list
          const last = categories.length - 1;
          const before = stacked ? series.slice(0, si).reduce((a, x) => a + (x.values[last] ?? 0), 0) : 0;
          const mid = stacked ? y(before + (s.values[last] ?? 0) / 2) : top + 12 + si * 14;
          return (
            <text key={s.name} x={left + plotW + 8} y={mid} dominantBaseline="middle" fontSize={10.5} fill="var(--v-ink)">
              <tspan fill={tone(s.color ?? SLOT[si % 6])}>■ </tspan>
              {s.name}
            </text>
          );
        })}
    </svg>
  );
}

/** Line chart over ordered x labels, with ringed end dots and direct labels. */
export function LineChart({
  labels,
  series,
  format = compactNumber,
  reference,
}: {
  labels: string[];
  series: { name: string; values: (number | null)[]; color?: Family; dashed?: boolean }[];
  format?: (n: number) => string;
  reference?: { value: number; label: string };
}) {
  const width = 560;
  const height = 220;
  const left = 46;
  const right = 110;
  const top = 10;
  const bottom = 22;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const ticks = niceTicks(Math.max(1, ...all, reference?.value ?? 0));
  const max = ticks[ticks.length - 1];
  const x = (i: number) => left + (labels.length <= 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const step = Math.max(1, Math.ceil(labels.length / 8));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={series.map((s) => s.name).join(', ')}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} stroke="var(--v-grid)" strokeWidth={0.6} />
          <text x={left - 6} y={y(t)} dominantBaseline="middle" textAnchor="end" fontSize={10} fill="var(--v-muted)" className="num">
            {format(t)}
          </text>
        </g>
      ))}
      {labels.map((l, i) =>
        i % step === 0 || i === labels.length - 1 ? (
          <text key={l + i} x={x(i)} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--v-muted)">
            {l}
          </text>
        ) : null,
      )}
      {reference && (
        <g>
          <line x1={left} x2={left + plotW} y1={y(reference.value)} y2={y(reference.value)} stroke={tone('ochre')} strokeWidth={0.9} strokeDasharray="1 3" />
          <text x={left + plotW + 6} y={y(reference.value)} dominantBaseline="middle" fontSize={10} fill="var(--v-muted)">
            {reference.label}
          </text>
        </g>
      )}
      {series.map((s, si) => {
        const color = tone(s.color ?? SLOT[si % 6]);
        const pts = s.values.map((v, i) => (v == null ? null : ([x(i), y(v)] as const))).filter(Boolean) as [number, number][];
        if (!pts.length) return null;
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
        const lastIdx = s.values.map((v, i) => (v == null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
        const last = pts[pts.length - 1];
        return (
          <g key={s.name}>
            <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={s.dashed ? '4 4' : undefined} />
            <circle cx={last[0]} cy={last[1]} r={3.5} fill={color} stroke="var(--v-surface)" strokeWidth={1.6} />
            <text x={last[0] + 8} y={last[1]} dominantBaseline="middle" fontSize={10.5} fill="var(--v-ink)">
              {s.name} <tspan className="num">{format(s.values[lastIdx] ?? 0)}</tspan>
            </text>
          </g>
        );
      })}
      <line x1={left} x2={left + plotW} y1={y(0)} y2={y(0)} stroke="var(--v-grid)" strokeWidth={0.8} />
    </svg>
  );
}

/** A single progress meter with planned marker. */
export function Meter({ value, planned, label }: { value: number; planned?: number | null; label?: string }) {
  const id = useId();
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2" aria-describedby={id}>
      <div className="relative h-2 flex-1 rounded-full bg-grid" role="meter" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? 'Progress'}>
        <div className="h-2 rounded-full bg-teal" style={{ width: `${v}%` }} />
        {planned != null && (
          <div className="absolute top-[-3px] h-[14px] w-[2px] bg-ochre" style={{ left: `calc(${Math.max(0, Math.min(100, planned))}% - 1px)` }} title={`Planned ${Math.round(planned)} %`} />
        )}
      </div>
      <span id={id} className="num w-12 text-right text-xs">
        {Math.round(v)} %
      </span>
    </div>
  );
}

/** Stat tile: one number with a short label. */
export function StatTile({ label, value, note, tone: t }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'critical' | 'serious' | 'good' }) {
  return (
    <div className="border-l-2 border-teal bg-card px-3 py-2">
      <p className="text-xs text-secondary">{label}</p>
      <p className={`num text-2xl leading-tight ${t === 'critical' ? 'text-critical' : t === 'serious' ? 'text-serious' : t === 'good' ? 'text-good' : 'text-ink'}`}>{value}</p>
      {note && <p className="text-xs text-secondary">{note}</p>}
    </div>
  );
}

export function useChartColors(n: number): Family[] {
  return useMemo(() => Array.from({ length: n }, (_, i) => SLOT[i % 6]), [n]);
}
