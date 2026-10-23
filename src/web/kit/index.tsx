// @life/kit: the only building blocks widgets use (D5). Material 3 (Expressive) components
// on the dashboard's color, type, shape and motion tokens, plus hooks for custom.db.
// Widgets import from "@life/kit" and "react"; nothing else.

import { type CSSProperties, type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { cmd, onLife } from "../api";
import { desktop } from "../desktop";

// ---------- data: custom.db (D8) ----------

type Params = unknown[] | Record<string, unknown>;

/** Reads rows from custom.db. Read-only; use exec() to change data. */
export function query<T = Record<string, any>>(sql: string, params?: Params): Promise<T[]> {
  return cmd<T[]>("db.query", { sql, params });
}

/** Changes custom.db (INSERT, UPDATE, DELETE, CREATE TABLE…). Every useQuery refreshes after. */
export function exec(sql: string, params?: Params): Promise<{ changes: number; lastInsertRowid: number }> {
  return cmd("db.exec", { sql, params });
}

/** Rows from custom.db, kept fresh: re-runs whenever data changes anywhere (UI, CLI or agent). */
export function useQuery<T = Record<string, any>>(sql: string, params?: Params): { rows: T[]; loading: boolean; error: string | null; refresh: () => void } {
  const [state, setState] = useState<{ rows: T[]; loading: boolean; error: string | null }>({ rows: [], loading: true, error: null });
  const key = JSON.stringify([sql, params ?? null]);
  const refresh = useCallback(() => {
    query<T>(sql, params).then(
      (rows) => setState({ rows, loading: false, error: null }),
      (e) => setState((s) => ({ ...s, loading: false, error: e.message })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    refresh();
    return onLife((e) => e.type === "data" && refresh());
  }, [refresh]);
  return { ...state, refresh };
}

/** A notification: native in the Mac app; in a browser only over HTTPS and if the user allows it.
 * It shows while the dashboard is open somewhere, e.g. the Mac app running in the menu bar. */
export function notify(title: string, body = ""): void {
  if (desktop) return desktop.notify(title, body);
  if (typeof Notification === "undefined" || !isSecureContext) return;
  if (Notification.permission === "granted") new Notification(title, { body });
  else if (Notification.permission === "default") Notification.requestPermission().then((p) => p === "granted" && new Notification(title, { body }));
}

/** Today's date in the user's time zone, as "YYYY-MM-DD" (the format to store dates in). */
export function today(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return dayKey(d);
}

/** A Date as "YYYY-MM-DD" in the user's time zone. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Formats numbers, money and dates for the user's locale. */
export const format = {
  number: (n: number, digits = 0) => n.toLocaleString(undefined, { maximumFractionDigits: digits }),
  money: (n: number, currency = "USD") => n.toLocaleString(undefined, { style: "currency", currency }),
  date: (d: string | Date, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) =>
    (typeof d === "string" ? new Date(d.length === 10 ? d + "T00:00" : d) : d).toLocaleDateString(undefined, opts),
  time: (d: string | Date) => (typeof d === "string" ? new Date(d) : d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
};

// ---------- layout ----------

type Box = { children?: ReactNode; style?: CSSProperties; className?: string };

/** A vertical stack. gap is in px (default 12). */
export function Stack({ gap = 12, align, children, style, className }: Box & { gap?: number; align?: CSSProperties["alignItems"] }) {
  return <div className={cx("k-stack", className)} style={{ gap, alignItems: align, ...style }}>{children}</div>;
}

/** A horizontal row. gap in px (default 8); wrap to let items flow onto new lines. */
export function Row({ gap = 8, align = "center", justify, wrap, children, style, className }: Box & { gap?: number; align?: CSSProperties["alignItems"]; justify?: CSSProperties["justifyContent"]; wrap?: boolean }) {
  return <div className={cx("k-row", className)} style={{ gap, alignItems: align, justifyContent: justify, flexWrap: wrap ? "wrap" : undefined, ...style }}>{children}</div>;
}

/** A responsive grid of equal columns, at least `min` px wide each (default 140). */
export function Grid({ min = 140, gap = 12, children, style, className }: Box & { min?: number; gap?: number }) {
  return <div className={cx("k-grid", className)} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${min}px), 1fr))`, gap, ...style }}>{children}</div>;
}

/** Pushes what follows to the end of a Row. */
export function Spacer() {
  return <div style={{ flex: 1 }} />;
}

export function Divider({ inset = false }: { inset?: boolean }) {
  return <hr className={cx("k-divider", inset && "inset")} />;
}

// ---------- text and icons ----------

export type TextVariant =
  | "display-large" | "display-medium" | "display-small"
  | "headline-large" | "headline-medium" | "headline-small"
  | "title-large" | "title-medium" | "title-small"
  | "body-large" | "body-medium" | "body-small"
  | "label-large" | "label-medium" | "label-small";

/** A color role, e.g. "primary", "on-surface-variant", "error", "tertiary". */
export type ColorRole = string;
const role = (c?: ColorRole) => (c ? `var(--md-sys-color-${c})` : undefined);

/** Text on the Material type scale. color is a color role ("primary", "on-surface-variant"…). */
export function Text({ variant = "body-medium", color, as = "div", children, style, className }: Box & { variant?: TextVariant; color?: ColorRole; as?: "div" | "span" | "p" | "h2" | "h3" }) {
  const Tag = as;
  return <Tag className={cx(`t-${variant}`, "k-text", className)} style={{ color: role(color), ...style }}>{children}</Tag>;
}

/** A Material Symbols icon by name, e.g. "water_drop", "check_circle", "payments". */
export function Icon({ name, size = 24, fill = false, color, style }: { name: string; size?: number; fill?: boolean; color?: ColorRole; style?: CSSProperties }) {
  return (
    <span className="k-icon" aria-hidden style={{ fontSize: size, color: role(color), fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'opsz' ${Math.min(48, Math.max(20, size))}`, ...style }}>
      {name}
    </span>
  );
}

// ---------- actions ----------

type ButtonProps = {
  children?: ReactNode;
  variant?: "filled" | "tonal" | "outlined" | "text" | "elevated";
  size?: "xs" | "s" | "m";
  icon?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  style?: CSSProperties;
};

/** A Material 3 button. Round, and its corners morph square-ish when pressed. */
export function Button({ children, variant = "filled", size = "s", icon, onClick, disabled, type = "button", style }: ButtonProps) {
  return (
    <button type={type} className={cx("k-button", variant, `size-${size}`)} onClick={onClick} disabled={disabled} style={style}>
      {icon && <Icon name={icon} size={size === "m" ? 24 : 20} />}
      {children}
    </button>
  );
}

/** A round icon-only button. label is read by screen readers and shown on hover. */
export function IconButton({ icon, label, onClick, variant = "standard", selected, disabled, size = 40 }: { icon: string; label: string; onClick?: () => void; variant?: "standard" | "filled" | "tonal" | "outlined"; selected?: boolean; disabled?: boolean; size?: number }) {
  return (
    <button type="button" className={cx("k-icon-button", variant, selected && "selected")} aria-label={label} title={label} aria-pressed={selected} onClick={onClick} disabled={disabled} style={{ width: size, height: size }}>
      <Icon name={icon} size={Math.round(size * 0.6)} fill={selected} />
    </button>
  );
}

/** A compact choice: filter chips (selected/onClick) or assist chips (icon/onClick). */
export function Chip({ label, icon, selected, onClick, disabled }: { label: string; icon?: string; selected?: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={cx("k-chip", selected && "selected")} onClick={onClick} disabled={disabled} aria-pressed={selected}>
      {selected ? <Icon name="check" size={18} /> : icon ? <Icon name={icon} size={18} /> : null}
      {label}
    </button>
  );
}

/** A connected button group to pick one option, e.g. Day / Week / Month. */
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string; icon?: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="k-segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={cx(o.value === value && "selected")} onClick={() => onChange(o.value)}>
          {o.value === value ? <Icon name="check" size={18} /> : o.icon ? <Icon name={o.icon} size={18} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- inputs ----------

/** A filled text field with a floating label. onChange gets the new string. */
export function TextField({ label, value, onChange, type = "text", placeholder, supporting, error, multiline, onEnter, autoFocus, style }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "number" | "date" | "time" | "email" | "password" | "url";
  placeholder?: string;
  supporting?: string;
  error?: string;
  multiline?: boolean;
  onEnter?: () => void;
  autoFocus?: boolean;
  style?: CSSProperties;
}) {
  const id = useId();
  const props = {
    id,
    value,
    placeholder: placeholder ?? " ",
    autoFocus,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && onEnter && !(multiline && e.shiftKey)) {
        e.preventDefault();
        onEnter();
      }
    },
  };
  return (
    <div className={cx("k-field", error && "error", (type === "date" || type === "time" || value !== "") && "filled")} style={style}>
      <div className="box">
        {multiline ? <textarea rows={3} {...props} /> : <input type={type} inputMode={type === "number" ? "decimal" : undefined} {...props} />}
        <label htmlFor={id}>{label}</label>
      </div>
      {(error || supporting) && <div className="support t-body-small">{error ?? supporting}</div>}
    </div>
  );
}

/** A dropdown in the text field's style. */
export function Select({ label, value, options, onChange, style }: { label: string; value: string; options: (string | { value: string; label: string })[]; onChange: (v: string) => void; style?: CSSProperties }) {
  const id = useId();
  return (
    <div className="k-field filled select" style={style}>
      <div className="box">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
        <label htmlFor={id}>{label}</label>
        <Icon name="arrow_drop_down" style={{ position: "absolute", right: 12, top: 16, pointerEvents: "none" }} />
      </div>
    </div>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx("k-check", disabled && "disabled")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="mark" aria-hidden>
        <Icon name="check" size={16} />
      </span>
      {label !== undefined && <span className="t-body-large">{label}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx("k-switch", disabled && "disabled")}>
      {label !== undefined && <span className="t-body-large">{label}</span>}
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
        <span className="handle">{checked && <Icon name="check" size={16} />}</span>
      </button>
    </label>
  );
}

export function Slider({ value, onChange, min = 0, max = 100, step = 1, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label?: string }) {
  return (
    <label className="k-slider">
      {label && <span className="t-label-large">{label}</span>}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ["--p" as any]: `${((value - min) / (max - min || 1)) * 100}%` }} />
    </label>
  );
}

// ---------- containers and content ----------

/** A card inside a widget. The dashboard already puts each widget in a card; use this for sections. */
export function Card({ variant = "filled", children, onClick, style, className }: Box & { variant?: "filled" | "elevated" | "outlined"; onClick?: () => void }) {
  return (
    <div className={cx("k-card", variant, onClick && "clickable", className)} onClick={onClick} style={style}>
      {children}
    </div>
  );
}

export function List({ children }: { children?: ReactNode }) {
  return <div className="k-list" role="list">{children}</div>;
}

/** One row of a List. leading/trailing take an icon name or any element. */
export function ListItem({ headline, supporting, leading, trailing, onClick }: { headline: ReactNode; supporting?: ReactNode; leading?: string | ReactNode; trailing?: string | ReactNode; onClick?: () => void }) {
  const slot = (x: string | ReactNode) => (typeof x === "string" ? <Icon name={x} color="on-surface-variant" /> : x);
  return (
    <div className={cx("k-list-item", onClick && "clickable")} role="listitem" onClick={onClick}>
      {leading !== undefined && <div className="lead">{slot(leading)}</div>}
      <div className="body">
        <div className="t-body-large">{headline}</div>
        {supporting !== undefined && <div className="t-body-medium" style={{ color: "var(--md-sys-color-on-surface-variant)" }}>{supporting}</div>}
      </div>
      {trailing !== undefined && <div className="trail">{slot(trailing)}</div>}
    </div>
  );
}

/** One number that matters: a big value with a label, unit, optional icon and change. */
export function Stat({ label, value, unit, icon, delta, deltaGood = "up" }: { label: string; value: ReactNode; unit?: string; icon?: string; delta?: number; deltaGood?: "up" | "down" }) {
  const good = delta === undefined ? null : deltaGood === "up" ? delta >= 0 : delta <= 0;
  return (
    <div className="k-stat">
      <Row gap={8}>
        {icon && <Icon name={icon} size={20} color="primary" fill />}
        <Text variant="label-large" color="on-surface-variant">{label}</Text>
      </Row>
      <Row gap={6} align="baseline">
        <Text variant="display-small">{value}</Text>
        {unit && <Text variant="title-medium" color="on-surface-variant">{unit}</Text>}
      </Row>
      {delta !== undefined && (
        <span className={cx("k-delta", good ? "good" : "bad")}>
          <Icon name={delta >= 0 ? "trending_up" : "trending_down"} size={16} />
          {delta >= 0 ? "+" : ""}
          {format.number(delta, 1)}
        </span>
      )}
    </div>
  );
}

/** Progress: value from 0 to 1, or leave it out for "working…". Linear or circular. */
export function Progress({ value, variant = "linear", size = 48 }: { value?: number; variant?: "linear" | "circular"; size?: number }) {
  const v = value === undefined ? undefined : Math.max(0, Math.min(1, value));
  if (variant === "circular") {
    const r = 20;
    const c = 2 * Math.PI * r;
    return (
      <svg className={cx("k-circular", v === undefined && "indeterminate")} width={size} height={size} viewBox="0 0 48 48" role="progressbar" aria-valuenow={v === undefined ? undefined : Math.round(v * 100)}>
        <circle cx="24" cy="24" r={r} className="track" />
        <circle cx="24" cy="24" r={r} className="bar" strokeDasharray={c} strokeDashoffset={v === undefined ? c * 0.7 : c * (1 - v)} />
      </svg>
    );
  }
  return (
    <div className={cx("k-linear", v === undefined && "indeterminate")} role="progressbar" aria-valuenow={v === undefined ? undefined : Math.round(v * 100)}>
      <div className="bar" style={{ width: v === undefined ? undefined : `${v * 100}%` }} />
      <div className="track" />
    </div>
  );
}

/** The Material 3 Expressive loading indicator: a shape that morphs while it turns. */
export function Loading({ size = 48 }: { size?: number }) {
  return <span className="k-loading" style={{ width: size, height: size }} role="progressbar" aria-label="Loading" />;
}

/** What to show when there's nothing yet. */
export function Empty({ icon = "inbox", title, body, action }: { icon?: string; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="k-empty">
      <span className="badge"><Icon name={icon} size={28} /></span>
      <Text variant="title-medium">{title}</Text>
      {body && <Text variant="body-medium" color="on-surface-variant">{body}</Text>}
      {action}
    </div>
  );
}

// ---------- charts ----------

type Point = { label: string; value: number };

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(300);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Bars for a handful of values, e.g. the last 7 days. goal draws a dashed line. */
export function BarChart({ data, height = 160, goal, format: fmt = (n: number) => format.number(n, 1) }: { data: Point[]; height?: number; goal?: number; format?: (n: number) => string }) {
  const [ref, w] = useWidth();
  const max = Math.max(goal ?? 0, ...data.map((d) => d.value), 1);
  const plot = height - 24;
  const slot = w / Math.max(1, data.length);
  const bw = Math.max(4, Math.min(40, slot * 0.6));
  return (
    <div ref={ref} className="k-chart">
      <svg width={w} height={height} role="img">
        {data.map((d, i) => {
          const h = (d.value / max) * (plot - 4);
          const x = i * slot + (slot - bw) / 2;
          return (
            <g key={i}>
              <title>{`${d.label}: ${fmt(d.value)}`}</title>
              <rect x={x} y={plot - h} width={bw} height={Math.max(h, 2)} rx={Math.min(bw / 2, 8)} className="bar" />
              <text x={i * slot + slot / 2} y={height - 6} textAnchor="middle" className="axis">{d.label}</text>
            </g>
          );
        })}
        {goal !== undefined && <line x1={0} x2={w} y1={plot - (goal / max) * (plot - 4)} y2={plot - (goal / max) * (plot - 4)} className="goal" />}
      </svg>
    </div>
  );
}

/** A line over time, e.g. weight by day. Labels show at the ends. */
export function LineChart({ data, height = 160, format: fmt = (n: number) => format.number(n, 1) }: { data: Point[]; height?: number; format?: (n: number) => string }) {
  const [ref, w] = useWidth();
  if (!data.length) return <div ref={ref} className="k-chart" style={{ height }} />;
  const vals = data.map((d) => d.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.1 || 1;
  const plot = height - 24;
  const x = (i: number) => (data.length === 1 ? w / 2 : 8 + (i / (data.length - 1)) * (w - 16));
  const y = (v: number) => 8 + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (plot - 16);
  const path = data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.value)}`).join(" ");
  const last = data[data.length - 1]!;
  return (
    <div ref={ref} className="k-chart">
      <svg width={w} height={height} role="img">
        <path d={`${path} L${x(data.length - 1)},${plot} L${x(0)},${plot} Z`} className="area" />
        <path d={path} className="line" />
        <circle cx={x(data.length - 1)} cy={y(last.value)} r={5} className="dot">
          <title>{`${last.label}: ${fmt(last.value)}`}</title>
        </circle>
        <text x={x(0)} y={height - 6} textAnchor="start" className="axis">{data[0]!.label}</text>
        {data.length > 1 && <text x={x(data.length - 1)} y={height - 6} textAnchor="end" className="axis">{last.label}</text>}
      </svg>
    </div>
  );
}

function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
