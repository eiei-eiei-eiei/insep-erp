import type { PayLineItem } from "./types";

/**
 * lib/payroll/slip — สลิปเงินเดือน (HTML → หน้าต่างพิมพ์)
 *
 * ★ จงใจ **ไม่** ไปใช้ `app/(app)/sales/_components/print.ts` ร่วมกัน:
 *   ไฟล์นั้นคุมหน้าตาใบกำกับภาษี/ใบเสร็จที่ลูกค้าเทียบกับของเดิมทีละบรรทัดมาแล้ว
 *   แตะเพื่อ "ใช้ร่วมกัน" = เสี่ยงทำเอกสารการค้าขยับโดยไม่ได้ตั้งใจ ซึ่งแลกไม่คุ้ม
 *
 * 🚨 ดำบนขาวเสมอ ห้ามผูกกับ token ธีมของแอป (บทเรียน D43): เปิดโหมดมืดแล้วสั่งพิมพ์
 *    จะได้กระดาษพื้นดำ
 */

export type SlipData = {
  companyName: string;
  companyAddress?: string;
  periodLabel: string;   // "05/2026"
  payDate?: string;
  empName: string;
  empId: string;
  groupLabel?: string;
  baseLabel: string;     // "เงินเดือน (28 วัน)"
  baseAmount: number;
  items: PayLineItem[];
  sso: number;
  wht: number;
  gross: number;
  net: number;
};

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SLIP_CSS = `
  * { box-sizing: border-box; }
  body { font-family: "Sarabun","TH Sarabun New",sans-serif; margin: 0; padding: 0;
         color: #000; background: #fff; font-size: 14px; }
  .slip { width: 190mm; margin: 0 auto 8mm; padding: 8mm; border-bottom: 1px dashed #999; }
  .slip:last-child { border-bottom: none; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .muted { color: #444; font-size: 12px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #000; padding-bottom: 4px; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; vertical-align: top; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .sec td { border-top: 1px solid #000; font-weight: 700; }
  .total td { border-top: 2px solid #000; border-bottom: 3px double #000;
              font-weight: 700; font-size: 16px; }
  .sign { margin-top: 14mm; display: flex; justify-content: space-between; }
  .sign div { width: 45%; text-align: center; border-top: 1px dotted #000; padding-top: 3px; font-size: 12px; }
  @page { size: A4; margin: 8mm; }
  @media print { .slip { page-break-after: always; } .slip:last-child { page-break-after: auto; } }
`;

/** สลิป 1 ใบ */
export function slipHtml(d: SlipData): string {
  const earn = d.items.filter((i) => i.kind === "earning");
  const ded = d.items.filter((i) => i.kind === "deduction");
  const row = (label: string, amount: number, cls = "") =>
    `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${money(amount)}</td></tr>`;

  return `
  <div class="slip">
    <div class="head">
      <div>
        <h1>${esc(d.companyName)}</h1>
        ${d.companyAddress ? `<div class="muted">${esc(d.companyAddress)}</div>` : ""}
      </div>
      <div style="text-align:right">
        <div style="font-weight:700">ใบแจ้งเงินเดือน</div>
        <div class="muted">งวด ${esc(d.periodLabel)}</div>
        ${d.payDate ? `<div class="muted">จ่ายวันที่ ${esc(d.payDate)}</div>` : ""}
      </div>
    </div>

    <table>
      <tr>
        <td><b>${esc(d.empName)}</b> <span class="muted">(${esc(d.empId)})</span></td>
        <td class="num muted">${esc(d.groupLabel ?? "")}</td>
      </tr>
    </table>

    <table style="margin-top:8px">
      ${row(d.baseLabel, d.baseAmount)}
      ${earn.map((i) => row(i.name, i.amount)).join("")}
      <tr class="sec"><td>รวมเงินได้</td><td class="num">${money(d.gross)}</td></tr>
      ${d.sso ? row("หัก ประกันสังคม", -d.sso) : ""}
      ${d.wht ? row("หัก ภาษี ณ ที่จ่าย", -d.wht) : ""}
      ${ded.map((i) => row("หัก " + i.name, -i.amount)).join("")}
      <tr class="total"><td>ยอดเงินสุทธิ</td><td class="num">${money(d.net)}</td></tr>
    </table>

    <div class="sign">
      <div>ผู้รับเงิน</div>
      <div>ผู้จ่ายเงิน</div>
    </div>
  </div>`;
}

/** เปิดหน้าต่างพิมพ์สลิปหลายใบ (1 ใบ = 1 หน้า) */
export function printSlips(slips: SlipData[]): void {
  const w = window.open("", "_blank", "width=900,height=1200");
  if (!w) {
    alert("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — โปรดอนุญาต popup แล้วลองใหม่");
    return;
  }
  w.document.open();
  w.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>สลิปเงินเดือน</title>` +
      `<style>${SLIP_CSS}</style></head><body>${slips.map(slipHtml).join("")}</body></html>`,
  );
  w.document.close();
  // รอฟอนต์โหลดก่อนสั่งพิมพ์ ไม่งั้นความสูงบรรทัดเพี้ยนตอนวัดหน้า
  setTimeout(() => {
    const fonts = (w.document as Document & { fonts?: FontFaceSet }).fonts;
    const go = () => { w.focus(); w.print(); };
    if (fonts?.ready) fonts.ready.then(go).catch(go);
    else go();
  }, 150);
}

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
