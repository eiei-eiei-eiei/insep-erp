"use client";

/**
 * print — พิมพ์ใบเสนอราคา (A4) + เอกสารขาย B2B (invoice/tax-invoice/receipt)
 *   port verbatim จาก docs/legacy/sales/_templates_print.html + _js_orders.html (setupDoc)
 *   วิธี: เปิด window ใหม่เขียน HTML แล้ว print (แทน iframe เดิม)
 *
 * ⚠️ หัวกระดาษ/เลขบัญชี = ข้อมูลบริษัทจริง (คงตามเดิมเป๊ะ — ผู้ใช้พิมพ์ทุกวัน)
 *    แก้ได้ที่ constant COMPANY ด้านล่าง (ดู GOLIVE_CHECKLIST Phase 4)
 */
import { reverseCalcPrint, roundTo2 } from "@/lib/sales/calc";
import { formatThaiDate } from "@/lib/sales/orders";
import type { OrderItem } from "./types";

const COMPANY = {
  name: "บริษัท อินทร์ เสพเทมเบ้อ จำกัด",
  nameEng: "IN SEPTEMBER CO.,LTD.",
  address: "(สำนักงานใหญ่) 5/15 ม.8 ต.ท่าน้ำอ้อย อ.พยุหะคีรี จ.นครสวรรค์ 60130",
  taxLine: "เลขประจำตัวผู้เสียภาษี (Tax ID): 0605567002178 | โทร: 088-818-1804",
  bank: "ธนาคารกสิกรไทย เลขที่บัญชี 195-1-19799-4<br>ชื่อบัญชี บริษัท อินทร์ เสพเทมเบ้อ จำกัด",
};

const nf = (n: number) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export function formatBranch(branchText: string): string {
  if (!branchText) return "";
  const b = branchText.toString().trim();
  if (b === "สำนักงานใหญ่" || b.includes("สำนักงานใหญ่")) return "(สำนักงานใหญ่)";
  if (/^\d+$/.test(b)) return `(สาขาที่ ${b})`;
  return `(${b})`;
}

function formatChequeDetail(text: string): string {
  if (!text) return "";
  if (text.includes("เลขที่เช็ค") || text.includes("ยอด")) return text;
  const parts = text.split(" ");
  if (parts.length >= 4) {
    const amount = parseFloat(parts.pop()!);
    const date = parts.pop();
    const cqNo = parts.pop();
    let bank = parts.join(" ");
    if (!bank.includes("ธนาคาร") && bank !== "-") bank = "ธนาคาร" + bank;
    const amt = isNaN(amount) ? String(amount) : amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${bank} เลขที่เช็ค : ${cqNo} ลงวันที่ ${date} ยอด ${amt} บาท`;
  }
  return text;
}

const A4_HEAD = `<style>
@import url('https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600&display=swap');
@page { size: A4; margin: 10mm; }
body { font-family: 'Kanit', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; background: white; }
.a4-container { width: 100%; max-width: 210mm; margin: 0 auto; box-sizing: border-box; background: white; padding: 0 2mm; }
</style>`;

function companyHeader(rightTitle: string, rightEng: string, copyType?: string): string {
  return `<table style="width:100%;margin-bottom:15px;border-bottom:2px solid #1e293b;padding-bottom:10px;"><tr>
    <td style="width:50%;vertical-align:top;">
      <h1 style="margin:0;font-size:24px;color:#0f172a;font-weight:600;">${COMPANY.name}<br>${COMPANY.nameEng}</h1>
      <p style="margin:5px 0 0 0;font-size:11px;color:#334155;line-height:1.4;">${COMPANY.address}<br>${COMPANY.taxLine}</p>
    </td>
    <td style="width:50%;vertical-align:top;text-align:right;white-space:nowrap;">
      <h2 style="margin:0;font-size:${copyType ? 20 : 28}px;color:#0f172a;font-weight:600;">${esc(rightTitle)}</h2>
      <p style="margin:0;font-size:${copyType ? 14 : 18}px;font-weight:500;color:#0f172a;letter-spacing:${copyType ? 0.5 : 1}px;">${esc(rightEng)}</p>
      ${copyType ? `<p style="margin:5px 0 0 0;font-size:14px;font-weight:500;color:#64748b;">${esc(copyType)}</p>` : ""}
    </td></tr></table>`;
}

function customerBox(name: string, address: string, taxId: string, branch: string): string {
  const br = branch ? `<span style="margin-left:5px;">${esc(formatBranch(branch))}</span>` : "";
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
  date: string;
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
};

function quotationHtml(d: QuotationDoc): string {
  // โมเดล inclusive: line items = ราคารวม VAT → รวมได้ = grandIncl · summary ถอด VAT ออก
  const grandIncl = roundTo2(d.items.reduce((s, it) => s + it.price * it.qty, 0));
  const discountIncl = roundTo2(grandIncl - d.grandTotal);
  const discountRow =
    discountIncl > 0.005
      ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">หักส่วนลด (รวม VAT)</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">-${nf(discountIncl)}</td></tr>`
      : "";
  const wht =
    d.whtPercent > 0
      ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">หัก ณ ที่จ่าย ${d.whtPercent}%</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:2px solid #cbd5e1;">-${nf(d.whtAmount)}</td></tr>
         <tr style="background-color:#f8fafc;"><td style="padding:8px 12px;text-align:left;font-weight:bold;font-size:14px;border-bottom:4px double #0f172a;">ยอดชำระสุทธิ</td><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:15px;border:2px solid #cbd5e1;border-bottom:4px double #0f172a;background-color:#f1f5f9;">${nf(d.netPayable)}</td></tr>`
      : "";
  const grandBottom = d.whtPercent
    ? "border-bottom:1px solid #cbd5e1;"
    : "border-bottom:4px double #0f172a;background-color:#f1f5f9;";
  return `<div class="a4-container" style="font-family:'Kanit',sans-serif;color:#111;line-height:1.5;">
    ${companyHeader("ใบเสนอราคา", "Quotation")}
    <div style="display:flex;justify-content:space-between;width:100%;margin-bottom:15px;font-size:14px;box-sizing:border-box;">
      ${customerBox(d.customerName, d.customerAddress, d.customerTaxId, d.customerBranch)}
      <div style="width:41%;border:2px solid #cbd5e1;padding:12px 15px;border-radius:8px;background-color:#f8fafc;box-sizing:border-box;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:3px 0;font-weight:600;width:60%;">เลขที่ / Quotation No.</td><td style="padding:3px 0;font-weight:500;text-align:right;">${esc(d.quNo)}</td></tr>
          <tr><td style="padding:3px 0;font-weight:600;">วันที่ / Date</td><td style="padding:3px 0;text-align:right;">${esc(d.date)}</td></tr>
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
            <div style="font-weight:600;margin-bottom:4px;color:#0f172a;font-size:13px;">ช่องทางการโอนเงิน / Bank Transfer:</div>
            <div style="color:#0f172a;line-height:1.4;margin-bottom:10px;font-size:14px;font-weight:500;">${COMPANY.bank}</div>
            <div style="font-weight:600;margin-bottom:4px;color:#b45309;font-size:13px;">หมายเหตุ / Remarks:</div>
            <div style="color:#475569;line-height:1.4;font-size:13px;white-space:pre-wrap;">${esc(d.remarks || "-")}</div>
          </div>
        </td>
        <td style="width:45%;vertical-align:top;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:4px 12px;text-align:left;font-size:13px;">รวมเป็นเงิน (รวม VAT)</td><td style="padding:4px 12px;text-align:right;width:120px;border:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;vertical-align:bottom;">${nf(grandIncl)}</td></tr>
            ${discountRow}
            <tr><td style="padding:4px 12px;text-align:left;font-size:13px;">มูลค่าสินค้า (ก่อน VAT)</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">${nf(d.subDiscount)}</td></tr>
            <tr><td style="padding:4px 12px;text-align:left;font-size:13px;">ภาษีมูลค่าเพิ่ม 7% (รวมในราคาแล้ว)</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:2px solid #cbd5e1;">${nf(d.vat)}</td></tr>
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

function openPrint(inner: string) {
  const w = window.open("", "_blank", "width=900,height=1200");
  if (!w) {
    alert("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — โปรดอนุญาต popup");
    return;
  }
  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><title>Document</title>${A4_HEAD}</head><body>${inner}</body></html>`);
  w.document.close();

  // Smart scale (port executeIframePrint เดิม): ถ้า content เกินหน้าเดียวนิดเดียว → zoom ย่อให้พอดี
  // A4 printable height = 297mm − margin 10mm×2 = 277mm ≈ 1047px @96dpi (ใช้ 1020 กัน rounding)
  const A4_H = 1020;
  const MIN_SCALE = 0.75; // ต่ำกว่านี้ = content เยอะมาก → ปล่อย paginate ตามธรรมชาติ (ดีกว่าตัวเล็กเกิน)
  const measureAndPrint = () => {
    const containers = w.document.querySelectorAll<HTMLElement>(".a4-container");
    let maxH = 0;
    containers.forEach((c) => {
      if (c.offsetHeight > maxH) maxH = c.offsetHeight;
    });
    if (maxH === 0) maxH = w.document.body.scrollHeight;
    const scale = A4_H / maxH;
    if (scale < 1 && scale >= MIN_SCALE) {
      const styleEl = w.document.createElement("style");
      styleEl.textContent = `body { zoom: ${scale.toFixed(3)}; }`;
      w.document.head.appendChild(styleEl);
    }
    w.focus();
    w.print();
  };

  // รอ font โหลด + render ครบก่อนวัด (พึ่ง fonts.ready เป็นหลัก)
  setTimeout(() => {
    const fonts = (w.document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) fonts.ready.then(measureAndPrint).catch(measureAndPrint);
    else measureAndPrint();
  }, 300);
}

export function printQuotation(d: QuotationDoc) {
  openPrint(quotationHtml(d));
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
};

type PreparedDoc = Record<string, unknown> & { docType: string; copyType: string };

function setupDoc(order: OrderLike, items: OrderItem[], docType: string, copyType: string): PreparedDoc {
  const docDate1_th = order.docDate1 ? formatThaiDate(order.docDate1) : new Date().toLocaleDateString("th-TH");
  const docDate2_th = order.docDate2 ? formatThaiDate(order.docDate2) : docDate1_th;
  const whtPercent = order.whtPercent || 0;
  const subDiscount = roundTo2((order.subTotal || 0) - (order.discount || 0));
  const netPayable = order.netPayable || order.grandTotal;

  // โมเดล inclusive: ยอดรวม VAT จาก line items (ราคา = รวม VAT) → ตรงกับที่ line item รวมได้
  const grandIncl = roundTo2(items.reduce((s, it) => s + it.price * it.qty, 0));
  const discountIncl = roundTo2(grandIncl - (order.grandTotal || 0));

  const doc: PreparedDoc = {
    docType,
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

  if (docType === "tax-invoice-deposit") doc.chequeDetails = formatChequeDetail(order.checkDetail1);
  else if (docType === "tax-invoice-balance" || docType === "tax-invoice-receipt" || docType === "tax-invoice-receipt-do")
    doc.chequeDetails = formatChequeDetail(order.checkDetail2);
  else doc.chequeDetails = "";

  if (docType === "invoice") {
    doc.receiptTitle = "ใบแจ้งหนี้/ใบส่งสินค้า";
    doc.receiptTitleEng = "Invoice / Delivery Order";
    doc.docNo = order.invNo;
    doc.outstandingBalance = roundTo2(netPayable - (order.deposit || 0));
    if ((order.deposit || 0) > 0) {
      const balVals = reverseCalcPrint(doc.outstandingBalance as number, whtPercent);
      doc.receiptPreVat = balVals.preVat;
      doc.receiptVat = balVals.vat;
      doc.receiptWht = balVals.wht;
      doc.depositPreVat = reverseCalcPrint(order.deposit, whtPercent).preVat;
    }
  } else if (docType === "invoice-only") {
    doc.receiptTitle = "ใบแจ้งหนี้";
    doc.receiptTitleEng = "Invoice";
    doc.docNo = order.invNo;
    doc.outstandingBalance = roundTo2(netPayable - (order.deposit || 0));
  } else if (docType === "tax-invoice-deposit") {
    doc.receiptTitle = "ใบกำกับภาษี/ใบเสร็จรับเงิน";
    doc.receiptTitleEng = "Tax Invoice / Receipt";
    doc.receiptAmount = order.deposit;
    doc.docNo = order.taxNo1;
    const v = reverseCalcPrint(order.deposit, whtPercent);
    doc.receiptPreVat = v.preVat;
    doc.receiptVat = v.vat;
    doc.receiptWht = v.wht;
    doc.outstandingBalance = 0;
  } else if (docType === "tax-invoice-balance") {
    doc.documentDate = docDate2_th;
    doc.receiptTitle = "ใบกำกับภาษี/ใบเสร็จรับเงิน";
    doc.receiptTitleEng = "Tax Invoice / Receipt";
    doc.receiptAmount = roundTo2(netPayable - (order.deposit || 0));
    doc.docNo = order.taxNo2;
    const v = reverseCalcPrint(doc.receiptAmount as number, whtPercent);
    doc.receiptPreVat = v.preVat;
    doc.receiptVat = v.vat;
    doc.receiptWht = v.wht;
    doc.depositPreVat = reverseCalcPrint(order.deposit, whtPercent).preVat;
    doc.outstandingBalance = 0;
  } else if (docType === "tax-invoice-receipt") {
    doc.documentDate = docDate2_th;
    doc.receiptTitle = "ใบกำกับภาษี/ใบเสร็จรับเงิน";
    doc.receiptTitleEng = "Tax Invoice / Receipt";
    doc.docNo = order.taxNo1;
    doc.outstandingBalance = 0;
  } else if (docType === "tax-invoice-receipt-do") {
    doc.documentDate = docDate2_th;
    doc.receiptTitle = "ใบกำกับภาษี/ใบเสร็จรับเงิน/ใบส่งสินค้า";
    doc.receiptTitleEng = "Tax Invoice / Receipt / Delivery Order";
    doc.docNo = order.taxNo1;
    doc.outstandingBalance = 0;
  }
  return doc;
}

// โมเดล inclusive: line items = ราคารวม VAT → รวมได้ = grandIncl · summary ถอด VAT ออก
function docSummaryRows(doc: PreparedDoc): string {
  const n = (k: string) => nf(Number(doc[k]) || 0);
  const whtP = Number(doc.whtPercent) || 0;
  const dt = doc.docType as string;
  const discInc = Number(doc.discountIncl) || 0;

  // แถวบนสุด: รวมเป็นเงิน (รวม VAT) = ยอดที่ line items รวมได้ + (หักส่วนลดถ้ามี)
  const head =
    `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">รวมเป็นเงิน (รวม VAT)</td><td style="padding:4px 12px;text-align:right;width:120px;border:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;vertical-align:bottom;">${n("grandIncl")}</td></tr>` +
    (discInc > 0.005
      ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">หักส่วนลด (รวม VAT)</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">-${n("discountIncl")}</td></tr>`
      : "");
  const whtRow = whtP > 0 ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">หัก ณ ที่จ่าย ${whtP}%</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">-${n("receiptWht")}</td></tr>` : "";

  if (dt === "tax-invoice-deposit") {
    return `${head}
      <tr><td style="padding:4px 12px;text-align:left;font-size:13px;font-weight:bold;color:#15803d;border-top:2px dashed #94a3b8;">มูลค่ามัดจำ (ก่อน VAT)</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;border-top:2px dashed #94a3b8;font-weight:bold;color:#15803d;">${n("receiptPreVat")}</td></tr>
      <tr><td style="padding:4px 12px;text-align:left;font-size:13px;">ภาษีมูลค่าเพิ่ม 7%</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">${n("receiptVat")}</td></tr>
      ${whtRow}
      <tr style="background-color:#f0fdf4;"><td style="padding:8px 12px;text-align:left;font-weight:bold;font-size:14px;border-bottom:4px double #15803d;color:#15803d;">ยอดรับมัดจำ (รวม VAT)</td><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:15px;border:2px solid #cbd5e1;border-bottom:4px double #15803d;color:#15803d;">${n("receiptAmount")}</td></tr>`;
  }
  if ((dt === "tax-invoice-balance" || dt === "invoice") && Number(doc.deposit) > 0) {
    const bal = dt === "tax-invoice-balance"
      ? `<tr style="background-color:#f0fdf4;"><td style="padding:8px 12px;text-align:left;font-weight:bold;font-size:14px;border-bottom:4px double #15803d;color:#15803d;">ยอดรับครั้งนี้ (รวม VAT)</td><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:15px;border:2px solid #cbd5e1;border-bottom:4px double #15803d;color:#15803d;">${n("receiptAmount")}</td></tr>`
      : `<tr style="background-color:#fff1f2;"><td style="padding:8px 12px;text-align:left;font-weight:bold;font-size:14px;border-bottom:4px double #be123c;color:#be123c;">ยอดค้างชำระ (รวม VAT)</td><td style="padding:8px 12px;text-align:right;font-weight:bold;font-size:15px;border:2px solid #cbd5e1;border-bottom:4px double #be123c;color:#be123c;">${n("outstandingBalance")}</td></tr>`;
    return `${head}
      <tr><td style="padding:4px 12px;text-align:left;font-size:13px;font-weight:600;color:#15803d;border-top:2px dashed #94a3b8;">หัก มัดจำรับแล้ว (ก่อน VAT)</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;border-top:2px dashed #94a3b8;color:#15803d;font-weight:600;">-${n("depositPreVat")}</td></tr>
      <tr><td style="padding:4px 12px;text-align:left;font-size:13px;font-weight:bold;color:#be123c;">ยอดคงค้างยกมา (ก่อน VAT)</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;font-weight:bold;color:#be123c;">${n("receiptPreVat")}</td></tr>
      <tr><td style="padding:4px 12px;text-align:left;font-size:13px;">ภาษีมูลค่าเพิ่ม 7%</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">${n("receiptVat")}</td></tr>
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
    <tr><td style="padding:4px 12px;text-align:left;font-size:13px;">มูลค่าสินค้า (ก่อน VAT)</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">${n("subDiscount")}</td></tr>
    <tr><td style="padding:4px 12px;text-align:left;font-size:13px;">ภาษีมูลค่าเพิ่ม 7% (รวมในราคาแล้ว)</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">${n("vatAmount")}</td></tr>
    <tr style="background-color:#f8fafc;"><td style="padding:6px 12px;text-align:left;font-weight:bold;font-size:13px;border-bottom:1px solid #cbd5e1;">ยอดรวมทั้งสิ้น</td><td style="padding:6px 12px;text-align:right;font-weight:bold;font-size:14px;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;color:#0f172a;border-bottom:1px solid #cbd5e1;background-color:#f1f5f9;">${n("grandTotal")}</td></tr>
    ${whtP > 0 ? `<tr><td style="padding:4px 12px;text-align:left;font-size:13px;">หัก ณ ที่จ่าย ${whtP}%</td><td style="padding:4px 12px;text-align:right;border-left:2px solid #cbd5e1;border-right:2px solid #cbd5e1;border-bottom:1px solid #cbd5e1;">-${n("whtAmount")}</td></tr>` : ""}
    ${netRow}${outRow}`;
}

function docSignatures(dt: string): string {
  const sig = (label: string, w = 180) => `<td style="vertical-align:top;"><div style="height:24px;"></div><div style="margin-top:5px;width:${w}px;border-top:1px dashed #64748b;margin-left:auto;margin-right:auto;"></div><div style="margin-top:5px;color:#475569;">( ${label} )</div><div style="margin-top:5px;color:#64748b;font-size:12px;">วันที่ / Date: ______/______/________</div></td>`;
  let cells = "";
  if (dt === "invoice-only") cells += sig("ผู้ชำระเงิน / Payer", 200);
  if (dt === "invoice" || dt === "tax-invoice-receipt-do") cells += sig("ผู้รับสินค้า / Receiver");
  if (dt === "invoice" || dt === "tax-invoice-receipt-do") cells += sig("ผู้ส่งสินค้า / Deliverer");
  if (["tax-invoice-deposit", "tax-invoice-balance", "tax-invoice-receipt", "tax-invoice-receipt-do"].includes(dt)) cells += sig("ผู้รับเงิน / Collector");
  cells += sig("ผู้มีอำนาจลงนาม / Auth. Signature");
  return `<table style="width:100%;margin-top:40px;text-align:center;font-size:13px;"><tr>${cells}</tr></table>`;
}

function bankOrPaymentBox(doc: PreparedDoc): string {
  const dt = doc.docType as string;
  if (dt.includes("invoice") && !dt.includes("tax-") && Number(doc.outstandingBalance) > 0) {
    return `<div style="border:2px solid #cbd5e1;padding:12px 15px;border-radius:8px;background-color:#fffbeb;box-sizing:border-box;">
      <div style="font-weight:600;margin-bottom:4px;color:#0f172a;font-size:13px;">ช่องทางการโอนเงิน / Bank Transfer:</div>
      <div style="color:#0f172a;line-height:1.4;margin-bottom:10px;font-size:14px;font-weight:500;">${COMPANY.bank}</div></div>`;
  }
  const cq =
    doc.paymentMethod === "เช็ค" && doc.chequeDetails
      ? `<div style="color:#475569;font-size:13px;margin-top:2px;"><span style="font-weight:600;">ข้อมูลเช็ค:</span> ${esc(doc.chequeDetails)}</div>`
      : "";
  return `<div style="border:2px solid #cbd5e1;padding:12px 15px;border-radius:8px;background-color:#f8fafc;box-sizing:border-box;">
    <div style="font-weight:600;color:#0f172a;font-size:13px;">การชำระเงินจะสมบูรณ์เมื่อบริษัทได้รับเงินเรียบร้อยแล้ว</div>
    <div style="color:#475569;font-size:13px;margin-top:4px;">อ้างอิงวิธีชำระ: ${esc(doc.paymentMethod || "ไม่ระบุ")}</div>${cq}</div>`;
}

function b2bDocHtml(doc: PreparedDoc, idx: number): string {
  const brk = idx > 0 ? "page-break-before:always;break-before:page;margin-top:15px;" : "";
  return `<div class="a4-container" style="${brk}font-family:'Kanit',sans-serif;color:#111;line-height:1.5;">
    ${companyHeader(doc.receiptTitle as string, doc.receiptTitleEng as string, doc.copyType)}
    <div style="display:flex;justify-content:space-between;width:100%;margin-bottom:15px;font-size:14px;box-sizing:border-box;">
      ${customerBox(doc.customerName as string, doc.customerAddress as string, doc.customerTaxId as string, doc.customerBranch as string)}
      <div style="width:41%;border:2px solid #cbd5e1;padding:12px 15px;border-radius:8px;background-color:#f8fafc;box-sizing:border-box;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:3px 0;font-weight:600;width:50%;">เลขที่ / Doc No.</td><td style="padding:3px 0;font-weight:500;text-align:right;">${esc(doc.docNo)}</td></tr>
          <tr><td style="padding:3px 0;font-weight:600;">วันที่ / Date</td><td style="padding:3px 0;text-align:right;">${esc(doc.documentDate)}</td></tr>
          <tr><td style="padding:3px 0;font-weight:600;">อ้างอิง / Ref No.</td><td style="padding:3px 0;text-align:right;">${esc(doc.quNo)}</td></tr>
        </table>
      </div>
    </div>
    ${itemsTable(doc.items as OrderItem[], false)}
    <div style="page-break-inside:avoid;break-inside:avoid;">
      <table style="width:100%;font-size:14px;"><tr>
        <td style="width:55%;vertical-align:bottom;padding-right:20px;">${bankOrPaymentBox(doc)}</td>
        <td style="width:45%;vertical-align:top;"><table style="width:100%;border-collapse:collapse;">${docSummaryRows(doc)}</table></td>
      </tr></table>
      ${docSignatures(doc.docType)}
    </div>
  </div>`;
}

/** พิมพ์เอกสารขาย (ต้นฉบับ + สำเนา ต่อ docType) */
export function printSalesDocs(order: OrderLike, items: OrderItem[], docTypes: string[]) {
  const docs: PreparedDoc[] = [];
  for (const dt of docTypes) {
    docs.push(setupDoc(order, items, dt, "(ต้นฉบับ / Original)"));
    docs.push(setupDoc(order, items, dt, "(สำเนา / Copy)"));
  }
  openPrint(docs.map((d, i) => b2bDocHtml(d, i)).join(""));
}
