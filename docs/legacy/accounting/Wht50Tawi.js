// =========================================================================
// FILE: Wht50Tawi.gs  [8/8]
// ส่วนที่ 3: ระบบจัดการและพิมพ์ 50 ทวิ (WHT Management) + forceFullAuth
// =========================================================================

function getOrCreatePndSheet(ss) {
  let sheet = ss.getSheetByName('pnd3-53');
  if (!sheet) {
    sheet = ss.insertSheet('pnd3-53');
    // [Multi-Entity] col 9 (J) = Entity_Id ผู้ออกหนังสือรับรอง (saveAndGenerate50Tawi เขียนค่าลง col นี้)
    sheet.appendRow(["Document_No","Issue_Date","Contact_Name","Amount_Before_WHT","WHT_Amount","PND_Type","Income_Seq","Other_Desc","Transaction_ID","Entity_Id"]);
  } else if (!String(sheet.getRange(1, 10).getValue()).trim()) {
    // ชีทเก่าที่ header มีแค่ 9 คอลัมน์ — เติม header J1 ให้ครบ (ค่าใน data row ถูกเขียนจาก appendRow อยู่แล้ว)
    sheet.getRange(1, 10).setValue("Entity_Id");
  }
  return sheet;
}

function getNextWhtDocNo() {
  try {
    const cfg   = getConfig_();
    const ss    = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const sheet = getOrCreatePndSheet(ss);

    // force column A เป็น Plain text — กัน Sheets auto-convert
    sheet.getRange('A:A').setNumberFormat('@');

    // format: ปี พ.ศ. 2 หลัก + ลำดับ เช่น "6901", "6902", "6903"
    const prefix = (new Date().getFullYear() + 543).toString().slice(-2);  // "69"

    let maxNum = 0;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const docNo = String(data[i][0] || '').trim();
      if (docNo.startsWith(prefix)) {
        const numPart = parseInt(docNo.substring(prefix.length));
        if (!isNaN(numPart) && numPart > maxNum) { maxNum = numPart; }
      }
    }
    // ลำดับถัดไป: "6901", "6902", ... "6999", "69100", ...
    return { success: true, docNo: prefix + (maxNum + 1).toString().padStart(2, '0') };
  } catch (e) {
    console.error(`[getNextWhtDocNo] ${e.message}`);
    return { success: false, message: e.message };
  }
}

function saveAndGenerate50Tawi(formData) {
  try {
    const cfg          = getConfig_();
    const ss           = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const txSheet      = ss.getSheetByName('Transactions');
    const pndSheet     = getOrCreatePndSheet(ss);
    const contactsSheet= ss.getSheetByName('Contacts');

    // รองรับทั้ง single item (formData.transactionId) และ merged items (formData.items)
    const items = formData.items && formData.items.length > 0
      ? formData.items
      : [{ transactionId: formData.transactionId, amount: null, whtAmount: null }];

    // ดึงข้อมูลจาก Transaction แรก (สำหรับ contactName, วันที่, payee info)
    const firstTxId = items[0].transactionId;
    let txData = null;
    const txRaw = txSheet.getDataRange().getValues();
    for (let i = 1; i < txRaw.length; i++) {
      if (txRaw[i][0] === firstTxId) {
        txData = {
          date       : txRaw[i][2],
          contactName: txRaw[i][6],
          amount     : parseFloat(txRaw[i][10]) || 0,
          whtRate    : parseFloat(txRaw[i][12]) || 0,
          whtAmount  : parseFloat(txRaw[i][13]) || 0
        };
        break;
      }
    }
    if (!txData) throw new Error("ไม่พบข้อมูล Transaction อ้างอิง");

    // ถ้า items มีค่าที่ส่งมา (merged) → ใช้ยอดรวม; ถ้าไม่มี → ใช้จาก Transaction
    const totalAmount = (items[0].amount != null)
      ? items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0)
      : txData.amount;
    const totalWht = (items[0].whtAmount != null)
      ? items.reduce((s, i) => s + (parseFloat(i.whtAmount) || 0), 0)
      : txData.whtAmount;

    let payeeTaxId = "-", payeeAddress = "-";
    const cData = contactsSheet.getDataRange().getValues();
    for (let i = 1; i < cData.length; i++) {
      if (cData[i][1] === txData.contactName) {
        payeeTaxId   = cData[i][2];
        payeeAddress = cData[i][4];
        break;
      }
    }

    const isCorporate = /บริษัท|บจก|ห้างหุ้นส่วน|หจก|บมจ|จำกัด/i.test(txData.contactName);
    const pndType     = isCorporate ? "ภ.ง.ด.53" : "ภ.ง.ด.3";

    // บันทึก 1 row ต่อ 1 เอกสาร (docNo)
    // เก็บ transactionId ทุกตัวรวมกันด้วย comma — getDashboardAndWhtData จะ split ตอนสร้าง issuedSet
    const allTxIds = items.map(i => i.transactionId).join(',');
    const entityId = formData.entityId || getConfig_().DEFAULT_ENTITY_ID;   // [Multi-Entity]
    pndSheet.appendRow([
      formData.docNo,   // column A ถูก setNumberFormat('@') ไว้แล้วใน getNextWhtDocNo
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"),
      txData.contactName,
      totalAmount,
      totalWht,
      pndType,
      formData.seq,
      formData.otherDesc || "",
      allTxIds,  // comma-separated transactionIds
      entityId   // [Multi-Entity] col 9 = entityId ผู้ออกหนังสือรับรอง
    ]);

    // [PDF-Template] เก็บวันที่จ่าย (จาก modal) ลง Transactions col W (col23/idx22 = paymentDate)
    // ใช้แสดง "วันเดือนปีที่จ่าย" ในใบ 50ทวิ และตอนพิมพ์ซ้ำดึงค่านี้กลับมา
    if (formData.paymentDate) {
      const idSet = {};
      items.forEach(it => { if (it.transactionId) idSet[it.transactionId] = true; });
      for (let i = 1; i < txRaw.length; i++) {
        if (idSet[txRaw[i][0]]) txSheet.getRange(i + 1, 23).setValue(formData.paymentDate);
      }
    }

    const printData = {
      docNo       : formData.docNo,
      pndType     : pndType,
      payeeName   : txData.contactName,
      payeeTaxId  : payeeTaxId,
      payeeAddress: payeeAddress,
      seq         : formData.seq,
      otherDesc   : formData.otherDesc,
      // ใช้วันที่จ่ายที่ user เลือกใน modal — fallback เป็น transactionDate ถ้าไม่ได้ส่งมา
      date        : formData.paymentDate ? new Date(formData.paymentDate) : txData.date,
      amount      : totalAmount,
      whtAmount   : totalWht,
      entInfo     : getEntityInfo_(entityId)   // [Multi-Entity] ผู้มีหน้าที่หักภาษี = กิจการที่เลือก
    };

    // [PDF-Template] field สำเร็จรูปสำหรับ fill เทมเพลต PDF ฝั่ง frontend
    printData.dateText    = formatDateThai(printData.date);          // วันเดือนปีที่จ่าย (col W)
    printData.bahtText    = ThaiBaht(printData.whtAmount);
    printData.issueDateISO = wht50ToISO_(txData.date);              // วันที่ออกหนังสือ = Transaction_Date (col C)

    // printData ใช้กับ PDF engine
    // ⚠️ sanitize: google.script.run แฮงเงียบถ้า return มี undefined/Date — JSON ทำให้เป็น plain ปลอดภัย
    const printDataSafe = JSON.parse(JSON.stringify(printData));
    return { success: true, printData: printDataSafe };
  } catch(e) { return { success: false, message: e.message }; }
}

function generate50TawiHTMLFromHistory(docNo) {
  try {
    const cfg = getConfig_();
    const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const pndSheet = ss.getSheetByName('pnd3-53');
    const txSheet = ss.getSheetByName('Transactions');
    const contactsSheet = ss.getSheetByName('Contacts');

    if(!pndSheet) throw new Error("ไม่พบฐานข้อมูลประวัติ");

    let pndRecord = null;
    const pndRaw = pndSheet.getDataRange().getValues();
    for(let i = 1; i < pndRaw.length; i++){
      if(pndRaw[i][0] === docNo) {
        pndRecord = {
          docNo        : pndRaw[i][0],
          payeeName    : pndRaw[i][2],
          amount       : pndRaw[i][3],
          whtAmount    : pndRaw[i][4],
          pndType      : pndRaw[i][5],
          seq          : pndRaw[i][6].toString(),
          otherDesc    : pndRaw[i][7],
          transactionId: pndRaw[i][8],
          entityId     : String(pndRaw[i][9] || '').trim() || 'EID01'   // [Multi-Entity]
        };
        break;
      }
    }
    if(!pndRecord) throw new Error("ไม่พบเอกสารเลขที่ " + docNo);

    // ใช้ transactionId ตัวแรก (pndRecord.transactionId อาจเป็น comma-separated ตอน merge)
    const firstTxId = String(pndRecord.transactionId || '').split(',')[0].trim();
    let txDate = '', txPayDate = '';
    const txRaw = txSheet.getDataRange().getValues();
    for(let i = 1; i < txRaw.length; i++){
      if(txRaw[i][0] === firstTxId) {
        txDate    = txRaw[i][2];   // col C = Transaction_Date (วันที่ออกหนังสือ)
        txPayDate = txRaw[i][22];  // col W = paymentDate (วันเดือนปีที่จ่าย)
        break;
      }
    }
    const incomeDate = txPayDate || txDate;  // วันที่จ่าย: ใช้ col W ก่อน, ไม่มีค่อย fallback col C

    let payeeTaxId = "-", payeeAddress = "-";
    const cData = contactsSheet.getDataRange().getValues();
    for (let i = 1; i < cData.length; i++) {
      if (cData[i][1] === pndRecord.payeeName) {
        payeeTaxId = cData[i][2];
        payeeAddress = cData[i][4];
        break;
      }
    }

    const printData = {
      docNo       : pndRecord.docNo,
      pndType     : pndRecord.pndType,
      payeeName   : pndRecord.payeeName,
      payeeTaxId  : payeeTaxId,
      payeeAddress: payeeAddress,
      seq         : pndRecord.seq,
      otherDesc   : pndRecord.otherDesc,
      date        : incomeDate,   // วันเดือนปีที่จ่าย (col W ก่อน, fallback col C)
      amount      : pndRecord.amount,
      whtAmount   : pndRecord.whtAmount,
      entInfo     : getEntityInfo_(pndRecord.entityId)   // [Multi-Entity]
    };

    // [PDF-Template] field สำเร็จรูปสำหรับ fill เทมเพลต PDF ฝั่ง frontend
    printData.dateText     = formatDateThai(printData.date);    // วันเดือนปีที่จ่าย
    printData.bahtText     = ThaiBaht(printData.whtAmount);
    printData.issueDateISO = wht50ToISO_(txDate);              // วันที่ออกหนังสือ = Transaction_Date (col C)

    // ⚠️ sanitize: google.script.run แฮงเงียบถ้า return มี undefined/Date — JSON ทำให้เป็น plain ปลอดภัย
    const printDataSafe = JSON.parse(JSON.stringify(printData));
    return { success: true, printData: printDataSafe };

  } catch(e) { return { success: false, message: e.message }; }
}

// [PDF-Template] แปลงค่าวันที่ (Date หรือ string) -> 'yyyy-MM-dd' สำหรับส่งให้ frontend
function wht50ToISO_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v || '');
}

// =========================================================================
// HTML Generator: ออกแบบฟอร์ม 50 ทวิให้เป๊ะตามแบบมาตรฐาน
// =========================================================================

function formatDateThai(dateVal) {
  if (!(dateVal instanceof Date)) dateVal = new Date(dateVal);
  if (isNaN(dateVal.getTime())) return "-";
  const thMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${dateVal.getDate()} ${thMonths[dateVal.getMonth()]} ${(dateVal.getFullYear() + 543).toString().slice(-2)}`;
}

// สร้างกล่องสี่เหลี่ยมสำหรับตัวเลข 13 หลัก
function renderTaxIdBoxes(taxId) {
  if (!taxId) taxId = "";
  taxId = taxId.toString().replace(/['" ]/g, '').trim();
  if (/^[0-9]+$/.test(taxId) && taxId.length > 0 && taxId.length < 13) {
    taxId = taxId.padStart(13, '0');
  } else if (taxId.length < 13) {
    taxId = taxId.padEnd(13, ' ');
  }
  let html = '<div style="display:inline-flex; align-items: center; margin-left: 5px;">';
  for (let i = 0; i < 13; i++) {
    let val = taxId[i] && taxId[i].trim() ? taxId[i] : '&nbsp;';
    html += `<span style="display:inline-block; width: 14px; height: 18px; line-height: 18px; text-align: center; border: 1px solid #000; margin-right: 1px; font-size: 11pt; font-family: monospace; box-sizing: border-box;">${val}</span>`;
    if (i === 0 || i === 4 || i === 9 || i === 11) html += '<span style="margin: 0 2px; font-weight:bold;">-</span>';
  }
  html += '</div>';
  return html;
}

// วาดกล่องฟอร์มเต็มกระดาษ
function get50TawiFullHTML(data, isCopy1) {
  // ดึงข้อมูลบริษัทจาก Script Properties
  const cfg = getConfig_();
  // [Multi-Entity] ผู้มีหน้าที่หักภาษี = ข้อมูลกิจการที่เลือก (fallback COMPANY_* เดิม)
  const issuer = data.entInfo || { name: cfg.COMPANY_NAME, taxId: cfg.COMPANY_TAX_ID, address: cfg.COMPANY_ADDRESS };

  const copyText = isCopy1
    ? "ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)"
    : "ฉบับที่ 2 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)";

  let checkMarks = { '1': '&nbsp;', '2': '&nbsp;', '3': '&nbsp;', '4': '&nbsp;', '5': '&nbsp;', '6': '&nbsp;' };
  checkMarks[data.seq] = '✓';

  let pnd1k = "&nbsp;", pnd1k_sp = "&nbsp;", pnd2 = "&nbsp;", pnd3 = "&nbsp;", pnd53 = "&nbsp;";
  if (data.pndType === "ภ.ง.ด.3") pnd3 = "✓";
  else if (data.pndType === "ภ.ง.ด.53") pnd53 = "✓";

  let dateTh = formatDateThai(data.date);
  let amtFormatted = formatNumber(data.amount);
  let taxFormatted = formatNumber(data.whtAmount);
  let bahtText = ThaiBaht(data.whtAmount);

  return `
    <div class="certificate-full">
      <div style="font-size: 11pt; font-weight: bold; margin-bottom: 5px;">${copyText}</div>

      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; margin-top: 5px;">
        <div style="width: 20%;"></div>
        <div style="width: 60%; text-align: center;">
          <div style="font-weight: bold; font-size: 16pt;">หนังสือรับรองการหักภาษี ณ ที่จ่าย</div>
          <div style="font-size: 12pt;">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</div>
        </div>
        <div style="width: 20%; text-align: right; font-size: 11pt; padding-top: 5px;">
          เลขที่ <span style="display:inline-block; width: 90px; text-align:center; border-bottom: 1px dotted #000;">${data.docNo}</span>
        </div>
      </div>

      <!-- ข้อมูลผู้จ่าย: ใช้ cfg.COMPANY_* แทน hardcoded const -->
      <div class="box-section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div><b>ผู้มีหน้าที่หักภาษี ณ ที่จ่าย :</b></div>
          <div style="display: flex; align-items: center;">
             <span style="margin-right: 5px;">เลขประจำตัวผู้เสียภาษีอากร (13 หลัก)*</span>
             ${renderTaxIdBoxes(issuer.taxId)}
          </div>
        </div>
        <div style="display: flex; margin-bottom: 6px; align-items: flex-start;">
           <div style="width: 40px; flex-shrink: 0; line-height: 1.5;">ชื่อ</div>
           <div style="border-bottom: 1px dotted #000; flex-grow: 1; line-height: 1.5; word-break: break-word;">${issuer.name}</div>
        </div>
        <div style="display: flex; align-items: flex-start;">
           <div style="width: 40px; flex-shrink: 0; line-height: 1.5;">ที่อยู่</div>
           <div style="border-bottom: 1px dotted #000; flex-grow: 1; line-height: 1.5; word-break: break-word;">${issuer.address}</div>
        </div>
      </div>

      <!-- ข้อมูลผู้รับ -->
      <div class="box-section" style="margin-top: -1px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div><b>ผู้ถูกหักภาษี ณ ที่จ่าย :</b></div>
          <div style="display: flex; align-items: center;">
             <span style="margin-right: 5px;">เลขประจำตัวผู้เสียภาษีอากร (13 หลัก)*</span>
             ${renderTaxIdBoxes(data.payeeTaxId)}
          </div>
        </div>
        <div style="display: flex; margin-bottom: 6px; align-items: flex-start;">
           <div style="width: 40px; flex-shrink: 0; line-height: 1.5;">ชื่อ</div>
           <div style="border-bottom: 1px dotted #000; flex-grow: 1; line-height: 1.5; word-break: break-word;">${data.payeeName}</div>
        </div>
        <div style="display: flex; margin-bottom: 6px; align-items: flex-start;">
           <div style="width: 40px; flex-shrink: 0; line-height: 1.5;">ที่อยู่</div>
           <div style="border-bottom: 1px dotted #000; flex-grow: 1; line-height: 1.5; word-break: break-word;">${data.payeeAddress}</div>
        </div>
        <div style="margin-top: 8px; font-size: 10.5pt;">
          ลำดับที่ <span style="border-bottom: 1px dotted #000; display:inline-block; width:50px;"></span> ในแบบ
          <span class="check-box" style="margin-left:8px;">${pnd1k}</span> ภ.ง.ด.1ก
          <span class="check-box" style="margin-left:8px;">${pnd1k_sp}</span> ภ.ง.ด.1ก พิเศษ
          <span class="check-box" style="margin-left:8px;">${pnd2}</span> ภ.ง.ด.2
          <span class="check-box" style="margin-left:8px;">${pnd3}</span> ภ.ง.ด.3
          <span class="check-box" style="margin-left:8px;">${pnd53}</span> ภ.ง.ด.53
        </div>
      </div>

      <!-- ตารางประเภทเงินได้ -->
      <table class="grid-table" style="margin-top: 10px;">
        <thead>
          <tr>
            <th style="width: 60%; padding: 8px;">ประเภทเงินได้ที่จ่าย</th>
            <th style="width: 15%; padding: 8px;">วัน เดือน ปี<br>ที่จ่าย</th>
            <th style="width: 12.5%; padding: 8px;">จำนวนเงินที่จ่าย</th>
            <th style="width: 12.5%; padding: 8px;">ภาษีที่หัก<br>และนำส่งไว้</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 6px;"><span class="check-box">${checkMarks['1']}</span> 1. เงินเดือน ค่าจ้าง บำนาญ ฯลฯ ตามมาตรา 40 (1) (2)</td>
            <td class="text-center" style="padding: 6px;">${data.seq === '1' ? dateTh : ''}</td>
            <td class="text-right" style="padding: 6px;">${data.seq === '1' ? amtFormatted : ''}</td>
            <td class="text-right" style="padding: 6px;">${data.seq === '1' ? taxFormatted : ''}</td>
          </tr>
          <tr>
            <td style="padding: 6px;"><span class="check-box">${checkMarks['2']}</span> 2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)</td>
            <td class="text-center" style="padding: 6px;">${data.seq === '2' ? dateTh : ''}</td>
            <td class="text-right" style="padding: 6px;">${data.seq === '2' ? amtFormatted : ''}</td>
            <td class="text-right" style="padding: 6px;">${data.seq === '2' ? taxFormatted : ''}</td>
          </tr>
          <tr>
            <td style="padding: 6px;"><span class="check-box">${checkMarks['3']}</span> 3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)</td>
            <td class="text-center" style="padding: 6px;">${data.seq === '3' ? dateTh : ''}</td>
            <td class="text-right" style="padding: 6px;">${data.seq === '3' ? amtFormatted : ''}</td>
            <td class="text-right" style="padding: 6px;">${data.seq === '3' ? taxFormatted : ''}</td>
          </tr>
          <tr>
            <td style="padding: 6px;"><span class="check-box">${checkMarks['4']}</span> 4. (ก) ดอกเบี้ย ฯลฯ ตามมาตรา 40 (4) (ก)</td>
            <td class="text-center" style="padding: 6px;">${data.seq === '4' ? dateTh : ''}</td>
            <td class="text-right" style="padding: 6px;">${data.seq === '4' ? amtFormatted : ''}</td>
            <td class="text-right" style="padding: 6px;">${data.seq === '4' ? taxFormatted : ''}</td>
          </tr>
          <tr>
            <td style="padding: 6px; line-height: 1.4;"><span class="check-box" style="float:left;">${checkMarks['5']}</span> <div style="margin-left: 22px;">5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากร<br>(เช่น รางวัล, ส่วนลด, ค่าจ้างทำของ, ค่าเช่า, ค่าขนส่ง, ค่าบริการ ฯลฯ)</div></td>
            <td class="text-center" style="padding: 6px; vertical-align: bottom;">${data.seq === '5' ? dateTh : ''}</td>
            <td class="text-right" style="padding: 6px; vertical-align: bottom;">${data.seq === '5' ? amtFormatted : ''}</td>
            <td class="text-right" style="padding: 6px; vertical-align: bottom;">${data.seq === '5' ? taxFormatted : ''}</td>
          </tr>
          <tr>
            <td style="padding: 6px;"><span class="check-box">${checkMarks['6']}</span> 6. อื่นๆ (ระบุ) <span style="border-bottom: 1px dotted #000;">${data.seq === '6' ? data.otherDesc : '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;'}</span></td>
            <td class="text-center" style="padding: 6px;">${data.seq === '6' ? dateTh : ''}</td>
            <td class="text-right" style="padding: 6px;">${data.seq === '6' ? amtFormatted : ''}</td>
            <td class="text-right" style="padding: 6px;">${data.seq === '6' ? taxFormatted : ''}</td>
          </tr>
          <tr>
            <td class="text-right" colspan="2" style="font-weight: bold; padding: 6px;">รวมเงินที่จ่ายและภาษีที่หักนำส่ง</td>
            <td class="text-right" style="font-weight: bold; padding: 6px;">${amtFormatted}</td>
            <td class="text-right" style="font-weight: bold; padding: 6px;">${taxFormatted}</td>
          </tr>
          <tr>
            <td colspan="4" style="padding: 6px;">
               <b>รวมเงินภาษีที่หักนำส่ง (ตัวอักษร)</b> &nbsp;&nbsp;&nbsp; ${bahtText}
            </td>
          </tr>
        </tbody>
      </table>

      <!-- บรรทัดเงินที่จ่ายเข้ากองทุน — อยู่นอกตารางคำนวณ เหนือบรรทัดผู้จ่ายเงิน -->
      <div style="margin-top: 8px; margin-bottom: 8px; font-size: 10.5pt; line-height: 1.8;">
        <b>เงินที่จ่ายเข้า</b>
        กบข./กสจ./กองทุนสงเคราะห์ครูโรงเรียนเอกชน<span style="display:inline-block; width:80px; border-bottom: 1px dotted #000; margin: 0 4px; vertical-align: bottom;"></span>บาท
        &nbsp;&nbsp; กองทุนประกันสังคม<span style="display:inline-block; width:80px; border-bottom: 1px dotted #000; margin: 0 4px; vertical-align: bottom;"></span>บาท
        &nbsp;&nbsp; กองทุนสำรองเลี้ยงชีพ<span style="display:inline-block; width:80px; border-bottom: 1px dotted #000; margin: 0 4px; vertical-align: bottom;"></span>บาท
      </div>

      <div style="margin-top: 12px; font-size: 11pt;">
        <b>ผู้จ่ายเงิน</b>
        <span class="check-box" style="margin-left: 10px;">✓</span> (1) หัก ณ ที่จ่าย &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
        <span class="check-box"></span> (2) ออกให้ตลอดไป &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
        <span class="check-box"></span> (3) ออกให้ครั้งเดียว &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
        <span class="check-box"></span> (4) อื่น ๆ ...................
      </div>

      <div style="display: flex; margin-top: 15px; font-size: 11pt; align-items: flex-start;">
        <div style="width: 32%; padding: 8px; border: 1px solid #000; box-sizing: border-box;">
          <div style="text-align: center; font-weight: bold; margin-bottom: 5px; font-size: 11pt;">คำเตือน</div>
          <div style="font-size: 9.5pt; line-height: 1.4; text-align: left;">
            ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย ฝ่าฝืนไม่ปฏิบัติตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร ต้องรับโทษทางอาญาตามมาตรา 35 แห่งประมวลรัษฎากร
          </div>
        </div>
        <div style="width: 68%; padding-left: 20px; box-sizing: border-box;">
          <div style="margin-bottom: 20px; text-align: left; font-size: 11pt; font-weight: bold; white-space: nowrap;">
            ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ
          </div>
          <div style="display: flex; justify-content: space-between; align-items: flex-end;">
             <div style="text-align: center; flex-grow: 1;">
                <div style="margin-bottom: 8px;">ลงชื่อ ............................................................................ ผู้จ่ายเงิน</div>
                <div style="margin-bottom: 12px;">( ............................................................................ )</div>
                <div>วัน เดือน ปี ที่ออกหนังสือรับรองฯ ....... / ....... / ...........</div>
             </div>
             <div style="margin-left: 15px;">
                <div style="width: 70px; height: 70px; border: 1px dashed #666; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                   <span style="font-size: 8.5pt; color: #666; line-height: 1.3; text-align: center;">ประทับตรา<br>นิติบุคคล<br>(ถ้ามี)</span>
                </div>
             </div>
          </div>
        </div>
      </div>

      <div style="margin-top: 15px; font-size: 9.5pt; border-top: 1px solid #ccc; padding-top: 8px; line-height: 1.4;">
        <b>หมายเหตุ</b> เลขประจำตัวผู้เสียภาษีอากร (13 หลัก)* หมายถึง<br>
        1. กรณีบุคคลธรรมดาไทย ให้ใช้เลขประจำตัวประชาชนของกรมการปกครอง<br>
        2. กรณีนิติบุคคล ให้ใช้เลขทะเบียนนิติบุคคลของกรมพัฒนาธุรกิจการค้า<br>
        3. กรณีอื่นๆ นอกเหนือจาก 1. และ 2. ให้ใช้เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) ของกรมสรรพากร
      </div>
    </div>
  `;
}

function build50TawiHTML(data) {
  const css = `
    body { font-family: 'Sarabun', sans-serif; background-color: #f3f4f6; margin: 0; padding: 20px; }
    @page { size: A4 portrait; margin: 0; }
    .page-a4 { width: 210mm; height: 297mm; margin: 0 auto 20px auto; background: #fff; padding: 10mm; box-shadow: 0 0 10px rgba(0,0,0,0.1); box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-start; page-break-after: always; }
    .certificate-full { min-height: 100%; padding: 0; box-sizing: border-box; position: relative; }
    .box-section { border: 1px solid #333; padding: 8px; line-height: 1.6; }
    .grid-table { width: 100%; border-collapse: collapse; font-size: 11pt; margin-top: 10px; }
    .grid-table th, .grid-table td { border: 1px solid #333; vertical-align: middle; }
    .grid-table th { text-align: center; font-weight: normal; }
    .text-center { text-align: center; } .text-right { text-align: right; } .text-left { text-align: left; }
    .check-box { display: inline-block; width: 14px; height: 14px; border: 1px solid #000; text-align: center; line-height: 14px; font-size: 10pt; font-weight: bold; margin-right: 4px; vertical-align: middle; }
    .btn-print { display: block; width: 350px; margin: 0 auto 20px auto; padding: 15px; background: #2563eb; color: #fff; text-align: center; font-size: 18pt; font-weight: bold; border-radius: 8px; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    .btn-print:hover { background: #1d4ed8; }
    .no-print { display: block; }
    @media print {
      body { background: none; padding: 0; }
      .page-a4 { margin: 0; padding: 10mm; box-shadow: none; width: 210mm; height: 297mm; page-break-after: always; }
      .no-print { display: none !important; }
      .certificate-full, .box-section, .grid-table th, .grid-table td { border-color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;

  const copy1 = get50TawiFullHTML(data, true);
  const copy2 = get50TawiFullHTML(data, false);

  return `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <title>หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) - ${data.docNo}</title>
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap" rel="stylesheet">
      <style>${css}</style>
    </head>
    <body>
      <div class="no-print"><div class="btn-print" onclick="window.print()">🖨️ สั่งพิมพ์ A4 (2 หน้า)</div></div>
      <div class="page-a4">${copy1}</div>
      <div class="page-a4">${copy2}</div>
    </body>
    </html>
  `;
}

// =========================================================================
// [PDF-Template] เสิร์ฟเทมเพลต PDF + ฟอนต์ไทยเป็น base64 ให้ frontend
// ใช้โฟลเดอร์ Drive เดียวกับรายงานแอปผลิต (มีฟอนต์ .ttf อยู่แล้ว) —
// หาไฟล์จากโฟลเดอร์อัตโนมัติ ไม่ต้องตั้ง Script Property:
//   - เทมเพลต: ไฟล์ .pdf ที่ชื่อมี 'wh3' (ฟอร์ม 50 ทวิ AcroForm), fallback = .pdf ตัวแรก
//   - ฟอนต์  : ไฟล์ .ttf ตัวแรกในโฟลเดอร์ (แนะนำ THSarabun ที่มี glyph ครบ)
// คืน base64 ทั้งคู่ในครั้งเดียว (frontend cache ไว้ ไม่ต้องโหลดซ้ำ)
// =========================================================================
const WHT50_TEMPLATE_FOLDER_ID = '1chaDKOfLxgCbLT0oWHGJDEhoXzkZnrVK';  // โฟลเดอร์เดียวกับ REPORT_TEMPLATE_FOLDER_ID ของแอปผลิต

function getWht50Assets() {
  try {
    const folder = DriveApp.getFolderById(WHT50_TEMPLATE_FOLDER_ID);

    // --- หาเทมเพลต PDF (ชื่อมี 'wh3' ก่อน, ไม่งั้นเอา .pdf ตัวแรก) ---
    let templateFile = null, firstPdf = null;
    const pdfIt = folder.getFiles();
    while (pdfIt.hasNext()) {
      const f = pdfIt.next();
      const name = String(f.getName()).toLowerCase();
      if (name.slice(-4) !== '.pdf') continue;
      if (!firstPdf) firstPdf = f;
      if (name.indexOf('wh3') !== -1) { templateFile = f; break; }
    }
    templateFile = templateFile || firstPdf;
    if (!templateFile) throw new Error('ไม่พบไฟล์เทมเพลต .pdf ในโฟลเดอร์ Drive');

    // --- หาฟอนต์ .ttf ตัวแรก ---
    let fontFile = null;
    const fontIt = folder.getFiles();
    while (fontIt.hasNext()) {
      const f = fontIt.next();
      if (String(f.getName()).toLowerCase().slice(-4) === '.ttf') { fontFile = f; break; }
    }
    if (!fontFile) throw new Error('ไม่พบไฟล์ฟอนต์ (.ttf) ในโฟลเดอร์ Drive — กรุณาอัปโหลด THSarabun*.ttf');

    return {
      success      : true,
      template     : Utilities.base64Encode(templateFile.getBlob().getBytes()),
      font         : Utilities.base64Encode(fontFile.getBlob().getBytes()),
      templateName : templateFile.getName(),
      fontName     : fontFile.getName()
    };
  } catch (e) {
    console.error(`[getWht50Assets] ${e.message}`);
    return { success: false, message: e.message };
  }
}

// อัปเดตฟังก์ชันนี้เพื่อใช้สำหรับกระตุ้นขอสิทธิ์ API ได้รวดเร็ว
function forceFullAuth() {
  // เอา try...catch ออก เพื่อบังคับให้ระบบแครชและเด้งหน้าต่างขอสิทธิ์ขึ้นมา
  const cfg = getConfig_();
  UrlFetchApp.fetch("https://www.google.com");
  DriveApp.getFolderById(cfg.RECEIPT_FOLDER_ID || '1jviKAd0dJ-KPMXflWIWsa6x5GnrYr5DJ');
  Logger.log("Authorization OK");
}
