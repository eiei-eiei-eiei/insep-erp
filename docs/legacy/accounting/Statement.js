// =========================================================================
// FILE: Statement.gs  [12/12]
// [Phase 2] N4 พิมพ์ statement รายบัญชี/รายเดือน (PDF) + N5 drill-down รายการรายเดือน
//   - generateStatementHTML : คืน HTML พร้อมพิมพ์ (ใช้ BASE_PRINT_STYLES + formatNumber จาก Reports.gs)
//   - getMonthTransactions  : รายการ รายรับ/รายจ่าย ของกิจการ+เดือน (สำหรับ drill-down แดชบอร์ด)
//   ทั้งคู่ skip AP/AR ค้าง (col 21) + ใช้ paymentDate (col 22) เป็น ledger date ถ้ามี
// ⚠️ [Option A] col 4 = ชื่อบัญชี — statement filter ด้วยชื่อบัญชี (ไม่ใช่ accountId)
// =========================================================================

/**
 * [Phase 2 / N4] สร้าง HTML statement รายบัญชี ประจำเดือน (พร้อมยอดยกมา + running balance)
 * @param {string} accountName - ชื่อบัญชี (ตรงกับ col 4 ของ Transactions)
 * @param {string} period      - "yyyy-MM"
 * @returns {{ success, htmlContent }}
 */
function generateStatementHTML(accountName, period) {
  try {
    const ss = SpreadsheetApp.openById(getConfig_().SPREADSHEET_ID);
    const tz = Session.getScriptTimeZone();

    const acc = getAccounts_().find(a => a.accountName === accountName);
    if (!acc) return { success: false, message: 'ไม่พบบัญชี ' + accountName };
    // ชื่อกิจการจาก entity แรกที่บัญชีนี้สังกัด (บัญชีใช้ร่วมจะโชว์ entity แรก)
    const ent = (acc.entityIds && acc.entityIds.length)
      ? (getEntityById_(acc.entityIds[0]) || { name: '' })
      : { name: '' };

    const thMonths = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
    const [sYear, sMonth] = period.split('-');
    const reportMonthTh = thMonths[parseInt(sMonth) - 1];
    const reportYearTh  = parseInt(sYear) + 543;

    const data = ss.getSheetByName('Transactions').getDataRange().getValues();
    // ledger date = paymentDate (col 22) ถ้ามี ไม่งั้น transactionDate (col 2)
    const ledgerDate = row => { const pd = row[22]; const d = pd ? pd : row[2]; return (d instanceof Date) ? d : new Date(d); };
    const ym = d => Utilities.formatDate(d, tz, "yyyy-MM");

    let opening = parseFloat(acc.openingBalance) || 0;   // ยอดยกมาจาก Accounts
    const inPeriod = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[18] !== 'ปกติ') continue;
      if (row[21]) continue;                 // ข้าม AP/AR ที่ยังค้าง
      if (String(row[4] || '').trim() !== accountName) continue;

      const type = row[3];
      const net  = parseFloat(row[14]) || 0;
      let signed = 0;
      if (type === 'รายรับ')              signed = net;
      else if (type === 'รายจ่าย')         signed = -net;
      else if (type === 'โอนระหว่างบัญชี') signed = net;   // net มีเครื่องหมายอยู่แล้ว (+เข้า/-ออก)
      else continue;

      const ld = ledgerDate(row);
      if (isNaN(ld.getTime())) continue;
      const m = ym(ld);
      if (m < period)        opening += signed;   // ก่อน period → ยอดยกมา
      else if (m === period) inPeriod.push({ date: ld, desc: row[7] || row[5] || '-', contact: row[6] || '', inv: row[15] || '', signed: signed });
    }

    inPeriod.sort((a, b) => a.date - b.date);

    let bal = opening, totIn = 0, totOut = 0, rowsHtml = '';
    inPeriod.forEach(r => {
      bal += r.signed;
      const credit = r.signed > 0 ? formatNumber(r.signed) : '';
      const debit  = r.signed < 0 ? formatNumber(-r.signed) : '';
      if (r.signed > 0) totIn += r.signed; else totOut += -r.signed;
      const dd = `${("0"+r.date.getDate()).slice(-2)}/${("0"+(r.date.getMonth()+1)).slice(-2)}/${r.date.getFullYear()+543}`;
      rowsHtml += `<tr><td class="text-center">${dd}</td><td class="text-left">${r.desc}</td><td class="text-left">${r.contact}</td><td class="text-center">${r.inv||'-'}</td><td class="text-right">${credit}</td><td class="text-right">${debit}</td><td class="text-right">${formatNumber(bal)}</td></tr>`;
    });
    if (inPeriod.length === 0) rowsHtml = `<tr><td colspan="7" class="text-center" style="color:#6b7280;height:120px;">ไม่มีรายการในเดือนนี้</td></tr>`;

    const htmlContent = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>Statement_${accountName}_${period}</title>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap" rel="stylesheet"><style>${BASE_PRINT_STYLES}</style></head>
      <body><div class="no-print"><div class="btn-print" onclick="window.print()">🖨️ สั่งพิมพ์ หรือ บันทึกเป็น PDF</div></div>
      <div class="page clearfix">
        <div class="page-title-block">
          <h1 class="text-center bold">รายการเดินบัญชี (Statement)</h1>
          <h2 class="text-center">${ent.name} — ${acc.accountName}</h2>
          <h2 class="text-center">ประจำเดือน ${reportMonthTh} ${reportYearTh}</h2>
        </div>
        <table class="data-table">
          <thead><tr>
            <th style="width:11%;">วันที่</th><th style="width:30%;">รายละเอียด</th><th style="width:20%;">คู่ค้า/ลูกค้า</th>
            <th style="width:13%;">เลขที่เอกสาร</th><th style="width:10%;">รับ (+)</th><th style="width:10%;">จ่าย (-)</th><th style="width:13%;">คงเหลือ</th>
          </tr></thead>
          <tbody>
            <tr><td colspan="6" class="text-right bold">ยอดยกมา</td><td class="text-right bold">${formatNumber(opening)}</td></tr>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr><td colspan="4" class="text-right bold">รวมเคลื่อนไหวเดือนนี้</td><td class="text-right bold">${formatNumber(totIn)}</td><td class="text-right bold">${formatNumber(totOut)}</td><td class="text-right bold">${formatNumber(bal)}</td></tr>
          </tfoot>
        </table>
      </div></body></html>`;

    return { success: true, htmlContent: htmlContent };
  } catch (e) {
    console.error(`[generateStatementHTML] ${e.message}`);
    return { success: false, message: e.message };
  }
}

/**
 * [Phase 2 / N5] รายการ transaction ของกิจการ+เดือน+ชนิด (drill-down จากแดชบอร์ด)
 * skip AP/AR ค้าง · ใช้ paymentDate(22)||taxInvoiceDate(16)||transactionDate(2) เป็นวันแสดง
 * @param {string} entityId - กิจการที่เลือก
 * @param {string} period   - "yyyy-MM"
 * @param {string} type     - 'รายรับ' | 'รายจ่าย'
 * @returns {{ success, results }}
 */
function getMonthTransactions(entityId, period, type) {
  try {
    const ss = SpreadsheetApp.openById(getConfig_().SPREADSHEET_ID);
    const tz = Session.getScriptTimeZone();
    const data = ss.getSheetByName('Transactions').getDataRange().getValues();
    const out = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[18] !== 'ปกติ') continue;
      if (row[21]) continue;                                   // ข้าม AP/AR ค้าง
      if (!inEntityScope_(row[TX_ENTITY_COL], entityId)) continue;
      if (row[3] !== type) continue;

      // วันที่อ้างอิงรายงาน = taxInvoiceDate(16) ถ้ามี ไม่งั้น transactionDate(2) — ตรงกับ dashboard
      const dateVal = row[16] ? row[16] : row[2];
      const dStr = (dateVal instanceof Date) ? Utilities.formatDate(dateVal, tz, "yyyy-MM") : String(dateVal).substring(0, 7);
      if (dStr !== period) continue;

      const disp = (dateVal instanceof Date) ? Utilities.formatDate(dateVal, tz, "dd/MM/yyyy") : String(dateVal);
      out.push({
        txId       : row[0],
        date       : disp,
        contact    : row[6] || '',
        category   : row[5] || '',
        description: row[7] || '',
        amount     : parseFloat(row[10]) || 0,   // amountAfterDiscount (ฐานก่อน VAT)
        vat        : parseFloat(row[11]) || 0,
        net        : parseFloat(row[14]) || 0
      });
    }
    return JSON.parse(JSON.stringify({ success: true, results: out }));
  } catch (e) {
    console.error(`[getMonthTransactions] ${e.message}`);
    return { success: false, message: e.message };
  }
}
