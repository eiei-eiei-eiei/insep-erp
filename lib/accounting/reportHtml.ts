/**
 * lib/accounting/reportHtml — HTML รายงาน ภพ.30 + ภงด.3/53 (กลไก C: HTML → print/save PDF)
 * port จาก Reports.js generateTaxReportHTML / generateWHTReportHTML — โครง HTML/CSS ชุดเดิม
 *   (เปิดหน้าใหม่ กด "พิมพ์/บันทึก PDF" — เลย์เอาต์ตรงระบบเดิม 100% เพราะใช้ style ชุดเดียวกัน)
 * ข้อมูลตัวเลขมาจาก taxReport/whtReport (lib/accounting/calc, มี golden test)
 */
import { formatTaxId, formatBranch } from "../shared/format";
import type { TaxReport, WhtReport } from "./calc";

const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

export type EntityHeader = { name: string; tax_id?: string | null; branch?: string | null };

function fmtNum(n: number): string {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const BASE_PRINT_STYLES = `
  body { font-family: 'Sarabun','TH Sarabun New',sans-serif; background:#f3f4f6; margin:0; padding:20px; }
  @page { size: A4 landscape; margin: 10mm; }
  .page { width:297mm; min-height:210mm; margin:0 auto 20px auto; background:#fff; padding:10mm 15mm; box-shadow:0 0 10px rgba(0,0,0,.1); box-sizing:border-box; page-break-after:always; position:relative; }
  .text-center{text-align:center}.text-right{text-align:right}.text-left{text-align:left}.bold{font-weight:700}
  h1{font-size:16pt;margin:0;padding-bottom:5px}h2{font-size:14pt;margin:0;padding-bottom:10px;font-weight:400}
  .sec-title{font-size:14pt;margin:8px 0 4px}
  .info-table{width:100%;margin-bottom:8px;font-size:12pt;border-collapse:collapse}.info-table td{padding:2px}
  .data-table{width:100%;border-collapse:collapse;font-size:11pt;margin-bottom:8px}
  .data-table th,.data-table td{border:1px solid #000;padding:4px;vertical-align:middle;height:26px}.data-table th{background:#fff}
  .summary-box{width:50%;float:right;border-collapse:collapse;font-size:12pt;margin-top:5px}
  .summary-box th,.summary-box td{border:1px solid #000;padding:4px;height:26px}.summary-box th{background:#e5e7eb}
  .btn-print{display:block;width:350px;margin:0 auto 20px auto;padding:12px;background:#2563eb;color:#fff;text-align:center;font-size:16pt;font-weight:bold;border-radius:8px;cursor:pointer}
  .clearfix::after{content:"";clear:both;display:table}
  @media print{ body{background:none;padding:0}.page{margin:0;box-shadow:none;width:auto;min-height:auto}.page + .page{padding-top:14mm}.no-print{display:none!important} }
`;

/** A1 — HTML ภพ.30 (รายงานภาษีซื้อ-ขาย) */
export function taxReportHtml(period: string, entity: EntityHeader, r: TaxReport): string {
  const [sYear, sMonth] = period.split("-");
  const monthTh = TH_MONTHS[parseInt(sMonth, 10) - 1];
  const yearTh = parseInt(sYear, 10) + 543;
  const myBranch = formatBranch(entity.branch);
  const myHQ = myBranch.isHQ ? "/" : "&nbsp;&nbsp;&nbsp;";
  const myBranchMark = myBranch.isHQ ? "&nbsp;&nbsp;&nbsp;" : myBranch.text;

  const header = `<div><h1 class="text-center bold">รายงานภาษี</h1><h2 class="text-center">เดือนภาษี &nbsp;&nbsp;${monthTh}&nbsp;&nbsp;&nbsp;&nbsp; ปีภาษี ${yearTh}</h2><table class="info-table"><tr><td style="width:18%">ชื่อผู้ประกอบการ</td><td class="bold">${esc(entity.name)}</td><td style="width:40%">เลขประจำตัวผู้เสียภาษีอากร &nbsp;&nbsp;${formatTaxId(entity.tax_id)}</td></tr><tr><td>ชื่อสถานประกอบการ</td><td class="bold">${esc(entity.name)}</td><td>สำนักงานใหญ่ ${myHQ} &nbsp;&nbsp; สาขา ${myBranchMark}</td></tr></table></div>`;

  function tables(rows: TaxReport["sales"], typeStr: "sales" | "purch", title: string, grandAmt: number, grandVat: number, lead: string, append: string, rpp = 11): string {
    const chunks: TaxReport["sales"][] = [];
    if (rows.length === 0) chunks.push([]);
    else for (let i = 0; i < rows.length; i += rpp) chunks.push(rows.slice(i, i + rpp));
    let html = "";
    chunks.forEach((chunk, pIdx) => {
      const isLast = pIdx === chunks.length - 1;
      const isFirst = pIdx === 0;
      html += `<div class="page clearfix">${chunks.length > 1 ? `<div style="position:absolute;top:12mm;right:15mm;font-size:10pt;">หน้า ${pIdx + 1}/${chunks.length}</div>` : ""}`;
      if (isFirst && lead) html += lead;
      html += `<h2 class="sec-title text-center bold">${title}${chunks.length > 1 && !isFirst ? " (ต่อ)" : ""}</h2><table class="data-table"><thead><tr><th rowspan="2" style="width:5%">ลำดับที่</th><th rowspan="2" style="width:9%">วัน เดือน ปี</th><th rowspan="2" style="width:14%">เลขที่<br>ใบกำกับภาษี</th><th rowspan="2" style="width:25%">ชื่อผู้${typeStr === "sales" ? "รับ" : "ให้บริการ"}<br>สินค้า/บริการ</th><th rowspan="2" style="width:16%">เลขประจำตัวผู้เสียภาษีอากร<br>ของผู้${typeStr === "sales" ? "ซื้อ" : "ขาย"}สินค้าหรือบริการ</th><th colspan="2">สถานประกอบการ</th><th rowspan="2" style="width:11%">มูลค่าสินค้า<br>หรือบริการ</th><th rowspan="2" style="width:11%">จำนวนเงิน<br>ภาษีมูลค่าเพิ่ม</th></tr><tr><th style="width:4%">สนญ.</th><th style="width:5%">สาขา</th></tr></thead><tbody>`;
      if (chunk.length === 0) html += `<tr><td colspan="9" class="text-center" style="color:#6b7280;height:260px;">ไม่มีรายการในเดือนนี้</td></tr>`;
      else {
        chunk.forEach((row, i) => {
          html += `<tr><td class="text-center">${pIdx * rpp + i + 1}</td><td class="text-center">${row.date}</td><td class="text-center">${esc(row.invoiceNo)}</td><td class="text-left">${esc(row.name)}</td><td class="text-center">${row.taxId}</td><td class="text-center">${row.isHQMark}</td><td class="text-center">${row.branchMark}</td><td class="text-right">${fmtNum(row.amount)}</td><td class="text-right">${fmtNum(row.vat)}</td></tr>`;
        });
        for (let i = chunk.length; i < rpp; i++) html += `<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
      }
      html += `</tbody>`;
      if (isLast) html += `<tfoot><tr><td colspan="7" class="text-right bold">รวม</td><td class="text-right bold">${fmtNum(grandAmt)}</td><td class="text-right bold">${fmtNum(grandVat)}</td></tr></tfoot>`;
      html += `</table>${isLast && append ? append : ""}</div>`;
    });
    return html;
  }

  const netVat = r.totalSalesVat - r.totalPurchaseVat;
  const summary = `<div style="page-break-inside:avoid;"><table class="summary-box"><thead><tr><th colspan="2" class="text-center bold">สรุปการคำนวณภาษี</th></tr></thead><tbody><tr><td class="text-right" style="width:60%">ภาษีขายเดือนนี้</td><td class="text-right" style="width:40%">${fmtNum(r.totalSalesVat)}</td></tr><tr><td class="text-right">หัก ภาษีซื้อเดือนนี้</td><td class="text-right">${fmtNum(r.totalPurchaseVat)}</td></tr><tr><td class="text-right bold">ภาษีมูลค่าเพิ่มเดือนนี้</td><td class="text-right bold">${fmtNum(netVat)}</td></tr><tr><td class="text-right">หัก ภาษีซื้อยกมา</td><td class="text-right">${fmtNum(r.forwardedVatIn)}</td></tr><tr><td class="text-right bold" style="color:${r.netPayable >= 0 ? "red" : "green"};">${r.netPayable >= 0 ? "ภาษีที่ต้องชำระ (บวก)" : "ภาษีที่ชำระเกิน หรือเครดิตยกไป (ลบ)"}</td><td class="text-right bold">${fmtNum(r.netPayable)}</td></tr></tbody></table></div>`;

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>รายงานภาษี_${period}</title><style>${BASE_PRINT_STYLES}</style></head><body><div class="no-print"><div class="btn-print" onclick="window.print()">🖨️ สั่งพิมพ์ หรือ บันทึกเป็น PDF</div></div>${tables(r.sales, "sales", "รายงานภาษีขาย", r.totalSalesAmount, r.totalSalesVat, header, "", 11)}${tables(r.purchases, "purch", "รายงานภาษีซื้อ", r.totalPurchaseAmount, r.totalPurchaseVat, "", summary, 11)}</body></html>`;
}

/** A10 — HTML ภงด.3/53 */
export function whtReportHtml(period: string, entity: EntityHeader, w: WhtReport): string {
  const [sYear, sMonth] = period.split("-");
  const monthTh = TH_MONTHS[parseInt(sMonth, 10) - 1];
  const yearTh = parseInt(sYear, 10) + 543;

  function paginate(rows: WhtReport["pnd3"], typeName: string, totalPaid: number, totalWht: number): string {
    const chunks: WhtReport["pnd3"][] = [];
    if (rows.length === 0) chunks.push([]);
    else for (let i = 0; i < rows.length; i += 10) chunks.push(rows.slice(i, i + 10));
    let html = "";
    chunks.forEach((chunk, pIdx) => {
      const isLast = pIdx === chunks.length - 1;
      html += `<div class="page clearfix">${chunks.length > 1 ? `<div style="position:absolute;top:12mm;right:15mm;font-size:10pt;">หน้า ${pIdx + 1}/${chunks.length}</div>` : ""}`;
      html += `<h1 class="text-center bold">รายละเอียดการหักภาษี ณ ที่จ่าย (${typeName})</h1><h2 class="text-center">ประจำเดือน &nbsp;&nbsp;${monthTh}&nbsp;&nbsp;&nbsp;&nbsp; พ.ศ. ${yearTh}</h2>`;
      html += `<div style="font-size:12pt;margin-bottom:8px;"><span class="bold">ชื่อผู้มีหน้าที่หักภาษี:</span> ${esc(entity.name)} &nbsp;&nbsp;&nbsp;&nbsp;<span class="bold">เลขประจำตัวผู้เสียภาษี:</span> ${formatTaxId(entity.tax_id)}</div>`;
      html += `<table class="data-table"><thead><tr><th style="width:5%">ลำดับ</th><th style="width:10%">วัน เดือน ปี<br>ที่จ่าย</th><th style="width:18%">เลขประจำตัว<br>ผู้เสียภาษี</th><th style="width:25%">ชื่อผู้ถูกหักเงินได้</th><th style="width:16%">ประเภทเงินได้</th><th style="width:6%">อัตราภาษี<br>(ร้อยละ)</th><th style="width:10%">จำนวนเงิน<br>ที่จ่าย</th><th style="width:10%">จำนวนเงิน<br>ภาษีที่หัก</th></tr></thead><tbody>`;
      if (chunk.length === 0) html += `<tr><td colspan="8" class="text-center" style="color:#6b7280;height:260px;">ไม่มีรายการหักภาษี ณ ที่จ่าย ในหมวดหมู่นี้</td></tr>`;
      else {
        chunk.forEach((row, idx) => {
          const addr = row.address && row.address !== "-" ? `<div style="font-size:8.5pt;color:#4b5563;line-height:1.2;margin-top:3px;">${esc(row.address)}</div>` : "";
          html += `<tr><td class="text-center">${pIdx * 10 + idx + 1}</td><td class="text-center">${row.date}</td><td class="text-center">${row.taxId}</td><td class="text-left" style="padding-top:6px;padding-bottom:6px;"><span style="font-weight:500;">${esc(row.contactName)}</span>${addr}</td><td class="text-center">${esc(row.category)}</td><td class="text-center">${row.whtRate}%</td><td class="text-right">${fmtNum(row.amountPaid)}</td><td class="text-right">${fmtNum(row.whtAmount)}</td></tr>`;
        });
        for (let i = chunk.length; i < 10; i++) html += `<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
      }
      html += `</tbody>`;
      if (isLast) html += `<tfoot><tr><td colspan="6" class="text-right bold">รวมยอดทั้งสิ้น</td><td class="text-right bold">${fmtNum(totalPaid)}</td><td class="text-right bold">${fmtNum(totalWht)}</td></tr></tfoot>`;
      html += `</table></div>`;
    });
    return html;
  }

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>รายงานหักณที่จ่าย_${period}</title><style>${BASE_PRINT_STYLES}</style></head><body><div class="no-print"><div class="btn-print" onclick="window.print()">🖨️ สั่งพิมพ์ หรือ บันทึกเป็น PDF</div></div>${paginate(w.pnd3, "ภ.ง.ด.3 - บุคคลธรรมดา", w.pnd3TotalPaid, w.pnd3TotalWht)}${paginate(w.pnd53, "ภ.ง.ด.53 - นิติบุคคล", w.pnd53TotalPaid, w.pnd53TotalWht)}</body></html>`;
}
