// =========================================================================
// FILE: Api_doPost.gs  [4/8]
// Webhook รับจากแอปขาย (RECEIVE_REVENUE) + idempotency + ตัวสร้าง Transaction ID
// =========================================================================

/**
 * สร้าง Transaction ID แบบ Running Number รายวัน
 * รูปแบบ: TR-yyyyMMdd-NNNN (เช่น TR-20260513-0001)
 *
 * กลไก:
 *  - ใช้ Script Properties key "TX_COUNTER_yyyyMMdd" เก็บ counter ของแต่ละวัน
 *  - วันใหม่ = key ใหม่ → counter เริ่ม 1 ใหม่อัตโนมัติ ไม่ต้อง reset เอง
 *  - key เก่า (วันที่ผ่านมา) จะค้างอยู่ใน Properties แต่ไม่มีผลต่อการทำงาน
 *    (GAS Script Properties รองรับ 500 keys — ลบทิ้งได้ใน setupScriptProperties ถ้าอยากรักษาความสะอาด)
 *  - ใช้ LockService กัน race condition กรณีมี 2 request เข้าพร้อมกันใน millisecond เดียว
 *
 * @returns {string} เช่น "TR-20260513-0001"
 */
function getNextTxId_() {
  const tz        = Session.getScriptTimeZone();
  const dateStr   = Utilities.formatDate(new Date(), tz, "yyyyMMdd");
  const propKey   = `TX_COUNTER_${dateStr}`;

  // รอ lock สูงสุด 10 วินาที — ถ้า GAS timeout จะ throw ให้ caller จัดการ
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const props   = PropertiesService.getScriptProperties();
    const current = parseInt(props.getProperty(propKey) || '0', 10);
    const next    = current + 1;
    props.setProperty(propKey, next.toString());
    return `TR-${dateStr}-${next.toString().padStart(4, '0')}`;
  } finally {
    lock.releaseLock();   // release เสมอ แม้จะ error
  }
}
/**
 * B.2.1: Idempotency helpers สำหรับ doPost
 * ใช้ sheet "API_Log" เก็บ key ทุกการบันทึกสำเร็จ
 * Schema: [timestamp, action, idempotencyKey, status, message]
 */

/** Get or create API_Log sheet */
function getOrCreateApiLogSheet_(ss) {
  let sheet = ss.getSheetByName('API_Log');
  if (!sheet) {
    sheet = ss.insertSheet('API_Log');
    sheet.appendRow(['timestamp', 'action', 'idempotencyKey', 'status', 'message']);
  }
  return sheet;
}

/**
 * ตรวจว่า idempotencyKey นี้เคยบันทึกสำเร็จไปแล้วหรือยัง
 * @returns {{ found: boolean, txId?: string }} ถ้าเจอ — return txId เดิมที่บันทึกไว้
 */
function checkIdempotency_(ss, action, idempotencyKey) {
  if (!idempotencyKey) return { found: false };   // ไม่ส่ง key มา = ไม่ตรวจ

  const sheet = getOrCreateApiLogSheet_(ss);
  const data  = sheet.getDataRange().getValues();
  // วน reverse เพราะ key ที่เพิ่งใช้น่าจะอยู่ท้ายตาราง
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][1] === action && data[i][2] === idempotencyKey && data[i][3] === 'ok') {
      return { found: true, txId: data[i][4] };   // message เก็บ txId เดิม
    }
  }
  return { found: false };
}

/** บันทึก log idempotency หลังทำงานสำเร็จ */
function logApiCall_(ss, action, idempotencyKey, status, message) {
  try {
    const sheet = getOrCreateApiLogSheet_(ss);
    sheet.appendRow([
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      action,
      idempotencyKey || '-',
      status,
      message || '-'
    ]);
  } catch (e) {
    console.error(`[logApiCall_] failed: ${e.message}`);
  }
}

function doPost(e) {
  const cfg = getConfig_();
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, message: "ไม่พบข้อมูลที่ส่งมา" })).setMimeType(ContentService.MimeType.JSON);
    }
    const data = JSON.parse(e.postData.contents);
    if (data.token !== cfg.API_TOKEN) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Unauthorized: รหัส Token ไม่ถูกต้อง" })).setMimeType(ContentService.MimeType.JSON);
    }

    const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const txSheet = ss.getSheetByName('Transactions');
    const itemsSheet = ss.getSheetByName('Transaction_Items');
    const contactSheet = ss.getSheetByName('Contacts');

    // B.2.1: Idempotency check — ป้องกันแอปขาย retry แล้วบันทึกซ้ำ
    // ใช้ idempotencyKey ก่อน → fallback taxInvoiceNo → ถ้าไม่มีทั้งคู่ก็ไม่ตรวจ (backward compatible)
    const idempotencyKey = data.idempotencyKey || data.taxInvoiceNo || '';
    const ACTION_NAME    = 'RECEIVE_REVENUE';

    // ใช้ LockService ครอบ check-then-write กัน race condition
    // (2 retry เข้าพร้อมกัน — ตัวที่ 1 บันทึก, ตัวที่ 2 ต้องเห็นว่ามีแล้ว)
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);

    let dupCheck;
    try {
      dupCheck = checkIdempotency_(ss, ACTION_NAME, idempotencyKey);
      if (dupCheck.found) {
        lock.releaseLock();
        // คืน txId เดิม + message บอกชัดว่าเป็น duplicate
        return ContentService.createTextOutput(JSON.stringify({
          success: true,
          message: "รายการนี้ถูกบันทึกไปแล้วก่อนหน้านี้ (idempotent)",
          transactionId: dupCheck.txId,
          duplicate: true
        })).setMimeType(ContentService.MimeType.JSON);
      }
    } catch (lockErr) {
      lock.releaseLock();
      throw lockErr;
    }

    const dateObj    = new Date();
    const txId       = getNextTxId_();
    const todayDateStr = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyy-MM-dd");

    // ถ้าแอปไม่ได้ส่งชื่อลูกค้ามา จะให้ขึ้นว่า "ลูกค้าทั่วไป"
    const contactName = data.contactName || "ลูกค้าทั่วไป";

    // --- ระบบตรวจสอบและเพิ่มลูกค้าใหม่อัตโนมัติ (ถ้าไม่มีในระบบ) ---
    if (contactName !== "ลูกค้าทั่วไป" && contactName.trim() !== "") {
      let found = false;
      if (contactSheet) {
        const cData = contactSheet.getDataRange().getValues();
        // B.2.2: normalize ทั้ง 2 ฝั่งด้วย trim().toLowerCase()
        // กัน whitespace ต่างกัน 1 ช่อง → สร้าง contact ซ้ำ
        const normalizedSearch = contactName.trim().toLowerCase();
        for (let i = 1; i < cData.length; i++) {
          if (String(cData[i][1] || '').trim().toLowerCase() === normalizedSearch) {
            found = true; break;
          }
        }
        if (!found) {
          // B.2.3: ใช้ getNextContactId_ แทน getLastRow → กัน ID ซ้ำจาก race condition
          const contactId = getNextContactId_(contactSheet);
          const taxId     = data.taxId || "";
          const branch    = data.branch || "สำนักงานใหญ่";
          const address   = data.address || "";
          const safeTaxId = taxId ? "'" + taxId : "";
          contactSheet.appendRow([contactId, contactName, safeTaxId, branch, address, "ลูกค้า"]);
        }
      }
    }
    // -------------------------------------------------------------

    // [Multi-Entity] entity ของรายรับ: ใช้ค่าที่ส่งมาถ้ามี (เผื่อแอปอื่นในอนาคต),
    // ไม่งั้น fallback = DEFAULT_ENTITY_ID (EID01) ของแอปขายปัจจุบัน
    const txEntityId = data.entityId || cfg.DEFAULT_ENTITY_ID;

    // [Phase 0] ใช้ buildTxRow_ (27 คอลัมน์) แทน inline array — คง default value เดิมไว้ที่นี่
    // (RECEIVE_REVENUE = รายรับเข้าทันที → apArStatus '' โดย default, ไม่ใช่ AR ค้าง)
    const revData = {
      transactionDate     : todayDateStr,
      type                : "รายรับ",
      accountType         : data.accountType || "กสิกร insep",
      category            : data.category || "รายได้จากการขาย",
      contactName         : contactName,
      description         : data.description || "-",
      baseAmount          : data.baseAmount || 0,
      discount            : data.discount || 0,
      amountAfterDiscount : data.amountAfterDiscount || 0,
      vatAmount           : data.vatAmount || 0,
      whtRate             : data.whtRate || 0,
      whtAmount           : data.whtAmount || 0,
      netAmount           : data.netAmount || 0,
      taxInvoiceNo        : data.taxInvoiceNo || "-",
      taxInvoiceDate      : data.taxInvoiceDate || "",
      entityId            : txEntityId
    };
    txSheet.appendRow(buildTxRow_(txId, dateObj, revData, ""));

    if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      // B.2.5: batch setValues แทน loop appendRow — 10 items = 1 API call แทน 10
      const itemRows = data.items.map((item, index) => [
        `${txId}-${(index + 1).toString().padStart(2, '0')}`, txId,
        item.itemName || "-", item.quantity || 1, item.inVat || 0, item.exVat || 0, item.totalPrice || 0,
        item.discountPct || 0, item.discountBaht || 0, item.itemCategory || '', item.itemJob || ''   // [Phase A] 11 คอลัมน์
      ]);
      itemsSheet.getRange(
        itemsSheet.getLastRow() + 1, 1,
        itemRows.length, itemRows[0].length
      ).setValues(itemRows);
    }

    // B.2.1: บันทึก idempotency log หลัง save สำเร็จ — เก็บ txId ใน message สำหรับ return ครั้งหน้า
    logApiCall_(ss, ACTION_NAME, idempotencyKey, 'ok', txId);
    lock.releaseLock();

    return ContentService.createTextOutput(JSON.stringify({ success: true, message: "บันทึกข้อมูลเรียบร้อยแล้ว", transactionId: txId })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    // ปล่อย lock ถ้ายัง hold อยู่ — กัน lock ค้าง 10 วินาที
    try { LockService.getScriptLock().releaseLock(); } catch (_) {}
    return ContentService.createTextOutput(JSON.stringify({ success: false, message: "Server Error: " + error.message })).setMimeType(ContentService.MimeType.JSON);
  }
}
