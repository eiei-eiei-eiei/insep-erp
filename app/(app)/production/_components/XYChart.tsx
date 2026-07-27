"use client";

export type XYSeries = {
  name: string;
  color: string;
  axis?: "L" | "R";
  points: { x: number; y: number | null }[];
};

/** กราฟเส้น overlay หลายชุด แกน x เป็นตัวเลข (สำหรับเทียบหลาย batch) — SVG ล้วน */
export function XYChart({
  series,
  height = 260,
  xLabel = "",
}: {
  series: XYSeries[];
  height?: number;
  xLabel?: string;
}) {
  const W = 640;
  const H = height;
  const padL = 46, padR = 46, padT = 14, padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const allX = series.flatMap((s) => s.points.map((p) => p.x)).filter((v) => !isNaN(v));
  if (allX.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-400">ยังไม่มีข้อมูลพอวาดกราฟ</p>;
  }
  let xMin = Math.min(...allX), xMax = Math.max(...allX);
  if (xMin === xMax) { xMin -= 1; xMax += 1; }

  const yRange = (axis: "L" | "R") => {
    const ys = series
      .filter((s) => (s.axis ?? "L") === axis)
      .flatMap((s) => s.points.map((p) => p.y))
      .filter((v): v is number => v != null && !isNaN(v));
    if (ys.length === 0) return null;
    let min = Math.min(...ys), max = Math.max(...ys);
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.1;
    return { min: min - pad, max: max + pad };
  };
  const L = yRange("L"), R = yRange("R");

  const px = (x: number) => padL + (plotW * (x - xMin)) / (xMax - xMin);
  const py = (y: number, r: { min: number; max: number }) =>
    padT + plotH * (1 - (y - r.min) / (r.max - r.min));

  function path(s: XYSeries) {
    const r = (s.axis ?? "L") === "R" ? R : L;
    if (!r) return "";
    const pts = s.points.filter((p) => p.y != null && !isNaN(p.y)).sort((a, b) => a.x - b.x);
    return pts.map((p, i) => `${i ? "L" : "M"}${px(p.x).toFixed(1)},${py(p.y as number, r).toFixed(1)}`).join(" ");
  }

  const grid = [0, 0.25, 0.5, 0.75, 1];
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
  const xticks = [0, 0.5, 1].map((f) => xMin + (xMax - xMin) * f);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1 text-slate-600">
            <span className="inline-block h-2 w-4 rounded" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
        {grid.map((g) => {
          const y = padT + plotH * g;
          return (
            <g key={g}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              {L && <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#94a3b8">{fmt(L.max - (L.max - L.min) * g)}</text>}
              {R && <text x={W - padR + 6} y={y + 3} textAnchor="start" fontSize={9} fill="#94a3b8">{fmt(R.max - (R.max - R.min) * g)}</text>}
            </g>
          );
        })}
        {xticks.map((xv, i) => (
          <text key={i} x={px(xv)} y={H - padB + 14} textAnchor="middle" fontSize={9} fill="#94a3b8">{fmt(xv)}</text>
        ))}
        {xLabel && <text x={padL + plotW / 2} y={H - 2} textAnchor="middle" fontSize={9} fill="#64748b">{xLabel}</text>}
        {series.map((s) => {
          const r = (s.axis ?? "L") === "R" ? R : L;
          const d = path(s);
          return (
            <g key={s.name}>
              {d && <path d={d} fill="none" stroke={s.color} strokeWidth={1.8} />}
              {r && s.points.filter((p) => p.y != null && !isNaN(p.y)).map((p, i) => (
                <circle key={i} cx={px(p.x)} cy={py(p.y as number, r)} r={2} fill={s.color} />
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
