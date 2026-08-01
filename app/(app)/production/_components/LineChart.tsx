"use client";

import { CHART_AXIS_LABEL, CHART_GRID, CHART_LABEL } from "@/lib/shared/chart";

export type Series = {
  name: string;
  color: string;
  axis?: "L" | "R"; // แกนซ้าย (default) หรือขวา
  values: (number | null)[];
};

/** กราฟเส้นหลายชุด + 2 แกน (SVG ล้วน ไม่พึ่ง lib) */
export function LineChart({
  labels,
  series,
  height = 240,
  xLabel = "",
}: {
  labels: string[];
  series: Series[];
  height?: number;
  xLabel?: string;
}) {
  const W = 640;
  const H = height;
  const padL = 44;
  const padR = 44;
  const padT = 16;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = labels.length;

  const nums = (arr: (number | null)[]) => arr.filter((v): v is number => v != null && !isNaN(v));
  const rangeFor = (axis: "L" | "R") => {
    const vals = series.filter((s) => (s.axis ?? "L") === axis).flatMap((s) => nums(s.values));
    if (vals.length === 0) return null;
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.1;
    return { min: min - pad, max: max + pad };
  };
  const L = rangeFor("L");
  const R = rangeFor("R");

  const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const yOn = (v: number, r: { min: number; max: number }) =>
    padT + plotH * (1 - (v - r.min) / (r.max - r.min));

  function pathFor(s: Series) {
    const r = (s.axis ?? "L") === "R" ? R : L;
    if (!r) return [];
    // แตกเป็น segment ข้าม null
    const segs: string[] = [];
    let cur: string[] = [];
    s.values.forEach((v, i) => {
      if (v == null || isNaN(v)) { if (cur.length) { segs.push(cur.join(" ")); cur = []; } return; }
      cur.push(`${cur.length ? "L" : "M"}${x(i).toFixed(1)},${yOn(v, r).toFixed(1)}`);
    });
    if (cur.length) segs.push(cur.join(" "));
    return segs;
  }

  const grid = [0, 0.25, 0.5, 0.75, 1];
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
  // แสดง label แกน x ไม่เกิน ~8 ตัว
  const step = Math.max(1, Math.ceil(n / 8));

  if (n === 0) {
    return <p className="py-6 text-center text-sm text-faint">ยังไม่มีข้อมูลพอวาดกราฟ</p>;
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-3 text-xs">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1 text-muted">
            <span className="inline-block h-2 w-4 rounded" style={{ background: s.color }} />
            {s.name}
            <span className="text-faint">({(s.axis ?? "L") === "R" ? "ขวา" : "ซ้าย"})</span>
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
        {/* grid + แกนซ้าย/ขวา label */}
        {grid.map((g) => {
          const y = padT + plotH * g;
          return (
            <g key={g}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={CHART_GRID} strokeWidth={1} />
              {L && (
                <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={9} fill={CHART_LABEL}>
                  {fmt(L.max - (L.max - L.min) * g)}
                </text>
              )}
              {R && (
                <text x={W - padR + 6} y={y + 3} textAnchor="start" fontSize={9} fill={CHART_LABEL}>
                  {fmt(R.max - (R.max - R.min) * g)}
                </text>
              )}
            </g>
          );
        })}
        {/* x labels */}
        {labels.map((lb, i) =>
          i % step === 0 ? (
            <text key={i} x={x(i)} y={H - padB + 14} textAnchor="middle" fontSize={9} fill={CHART_LABEL}>
              {lb}
            </text>
          ) : null,
        )}
        {xLabel && (
          <text x={padL + plotW / 2} y={H - 2} textAnchor="middle" fontSize={9} fill={CHART_AXIS_LABEL}>
            {xLabel}
          </text>
        )}
        {/* เส้นแต่ละชุด + จุด */}
        {series.map((s) => {
          const r = (s.axis ?? "L") === "R" ? R : L;
          return (
            <g key={s.name}>
              {pathFor(s).map((d, k) => (
                <path key={k} d={d} fill="none" stroke={s.color} strokeWidth={1.8} />
              ))}
              {r &&
                s.values.map((v, i) =>
                  v == null || isNaN(v) ? null : (
                    <circle key={i} cx={x(i)} cy={yOn(v, r)} r={2.2} fill={s.color} />
                  ),
                )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
