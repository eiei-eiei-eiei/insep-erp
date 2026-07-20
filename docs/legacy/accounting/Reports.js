// =========================================================================
// FILE: Reports.gs  [7/8]
// ส่วนที่ 2: รายงาน VAT (ภพ.30) + ภงด.3/53 + แดชบอร์ด
// ⚠️ global ที่ประกาศที่นี่ (BASE_PRINT_STYLES) ห้ามประกาศซ้ำในไฟล์อื่น
// =========================================================================

function formatNumber(num) { return Number(num).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}); }

function getPreviousVAT(period, entityId) {
  try {
    const cfg = getConfig_();
    const tz = Session.getScriptTimeZone();
    const scopeEntity = entityId || cfg.DEFAULT_ENTITY_ID;
    const sumSheet = SpreadsheetApp.openById(cfg.SPREADSHEET_ID).getSheetByName('Tax_Summaries');
    if (!sumSheet) return { success: true, forwardedVat: 0 };

    // คำนวณ period เดือนก่อนหน้า
    const p = period.split('-');
    let year = parseInt(p[0]);
    let month = parseInt(p[1]) - 1;
    if (month === 0) { month = 12; year -= 1; }
    const prevPeriod = `${year}-${month.toString().padStart(2, '0')}`;

    const data = sumSheet.getDataRange().getValues();
    for (let i = data.length - 1; i > 0; i--) {
      const cell = data[i][0];
      // Sheets อาจ auto-convert "2026-04" → Date object เพราะหน้าตาเหมือน ISO date
      // ต้อง normalize ก่อนเปรียบเทียบเสมอ
      const cellPeriod = (cell instanceof Date)
        ? Utilities.formatDate(cell, tz, "yyyy-MM")
        : cell.toString().trim();

      // [Multi-Entity] match ทั้ง period และ entity (legacy แถวที่ col 9 ว่าง = EID01)
      const rowEntity = String(data[i][9] || '').trim() || 'EID01';
      if (cellPeriod === prevPeriod && rowEntity === scopeEntity) {
        return { success: true, forwardedVat: parseFloat(data[i][7]) || 0, prevPeriod: prevPeriod };
      }
    }
    return { success: true, forwardedVat: 0, prevPeriod: prevPeriod };
  } catch (e) { return { success: false, message: e.message }; }
}

const BASE_PRINT_STYLES = `
  body { font-family: 'Sarabun', sans-serif; background-color: #f3f4f6; margin: 0; padding: 20px; }
  @page { size: A4 landscape; margin: 10mm; }
  .page { width: 297mm; min-height: 210mm; margin: 0 auto 20px auto; background: #fff; padding: 10mm 15mm; box-shadow: 0 0 10px rgba(0,0,0,0.1); box-sizing: border-box; page-break-after: always; position: relative; }
  .text-center { text-align: center; } .text-right { text-align: right; } .text-left { text-align: left; } .bold { font-weight: 700; }
  h1 { font-size: 16pt; margin: 0; padding-bottom: 5px; page-break-after: avoid; break-after: avoid; }
  h2 { font-size: 14pt; margin: 0; padding-bottom: 10px; font-weight: 400; page-break-after: avoid; break-after: avoid; }
  .page-title-block { page-break-inside: avoid; break-inside: avoid; }
  .sec-title { font-size: 14pt; margin: 8px 0 4px; page-break-after: avoid; break-after: avoid; }
  .info-table { width: 100%; margin-bottom: 8px; font-size: 12pt; border-collapse: collapse; } .info-table td { padding: 2px; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 11pt; margin-bottom: 8px; }
  .data-table th, .data-table td { border: 1px solid #000; padding: 4px; vertical-align: middle; height: 26px; } .data-table th { background-color: #fff; }
  .summary-box { width: 50%; float: right; border-collapse: collapse; font-size: 12pt; margin-top: 5px; }
  .summary-box th, .summary-box td { border: 1px solid #000; padding: 4px; height: 26px; } .summary-box th { background-color: #e5e7eb; }
  .btn-print { display: block; width: 350px; margin: 0 auto 20px auto; padding: 12px; background: #2563eb; color: #fff; text-align: center; font-size: 16pt; font-weight: bold; border-radius: 8px; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.1); } .btn-print:hover { background: #1d4ed8; }
  .clearfix::after { content: ""; clear: both; display: table; }
  @media print {
    body { background: none; padding: 0; }
    .page { margin: 0; box-shadow: none; width: auto; min-height: auto; }
    /* เพิ่ม padding-top สำหรับหน้าที่ 2 เป็นต้นไป กัน combining char ของภาษาไทยชนขอบ */
    .page + .page { padding-top: 14mm; }
    .no-print { display: none !important; }
    .data-table th, .data-table td, .summary-box th, .summary-box td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

function generateTaxReportHTML(period, forwardedVatIn, entityId) {
  try {
    const cfg = getConfig_();
    const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const txSheet = ss.getSheetByName('Transactions');
    // [Multi-Entity] หัวกระดาษ + เลขภาษี ใช้ของกิจการที่เลือก (fallback COMPANY_* ถ้าไม่พบ)
    const entInfo = getEntityInfo_(entityId);
    const thMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
    const [sYear, sMonth] = period.split('-');
    const reportMonthTh = thMonths[parseInt(sMonth) - 1]; const reportYearTh = parseInt(sYear) + 543;

    const contactMap = {};
    const cData = ss.getSheetByName('Contacts')?.getDataRange().getValues() || [];
    for (let i = 1; i < cData.length; i++) contactMap[cData[i][1]] = { taxId: cData[i][2], branch: cData[i][3] };

    // [Phase A] โหลด taxAccountSet ครั้งเดียวก่อน loop — กัน Settings อ่านซ้ำทุก row
    const taxAccountSet = getTaxAccountSet_(ss);

    const data = txSheet.getDataRange().getValues();
    // สะสมเฉพาะ amountAfterDiscount (col[10]) — คำนวณ VAT รวมรอบเดียวตอนสรุป
    // ไม่ sum vatAmount ทีละ row เพราะอาจเกิด rounding error สะสม
    let sales = [], purchases = [], tSAmt = 0, tPAmt = 0;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // [Phase A] เปลี่ยนจาก row[4] === 'บัญชีบริษัท' → taxAccountSet.has(row[4])
      // รองรับบัญชีในระบบภาษีหลายบัญชี (เช่น บัญชีกสิกร, บัญชี SCB ฯลฯ)
      // [Multi-Entity] filter เฉพาะรายการของกิจการที่เลือก — กันรายการกิจการอื่นปนใน ภพ.30
      if (row[18] === 'ปกติ' && !row[21] && inEntityScope_(row[TX_ENTITY_COL], entityId) && taxAccountSet.has(row[4]) && (parseFloat(row[11]) || 0) > 0) {   // [Phase 2] !row[21] = ข้าม AP/AR ค้าง
        // --- filter ด้วย transactionDate (col[2]) เสมอ ---
        // เพื่อให้รายการเข้าเดือนที่บันทึกจริง ไม่ใช่วันที่บนใบกำกับ
        const filterDateVal = row[2];
        let dStr = "";
        if (filterDateVal instanceof Date) {
          dStr = Utilities.formatDate(filterDateVal, Session.getScriptTimeZone(), "yyyy-MM");
        } else {
          dStr = filterDateVal.toString().substring(0, 7);
        }

        if (dStr === period) {
          // --- แสดงวันที่ในรายงานด้วย taxInvoiceDate (col[16]) ---
          // เพราะวันที่บนใบกำกับภาษีต้องตรงกับเอกสารจริงที่นำส่งสรรพากร
          // fallback กลับมา transactionDate ถ้าไม่มี taxInvoiceDate
          const displayDateVal = row[16] ? row[16] : filterDateVal;
          let disp;
          if (displayDateVal instanceof Date) {
            disp = `${("0"+displayDateVal.getDate()).slice(-2)}.${("0"+(displayDateVal.getMonth()+1)).slice(-2)}.${(displayDateVal.getFullYear()+543).toString().slice(-2)}`;
          } else {
            disp = displayDateVal.toString();
          }

          const cInfo = contactMap[row[6]] || { taxId: '', branch: '' };
          const formattedTaxId = formatTaxId(cInfo.taxId);
          const branchInfo = formatBranch(cInfo.branch);
          const isHQMark = branchInfo.isHQ ? '/' : '';
          const branchMark = branchInfo.isHQ ? '' : branchInfo.text;
          const amtAfterDisc = parseFloat(row[10]) || 0;
          const vatAmt       = parseFloat(row[11]) || 0;

          // sortTs = วันที่ใบกำกับ (taxInvoiceDate ก่อน, fallback transactionDate) เป็น timestamp ไว้เรียงลำดับ
          const sortDate = (displayDateVal instanceof Date) ? displayDateVal : new Date(displayDateVal);
          const sortTs   = (sortDate instanceof Date && !isNaN(sortDate.getTime())) ? sortDate.getTime() : 0;

          // col: [วันที่(taxInvoice), เลขใบกำกับ, ชื่อ, taxId, HQ, branch, amountAfterDiscount, vatAmount, sortTs]
          const rec = [ disp, row[15]||'-', row[6], formattedTaxId, isHQMark, branchMark, amtAfterDisc, vatAmt, sortTs ];
          if (row[3] === 'รายรับ')  { sales.push(rec);     tSAmt += amtAfterDisc; }
          else if (row[3] === 'รายจ่าย') { purchases.push(rec); tPAmt += amtAfterDisc; }
        }
      }
    }

    // เรียงรายการตามวันที่ในใบกำกับ (เก่า→ใหม่) ด้วย sortTs (rec[8]) — เลขลำดับที่ในตารางจะไล่ตามวันที่
    sales.sort((a, b) => a[8] - b[8]);
    purchases.sort((a, b) => a[8] - b[8]);

    // คำนวณ VAT รอบเดียวจากยอดรวม amountAfterDiscount × 7%
    const tSVat = Math.round(tSAmt * 7 / 100 * 100) / 100;
    const tPVat = Math.round(tPAmt * 7 / 100 * 100) / 100;

    const netPayable = (tSVat - tPVat) - forwardedVatIn;
    const forwardedVatOut = netPayable < 0 ? Math.abs(netPayable) : 0;

    // บังคับ period เป็น text ด้วย apostrophe นำหน้า กัน Sheets auto-convert เป็น Date
    // (ถ้าไม่ทำ getPreviousVAT เดือนถัดไปจะอ่านค่าไม่ได้)
    let sumSheet = ss.getSheetByName('Tax_Summaries');
    if (!sumSheet) {
      sumSheet = ss.insertSheet('Tax_Summaries');
      sumSheet.appendRow(["Report_Month","Total_Sales_Amount","Total_Sales_VAT","Total_Purchase_Amount","Total_Purchase_VAT","Forwarded_VAT_In","Net_Payable","Forwarded_VAT_Out","Timestamp","Entity_Id"]);
      // กำหนด col A เป็น Plain text ถาวร กัน auto-convert ทุกแถวในอนาคต
      sumSheet.getRange("A:A").setNumberFormat("@");
    }
    sumSheet.appendRow([
      "'" + period,   // apostrophe บังคับ text — จะแสดงใน cell เป็น "2026-04" ปกติ
      tSAmt, tSVat, tPAmt, tPVat, forwardedVatIn, netPayable, forwardedVatOut,
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      entityId || cfg.DEFAULT_ENTITY_ID   // [Multi-Entity] col 9 = Entity_Id (VAT ยกยอดแยกต่อกิจการ)
    ]);

    // [Multi-Entity] หัวกระดาษใช้ข้อมูลกิจการที่เลือก
    const myBranchInfo = formatBranch(entInfo.branch);
    const myHQMark = myBranchInfo.isHQ ? '/' : '&nbsp;&nbsp;&nbsp;';
    const myBranchMark = myBranchInfo.isHQ ? '&nbsp;&nbsp;&nbsp;' : myBranchInfo.text;

    // หัวกระดาษบริษัท (แสดงหน้าแรกของรายงานหน้าเดียว) — รายงานภาษี + เดือน/ปี + ข้อมูลผู้ประกอบการ
    const companyHeaderHtml = `<div class="page-title-block"><h1 class="text-center bold">รายงานภาษี</h1><h2 class="text-center">เดือนภาษี &nbsp;&nbsp;&nbsp;&nbsp;${reportMonthTh}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ปีภาษี ${reportYearTh}</h2><table class="info-table"><tr><td style="width: 18%;">ชื่อผู้ประกอบการ</td><td class="bold">${entInfo.name}</td><td style="width: 40%;">เลขประจำตัวผู้เสียภาษีอากร &nbsp;&nbsp;${formatTaxId(entInfo.taxId)}</td></tr><tr><td>ชื่อสถานประกอบการ</td><td class="bold">${entInfo.name}</td><td>สำนักงานใหญ่ ${myHQMark} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; สาขา ${myBranchMark}</td></tr></table></div>`;

    // แบ่งหน้า 11 แถว/หน้า · leadHtml = หัวบริษัท (เฉพาะหน้าแรกของ section) · รวม+appendHtml(สรุป) หน้าสุดท้าย
    // ขาย: ส่ง companyHeaderHtml (หน้าแรก) → หน้า 1. ซื้อ: ส่ง '' (ไม่ซ้ำหัวบริษัท) + sHtml → หน้า 2
    function buildPaginatedTables(dataArr, typeStr, sectionTitle, grandAmt, grandVat, leadHtml = "", appendHtml = "", rowsPerPage = 11) {
      let html = "", chunks = [];
      if (dataArr.length === 0) chunks.push([]); else for (let i = 0; i < dataArr.length; i += rowsPerPage) chunks.push(dataArr.slice(i, i + rowsPerPage));
      chunks.forEach((chunk, pIdx) => {
        let isLast = pIdx === chunks.length - 1;
        let isFirst = pIdx === 0;
        html += `<div class="page clearfix">${chunks.length>1?`<div style="position:absolute;top:12mm;right:15mm;font-size:10pt;">หน้า ${pIdx+1}/${chunks.length}</div>`:''}`;
        if (isFirst && leadHtml) html += leadHtml;
        html += `<h2 class="sec-title text-center bold">${sectionTitle}${chunks.length>1 && !isFirst ? ' (ต่อ)' : ''}</h2><table class="data-table"><thead><tr><th rowspan="2" style="width: 5%;">ลำดับที่</th><th rowspan="2" style="width: 9%;">วัน เดือน ปี</th><th rowspan="2" style="width: 14%;">เลขที่<br>ใบกำกับภาษี</th><th rowspan="2" style="width: 25%;">ชื่อผู้${typeStr === 'sales' ? 'รับ' : 'ให้บริการ'}<br>สินค้า/บริการ</th><th rowspan="2" style="width: 16%;">เลขประจำตัวผู้เสียภาษีอากร<br>ของผู้${typeStr === 'sales' ? 'ซื้อ' : 'ขาย'}สินค้าหรือบริการ</th><th colspan="2">สถานประกอบการ</th><th rowspan="2" style="width: 11%;">มูลค่าสินค้า<br>หรือบริการ</th><th rowspan="2" style="width: 11%;">จำนวนเงิน<br>ภาษีมูลค่าเพิ่ม</th></tr><tr><th style="width: 4%;">สนญ.</th><th style="width: 5%;">สาขา</th></tr></thead><tbody>`;
        if (chunk.length === 0) html += `<tr><td colspan="9" class="text-center" style="color:#6b7280;height:260px;">ไม่มีรายการในเดือนนี้</td></tr>`;
        else {
          chunk.forEach((r, i) => html += `<tr><td class="text-center">${(pIdx*rowsPerPage)+i+1}</td><td class="text-center">${r[0]}</td><td class="text-center">${r[1]}</td><td class="text-left">${r[2]}</td><td class="text-center">${r[3]}</td><td class="text-center">${r[4]}</td><td class="text-center">${r[5]}</td><td class="text-right">${formatNumber(r[6])}</td><td class="text-right">${formatNumber(r[7])}</td></tr>`);
          for (let i = chunk.length; i < rowsPerPage; i++) html += `<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
        }
        html += `</tbody>`;
        if (isLast) html += `<tfoot><tr><td colspan="7" class="text-right bold">รวม</td><td class="text-right bold">${formatNumber(grandAmt)}</td><td class="text-right bold">${formatNumber(grandVat)}</td></tr></tfoot>`;
        html += `</table>${isLast && appendHtml ? appendHtml : ''}</div>`;
      });
      return html;
    }

    const sHtml = `<div style="page-break-inside: avoid;"><table class="summary-box"><thead><tr><th colspan="2" class="text-center bold">สรุปการคำนวณภาษี</th></tr></thead><tbody><tr><td class="text-right" style="width: 60%;">ภาษีขายเดือนนี้</td><td class="text-right" style="width: 40%;">${formatNumber(tSVat)}</td></tr><tr><td class="text-right">หัก ภาษีซื้อเดือนนี้</td><td class="text-right">${formatNumber(tPVat)}</td></tr><tr><td class="text-right bold">ภาษีมูลค่าเพิ่มเดือนนี้</td><td class="text-right bold">${formatNumber(tSVat - tPVat)}</td></tr><tr><td class="text-right">หัก ภาษีซื้อยกมา</td><td class="text-right">${formatNumber(forwardedVatIn)}</td></tr><tr><td class="text-right bold" style="color: ${netPayable>=0?'red':'green'};">${netPayable>=0?"ภาษีที่ต้องชำระ (บวก)":"ภาษีที่ชำระเกิน หรือเครดิตยกไป (ลบ)"}</td><td class="text-right bold">${formatNumber(netPayable)}</td></tr></tbody></table></div>`;
    return { success: true, htmlContent: `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>รายงานภาษี_${period}</title><link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap" rel="stylesheet"><style>${BASE_PRINT_STYLES}</style></head><body><div class="no-print"><div class="btn-print" onclick="window.print()">🖨️ สั่งพิมพ์ หรือ บันทึกเป็น PDF</div></div>${buildPaginatedTables(sales, 'sales', "รายงานภาษีขาย", tSAmt, tSVat, companyHeaderHtml, "", 11)}${buildPaginatedTables(purchases, 'purch', "รายงานภาษีซื้อ", tPAmt, tPVat, "", sHtml, 11)}</body></html>` };
  } catch (e) { return { success: false, message: e.message }; }
}

function generateWHTReportHTML(period, entityId) {
  try {
    const cfg = getConfig_();
    const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const txSheet = ss.getSheetByName('Transactions');
    const contactsSheet = ss.getSheetByName('Contacts');
    const entInfo = getEntityInfo_(entityId);   // [Multi-Entity] หัวกระดาษต่อกิจการ

    const thMonths = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
    const [sYear, sMonth] = period.split('-');
    const reportMonthTh = thMonths[parseInt(sMonth) - 1];
    const reportYearTh = parseInt(sYear) + 543;

    const contactMap = {};
    if (contactsSheet) {
      const cData = contactsSheet.getDataRange().getValues();
      for (let i = 1; i < cData.length; i++) {
        contactMap[cData[i][1]] = { taxId: cData[i][2], branch: cData[i][3], address: cData[i][4] };
      }
    }

    const data = txSheet.getDataRange().getValues();
    let pnd3 = [], pnd53 = [];

    // [Phase A] โหลด taxAccountSet ครั้งเดียวก่อน loop
    const taxAccountSet = getTaxAccountSet_(ss);

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const type = row[3];
      const account = row[4];
      const whtAmt = parseFloat(row[13]) || 0;

      // [Phase A] เปลี่ยนจาก account === 'บัญชีบริษัท' → taxAccountSet.has(account)
      // [Multi-Entity] filter เฉพาะกิจการที่เลือก
      if (row[18] === 'ปกติ' && !row[21] && inEntityScope_(row[TX_ENTITY_COL], entityId) && taxAccountSet.has(account) && type === 'รายจ่าย' && whtAmt > 0) {   // [Phase 2] !row[21] = ข้าม AP/AR ค้าง
        const dateVal = row[2];
        let dStr = "", displayDate = dateVal;

        if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
          dStr = Utilities.formatDate(dateVal, Session.getScriptTimeZone(), "yyyy-MM");
          const yy = (dateVal.getFullYear() + 543).toString().slice(-2);
          const mm = ("0" + (dateVal.getMonth() + 1)).slice(-2);
          const dd = ("0" + dateVal.getDate()).slice(-2);
          displayDate = `${dd}/${mm}/${yy}`;
        } else {
          dStr = dateVal.toString().substring(0, 7);
        }

        if (dStr === period) {
          const contactName = row[6];
          const category = row[5];
          const amountPaid = parseFloat(row[10]) || 0;
          const whtRate = parseFloat(row[12]) || 0;
          const cInfo = contactMap[contactName] || { taxId: '-', branch: '-', address: '-' };
          const formattedTaxId = formatTaxId(cInfo.taxId);
          const record = [ displayDate, formattedTaxId, contactName, category, whtRate, amountPaid, whtAmt, cInfo.address ];
          const isCorporate = /บริษัท|บจก|ห้างหุ้นส่วน|หจก|บมจ|จำกัด/i.test(contactName);
          if (isCorporate) { pnd53.push(record); } else { pnd3.push(record); }
        }
      }
    }

    function buildWhtPaginated(dataArr, typeName) {
      let pagesHtml = "";
      let chunks = [];
      if (dataArr.length === 0) chunks.push([]);
      else for (let i = 0; i < dataArr.length; i += 10) chunks.push(dataArr.slice(i, i + 10));

      let totalPaidGrand = 0; let totalWhtGrand = 0;
      dataArr.forEach(r => { totalPaidGrand += parseFloat(r[5]) || 0; totalWhtGrand += parseFloat(r[6]) || 0; });

      chunks.forEach((chunk, pageIndex) => {
        let isLastPage = (pageIndex === chunks.length - 1);
        pagesHtml += `<div class="page clearfix">`;
        if (chunks.length > 1) {
          pagesHtml += `<div style="position: absolute; top: 12mm; right: 15mm; font-size: 10pt;">หน้า ${pageIndex + 1}/${chunks.length}</div>`;
        }
        pagesHtml += `<h1 class="text-center bold">รายละเอียดการหักภาษี ณ ที่จ่าย (${typeName})</h1>`;
        pagesHtml += `<h2 class="text-center">ประจำเดือน &nbsp;&nbsp;&nbsp;&nbsp;${reportMonthTh}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; พ.ศ. ${reportYearTh}</h2>`;
        pagesHtml += `<div style="font-size: 12pt; margin-bottom: 8px;">
          <span class="bold">ชื่อผู้มีหน้าที่หักภาษี:</span> ${entInfo.name} &nbsp;&nbsp;&nbsp;&nbsp;
          <span class="bold">เลขประจำตัวผู้เสียภาษี:</span> ${formatTaxId(entInfo.taxId)}
        </div>`;
        pagesHtml += `
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 5%;">ลำดับ</th>
              <th style="width: 10%;">วัน เดือน ปี<br>ที่จ่าย</th>
              <th style="width: 18%;">เลขประจำตัว<br>ผู้เสียภาษี</th>
              <th style="width: 25%;">ชื่อผู้ถูกหักเงินได้</th>
              <th style="width: 16%;">ประเภทเงินได้</th>
              <th style="width: 6%;">อัตราภาษี<br>(ร้อยละ)</th>
              <th style="width: 10%;">จำนวนเงิน<br>ที่จ่าย</th>
              <th style="width: 10%;">จำนวนเงิน<br>ภาษีที่หัก</th>
            </tr>
          </thead>
          <tbody>`;
        if (chunk.length === 0) {
          pagesHtml += `<tr><td colspan="8" class="text-center" style="color: #6b7280; height: 260px;">ไม่มีรายการหักภาษี ณ ที่จ่าย ในหมวดหมู่นี้</td></tr>`;
        } else {
          chunk.forEach((row, idx) => {
            let globalIndex = (pageIndex * 10) + idx + 1;
            let addressHtml = (row[7] && row[7] !== '-')
              ? `<div style="font-size: 8.5pt; color: #4b5563; line-height: 1.2; margin-top: 3px;">${row[7]}</div>`
              : '';
            pagesHtml += `<tr>
              <td class="text-center">${globalIndex}</td>
              <td class="text-center">${row[0]}</td>
              <td class="text-center">${row[1]}</td>
              <td class="text-left" style="padding-top: 6px; padding-bottom: 6px;">
                 <span style="font-weight: 500;">${row[2]}</span>
                 ${addressHtml}
              </td>
              <td class="text-center">${row[3]}</td>
              <td class="text-center">${row[4]}%</td>
              <td class="text-right">${formatNumber(row[5])}</td>
              <td class="text-right">${formatNumber(row[6])}</td>
            </tr>`;
          });
          for (let i = chunk.length; i < 10; i++) {
            pagesHtml += `<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;
          }
        }
        pagesHtml += `</tbody>`;
        if (isLastPage) {
          pagesHtml += `
            <tfoot>
              <tr>
                <td colspan="6" class="text-right bold">รวมยอดทั้งสิ้น</td>
                <td class="text-right bold">${formatNumber(totalPaidGrand)}</td>
                <td class="text-right bold">${formatNumber(totalWhtGrand)}</td>
              </tr>
            </tfoot>`;
        }
        pagesHtml += `</table></div>`;
      });
      return pagesHtml;
    }

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>รายงานหักณที่จ่าย_${period}</title>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;700&display=swap" rel="stylesheet">
      <style>${BASE_PRINT_STYLES}</style>
    </head>
    <body>
      <div class="no-print"><div class="btn-print" onclick="window.print()">🖨️ สั่งพิมพ์ หรือ บันทึกเป็น PDF</div></div>
      ${buildWhtPaginated(pnd3, 'ภ.ง.ด.3 - บุคคลธรรมดา')}
      ${buildWhtPaginated(pnd53, 'ภ.ง.ด.53 - นิติบุคคล')}
    </body>
    </html>
    `;
    return { success: true, htmlContent: htmlContent };
  } catch (e) { return { success: false, message: e.message }; }
}

// =========================================================================
// แดชบอร์ด + ข้อมูล WHT ค้างออก 50ทวิ (เรียกจากหน้าแดชบอร์ด)
// =========================================================================

function getDashboardAndWhtData(period, entityId) {
  try {
    const cfg = getConfig_();
    const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const txSheet = ss.getSheetByName('Transactions');
    const pndSheet = getOrCreatePndSheet(ss);

    const issuedSet = new Set();
    const historyData = [];
    const pndRaw = pndSheet.getDataRange().getValues();
    for (let i = 1; i < pndRaw.length; i++) {
      // normalize เป็น string — กัน Sheets คืน number แทน "69-001"
      const rawDocNo = String(pndRaw[i][0] || '').trim();
      if (rawDocNo) {
        // col[8] อาจมี txId หลายอันคั่น comma (กรณี merge) — mark ทั้งหมดเป็น issued
        String(pndRaw[i][8] || '').split(',').forEach(id => {
          const tid = id.trim();
          if (tid) issuedSet.add(tid);
        });
        // [Multi-Entity] pnd3-53 col 9 (index 9) = entityId (legacy ว่าง = EID01)
        const pndEntity = String(pndRaw[i][9] || '').trim() || 'EID01';
        let dStr = "";
        let dVal = pndRaw[i][1];
        if (dVal instanceof Date) dStr = Utilities.formatDate(dVal, Session.getScriptTimeZone(), "yyyy-MM");
        else dStr = dVal.toString().substring(0, 7);

        if (dStr === period && inEntityScope_(pndEntity, entityId)) {
          historyData.push({
            docNo      : rawDocNo,
            issueDate  : (dVal instanceof Date) ? Utilities.formatDate(dVal, Session.getScriptTimeZone(), "dd/MM/yyyy") : dVal,
            contactName: pndRaw[i][2],
            whtAmount  : pndRaw[i][4],
            pndType    : pndRaw[i][5]
          });
        }
      }
    }

    const data = txSheet.getDataRange().getValues();
    let sumIncome = 0, sumExpense = 0, sumVatOut = 0, sumVatIn = 0;
    let pendingWht = [];

    // [Phase A] โหลด taxAccountSet ครั้งเดียวก่อน loop
    const taxAccountSet = getTaxAccountSet_(ss);

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // [Phase A] เปลี่ยนจาก row[4] === 'บัญชีบริษัท' → taxAccountSet.has(row[4])
      // [Multi-Entity] filter เฉพาะรายการของกิจการที่เลือก
      if (row[18] === 'ปกติ' && !row[21] && inEntityScope_(row[TX_ENTITY_COL], entityId) && taxAccountSet.has(row[4]) && (row[16] || row[2])) {   // [Phase 2] !row[21] = ข้าม AP/AR ค้าง
        const txId = row[0];
        const dateVal = row[16] ? row[16] : row[2];
        let dStr = dateVal instanceof Date ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), "yyyy-MM") : dateVal.toString().substring(0, 7);

        if (dStr === period) {
          const type = row[3];
          const amount = parseFloat(row[10]) || 0;
          const vat = parseFloat(row[11]) || 0;
          const whtAmount = parseFloat(row[13]) || 0;

          if (type === 'รายรับ') { sumIncome += amount; sumVatOut += vat; }
          else if (type === 'รายจ่าย') {
            sumExpense += amount; sumVatIn += vat;
            if (whtAmount > 0 && !issuedSet.has(txId)) {
              let dispDate = (dateVal instanceof Date) ? Utilities.formatDate(dateVal, Session.getScriptTimeZone(), "dd/MM/yyyy") : dateVal;
              pendingWht.push({
                transactionId: txId,
                displayDate  : dispDate,
                contactName  : row[6],
                category     : row[5],
                amount       : amount,
                whtAmount    : whtAmount,
                whtRate      : parseFloat(row[12]) || 0
              });
            }
          }
        }
      }
    }

    return {
      success   : true,
      dash      : { income: sumIncome, expense: sumExpense, vatOut: sumVatOut, vatIn: sumVatIn },
      whtPending: pendingWht,
      whtHistory: historyData
    };

  } catch (e) { return { success: false, message: e.message }; }
}
