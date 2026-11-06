"use client";

/**
 * print — พิมพ์ใบเสนอราคา (A4) + เอกสารขาย B2B (invoice/tax-invoice/receipt)
 *   port verbatim จาก docs/legacy/sales/_templates_print.html + _js_orders.html (setupDoc)
 *   วิธี: เปิด window ใหม่เขียน HTML (แทน iframe เดิม) — D105: ไม่เปิดหน้าพิมพ์เองแล้ว
 *   แสดงเอกสาร + แถบปุ่ม พิมพ์ / คัดลอกเป็นภาพ / แชร์ (ดู ./docViewer)
 *
 * ⚠️ หัวกระดาษ/เลขบัญชี = ข้อมูลกิจการจริง — ต้องส่งเข้ามาเป็น argument (D44)
 *    ค่าอยู่ในตาราง `entities` ของแต่ละ tenant ไม่ใช่ในโค้ด (ตรรกะประกอบข้อความ: lib/sales/company)
 *    ตั้งค่าที่ บัญชี › ตั้งค่า › ข้อมูลบนเอกสารการค้า
 * ⚠️ ไฟล์นี้ห้ามผูกกับธีมแอป (ต้องดำบนขาวเสมอ) — เปิดโหมดมืดแล้วพิมพ์ต้องไม่ได้กระดาษพื้นดำ
 */
import { showToast } from "@/lib/shared/toast";
import { reverseCalcPrint, roundTo2 } from "@/lib/sales/calc";
import { DEFAULT_DOC_FORMAT, formatDate } from "@/lib/shared/dateFormat";
import { bangkokDateISO } from "@/lib/shared/datetime";
import { branchLabel, type CompanyInfo } from "@/lib/sales/company";
import { paymentForDoc, type SalesPayment } from "@/lib/sales/payments";
import { installmentDocFigures, type Installment } from "@/lib/sales/installments";
import { CANCELLED_STAMP, CANCELLED_STAMP_ENG } from "@/lib/sales/cancelledDocs";
import { amountsVat, docVatAtIssue } from "@/lib/sales/docVat";
import { cnInvoiceLines } from "@/lib/sales/creditNote";
import type { OrderItem } from "./types";
import { mountDocViewer, viewerHead } from "@/lib/shared/docViewer";

export type { CompanyInfo };

const nf = (n: number) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
/** ข้อความหลายบรรทัด → HTML (escape ก่อน แล้วค่อยเปลี่ยน \n เป็น <br>) */
/** ค่าใน attribute (data-doc-*) — escape เครื่องหมายคำพูดด้วย */
const escAttr = (s: unknown) => esc(s).replace(/"/g, "&quot;");
const escMultiline = (s: string) => esc(s).replace(/\r?\n/g, "<br>");

/**
 * D161 เฟส 3 — วันที่บนเอกสารการค้าตามค่าตั้ง `doc_date_format` ของกิจการ (มากับ CompanyInfo)
 * ★ ไม่ตั้ง = `06/11/2569` เท่ากับ `formatThaiDate` เดิมทุกวัน ⇒ กระดาษไม่ขยับจนกว่าลูกค้าจะเลือกเอง
 * 🚨 ฟอร์มราชการไม่ได้อยู่ในไฟล์นี้ และห้ามเรียกตัวนี้
 */
const docDate = (c: CompanyInfo) => (iso: string) => formatDate(iso, c.dateFormat ?? DEFAULT_DOC_FORMAT);

function formatChequeDetail(text: string): string {
  if (!text) return "";
  if (text.includes("เลขที่เช็ค") || text.includes("ยอด")) return text;
  const parts = text.split(" ");
  if (parts.length >= 4) {
    const amount = parseFloat(parts.pop()!);
    // D161 — ข้อความเช็ครูปแบบเก่าที่**เก็บไว้ใน DB** (ผู้ใช้พิมพ์เอง) ไม่ใช่วันที่ที่ระบบจัดรูป ⇒ พิมพ์ตามที่เก็บ
    const chequeDateText = parts.pop();
    const cqNo = parts.pop();
    let bank = parts.join(" ");
    if (!bank.includes("ธนาคาร") && bank !== "-") bank = "ธนาคาร" + bank;
    const amt = isNaN(amount) ? String(amount) : amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${bank} เลขที่เช็ค : ${cqNo} ลงวันที่ ${chequeDateText} ยอด ${amt} บาท`;
  }
  return text;
}

const A4_HEAD = `<style>
@import url('https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600&display=swap');
@page { size: A4; margin: 10mm; }
body { font-family: 'Kanit', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; background: white; }
.a4-container { width: 100%; max-width: 210mm; margin: 0 auto; box-sizing: border-box; background: white; padding: 0 2mm; }
</style>`;

/**
 * แผ่น A4 บนจอ (D105) — สัดส่วน A4 เท่ากระดาษ (210×297mm · ขอบ 10mm เท่า @page)
 * → ภาพที่คัดลอกเป็นหน้า A4 ไม่ใช่สั้นเท่าเนื้อหา · เนื้อหาเกินหน้าเดียวนิดเดียว = ย่อแบบเดียวกับตอนพิมพ์ (applyPrintScale)
 */
const VIEWER_HEAD = viewerHead(
  `@media screen {
  .dv-sheet { width: 210mm; min-height: 297mm; padding: 10mm; }
  .dv-sheet .a4-container { max-width: none; margin-top: 0 !important; }
}`,
  "width=860",
);

function companyHeader(c: CompanyInfo, rightTitle: string, rightEng: string, copyType?: string): string {
  const title = [esc(c.name), esc(c.nameEng)].filter(Boolean).join("<br>");
  const sub = [esc(c.address), esc(c.taxLine)].filter(Boolean).join("<br>");
  return `<table style="width:100%;margin-bottom:15px;border-bottom:2px solid #1e293b;padding-bottom:10px;"><tr>
    <td style="width:50%;vertical-align:top;">
      <h1 style="margin:0;font-size:24px;color:#0f172a;font-weight:600;">${title}</h1>
      <p style="margin:5px 0 0 0;font-size:11px;color:#334155;line-height:1.4;">${sub}</p>
    </td>
    <td style="width:50%;vertical-align:top;text-align:right;white-space:nowrap;">
      <h2 style="margin:0;font-size:${copyType ? 20 : 28}px;color:#0f172a;font-weight:600;">${esc(rightTitle)}</h2>
      <p style="margin:0;font-size:${copyType ? 14 : 18}px;font-weight:500;color:#0f172a;letter-spacing:${copyType ? 0.5 : 1}px;">${esc(rightEng)}</p>
      ${copyType ? `<p style="margin:5px 0 0 0;font-size:14px;font-weight:500;color:#64748b;">${esc(copyType)}</p>` : ""}
    </td></tr></table>`;
}

/** หัวข้อ + รายละเอียดช่องทางโอนเงิน · ไม่ได้กรอกไว้ = ไม่ขึ้นหัวข้อเปล่า */
function bankLines(c: CompanyInfo): string {
  if (!c.bank) return "";
  return `<div style="font-weight:600;margin-bottom:4px;color:#0f172a;font-size:13px;">ช่องทางการโอนเงิน / Bank Transfer:</div>
            <div style="color:#0f172a;line-height:1.4;margin-bottom:10px;font-size:14px;font-weight:500;">${escMultiline(c.bank)}</div>`;
}

function customerBox(name: string, address: string, taxId: string, branch: string): string {
  const br = branch ? `<span style="margin-left:5px;">${esc(branchLabel(branch))}</span>` : "";
  return `<div style="width:57%;border:2px solid #cbd5e1;padding:12px 15px;border-radius:8px;background-color:#f8fafc;box-sizing:border-box;">
    <div style="font-weight:600;margin-bottom:8px;font-size:15px;color:#0f172a;">ลูกค้า / Customer:</div>
    <div style="font-size:15px;font-weight:500;margin-bottom:4px;">${esc(name)}</div>
    <div style="margin-bottom:6px;line-height:1.4;">${esc(address || "-")}</div>
    <div style="white-space:nowrap;"><span style="font-weight:500;">เลขประจำตัวผู้เสียภาษี / Tax ID:</span> ${esc(taxId || "-")} ${br}</div>
  </div>`;
}

function itemsTable(items: OrderItem[], padRows: boolean): string {
  const rows = items
    .map(
      (it, i) => `<tr>
      <td style="padding:2px 6px 1px 6px;border:1px solid #94a3b8;text-align:center;vertical-align:top;">${i + 1}</td>
      <td style="padding:2px 12px 1px 12px;border:1px solid #94a3b8;vertical-align:top;white-space:pre-wrap;">${esc(it.name)}</td>
      <td style="padding:2px 6px 1px 6px;border:1px solid #94a3b8;text-align:center;vertical-align:top;">${it.qty}</td>
      <td style="padding:2px 10px 1px 10px;border:1px solid #94a3b8;text-align:right;vertical-align:top;">${nf(it.price)}</td>
      <td style="padding:2px 10px 1px 10px;border:1px solid #94a3b8;text-align:right;font-weight:500;vertical-align:top;">${nf(roundTo2(it.price * it.qty))}</td></tr>`,
    )
    .join("");
  const filler =
    padRows && items.length < 5
      ? `<tr>${'<td style="padding:8px;border:1px solid #94a3b8;border-bottom:none;"></td>'.repeat(5)}</tr>`
      : "";
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:15px;font-size:14px;">
    <thead><tr style="background-color:#f1f5f9;color:#0f172a;">
      <th style="padding:4px 6px;border:1px solid #94a3b8;width:8%;text-align:center;font-weight:600;font-size:13px;">ลำดับ</th>
      <th style="padding:4px 12px;border:1px solid #94a3b8;text-align:center;font-weight:600;font-size:13px;">รายการสินค้า</th>
      <th style="padding:4px 6px;border:1px solid #94a3b8;width:10%;text-align:center;font-weight:600;font-size:13px;">จำนวน</th>
      <th style="padding:4px 10px;border:1px solid #94a3b8;width:16%;text-align:center;font-weight:600;font-size:13px;">หน่วยละ</th>
      <th style="padding:4px 10px;border:1px solid #94a3b8;width:20%;text-align:center;font-weight:600;font-size:13px;">จำนวนเงิน</th>
    </tr></thead><tbody>${rows}${filler}</tbody></table>`;
}

// ── ใบเสนอราคา (A4) ──────────────────────────────────────────────────────────
export type QuotationDoc = {
  quNo: string;
  /** วันที่ออกใบ (ISO) — จัดรูปตามค่าตั้งของเอกสารในนี้ (D161 · เดิมผู้เรียกส่งข้อความที่จัดรูปแล้ว) */
  dateISO: string;
  quExp: string;
  customerName: string;
  customerAddress: string;
  customerTaxId: string;
  customerBranch: string;
  creditTerm: number;
  items: OrderItem[];
  subTotal: number;
  discount: number;
  subDiscount: number;
  vat: number;
  grandTotal: number;
  whtPercent: number;
  whtAmount: number;
  netPayable: number;
  remarks: string;
  saleName: string;
  /** D146 — เงื่อนไขการชำระเป็นงวด (บรรทัดจาก `planTermsLines()`) · ว่าง = ไม่พิมพ์หัวข้อนี้ */
  planTerms?: string[];
  /**
   * D153 — ออเดอร์ที่ยกเลิกก่อนออกเอกสารใด ๆ: พิมพ์ใบเสนอราคาพร้อมตรายกเลิก
   * ให้สำนักงานบัญชีเห็นว่าเลขใบเสนอราคา/เลขออเดอร์ที่ข้ามไปถูกใช้กับออเดอร์ไหน
   */
  cancelled?: boolean;
  /** เลขออเดอร์ (ORD) — ออกพร้อมใบเสนอราคา · พิมพ์เฉพาะใบที่ยกเลิก */
  orderNo?: string;
};

export function quotationHtml(c: CompanyInfo, d: QuotationDoc): string {
  // โมเดล inclusive: line items = ราคารวม VAT → รวมได้ = grandIncl · summary ถอด VAT ออก
  // 4.3 — ผู้ขายไม่จด VAT: ราคาที่เสนอคือราคาที่ลูกค้าจ่าย ไม่มีบรรทัด VAT บนใบเสนอราคา
  // D154 — ใบเสนอราคาที่พิมพ์ซ้ำตามยอดที่ตั้งไว้ (มี VAT ในยอด = แบบจด) ไม่ใช่สถานะวันนี้
  const isVat = amountsVat({ vatAmount: d.vat, grandTotal: d.grandTotal }, c.isVat !== false);
  const inclLabel = (base: string) => (isVat ? `${base} (รวม VAT)` : base);
  const grandIncl = roundTo2(d.items.reduce((s, it) => s + it.price * it.qty, 0));
  const discountIncl = roundTo2(grandIncl - d.grandTotal);
  const discountRow =
    discountIncl > 0.005
      ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">${inclLabel("หักส่วนลด")}</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">-${nf(discountIncl)}</td></tr>`
      : "";
  const wht =
    d.whtPercent > 0
      ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">หัก ณ ที่จ่าย ${d.whtPercent}%</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:2px solid #cbd5e1;">-${nf(d.whtAmount)}</td></tr>
         <tr style="background-color:#f8fafc;"><td style="padding:8px 12px;text-align:left;font-weight:bold;font-size:14px;border-bottom:4px double #0f172a;">ยอดชำระสุทธิ</td><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:15px;border:2px solid #cbd5e1;border-bottom:4px double #0f172a;background-color:#f1f5f9;">${nf(d.netPayable)}</td></tr>`
      : "";
  const grandBottom = d.whtPercent
    ? "border-bottom:1px solid #cbd5e1;"
    : "border-bottom:4px double #0f172a;background-color:#f1f5f9;";
  const title = d.cancelled ? `ใบเสนอราคา (${CANCELLED_STAMP})` : "ใบเสนอราคา";
  return `<div class="a4-container" data-doc-title="${escAttr(title)}" data-doc-no="${escAttr(d.quNo)}" style="${d.cancelled ? "position:relative;" : ""}font-family:'Kanit',sans-serif;color:#111;line-height:1.5;">
    ${d.cancelled ? cancelledStamp() : ""}
    ${companyHeader(c, "ใบเสนอราคา", "Quotation")}
    <div style="display:flex;justify-content:space-between;width:100%;margin-bottom:15px;font-size:14px;box-sizing:border-box;">
      ${customerBox(d.customerName, d.customerAddress, d.customerTaxId, d.customerBranch)}
      <div style="width:41%;border:2px solid #cbd5e1;padding:12px 15px;border-radius:8px;background-color:#f8fafc;box-sizing:border-box;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:3px 0;font-weight:600;width:60%;">เลขที่ / Quotation No.</td><td style="padding:3px 0;font-weight:500;text-align:right;">${esc(d.quNo)}</td></tr>
          ${d.cancelled && d.orderNo ? `<tr><td style="padding:3px 0;font-weight:600;">เลขที่ออเดอร์ / Order No.</td><td style="padding:3px 0;font-weight:500;text-align:right;">${esc(d.orderNo)}</td></tr>` : ""}
          <tr><td style="padding:3px 0;font-weight:600;">วันที่ / Date</td><td style="padding:3px 0;text-align:right;">${esc(docDate(c)(d.dateISO))}</td></tr>
          <tr><td style="padding:3px 0;font-weight:600;">ยืนราคาถึงวันที่ / Validity</td><td style="padding:3px 0;text-align:right;">${esc(d.quExp)}</td></tr>
          <tr><td style="padding:3px 0;font-weight:600;">เครดิตเทอม / Credit Term</td><td style="padding:3px 0;text-align:right;">${d.creditTerm > 0 ? d.creditTerm + " วัน" : "-"}</td></tr>
        </table>
      </div>
    </div>
    ${itemsTable(d.items, true)}
    <div style="page-break-inside:avoid;break-inside:avoid;">
      <table style="width:100%;font-size:14px;"><tr>
        <td style="width:55%;vertical-align:bottom;padding-right:20px;">
          <div style="border:2px solid #cbd5e1;padding:12px 15px;border-radius:8px;min-height:120px;background-color:#fffbeb;box-sizing:border-box;">
            ${bankLines(c)}
            <div style="font-weight:600;margin-bottom:4px;color:#b45309;font-size:13px;">หมายเหตุ / Remarks:</div>
            <div style="color:#475569;line-height:1.4;font-size:13px;white-space:pre-wrap;">${esc(d.remarks || "-")}</div>
            ${d.planTerms?.length
              ? `<div style="font-weight:600;margin:8px 0 4px;color:#b45309;font-size:13px;">เงื่อนไขการชำระเงิน / Payment Terms:</div>
                 <div style="color:#475569;line-height:1.5;font-size:13px;">${d.planTerms.map((l) => `<div>${esc(l)}</div>`).join("")}</div>`
              : ""}
          </div>
        </td>
        <td style="width:45%;vertical-align:top;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:4px 12px;text-align:left;font-size:13px;">${inclLabel("รวมเป็นเงิน")}</td><td style="padding:4px 12px;text-align:right;width:120px;border:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;vertical-align:bottom;">${nf(grandIncl)}</td></tr>
            ${discountRow}
            ${isVat ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">มูลค่าสินค้า (ก่อน VAT)</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">${nf(d.subDiscount)}</td></tr>` : ""}
            ${isVat ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">ภาษีมูลค่าเพิ่ม 7% (รวมในราคาแล้ว)</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:2px solid #cbd5e1;">${nf(d.vat)}</td></tr>` : ""}
            <tr><td style="padding:8px 12px;text-align:left;font-weight:bold;font-size:14px;${d.whtPercent ? "" : "border-bottom:4px double #0f172a;"}">ยอดรวมทั้งสิ้น</td><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:15px;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;color:#0f172a;${grandBottom}">${nf(d.grandTotal)}</td></tr>
            ${wht}
          </table>
        </td>
      </tr></table>
      <table style="width:100%;margin-top:40px;text-align:center;font-size:14px;"><tr>
        <td style="width:50%;vertical-align:top;"><div style="height:24px;font-weight:500;font-size:16px;color:#334155;">${esc(d.saleName)}</div><div style="margin-top:5px;width:220px;border-top:1px dashed #64748b;margin-left:auto;margin-right:auto;"></div><div style="margin-top:5px;color:#475569;">( ผู้เสนอราคา / Prepared By )</div><div style="margin-top:5px;color:#64748b;font-size:13px;">วันที่ / Date: ______/______/________</div></td>
        <td style="width:50%;vertical-align:top;"><div style="height:24px;"></div><div style="margin-top:5px;width:220px;border-top:1px dashed #64748b;margin-left:auto;margin-right:auto;"></div><div style="margin-top:5px;color:#475569;">( ผู้รับเสนอราคา / Approved By )</div><div style="margin-top:5px;color:#64748b;font-size:13px;">วันที่ / Date: ______/______/________</div></td>
      </tr></table>
    </div>
  </div>`;
}

/** เปิดหน้าต่างพิมพ์ทันทีใน onClick (ก่อน await) แล้วส่งเข้ามาที่นี่ → กัน popup blocker บนมือถือ/iPad */
export function openPrintWindow(): Window | null {
  return window.open("", "_blank", "width=900,height=1200");
}

function openPrint(inner: string, pre?: Window | null) {
  // pre ที่ส่งเข้ามา (แม้เป็น null) = caller เปิดเอง; ไม่ส่ง = เปิดใหม่ (backward-compat)
  const w = pre !== undefined ? pre : window.open("", "_blank", "width=900,height=1200");
  if (!w) {
    showToast({ ok: false, text: "เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — โปรดอนุญาต popup แล้วลองใหม่" });
    return;
  }
  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><title>Document</title>${A4_HEAD}${VIEWER_HEAD}</head><body>${inner}</body></html>`);
  w.document.close();

  // Smart scale (port executeIframePrint เดิม): ถ้า content เกินหน้าเดียวนิดเดียว → zoom ย่อให้พอดี
  // A4 printable height = 297mm − margin 10mm×2 = 277mm ≈ 1047px @96dpi (ใช้ 1020 กัน rounding)
  // D105: zoom อยู่ใน @media print เท่านั้น — บนจอ/ในภาพต้องเป็นขนาดจริง
  //       บนจอ .a4-container กว้าง 190mm เท่ากระดาษ (แผ่น 210mm − ขอบ 10mm×2) → วัดได้ค่าเดียวกับตอนพิมพ์
  const A4_H = 1020;
  const MIN_SCALE = 0.75; // ต่ำกว่านี้ = content เยอะมาก → ปล่อย paginate ตามธรรมชาติ (ดีกว่าตัวเล็กเกิน)
  const applyPrintScale = () => {
    const containers = w.document.querySelectorAll<HTMLElement>(".a4-container");
    let maxH = 0;
    containers.forEach((c) => {
      if (c.offsetHeight > maxH) maxH = c.offsetHeight;
    });
    if (maxH === 0) maxH = w.document.body.scrollHeight;
    const scale = A4_H / maxH;
    if (scale < 1 && scale >= MIN_SCALE) {
      const styleEl = w.document.createElement("style");
      // บนจอย่อเฉพาะเนื้อหาในแผ่น (แผ่นยังเป็น A4) → ภาพที่คัดลอกหน้าตาเท่ากระดาษที่พิมพ์ออกมา
      styleEl.textContent =
        `@media print { body { zoom: ${scale.toFixed(3)}; } }\n` +
        `@media screen { .dv-sheet .a4-container { zoom: ${scale.toFixed(3)}; } }`;
      w.document.head.appendChild(styleEl);
    }
  };

  // รอ font โหลด + render ครบก่อนวัด (พึ่ง fonts.ready เป็นหลัก)
  // D105: ไม่เปิดหน้าพิมพ์เองแล้ว — แสดงเอกสาร + แถบ พิมพ์ / คัดลอกเป็นภาพ / แชร์ ให้ผู้ใช้เลือก
  const ready = () => {
    // ห่อหน้าเป็นแผ่นกระดาษก่อน แล้วค่อยวัด (ความกว้างบนจอถึงจะเท่ากับตอนพิมพ์)
    mountDocViewer(
      w,
      () => {
        w.focus();
        w.print();
      },
      { pageSelector: ".a4-container" },
    );
    applyPrintScale();
    w.focus();
  };
  setTimeout(() => {
    const fonts = (w.document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) fonts.ready.then(ready).catch(ready);
    else ready();
  }, 300);
}

/**
 * กันพิมพ์หัวกระดาษเปล่า — ยังไม่ได้ตั้งข้อมูลกิจการ = เอกสารไม่มีชื่อผู้ขาย (ใช้ไม่ได้ทางกฎหมาย)
 * คืน true = พิมพ์ต่อได้
 */
function ensureCompany(c: CompanyInfo, w?: Window | null): boolean {
  if (c?.name) return true;
  if (w) w.close();
  // D134 — เดิมเป็น alert() (เบราว์เซอร์บล็อกได้ = ข้อความหายเงียบ) · ที่ชี้ไปบอก "บัญชี › ตั้งค่า" ย้ายแล้วตั้งแต่ D63
  showToast({
    ok: false,
    text:
      "ยังไม่ได้ตั้งข้อมูลกิจการที่ใช้ออกเอกสาร — หัวกระดาษจะว่าง\n" +
      "ไปที่ ตั้งค่า → กิจการ แล้วเลือกผู้ออกเอกสาร + กรอกชื่อ/ที่อยู่/เลขภาษี ก่อน",
  });
  return false;
}

export function printQuotation(company: CompanyInfo, d: QuotationDoc, w?: Window | null) {
  if (!ensureCompany(company, w)) return;
  openPrint(quotationHtml(company, d), w);
}

/** หัวเอกสารจริง (ใช้แสดงตัวอย่างในหน้าตั้งค่า — เห็นเหมือนที่พิมพ์ออกมาแน่นอน) */
export function companyHeaderPreviewHtml(company: CompanyInfo): string {
  return `<div style="font-family:'Kanit',sans-serif;color:#111;line-height:1.5;background:#fff;padding:14px;">
    ${companyHeader(company, "ใบเสนอราคา", "Quotation")}
    <div style="width:60%;border:2px solid #cbd5e1;padding:12px 15px;border-radius:8px;background-color:#fffbeb;box-sizing:border-box;font-size:14px;">
      ${bankLines(company) || '<div style="color:#94a3b8;font-size:13px;">— ยังไม่ได้กรอกช่องทางการโอนเงิน (กล่องนี้จะไม่ขึ้นบนเอกสาร) —</div>'}
    </div>
  </div>`;
}

// ── เอกสารขาย B2B (setupDoc + template) ──────────────────────────────────────
export type OrderLike = {
  quNo: string;
  invNo: string;
  taxNo1: string;
  taxNo2: string;
  subTotal: number;
  discount: number;
  vatAmount: number;
  grandTotal: number;
  netPayable: number;
  whtPercent: number;
  whtAmount: number;
  deposit: number;
  outstandingBalance: number;
  docDate1: string;
  docDate2: string;
  checkDetail1: string;
  checkDetail2: string;
  paymentMethod: string;
  customerName: string;
  customerAddress: string;
  customerTaxId: string;
  customerBranch: string;
  // D45 — ใบแจ้งหนี้ค่ามัดจำ (docType 'invoice-deposit')
  depInvNo?: string;
  depInvDate?: string;
  depInvAmount?: number;
  depDueDate?: string;
  depositPercent?: number;
  /** D89 — เลขใบเสร็จของกิจการที่ไม่จด VAT (คู่ขนานกับ taxNo1/taxNo2) */
  rcptNo1?: string;
  rcptNo2?: string;
  /** D147 — แผนงวด (มี = ออเดอร์แบ่งงวด · เอกสารรายงวดอ่านยอดจากที่นี่) */
  installments?: Installment[];
  /** D156 — ยอดรับชำระแล้ว ณ วันออกใบแจ้งหนี้ (ออเดอร์แบ่งงวด) · null/ไม่ส่ง = ใช้ deposit */
  invPaidBefore?: number | null;
  /**
   * D143 — การรับเงินทีละครั้ง · ใบเสร็จอ่านวิธีชำระ/เช็คของครั้งนั้นจากที่นี่
   * ไม่ส่ง/ไม่มีแถว (ออเดอร์เก่าที่ไม่มีบิลให้ backfill · ขายหน้าร้านที่เพิ่งขาย) = ใช้ช่องเดิมของออเดอร์
   */
  payments?: SalesPayment[];
};

type PreparedDoc = Record<string, unknown> & { docType: string; copyType: string };

/**
 * 4.3 — `currentIsVat` = ผู้ขายจดทะเบียน VAT ไหม **วันนี้** (มาจาก `CompanyInfo` ที่อ่าน `entities.is_vat`)
 *   D154 — ใช้เป็นแค่ค่าสุดท้ายเมื่อไม่มีหลักฐานกับเอกสาร · ตัวที่ใช้จริงคือ `docVatAtIssue()`
 *
 * 🚨 ไม่จด VAT → หัวเอกสาร **ห้ามมีคำว่า "ใบกำกับภาษี"** (ผิด ประมวลรัษฎากร ม.86/13)
 *    และแถวมูลค่าก่อน VAT / ภาษีมูลค่าเพิ่ม **ไม่ render เลย** (ไม่ใช่โชว์ 0.00)
 */
function setupDoc(order: OrderLike, items: OrderItem[], docType: string, copyType: string, fmt: (iso: string) => string, currentIsVat = true): PreparedDoc {
  // 🔴 D154 — หัวเอกสาร/แถว VAT ตามที่ใบนี้ "ออกไปจริง" ไม่ใช่สถานะของกิจการวันนี้ (lib/sales/docVat)
  const pay = paymentForDoc(docType, order.payments);
  const isVat = docVatAtIssue(docType, order, pay, currentIsVat);
  // D161 — ว่าง = วันนี้ (เดิม `toLocaleDateString("th-TH")` = `6/11/2569` ไม่เติมศูนย์ ต่างจากวันที่อื่นบนกระดาษใบเดียวกัน)
  const docDate1_th = order.docDate1 ? fmt(order.docDate1) : fmt(bangkokDateISO());
  const docDate2_th = order.docDate2 ? fmt(order.docDate2) : docDate1_th;
  const whtPercent = order.whtPercent || 0;
  const subDiscount = roundTo2((order.subTotal || 0) - (order.discount || 0));
  const netPayable = order.netPayable || order.grandTotal;

  // โมเดล inclusive: ยอดรวม VAT จาก line items (ราคา = รวม VAT) → ตรงกับที่ line item รวมได้
  const grandIncl = roundTo2(items.reduce((s, it) => s + it.price * it.qty, 0));
  const discountIncl = roundTo2(grandIncl - (order.grandTotal || 0));

  const doc: PreparedDoc = {
    docType,
    isVat, // 4.3 — docSummaryRows อ่านธงนี้เพื่อซ่อนแถว VAT
    copyType,
    quNo: order.quNo,
    items,
    customerName: order.customerName,
    customerAddress: order.customerAddress,
    customerTaxId: order.customerTaxId,
    customerBranch: order.customerBranch,
    grandIncl,
    discountIncl,
    subTotal: order.subTotal,
    subDiscount,
    vatAmount: order.vatAmount,
    grandTotal: order.grandTotal,
    netPayable,
    whtPercent,
    whtAmount: order.whtAmount || 0,
    deposit: order.deposit || 0,
    paymentMethod: order.paymentMethod,
    documentDate: docDate1_th,
  };

  // 🔴 D143 — ใบเสร็จต้องบอกวิธีชำระของ "ครั้งนั้น" · ช่องเดิมของออเดอร์ถูกเขียนทับเมื่อรับครั้งถัดไป
  //    (พิมพ์ใบเสร็จมัดจำซ้ำหลังรับยอดค้าง เคยขึ้นวิธีชำระของยอดค้าง)
  if (pay) {
    doc.paymentMethod = pay.method || order.paymentMethod;
    doc.chequeDetails = formatChequeDetail(pay.chequeDetail);
  } else if (docType === "tax-invoice-deposit") doc.chequeDetails = formatChequeDetail(order.checkDetail1);
  else if (docType === "tax-invoice-balance" || docType === "tax-invoice-receipt" || docType === "tax-invoice-receipt-do")
    doc.chequeDetails = formatChequeDetail(order.checkDetail2);
  else doc.chequeDetails = "";

  // ★ D147 — ออเดอร์แบ่งงวด: ใบแจ้งหนี้/ใบส่งสินค้าหักด้วย "รับชำระแล้ว" (ไม่ใช่ "มัดจำรับแล้ว")
  doc.planOrder = !!order.installments?.length;

  // ── D147 — เอกสารรายงวด "invoice-installment:k" / "tax-invoice-installment:k" ─────────
  //   ตัวเลขทั้งหมดจาก installmentDocFigures() — ยอดตามสัญญา · รับก่อนหน้า · งวดนี้ · คงเหลือ
  const instMatch = /^(invoice-installment|tax-invoice-installment):(\d+)$/.exec(docType);
  if (instMatch) {
    const base = instMatch[1];
    const seq = Number(instMatch[2]);
    const plan = order.installments ?? [];
    const f = installmentDocFigures(plan, seq, netPayable);
    const inst = plan.find((i) => i.seq === seq);
    const tag = `งวดที่ ${f.k}/${f.n}`;
    doc.docType = base; // ลายเซ็น/กล่องชำระเงินตัดสินจากชนิดหลัก
    doc.instTag = `${tag}${f.label ? ` (${f.label})` : ""}`;
    doc.instContract = f.contract;
    doc.instPaidBefore = f.paidBefore;
    doc.instRemaining = f.remaining;
    if (base === "invoice-installment") {
      // ใบแจ้งหนี้ของงวด — ยังไม่ได้รับเงิน (ไม่ใช่ใบกำกับภาษี เหมือนใบแจ้งหนี้มัดจำ D45)
      doc.receiptTitle = `ใบแจ้งหนี้ (${tag})`;
      doc.receiptTitleEng = `Invoice (Installment ${f.k}/${f.n})`;
      doc.docNo = inst?.invNo || "";
      doc.documentDate = inst?.invDate ? fmt(inst.invDate) : docDate1_th;
      doc.dueDate = inst?.dueDate ? fmt(inst.dueDate) : "";
      doc.instDue = f.amount;
      doc.outstandingBalance = f.amount; // > 0 → กล่องเลขบัญชีธนาคาร (เหมือนใบแจ้งหนี้อื่น)
    } else {
      // 4.3 — ผู้ไม่จด VAT ห้ามมีคำว่า "ใบกำกับภาษี" (ม.86/13)
      doc.receiptTitle = isVat ? `ใบกำกับภาษี/ใบเสร็จรับเงิน (${tag})` : `ใบเสร็จรับเงิน (${tag})`;
      doc.receiptTitleEng = isVat ? `Tax Invoice / Receipt (Installment ${f.k}/${f.n})` : `Receipt (Installment ${f.k}/${f.n})`;
      doc.docNo = pay?.docNo || "";
      doc.documentDate = pay?.docDate ? fmt(pay.docDate) : docDate1_th;
      const amount = pay ? roundTo2(pay.amount) : f.amount;
      const v = reverseCalcPrint(amount, whtPercent, isVat);
      doc.receiptAmount = amount;
      doc.receiptPreVat = v.preVat;
      doc.receiptVat = v.vat;
      doc.receiptWht = v.wht;
      doc.outstandingBalance = 0;
    }
    return doc;
  }

  if (docType === "invoice") {
    doc.receiptTitle = "ใบแจ้งหนี้/ใบส่งสินค้า";
    doc.receiptTitleEng = "Invoice / Delivery Order";
    doc.docNo = order.invNo;
    // 🔴 D156 — ออเดอร์แบ่งงวด: หักยอดที่รับแล้ว "ณ วันออกใบ" ไม่ใช่ยอดรับรวมถึงวันนี้
    //    (deposit ของออเดอร์แบ่งงวดโตทุกครั้งที่รับงวด → พิมพ์ซ้ำหลังรับครบเคยขึ้นคงค้าง 0.00)
    //    ออเดอร์แบบเดิม deposit ตั้งครั้งเดียวไม่ขยับ จึงไม่ใช้ค่านี้ · null = ไม่รู้ → deposit แบบเดิม
    const paid = (doc.planOrder && order.invPaidBefore != null ? order.invPaidBefore : order.deposit) || 0;
    doc.deposit = paid;
    doc.outstandingBalance = roundTo2(netPayable - paid);
    if (paid > 0) {
      const balVals = reverseCalcPrint(doc.outstandingBalance as number, whtPercent, isVat);
      doc.receiptPreVat = balVals.preVat;
      doc.receiptVat = balVals.vat;
      doc.receiptWht = balVals.wht;
      doc.depositPreVat = reverseCalcPrint(paid, whtPercent, isVat).preVat;
    }
  } else if (docType === "invoice-only") {
    doc.receiptTitle = "ใบแจ้งหนี้";
    doc.receiptTitleEng = "Invoice";
    doc.docNo = order.invNo;
    doc.outstandingBalance = roundTo2(netPayable - (order.deposit || 0));
  } else if (docType === "invoice-deposit") {
    // D45 — ใบแจ้งหนี้ "เรียกเก็บเฉพาะยอดมัดจำ" (ยังไม่ได้รับเงิน → ไม่ใช่ใบกำกับภาษี)
    doc.receiptTitle = "ใบแจ้งหนี้";
    doc.receiptTitleEng = "Invoice";
    doc.docNo = order.depInvNo || "";
    doc.documentDate = order.depInvDate ? fmt(order.depInvDate) : docDate1_th;
    doc.dueDate = order.depDueDate ? fmt(order.depDueDate) : "";
    doc.depositPercent = order.depositPercent || 0;
    const depAmt = roundTo2(order.depInvAmount || 0);
    doc.depositDue = depAmt; // ยอดที่ต้องชำระตอนนี้ (รวม VAT, หัก WHT แล้ว)
    doc.remainAfterDeposit = roundTo2(netPayable - depAmt); // เก็บตอนส่งมอบ
    doc.outstandingBalance = depAmt; // > 0 → footer โชว์เลขบัญชีธนาคาร (เหมือนใบแจ้งหนี้อื่น)
  } else if (docType === "tax-invoice-deposit") {
    doc.receiptTitle = isVat ? "ใบกำกับภาษี/ใบเสร็จรับเงิน" : "ใบเสร็จรับเงิน";
    doc.receiptTitleEng = isVat ? "Tax Invoice / Receipt" : "Receipt";
    doc.receiptAmount = order.deposit;
    // 🔴 D89 — เดิมอ่าน taxNo1 อย่างเดียว ผู้ไม่จด VAT จึงได้ "เลขที่" ว่างบนใบเสร็จค่ามัดจำ
    doc.docNo = order.taxNo1 || order.rcptNo1 || "";
    const v = reverseCalcPrint(order.deposit, whtPercent, isVat);
    doc.receiptPreVat = v.preVat;
    doc.receiptVat = v.vat;
    doc.receiptWht = v.wht;
    doc.outstandingBalance = 0;
  } else if (docType === "tax-invoice-balance") {
    doc.documentDate = docDate2_th;
    doc.receiptTitle = isVat ? "ใบกำกับภาษี/ใบเสร็จรับเงิน" : "ใบเสร็จรับเงิน";
    doc.receiptTitleEng = isVat ? "Tax Invoice / Receipt" : "Receipt";
    doc.receiptAmount = roundTo2(netPayable - (order.deposit || 0));
    // 🔴 D86 — กิจการไม่จด VAT ออกเลขใบกำกับ (TAX) ไม่ได้ → ใบเสร็จใช้เลขของตัวเอง
    //    (ชุด RC ตั้งแต่ D100 · ก่อนหน้านั้นยืมชุด INV — ใบเก่ายังพิมพ์ซ้ำด้วยเลขเดิม)
    //    เส้นทางจด VAT ไม่ขยับ เพราะ taxNo มีเสมอ `||` จึงไม่เคยตกไปข้างขวา
    // 🔴 D89 — เดิม fallback ไป invNo ตรง ๆ = ใบเสร็จยอดค้างใช้เลขซ้ำกับใบแจ้งหนี้
    //    ตอนนี้มีช่องของตัวเอง · คง || invNo ท้ายสุดไว้ให้ใบเก่าที่ออกก่อน D89 พิมพ์ซ้ำได้เหมือนเดิม
    doc.docNo = order.taxNo2 || order.rcptNo2 || order.invNo;
    const v = reverseCalcPrint(doc.receiptAmount as number, whtPercent, isVat);
    doc.receiptPreVat = v.preVat;
    doc.receiptVat = v.vat;
    doc.receiptWht = v.wht;
    doc.depositPreVat = reverseCalcPrint(order.deposit, whtPercent, isVat).preVat;
    doc.outstandingBalance = 0;
  } else if (docType === "tax-invoice-receipt") {
    doc.documentDate = docDate2_th;
    doc.receiptTitle = isVat ? "ใบกำกับภาษี/ใบเสร็จรับเงิน" : "ใบเสร็จรับเงิน";
    doc.receiptTitleEng = isVat ? "Tax Invoice / Receipt" : "Receipt";
    // 🔴 D86 — กิจการไม่จด VAT ออกเลขใบกำกับ (TAX) ไม่ได้ → ใบเสร็จใช้เลขของตัวเอง
    //    (ชุด RC ตั้งแต่ D100 · ก่อนหน้านั้นยืมชุด INV — ใบเก่ายังพิมพ์ซ้ำด้วยเลขเดิม)
    //    เส้นทางจด VAT ไม่ขยับ เพราะ taxNo มีเสมอ `||` จึงไม่เคยตกไปข้างขวา
    doc.docNo = order.taxNo1 || order.rcptNo1 || order.invNo;
    doc.outstandingBalance = 0;
  } else if (docType === "tax-invoice-receipt-do") {
    doc.documentDate = docDate2_th;
    doc.receiptTitle = isVat ? "ใบกำกับภาษี/ใบเสร็จรับเงิน/ใบส่งสินค้า" : "ใบเสร็จรับเงิน/ใบส่งสินค้า";
    doc.receiptTitleEng = isVat ? "Tax Invoice / Receipt / Delivery Order" : "Receipt / Delivery Order";
    // 🔴 D86 — กิจการไม่จด VAT ออกเลขใบกำกับ (TAX) ไม่ได้ → ใบเสร็จใช้เลขของตัวเอง
    //    (ชุด RC ตั้งแต่ D100 · ก่อนหน้านั้นยืมชุด INV — ใบเก่ายังพิมพ์ซ้ำด้วยเลขเดิม)
    //    เส้นทางจด VAT ไม่ขยับ เพราะ taxNo มีเสมอ `||` จึงไม่เคยตกไปข้างขวา
    doc.docNo = order.taxNo1 || order.rcptNo1 || order.invNo;
    doc.outstandingBalance = 0;
  }
  return doc;
}

// โมเดล inclusive: line items = ราคารวม VAT → รวมได้ = grandIncl · summary ถอด VAT ออก
function docSummaryRows(doc: PreparedDoc): string {
  const n = (k: string) => nf(Number(doc[k]) || 0);
  // 4.3 — ผู้ขายไม่จด VAT: ไม่มีอะไรให้ถอด → ไม่ render แถว VAT เลย และตัดคำ "(รวม VAT)" ออกจากป้าย
  const isVat = doc.isVat !== false;
  const inclLabel = (base: string) => (isVat ? `${base} (รวม VAT)` : base);
  // D155 — คู่ของ inclLabel: ไม่จด VAT ไม่มีอะไรให้ถอด → ตัวเลขคือยอดเต็ม ป้ายห้ามบอกว่า "ก่อน VAT"
  const exLabel = (base: string) => (isVat ? `${base} (ก่อน VAT)` : base);
  const whtP = Number(doc.whtPercent) || 0;
  const dt = doc.docType as string;
  const discInc = Number(doc.discountIncl) || 0;

  // แถวบนสุด: รวมเป็นเงิน (รวม VAT) = ยอดที่ line items รวมได้ + (หักส่วนลดถ้ามี)
  const head =
    `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">${inclLabel("รวมเป็นเงิน")}</td><td style="padding:4px 12px;text-align:right;width:120px;border:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;vertical-align:bottom;">${n("grandIncl")}</td></tr>` +
    (discInc > 0.005
      ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">${inclLabel("หักส่วนลด")}</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">-${n("discountIncl")}</td></tr>`
      : "");
  const whtRow = whtP > 0 ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">หัก ณ ที่จ่าย ${whtP}%</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">-${n("receiptWht")}</td></tr>` : "";

  // ── D147 — เอกสารรายงวด: ยอดตามสัญญา · รับก่อนหน้า · งวดนี้ · คงเหลือ (ผู้ใช้ตกลงรูปนี้) ──────
  if (dt === "invoice-installment" || dt === "tax-invoice-installment") {
    const cell = "padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;";
    const contract = `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">ยอดชำระตามสัญญา${whtP > 0 ? " (สุทธิ)" : ""}</td><td style="${cell}">${n("instContract")}</td></tr>`;
    const before = Number(doc.instPaidBefore) > 0
      ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;color:#15803d;">หัก รับชำระแล้วก่อนหน้า</td><td style="${cell}color:#15803d;">-${n("instPaidBefore")}</td></tr>`
      : "";
    const remain = `<tr><td style="padding:4px 12px;text-align:left;font-size:12px;color:#475569;">คงเหลือหลังงวดนี้</td><td style="padding:4px 12px;text-align:right;font-size:12px;color:#475569;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:2px solid #cbd5e1;">${n("instRemaining")}</td></tr>`;
    if (dt === "invoice-installment") {
      return `${head}${contract}${before}
        <tr style="background-color:#fff1f2;"><td style="padding:8px 12px;text-align:left;font-weight:bold;font-size:14px;border-top:2px dashed #94a3b8;border-bottom:4px double #be123c;color:#be123c;">ยอดเรียกเก็บ${esc(doc.instTag as string)}</td><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:15px;border:2px solid #cbd5e1;border-top:2px dashed #94a3b8;border-bottom:4px double #be123c;color:#be123c;">${n("instDue")}</td></tr>
        ${remain}`;
    }
    return `${head}${contract}${before}
      <tr><td style="padding:4px 12px;text-align:left;font-size:13px;font-weight:bold;color:#15803d;border-top:2px dashed #94a3b8;">${esc(doc.instTag as string)} มูลค่า${isVat ? " (ก่อน VAT)" : ""}</td><td style="${cell}border-top:2px dashed #94a3b8;font-weight:bold;color:#15803d;">${n("receiptPreVat")}</td></tr>
      ${isVat ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">ภาษีมูลค่าเพิ่ม 7%</td><td style="${cell}">${n("receiptVat")}</td></tr>` : ""}
      ${whtRow}
      <tr style="background-color:#f0fdf4;"><td style="padding:8px 12px;text-align:left;font-weight:bold;font-size:14px;border-bottom:4px double #15803d;color:#15803d;">ยอดรับงวดนี้${isVat ? " (รวม VAT)" : ""}</td><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:15px;border:2px solid #cbd5e1;border-bottom:4px double #15803d;color:#15803d;">${n("receiptAmount")}</td></tr>
      ${remain}`;
  }

  if (dt === "tax-invoice-deposit") {
    return `${head}
      <tr><td style="padding:4px 12px;text-align:left;font-size:13px;font-weight:bold;color:#15803d;border-top:2px dashed #94a3b8;">${exLabel("มูลค่ามัดจำ")}</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;border-top:2px dashed #94a3b8;font-weight:bold;color:#15803d;">${n("receiptPreVat")}</td></tr>
      ${isVat ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">ภาษีมูลค่าเพิ่ม 7%</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">${n("receiptVat")}</td></tr>` : ""}
      ${whtRow}
      <tr style="background-color:#f0fdf4;"><td style="padding:8px 12px;text-align:left;font-weight:bold;font-size:14px;border-bottom:4px double #15803d;color:#15803d;">${inclLabel("ยอดรับมัดจำ")}</td><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:15px;border:2px solid #cbd5e1;border-bottom:4px double #15803d;color:#15803d;">${n("receiptAmount")}</td></tr>`;
  }
  if (dt === "invoice-deposit") {
    // D45 — วางบิลค่ามัดจำ: โชว์ยอดทั้งบิลเพื่ออ้างอิง แล้วปิดท้ายด้วย "ยอดที่ต้องชำระตอนนี้"
    //
    // ⚠️ ลำดับบรรทัดตามหลักบัญชี ห้ามสลับ: "ยอดรวมทั้งสิ้น" = มูลค่าสินค้า + VAT เสมอ
    //    (บังคับบนใบกำกับภาษี ม.86/4(5) · เป็นฐาน ภพ.30 · AP ลูกค้าแมตช์กับ PO)
    //    หัก ณ ที่จ่าย = การหักตอนจ่ายเงิน ไม่ใช่มูลค่าบิล → อยู่ใต้เสมอ แล้วปิดด้วยยอดสุทธิ
    //    ถ้าเอา WHT ขึ้นก่อน = เลขบนใบนี้จะไม่ตรงกับใบกำกับภาษีของออเดอร์เดียวกันตอนรับเงิน
    const pct = Number(doc.depositPercent) || 0;
    const depLabel = `ยอดชำระมัดจำ${pct > 0 ? ` ${pct}%` : ""} สุทธิ`;
    // มี WHT → ต้องโชว์ "ยอดสุทธิ" คั่น ไม่งั้นลูกค้าไล่ไม่ออกว่ายอดมัดจำคิดจากอะไร
    const netRowDep =
      whtP > 0
        ? `<tr><td style="padding:6px 12px;text-align:left;font-size:13px;font-weight:600;">ยอดสุทธิ</td><td style="padding:6px 12px;text-align:right;font-weight:600;font-size:14px;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">${nf(Number(doc.netPayable) || Number(doc.grandTotal))}</td></tr>`
        : "";
    return `${head}
      <tr><td style="padding:4px 12px;text-align:left;font-size:13px;">${exLabel("มูลค่าสินค้า")}</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">${n("subDiscount")}</td></tr>
      ${isVat ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">ภาษีมูลค่าเพิ่ม 7%</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">${n("vatAmount")}</td></tr>` : ""}
      <tr style="background-color:#f8fafc;"><td style="padding:6px 12px;text-align:left;font-weight:bold;font-size:13px;border-bottom:1px solid #cbd5e1;">ยอดรวมทั้งสิ้น</td><td style="padding:6px 12px;text-align:right;font-weight:bold;font-size:14px;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;color:#0f172a;border-bottom:1px solid #cbd5e1;background-color:#f1f5f9;">${n("grandTotal")}</td></tr>
      ${whtP > 0 ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">หัก ณ ที่จ่าย ${whtP}%</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">-${n("whtAmount")}</td></tr>` : ""}
      ${netRowDep}
      <tr style="background-color:#fff1f2;"><td style="padding:8px 12px;text-align:left;font-weight:bold;font-size:14px;border-top:2px dashed #94a3b8;border-bottom:4px double #be123c;color:#be123c;">${depLabel}</td><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:15px;border:2px solid #cbd5e1;border-top:2px dashed #94a3b8;border-bottom:4px double #be123c;color:#be123c;">${n("depositDue")}</td></tr>
      <tr><td style="padding:4px 12px;text-align:left;font-size:12px;color:#475569;">คงเหลือเรียกเก็บเมื่อส่งมอบสินค้า</td><td style="padding:4px 12px;text-align:right;font-size:12px;color:#475569;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:2px solid #cbd5e1;">${n("remainAfterDeposit")}</td></tr>`;
  }
  if ((dt === "tax-invoice-balance" || dt === "invoice") && Number(doc.deposit) > 0) {
    const bal = dt === "tax-invoice-balance"
      ? `<tr style="background-color:#f0fdf4;"><td style="padding:8px 12px;text-align:left;font-weight:bold;font-size:14px;border-bottom:4px double #15803d;color:#15803d;">${inclLabel("ยอดรับครั้งนี้")}</td><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:15px;border:2px solid #cbd5e1;border-bottom:4px double #15803d;color:#15803d;">${n("receiptAmount")}</td></tr>`
      : `<tr style="background-color:#fff1f2;"><td style="padding:8px 12px;text-align:left;font-weight:bold;font-size:14px;border-bottom:4px double #be123c;color:#be123c;">${inclLabel("ยอดค้างชำระ")}</td><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:15px;border:2px solid #cbd5e1;border-bottom:4px double #be123c;color:#be123c;">${n("outstandingBalance")}</td></tr>`;
    return `${head}
      <tr><td style="padding:4px 12px;text-align:left;font-size:13px;font-weight:600;color:#15803d;border-top:2px dashed #94a3b8;">${exLabel(doc.planOrder ? "หัก รับชำระแล้ว" : "หัก มัดจำรับแล้ว")}</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;border-top:2px dashed #94a3b8;color:#15803d;font-weight:600;">-${n("depositPreVat")}</td></tr>
      <tr><td style="padding:4px 12px;text-align:left;font-size:13px;font-weight:bold;color:#be123c;">${exLabel("ยอดคงค้างยกมา")}</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;font-weight:bold;color:#be123c;">${n("receiptPreVat")}</td></tr>
      ${isVat ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">ภาษีมูลค่าเพิ่ม 7%</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">${n("receiptVat")}</td></tr>` : ""}
      ${whtRow}${bal}`;
  }
  // default (จ่ายเต็ม / invoice-only): ถอด VAT ออกจากยอดรวม
  const netRow = !dt.includes("invoice-only") && Number(doc.outstandingBalance) === 0
    ? `<tr style="background-color:#f0fdf4;"><td style="padding:8px 12px;text-align:left;font-weight:bold;font-size:14px;border-bottom:4px double #15803d;color:#15803d;">ยอดเงินรับสุทธิ</td><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:15px;border:2px solid #cbd5e1;border-bottom:4px double #15803d;color:#15803d;">${nf(Number(doc.netPayable) || Number(doc.grandTotal))}</td></tr>`
    : "";
  const outRow = dt.includes("invoice-only") || (dt === "invoice" && Number(doc.outstandingBalance) > 0)
    ? `<tr style="background-color:#fff1f2;"><td style="padding:8px 12px;text-align:left;font-weight:bold;font-size:14px;border-bottom:4px double #be123c;color:#be123c;">ยอดค้างชำระสุทธิ</td><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:15px;border:2px solid #cbd5e1;border-bottom:4px double #be123c;color:#be123c;">${n("outstandingBalance")}</td></tr>`
    : "";
  return `${head}
    <tr><td style="padding:4px 12px;text-align:left;font-size:13px;">${exLabel("มูลค่าสินค้า")}</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">${n("subDiscount")}</td></tr>
    ${isVat ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">ภาษีมูลค่าเพิ่ม 7% (รวมในราคาแล้ว)</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">${n("vatAmount")}</td></tr>` : ""}
    <tr style="background-color:#f8fafc;"><td style="padding:6px 12px;text-align:left;font-weight:bold;font-size:13px;border-bottom:1px solid #cbd5e1;">ยอดรวมทั้งสิ้น</td><td style="padding:6px 12px;text-align:right;font-weight:bold;font-size:14px;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;color:#0f172a;border-bottom:1px solid #cbd5e1;background-color:#f1f5f9;">${n("grandTotal")}</td></tr>
    ${whtP > 0 ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">หัก ณ ที่จ่าย ${whtP}%</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">-${n("whtAmount")}</td></tr>` : ""}
    ${netRow}${outRow}`;
}

function docSignatures(dt: string): string {
  const sig = (label: string, w = 180) => `<td style="vertical-align:top;"><div style="height:24px;"></div><div style="margin-top:5px;width:${w}px;border-top:1px dashed #64748b;margin-left:auto;margin-right:auto;"></div><div style="margin-top:5px;color:#475569;">( ${label} )</div><div style="margin-top:5px;color:#64748b;font-size:12px;">วันที่ / Date: ______/______/________</div></td>`;
  let cells = "";
  if (dt === "invoice-only" || dt === "invoice-deposit" || dt === "invoice-installment") cells += sig("ผู้ชำระเงิน / Payer", 200);
  if (dt === "invoice" || dt === "tax-invoice-receipt-do") cells += sig("ผู้รับสินค้า / Receiver");
  if (dt === "invoice" || dt === "tax-invoice-receipt-do") cells += sig("ผู้ส่งสินค้า / Deliverer");
  if (["tax-invoice-deposit", "tax-invoice-balance", "tax-invoice-receipt", "tax-invoice-receipt-do", "tax-invoice-installment"].includes(dt)) cells += sig("ผู้รับเงิน / Collector");
  if (dt === "credit-note") cells += sig("ผู้รับใบลดหนี้ / Received By"); // D159
  cells += sig("ผู้มีอำนาจลงนาม / Auth. Signature");
  return `<table style="width:100%;margin-top:40px;text-align:center;font-size:13px;"><tr>${cells}</tr></table>`;
}

function bankOrPaymentBox(c: CompanyInfo, doc: PreparedDoc): string {
  const dt = doc.docType as string;
  if (dt.includes("invoice") && !dt.includes("tax-") && Number(doc.outstandingBalance) > 0 && c.bank) {
    return `<div style="border:2px solid #cbd5e1;padding:12px 15px;border-radius:8px;background-color:#fffbeb;box-sizing:border-box;">
      ${bankLines(c)}</div>`;
  }
  const cq =
    doc.paymentMethod === "เช็ค" && doc.chequeDetails
      ? `<div style="color:#475569;font-size:13px;margin-top:2px;"><span style="font-weight:600;">ข้อมูลเช็ค:</span> ${esc(doc.chequeDetails)}</div>`
      : "";
  return `<div style="border:2px solid #cbd5e1;padding:12px 15px;border-radius:8px;background-color:#f8fafc;box-sizing:border-box;">
    <div style="font-weight:600;color:#0f172a;font-size:13px;">การชำระเงินจะสมบูรณ์เมื่อบริษัทได้รับเงินเรียบร้อยแล้ว</div>
    <div style="color:#475569;font-size:13px;margin-top:4px;">อ้างอิงวิธีชำระ: ${esc(doc.paymentMethod || "ไม่ระบุ")}</div>${cq}</div>`;
}

/**
 * D153 — ตรายกเลิกทับกลางหน้า (ป.86/2542 ข้อ 25: ประทับตราว่ายกเลิก)
 * 🚨 อยู่ใน .a4-container → ติดไปทั้งตอนพิมพ์และตอนคัดลอกเป็นภาพ · ไม่บังตัวเลข (โปร่ง + pointer-events:none)
 */
function cancelledStamp(): string {
  return `<div style="position:absolute;left:0;right:0;top:38%;display:flex;justify-content:center;pointer-events:none;z-index:5;">
    <div style="transform:rotate(-18deg);border:6px double #dc2626;color:#dc2626;opacity:0.55;border-radius:10px;padding:6px 36px;text-align:center;font-weight:600;line-height:1.1;background:rgba(255,255,255,0.35);">
      <div style="font-size:72px;">${esc(CANCELLED_STAMP)}</div>
      <div style="font-size:26px;letter-spacing:6px;">${esc(CANCELLED_STAMP_ENG)}</div>
    </div></div>`;
}

function b2bDocHtml(c: CompanyInfo, doc: PreparedDoc, idx: number, cancelled = false): string {
  const brk = idx > 0 ? "page-break-before:always;break-before:page;margin-top:15px;" : "";
  const title = cancelled ? `${doc.receiptTitle} (${CANCELLED_STAMP})` : (doc.receiptTitle as string);
  return `<div class="a4-container" data-doc-title="${escAttr(title)}" data-doc-copy="${escAttr(doc.copyType)}" data-doc-no="${escAttr(doc.docNo)}" style="${brk}${cancelled ? "position:relative;" : ""}font-family:'Kanit',sans-serif;color:#111;line-height:1.5;">
    ${cancelled ? cancelledStamp() : ""}
    ${companyHeader(c, doc.receiptTitle as string, doc.receiptTitleEng as string, doc.copyType)}
    <div style="display:flex;justify-content:space-between;width:100%;margin-bottom:15px;font-size:14px;box-sizing:border-box;">
      ${customerBox(doc.customerName as string, doc.customerAddress as string, doc.customerTaxId as string, doc.customerBranch as string)}
      <div style="width:41%;border:2px solid #cbd5e1;padding:12px 15px;border-radius:8px;background-color:#f8fafc;box-sizing:border-box;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:3px 0;font-weight:600;width:50%;">เลขที่ / Doc No.</td><td style="padding:3px 0;font-weight:500;text-align:right;">${esc(doc.docNo)}</td></tr>
          <tr><td style="padding:3px 0;font-weight:600;">วันที่ / Date</td><td style="padding:3px 0;text-align:right;">${esc(doc.documentDate)}</td></tr>
          ${doc.dueDate ? `<tr><td style="padding:3px 0;font-weight:600;">ครบกำหนด / Due</td><td style="padding:3px 0;text-align:right;">${esc(doc.dueDate)}</td></tr>` : ""}
          <tr><td style="padding:3px 0;font-weight:600;">อ้างอิง / Ref No.</td><td style="padding:3px 0;text-align:right;">${esc(doc.quNo)}</td></tr>
        </table>
      </div>
    </div>
    ${itemsTable(doc.items as OrderItem[], false)}
    <div style="page-break-inside:avoid;break-inside:avoid;">
      <table style="width:100%;font-size:14px;"><tr>
        <td style="width:55%;vertical-align:bottom;padding-right:20px;">${bankOrPaymentBox(c, doc)}</td>
        <td style="width:45%;vertical-align:top;"><table style="width:100%;border-collapse:collapse;">${docSummaryRows(doc)}</table></td>
      </tr></table>
      ${docSignatures(doc.docType)}
    </div>
  </div>`;
}

/**
 * พิมพ์เอกสารขาย (ต้นฉบับ + สำเนา ต่อ docType)
 * D153 — `cancelled` = ออเดอร์ถูกยกเลิก → ทุกหน้าติดตรายกเลิก (เนื้อเอกสาร/เลข/วันที่ เหมือนใบเดิมทุกอย่าง)
 */
export function printSalesDocs(
  company: CompanyInfo, order: OrderLike, items: OrderItem[], docTypes: string[], w?: Window | null,
  opts?: { cancelled?: boolean },
) {
  if (!ensureCompany(company, w)) return;
  openPrint(salesDocsHtml(company, order, items, docTypes, opts), w);
}

/**
 * เนื้อเอกสารขายเป็น HTML (ไม่เปิดหน้าต่าง) — ตัวเดียวกับที่ printSalesDocs พิมพ์
 * D155 — แยกออกมาให้เทสอ่านตัวเลขบนกระดาษจริงได้ (lib/sales/salesDocHtml.test.ts)
 */
export function salesDocsHtml(
  company: CompanyInfo, order: OrderLike, items: OrderItem[], docTypes: string[],
  opts?: { cancelled?: boolean },
): string {
  const docs: PreparedDoc[] = [];
  for (const dt of docTypes) {
    const currentIsVat = company.isVat !== false; // D154 — ค่าสุดท้ายเมื่อเอกสารไม่มีหลักฐาน (setupDoc ตัดสินเอง)
    docs.push(setupDoc(order, items, dt, "(ต้นฉบับ / Original)", docDate(company), currentIsVat));
    docs.push(setupDoc(order, items, dt, "(สำเนา / Copy)", docDate(company), currentIsVat));
  }
  return docs.map((d, i) => b2bDocHtml(company, d, i, !!opts?.cancelled)).join("");
}

// ── D159 — ใบลดหนี้ (ม.86/10) ─────────────────────────────────────────────────
/** ข้อมูลใบลดหนี้ที่บันทึกไว้ (ตรงกับ CreditNoteRow ใน data.ts) */
export type CreditNoteDoc = {
  cnNo: string;
  cnDate: string;
  reasonText: string;
  refs: { docNo: string; date: string; preVat: number; vat: number }[];
  original: number;
  correct: number;
  diff: number;
  vat: number;
  total: number;
  refund: number;
  wht: number;
  refundAccount: string;
  /** D160 — cancel = ทั้งออเดอร์ (ตารางใช้รายการของออเดอร์) · return = รายการที่คืน · discount = บรรทัดลดราคา */
  kind?: "cancel" | "return" | "discount";
  items?: { name: string; qty: number; price: number }[];
};

/** รายการในตารางของใบลดหนี้ (D160) — ไม่ได้ใช้คิดยอด ยอดอ่านจากแถวที่บันทึกไว้เสมอ */
function creditNoteLines(cn: CreditNoteDoc, orderItems: OrderItem[]): OrderItem[] {
  if (cn.kind === "return") {
    const lines: OrderItem[] = (cn.items ?? []).map((i) => ({ name: i.name, qty: i.qty, price: i.price }));
    // ส่วนลดท้ายบิลของออเดอร์ / ลดหนี้ครั้งก่อน → บรรทัดหักให้ตารางรวมได้เท่ายอดบนใบ (ไม่ปล่อยให้ตัวเลขขัดกัน)
    const gap = roundTo2(lines.reduce((s, l) => s + l.qty * l.price, 0) - cn.total);
    if (gap > 0.004) lines.push({ name: "หัก ส่วนลดตามใบกำกับเดิม / ยอดที่ลดหนี้ไปแล้ว", qty: 1, price: -gap });
    return lines;
  }
  if (cn.kind === "discount") return [{ name: "ลดราคาสินค้า/บริการตามใบกำกับภาษีเดิม", qty: 1, price: cn.total }];
  return orderItems;
}

/**
 * ใบลดหนี้ 1 ฉบับ (ต้นฉบับหรือสำเนา) — หน้าตาเดียวกับใบกำกับของแอปขาย
 * 🚨 รายการตาม ม.86/10: (1) คำว่า "ใบลดหนี้" เด่นชัด (ข้อหารือ 0811/พ.10090 — "ใบหักหนี้" = ผิด)
 *    (2) ผู้ออก (3) ผู้ซื้อ (4) วันที่ (5) เลขใบกำกับเดิม · มูลค่าเดิม · มูลค่าที่ถูกต้อง · ผลต่าง · ภาษีของผลต่าง
 *    (6) เหตุที่ออก · ★ ตัวเลขทั้งหมดอ่านจากแถวที่บันทึกไว้ (พิมพ์ซ้ำไม่ขยับ)
 */
function creditNoteHtml(c: CompanyInfo, order: OrderLike, items: OrderItem[], cn: CreditNoteDoc, copyType: string, idx: number): string {
  const brk = idx > 0 ? "page-break-before:always;break-before:page;margin-top:15px;" : "";
  const cell = "padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;";
  const row = (label: string, v: string, extra = "") =>
    `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;${extra}">${label}</td><td style="${cell}${extra}">${v}</td></tr>`;
  const refs = cn.refs.map((r) => `${esc(r.docNo)} (${esc(docDate(c)(r.date))})`).join("<br>");
  const inv = cnInvoiceLines(cn.refs, cn.original);
  const refRows = cn.refs.length > 1
    ? cn.refs.map((r) => row(`&nbsp;&nbsp;· ${esc(r.docNo)}`, nf(r.preVat), "color:#475569;font-size:12px;")).join("")
    : "";
  const whtRows = cn.wht > 0
    ? row("หัก ภาษีหัก ณ ที่จ่ายที่ลูกค้าหักไว้", `-${nf(cn.wht)}`) +
      `<tr style="background-color:#f8fafc;"><td style="padding:8px 12px;text-align:left;font-weight:bold;font-size:14px;border-bottom:4px double #0f172a;">ยอดคืนเงิน</td><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:15px;border:2px solid #cbd5e1;border-bottom:4px double #0f172a;">${nf(cn.refund)}</td></tr>`
    : "";
  const refundLine = cn.refundAccount
    ? `คืนเงินเข้าบัญชีลูกค้าจาก: ${esc(cn.refundAccount)}`
    : "ยังไม่ได้คืนเงิน (บันทึกเป็นยอดค้างจ่ายลูกค้า)";
  return `<div class="a4-container" data-doc-title="ใบลดหนี้" data-doc-copy="${escAttr(copyType)}" data-doc-no="${escAttr(cn.cnNo)}" style="${brk}font-family:'Kanit',sans-serif;color:#111;line-height:1.5;">
    ${companyHeader(c, "ใบลดหนี้", "Credit Note", copyType)}
    <div style="display:flex;justify-content:space-between;width:100%;margin-bottom:15px;font-size:14px;box-sizing:border-box;">
      ${customerBox(order.customerName, order.customerAddress, order.customerTaxId, order.customerBranch)}
      <div style="width:41%;border:2px solid #cbd5e1;padding:12px 15px;border-radius:8px;background-color:#f8fafc;box-sizing:border-box;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:3px 0;font-weight:600;width:45%;">เลขที่ / Doc No.</td><td style="padding:3px 0;font-weight:500;text-align:right;">${esc(cn.cnNo)}</td></tr>
          <tr><td style="padding:3px 0;font-weight:600;">วันที่ / Date</td><td style="padding:3px 0;text-align:right;">${esc(docDate(c)(cn.cnDate))}</td></tr>
          <tr><td style="padding:3px 0;font-weight:600;vertical-align:top;">อ้างอิงใบกำกับภาษีเดิม</td><td style="padding:3px 0;text-align:right;">${refs || "-"}</td></tr>
          <tr><td style="padding:3px 0;font-weight:600;">อ้างอิง / Ref No.</td><td style="padding:3px 0;text-align:right;">${esc(order.quNo)}</td></tr>
        </table>
      </div>
    </div>
    ${itemsTable(creditNoteLines(cn, items), false)}
    <div style="page-break-inside:avoid;break-inside:avoid;">
      <table style="width:100%;font-size:14px;"><tr>
        <td style="width:55%;vertical-align:bottom;padding-right:20px;">
          <div style="border:2px solid #cbd5e1;padding:12px 15px;border-radius:8px;background-color:#fffbeb;box-sizing:border-box;">
            <div style="font-weight:600;color:#b45309;font-size:13px;">เหตุที่ออกใบลดหนี้ / Reason:</div>
            <div style="color:#0f172a;font-size:14px;margin-top:2px;">${esc(cn.reasonText)}</div>
            <div style="color:#475569;font-size:13px;margin-top:8px;">${refundLine}</div>
          </div>
        </td>
        <td style="width:45%;vertical-align:top;"><table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:4px 12px;text-align:left;font-size:13px;">มูลค่าตามใบกำกับภาษีเดิม</td><td style="padding:4px 12px;text-align:right;width:120px;border:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">${nf(inv.invoice)}</td></tr>
          ${refRows}
          ${inv.prior > 0 ? row("หัก ลดหนี้ครั้งก่อน", `-${nf(inv.prior)}`) : ""}
          ${row("มูลค่าที่ถูกต้อง", nf(cn.correct))}
          ${row("ผลต่าง (มูลค่าที่ลดลง)", nf(cn.diff), "font-weight:600;")}
          ${row("ภาษีมูลค่าเพิ่ม 7% ของผลต่าง", nf(cn.vat))}
          <tr style="background-color:#fff1f2;"><td style="padding:8px 12px;text-align:left;font-weight:bold;font-size:14px;border-bottom:4px double #be123c;color:#be123c;">รวมลดหนี้ทั้งสิ้น</td><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:15px;border:2px solid #cbd5e1;border-bottom:4px double #be123c;color:#be123c;">${nf(cn.total)}</td></tr>
          ${whtRows}
        </table></td>
      </tr></table>
      ${docSignatures("credit-note")}
    </div>
  </div>`;
}

/** ใบลดหนี้ต้นฉบับ + สำเนา เป็น HTML (เทสอ่านได้ · ตัวเดียวกับที่พิมพ์) · D160 หลายใบต่อกันได้ */
export function creditNoteDocsHtml(company: CompanyInfo, order: OrderLike, items: OrderItem[], cn: CreditNoteDoc | CreditNoteDoc[]): string {
  const list = Array.isArray(cn) ? cn : [cn];
  return list.flatMap((c, i) => [
    creditNoteHtml(company, order, items, c, "(ต้นฉบับ / Original)", i * 2),
    creditNoteHtml(company, order, items, c, "(สำเนา / Copy)", i * 2 + 1),
  ]).join("");
}

export function printCreditNote(company: CompanyInfo, order: OrderLike, items: OrderItem[], cn: CreditNoteDoc | CreditNoteDoc[], w?: Window | null) {
  if (!ensureCompany(company, w)) return;
  openPrint(creditNoteDocsHtml(company, order, items, cn), w);
}
