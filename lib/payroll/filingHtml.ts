/**
 * lib/payroll/filingHtml — HTML ของเอกสารยื่นราชการ 3 ฉบับ (ภงด.1 · สปส.1-10 · ภงด.1ก)
 *
 * 🚨 **ดำบนขาวเสมอ ห้ามผูกกับธีมของแอป** (D43 ข้อ 4) — หน้าต่างพิมพ์เป็น `window.open`
 *    ที่เขียน HTML ใหม่ ไม่มี CSS/token ของแอปติดไปด้วย · ใส่ token สีเข้ามาเมื่อไหร่
 *    เปิดโหมดมืดแล้วสั่งพิมพ์จะได้กระดาษพื้นดำ
 *
 * ★ เอกสารพวกนี้เป็น "ใบแนบ/สำเนาเก็บแฟ้ม" ไม่ใช่ฟอร์มราชการที่ต้องตรงพิกัด
 *   (ผู้ใช้กรอกตัวเลขในเว็บราชการเอง) → ไม่มีข้อผูกมัดเรื่องพิกัดแบบฟอร์ม ภส./50ทวิ
 */
import type { Pnd1Result, Sso110Result, Pnd1kResult } from "./filings";

export type FilingEntity = {
  /** ★ ต้องมี — เลขที่ 50ทวิ รันต่อ entity และ RPC ใช้ตัดสินกิจการที่ออกเอกสาร */
  entityId: string;
  name: string;
  taxId?: string | null;
  branch?: string | null;
  address?: string | null;
  /** เลขที่บัญชีนายจ้าง ปกส. — ไม่มีก็ fallback เป็น taxId (เหมือนระบบเดิม) */
  ssoEmployerNo?: string | null;
};

const CSS = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: "TH Sarabun New", "Sarabun", sans-serif; color: #000; background: #fff; margin: 0; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .center { text-align: center; }
  .right { text-align: right; }
  .b { font-weight: 700; }
  .title { font-size: 20px; font-weight: 700; }
  .sub { font-size: 14px; }
  .mt8 { margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #000; padding: 3px 5px; }
  th { background: #eee; }
  table.no-border, table.no-border td { border: 0; padding: 1px 0; }
  tfoot td { font-weight: 700; }
`;

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

/** ตัวเลขเงิน 2 ตำแหน่ง มีคอมมา — 0 ต้องขึ้น "0.00" ไม่ใช่ช่องว่าง (เอกสารยื่นต้องเห็นว่าเป็นศูนย์) */
function money(n: number): string {
  return Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 1234567890123 → 1-2345-67890-12-3 · ไม่ครบ 13 หลักคืนค่าเดิม (ไม่เดารูปแบบ) */
export function formatNationalId(id: string | null | undefined): string {
  const s = String(id ?? "").replace(/\D/g, "");
  if (s.length !== 13) return String(id ?? "");
  return `${s[0]}-${s.slice(1, 5)}-${s.slice(5, 10)}-${s.slice(10, 12)}-${s[12]}`;
}

const TH_MONTH = ["", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

export function thaiMonthYear(month: number, yearBE: number): string {
  return `${TH_MONTH[month] ?? ""} ${yearBE}`;
}

function header(ent: FilingEntity, line2: string, line3?: string): string {
  const branch = ent.branch ? ` (${esc(ent.branch)})` : "";
  return `<div class="center">
    <span class="title">${esc(ent.name)}${branch}</span><br>
    <span class="sub">${line2}</span>
    ${line3 ? `<br><span class="sub">${line3}</span>` : ""}
  </div>`;
}

/** แถวเปล่าเมื่อไม่มีข้อมูล — ต้องบอกว่า "ไม่มีข้อมูล" ไม่ใช่ตารางหัวโล้น */
function emptyRow(cols: number): string {
  return `<tr><td colspan="${cols}" class="center">— ไม่มีข้อมูลในงวดนี้ —</td></tr>`;
}

// ── ภ.ง.ด.1 (ใบแนบ) ──────────────────────────────────────────────────────────
export function pnd1Html(ent: FilingEntity, monthLabel: string, r: Pnd1Result): string {
  const rows = r.rows.map((x) => `<tr>
      <td class="center">${x.seq}</td>
      <td>${esc(x.name)}</td>
      <td class="center">${esc(formatNationalId(x.nationalId))}</td>
      <td class="right">${money(x.income)}</td>
      <td class="right">${money(x.wht)}</td>
    </tr>`).join("");

  return `<div class="page">
    ${header(ent, `ใบแนบ ภ.ง.ด.1 — ภาษีหัก ณ ที่จ่าย เงินเดือน ประจำเดือน ${esc(monthLabel)}`,
      ent.taxId ? `เลขประจำตัวผู้เสียภาษี ${esc(formatNationalId(ent.taxId))}` : undefined)}
    <table class="mt8">
      <thead><tr>
        <th style="width:6%">ที่</th><th>ชื่อ-สกุล</th>
        <th style="width:22%">เลขประจำตัวผู้เสียภาษี</th>
        <th style="width:18%">เงินได้</th><th style="width:18%">ภาษีที่หัก</th>
      </tr></thead>
      <tbody>${rows || emptyRow(5)}</tbody>
      <tfoot><tr>
        <td colspan="3" class="right">รวม</td>
        <td class="right">${money(r.totalIncome)}</td>
        <td class="right">${money(r.totalWht)}</td>
      </tr></tfoot>
    </table>
    <table class="no-border mt8 sub">
      <tr><td>จำนวนผู้มีเงินได้ทั้งหมด: <b>${r.count}</b> ราย
        　|　ในจำนวนนี้ถูกหักภาษี <b>${r.countWithTax}</b> ราย</td></tr>
      <tr><td>ภาษีนำส่งรวม: <b>${money(r.totalWht)}</b> บาท</td></tr>
    </table>
  </div>`;
}

// ── สปส.1-10 ─────────────────────────────────────────────────────────────────
export function sso110Html(ent: FilingEntity, monthLabel: string, r: Sso110Result): string {
  const rows = r.rows.map((x) => `<tr>
      <td class="center">${x.seq}</td>
      <td class="center">${esc(x.ssoRef)}</td>
      <td>${esc(x.name)}</td>
      <td class="right">${money(x.wage)}</td>
      <td class="right">${money(x.sso)}</td>
    </tr>`).join("");

  const empNo = ent.ssoEmployerNo || ent.taxId || "-";
  return `<div class="page">
    ${header(ent, `สปส. 1-10 — แบบรายการแสดงการส่งเงินสมทบ ประจำเดือน ${esc(monthLabel)}`,
      `เลขที่บัญชีนายจ้าง: ${esc(empNo)}`)}
    <table class="mt8">
      <thead><tr>
        <th style="width:6%">ที่</th><th style="width:22%">เลข ปกส./เลขบัตร</th>
        <th>ชื่อ-สกุล</th><th style="width:18%">ค่าจ้าง</th><th style="width:18%">เงินสมทบ</th>
      </tr></thead>
      <tbody>${rows || emptyRow(5)}</tbody>
      <tfoot><tr>
        <td colspan="3" class="right">รวม</td>
        <td class="right">${money(r.totalWage)}</td>
        <td class="right">${money(r.totalEmployee)}</td>
      </tr></tfoot>
    </table>
    <table class="no-border mt8 sub">
      <tr><td>จำนวนผู้ประกันตน: <b>${r.count}</b> คน</td></tr>
      <tr><td>เงินสมทบส่วนลูกจ้าง: <b>${money(r.totalEmployee)}</b> บาท</td></tr>
      <tr><td>เงินสมทบส่วนนายจ้าง: <b>${money(r.totalEmployer)}</b> บาท</td></tr>
      <tr class="b"><td>รวมเงินนำส่งทั้งสิ้น: ${money(r.grandTotal)} บาท</td></tr>
    </table>
  </div>`;
}

// ── ภ.ง.ด.1ก ─────────────────────────────────────────────────────────────────
export function pnd1kHtml(ent: FilingEntity, yearBE: number, r: Pnd1kResult): string {
  const rows = r.rows.map((x) => `<tr>
      <td class="center">${x.seq}</td>
      <td>${esc(x.name)}</td>
      <td class="center">${esc(formatNationalId(x.nationalId))}</td>
      <td class="right">${money(x.income)}</td>
      <td class="right">${money(x.wht)}</td>
    </tr>`).join("");

  return `<div class="page">
    ${header(ent, `ภ.ง.ด.1ก — สรุปการจ่ายเงินได้ 40(1) และภาษีหัก ณ ที่จ่าย ประจำปีภาษี ${yearBE}`,
      ent.taxId ? `เลขประจำตัวผู้เสียภาษี ${esc(formatNationalId(ent.taxId))}` : undefined)}
    <table class="mt8">
      <thead><tr>
        <th style="width:6%">ที่</th><th>ชื่อ-สกุล</th>
        <th style="width:22%">เลขประจำตัวผู้เสียภาษี</th>
        <th style="width:18%">เงินได้ทั้งปี</th><th style="width:18%">ภาษีหักทั้งปี</th>
      </tr></thead>
      <tbody>${rows || emptyRow(5)}</tbody>
      <tfoot><tr>
        <td colspan="3" class="right">รวม</td>
        <td class="right">${money(r.totalIncome)}</td>
        <td class="right">${money(r.totalWht)}</td>
      </tr></tfoot>
    </table>
    <table class="no-border mt8 sub">
      <tr><td>จำนวนผู้มีเงินได้ทั้งหมด: <b>${r.count}</b> ราย
        　|　ในจำนวนนี้ถูกหักภาษี <b>${r.countWithTax}</b> ราย</td></tr>
      <tr><td>ภาษีนำส่งทั้งปี: <b>${money(r.totalWht)}</b> บาท</td></tr>
    </table>
  </div>`;
}

/**
 * เปิดหน้าต่างพิมพ์ — แพตเทิร์นเดียวกับ `printSlips` (รอฟอนต์โหลดก่อนสั่งพิมพ์
 * ไม่งั้นความสูงบรรทัดเพี้ยนตอนวัดหน้า)
 */
export function printFilingDoc(title: string, bodyHtml: string): void {
  const w = window.open("", "_blank", "width=900,height=1200");
  if (!w) {
    alert("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — โปรดอนุญาต popup แล้วลองใหม่");
    return;
  }
  w.document.open();
  w.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>` +
      `<style>${CSS}</style></head><body>${bodyHtml}</body></html>`,
  );
  w.document.close();
  setTimeout(() => {
    const fonts = (w.document as Document & { fonts?: FontFaceSet }).fonts;
    const go = () => { w.focus(); w.print(); };
    if (fonts?.ready) fonts.ready.then(go).catch(go);
    else go();
  }, 150);
}

/**
 * ตารางเป็น TSV สำหรับวางลง Excel / ช่องกรอกในเว็บราชการ
 * ★ นี่คือตัวช่วยหลักของทั้งแท็บ — ผู้ใช้กรอกเว็บราชการเอง ไม่ได้อัปโหลดไฟล์
 * 🪤 ตัวเลขต้อง **ไม่มีคอมมา** ไม่งั้นวางลง Excel แล้วกลายเป็นข้อความ
 */
export function toTsv(headers: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => String(v ?? "").replace(/[\t\r\n]/g, " ");
  return [headers.map(cell).join("\t"), ...rows.map((r) => r.map(cell).join("\t"))].join("\n");
}
