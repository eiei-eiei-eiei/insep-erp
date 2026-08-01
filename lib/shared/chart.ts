/**
 * สีสำหรับกราฟ (D43) — อ้าง CSS variable เพื่อให้เปลี่ยนตามโหมดสว่าง/มืดอัตโนมัติ
 *
 * ค่าเป็นสตริง `var(--color-chart-N)` ใส่ลง attribute ของ SVG ได้ตรง ๆ
 * (stroke/fill รับ var() ได้เมื่อ SVG อยู่ใน DOM ปกติ)
 *
 * ★ ชุดนี้แยกจาก "สีแบรนด์" และ "สีสถานะ" โดยตั้งใจ —
 *   กราฟหลายเส้นต้องแยกออกจากกันด้วยตาเปล่า ไม่เกี่ยวกับความหมาย ok/warn/crit
 */

export const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
  "var(--color-chart-7)",
  "var(--color-chart-8)",
] as const;

/** สีเส้นที่ n (วนซ้ำเมื่อเกิน 8 ชุด) */
export function chartColor(i: number): string {
  return CHART_COLORS[i % CHART_COLORS.length];
}

/** สีองค์ประกอบของกราฟ (เส้นตาราง/ตัวอักษรกำกับแกน) */
export const CHART_GRID = "var(--color-grid)";
export const CHART_LABEL = "var(--color-faint)";
export const CHART_AXIS_LABEL = "var(--color-muted)";
