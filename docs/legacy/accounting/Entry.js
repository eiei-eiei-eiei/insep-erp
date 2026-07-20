// =========================================================================
// FILE: Entry.gs  [5/8]
// หน้าหลัก/login/settings + contacts + บันทึก transaction (saveTransaction)
// =========================================================================

/**
 * B.2.3: สร้าง Contact ID แบบ Running Number ต่อเนื่อง (ไม่ reset รายวัน)
 * รูปแบบ: C-NNNN (เช่น C-0001, C-0042)
 *
 * - key: CONTACT_COUNTER — อ่านครั้งแรก scan sheet หา max ป้องกัน ID ซ้ำกับที่มีอยู่แล้ว
 * - ใช้ LockService กัน race condition (2 request สร้าง contact พร้อมกัน)
 * - @param {Sheet} contactSheet - Contacts sheet object (ส่งมาเพื่อ seed ครั้งแรก)
 * @returns {string} เช่น "C-0001"
 */
function getNextContactId_(contactSheet) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props   = PropertiesService.getScriptProperties();
    let   counter = parseInt(props.getProperty('CONTACT_COUNTER') || '0', 10);

    // Seed ครั้งแรก: ถ้า counter ยังเป็น 0 → scan sheet หา max number ที่มีอยู่
    // กัน ID ชนกับที่สร้างไว้ก่อน feature นี้
    if (counter === 0 && contactSheet) {
      const rows = contactSheet.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        const id  = String(rows[i][0] || '');
        const m   = id.match(/^C-(\d+)$/);
        if (m) counter = Math.max(counter, parseInt(m[1], 10));
      }
    }

    const next = counter + 1;
    props.setProperty('CONTACT_COUNTER', next.toString());
    return `C-${next.toString().padStart(4, '0')}`;
  } finally {
    lock.releaseLock();
  }
}


/**
 * C2-5: ดึง transaction ล่าสุดของ contact (สำหรับ autocomplete description + category)
 * @param {string} contactName
 * @param {number} limit - จำนวนสูงสุด (default 5)
 * @returns {{ success: boolean, transactions: Array }}
 */
function getRecentTransactionsByContact(contactName, limit) {
  try {
    const cfg   = getConfig_();
    const ss    = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Transactions');
    if (!sheet) return { success: true, transactions: [] };

    const data    = sheet.getDataRange().getValues();
    const maxRows = limit || 5;
    const result  = [];

    // วน reverse — เอาล่าสุดก่อน
    for (let i = data.length - 1; i >= 1 && result.length < maxRows; i--) {
      const row = data[i];
      if (row[18] === 'ปกติ' && String(row[6]).trim() === String(contactName).trim()) {
        result.push({
          txId        : row[0],
          date        : row[2] instanceof Date
                          ? Utilities.formatDate(row[2], Session.getScriptTimeZone(), "dd/MM/yy")
                          : row[2],
          type        : row[3],
          category    : row[5],
          description : row[7],
          netAmount   : row[14]
        });
      }
    }
    return { success: true, transactions: result };
  } catch (e) {
    return { success: false, message: e.message, transactions: [] };
  }
}

function doGet() {
  // [Split] ใช้ template + include() แทน createHtmlOutputFromFile
  // เพื่อให้ index.html ดึงไฟล์ย่อย (_styles, _view_*, _js_*) มาประกอบเป็นหน้าเดียว
  return HtmlService.createTemplateFromFile('index').evaluate()
    .setTitle('ระบบจัดการบัญชี')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * [Split] รวมไฟล์ HTML ย่อย — เรียกจาก index.html ด้วย <?!= include('ชื่อไฟล์'); ?>
 * คืน raw content ของไฟล์ (ไม่ escape) เพื่อแปะ ณ ตำแหน่งนั้น
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function verifyPassword(password) {
  return password === getConfig_().LOGIN_PASSWORD;
}

function getSettingsData() {
  try {
    const cfg = getConfig_();
    const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    // [Phase A] taxAccounts: ชื่อบัญชีในระบบภาษีจาก col E — ส่งไปให้ UI แสดง label ได้
    // [Multi-Entity] entities + accountsMeta: ให้ UI สร้าง dropdown เลือกกิจการ + map บัญชี→entity
    const result = { accounts: [], expenseCats: [], incomeCats: [], whtRates: [], taxAccounts: [], contacts: [], entities: [], accountsMeta: [] };

    // รายชื่อกิจการ (Entities sheet) — ถ้ายังไม่มีชีท/ข้อมูล จะเป็น array ว่าง (UI fallback EID01)
    result.entities = getEntities_();
    // บัญชีจาก Accounts sheet (มี entityIds + openingBalance) — ใช้ใน dropdown โอน/ยอดคงเหลือ
    result.accountsMeta = getAccounts_();
    const sheet = ss.getSheetByName('Settings');
    if (sheet) {
      const data = sheet.getDataRange().getDisplayValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0]) result.accounts.push(data[i][0].trim());
        if (data[i][1]) result.expenseCats.push(data[i][1].trim());
        if (data[i][2]) result.incomeCats.push(data[i][2].trim());
        if (data[i][3]) result.whtRates.push(data[i][3].trim());
        if (data[i][4]) result.taxAccounts.push(data[i][4].trim()); // [Phase A] col E
      }
    }
    // [Phase A] Fallback ถ้า col E ว่าง → backward-compat กับ Settings เดิม
    if (result.taxAccounts.length === 0) result.taxAccounts = ['บัญชีบริษัท'];

    const contactSheet = ss.getSheetByName('Contacts');
    if (contactSheet) {
      const cData = contactSheet.getDataRange().getDisplayValues();
      for (let i = 1; i < cData.length; i++) {
        if (cData[i][1]) result.contacts.push({ id: cData[i][0], name: cData[i][1], taxId: cData[i][2], branch: cData[i][3], address: cData[i][4], type: cData[i][5] || '', txCount: 0 });   // [B2] +type (col 5: ผู้ขาย/ลูกค้า) เพื่อ filter ตามรายรับ/รายจ่าย
      }
    }
    // นับความถี่การใช้งานคู่ค้า จาก Transactions col 6 (contactName) → เรียงบ่อย→น้อยใน dropdown
    const txSheet = ss.getSheetByName('Transactions');
    if (txSheet && result.contacts.length > 0) {
      const txVals = txSheet.getDataRange().getValues();
      const freqMap = {};
      for (let i = 1; i < txVals.length; i++) {
        const name = (txVals[i][6] || '').toString().trim().toLowerCase();
        if (name) freqMap[name] = (freqMap[name] || 0) + 1;
      }
      result.contacts.forEach(c => { c.txCount = freqMap[(c.name || '').trim().toLowerCase()] || 0; });
    }
    // spread result เพื่อให้ { success, accounts, expenseCats, ... } อยู่ใน level เดียวกัน
    return { success: true, ...result };
  } catch (e) {
    console.error(`[getSettingsData] ${e.message}`);
    // return array ว่างทุกตัวเพื่อไม่ให้ HTML พัง แม้ GAS แครช
    return { success: false, message: e.message, accounts: [], expenseCats: [], incomeCats: [], whtRates: [], taxAccounts: [], contacts: [] };
  }
}

function addContact(contactData) {
  try {
    const cfg = getConfig_();
    const ss  = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const contactSheet = ss.getSheetByName('Contacts');
    // B.2.3: ใช้ getNextContactId_ แทน getLastRow → กัน ID ซ้ำจาก race condition
    const contactId = getNextContactId_(contactSheet);
    const safeTaxId = contactData.taxId ? "'" + contactData.taxId : "";
    contactSheet.appendRow([ contactId, contactData.name, safeTaxId, contactData.branch, contactData.address, contactData.type ]);
    return { success: true, contact: { id: contactId, name: contactData.name, taxId: contactData.taxId, branch: contactData.branch, address: contactData.address } };
  } catch (error) { return { success: false, message: error.message }; }
}

function saveTransaction(data) {
  try {
    const cfg = getConfig_();
    const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const txSheet = ss.getSheetByName('Transactions');
    const itemsSheet = ss.getSheetByName('Transaction_Items');
    const dateObj = new Date();
    const txId    = getNextTxId_();

    let receiptImageUrl = '';
    if (data.imageObj && data.imageObj.base64) {
      // B.2.4: ดึง folder ID จาก Script Properties แทน hardcode
      const folderId = cfg.RECEIPT_FOLDER_ID;
      if (!folderId) throw new Error('ยังไม่ได้ตั้งค่า RECEIPT_FOLDER_ID ใน Script Properties');
      const folder = DriveApp.getFolderById(folderId);
      const blob = Utilities.newBlob(
        Utilities.base64Decode(data.imageObj.base64.split(',')[1]),
        data.imageObj.base64.split(':')[1].split(';')[0],
        txId + '_' + data.imageObj.filename
      );
      receiptImageUrl = folder.createFile(blob).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW).getUrl();
    }

    // [Multi-Entity] entity ที่ผู้ใช้เลือกบนหน้าจอ — fallback EID01 ถ้าไม่ส่งมา
    const txEntityId = data.entityId || cfg.DEFAULT_ENTITY_ID;

    // [Phase 0] ใช้ buildTxRow_ (27 คอลัมน์) แทน inline array — schema จุดเดียวใน TxModel.gs
    // [Phase 2] โหมดตั้งค้าง AP/AR: ถ้า client ส่ง data.apArStatus ('AP'/'AR') → เซ็ต col 21 + dueDate (col 26)
    //   รายการชำระทันที (ปกติ) ไม่ส่ง apArStatus → col 21 = '' เหมือนเดิม
    const txExtra = {};
    if (data.apArStatus === 'AP' || data.apArStatus === 'AR') {
      txExtra.apArStatus = data.apArStatus;
      txExtra.dueDate    = data.dueDate || '';
    }
    // Object.assign คง field เดิมของ data + override entityId ให้เป็นค่าที่ fallback แล้ว
    txSheet.appendRow(buildTxRow_(txId, dateObj,
      Object.assign({}, data, { entityId: txEntityId }), receiptImageUrl, txExtra));

    if (data.items && data.items.length > 0) {
      // B.2.5: batch setValues แทน loop appendRow — 10 items = 1 API call แทน 10
      const itemRows = data.items.map((item, i) => [
        `${txId}-${(i + 1).toString().padStart(2, '0')}`, txId,
        item.itemName, item.quantity, item.inVat, item.exVat, item.totalPrice,
        item.discountPct || 0, item.discountBaht || 0, item.itemCategory || '', item.itemJob || ''
      ]);
      itemsSheet.getRange(
        itemsSheet.getLastRow() + 1, 1,
        itemRows.length, itemRows[0].length
      ).setValues(itemRows);
    }

    // =========================================================================
    // ส่วนเสริม: ยิง API แจ้งเตือนเข้าสู่ระบบสต็อก (ถ้าเป็นต้นทุนสุรา)
    // =========================================================================
    // [Multi-Entity] forward ต้นทุนสุราไปแอปผลิต เฉพาะรายการของกิจการสุรา (LIQUOR_ENTITY_ID)
    // กันต้นทุนของกิจการอื่น (เช่น บัญชีส่วนตัว) ไปตัดสต็อกวัตถุดิบในแอปผลิตผิด
    if (data.type === 'รายจ่าย' && data.category === 'ต้นทุนสุรา' && txEntityId === cfg.LIQUOR_ENTITY_ID && data.items && data.items.length > 0) {
      const docRefId = (data.taxInvoiceNo && data.taxInvoiceNo !== "-") ? data.taxInvoiceNo : txId;
      const noteStr = "รับจาก " + (data.contactName || "ไม่ระบุชื่อ") + (data.description ? ` (${data.description})` : "");

      const apiPayload = {
        "token"  : cfg.API_TOKEN,
        "action" : "RECEIVE_MATERIAL",
        "payload": {
          "date"  : data.transactionDate,
          "docRef": docRefId,
          "note"  : noteStr,
          "items" : data.items.map(item => ({
            "materialName": item.itemName,
            "amount"      : parseFloat(item.quantity) || 0
          }))
        }
      };

      let apiWarning = null;
      try {
        const apiResponse = UrlFetchApp.fetch(cfg.LIQUOR_API_URL, {
          "method"             : "post",
          "contentType"        : "application/json",
          "payload"            : JSON.stringify(apiPayload),
          "muteHttpExceptions" : true   // กัน GAS throw เมื่อ server ตอบ 4xx/5xx
        });

        const responseCode = apiResponse.getResponseCode();
        if (responseCode !== 200) {
          // บันทึกบัญชีสำเร็จแล้ว แต่แจ้งเตือนว่า inventory API มีปัญหา
          const responseText = apiResponse.getContentText();
          console.warn(`[saveTransaction] LIQUOR_API returned ${responseCode}: ${responseText}`);
          apiWarning = `แจ้งเตือน: บันทึกบัญชีสำเร็จ แต่ระบบสต็อกตอบกลับ HTTP ${responseCode} — กรุณาตรวจสอบ Log_Material ในแอปผลิต`;
        }
      } catch (err) {
        // network error / timeout — บันทึกบัญชียังถือว่าสำเร็จ
        console.error(`[saveTransaction] Failed to reach LIQUOR_API: ${err.message}`);
        apiWarning = `แจ้งเตือน: บันทึกบัญชีสำเร็จ แต่เชื่อมต่อระบบสต็อกไม่ได้ (${err.message}) — กรุณาตรวจสอบ Log_Material ในแอปผลิต`;
      }

      // ถ้ามี warning ให้ return พ่วงไปด้วย ฝั่ง client จะแสดง toast เหลืองแทน toast เขียว
      if (apiWarning) {
        return { success: true, message: 'บันทึกข้อมูลเรียบร้อยแล้ว', txId: txId, apiWarning: apiWarning };
      }
    }
    // =========================================================================

    return { success: true, message: 'บันทึกข้อมูลเรียบร้อยแล้ว', txId: txId };
  } catch (error) { return { success: false, message: error.message }; }
}
