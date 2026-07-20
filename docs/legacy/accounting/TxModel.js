// =========================================================================
// FILE: TxModel.gs  [9/9]
// [Phase 0] Schema foundation ของชีท Transactions
//   - buildTxRow_         : ตัวสร้างแถว Transactions มาตรฐาน 27 คอลัมน์ (col 0–26)
//   - deriveApArStatus_   : map type → ฝั่ง AP/AR (ใช้ตอนตั้งค้าง Phase 2 เท่านั้น)
//   - migrateBackfillTxColumns : ขยายชีทเดิม 21 → 27 คอลัมน์ + ใส่ header (run ครั้งเดียว)
//
// ⚠️ Decision (Option A): col 4 = "ชื่อบัญชี" จริงเสมอ ตลอด lifecycle
//    ฝั่ง AP/AR ตัดสินจาก type + col 21 (apArStatus) — ไม่ overload col 4
// =========================================================================

/**
 * [Phase 0] สร้างแถว Transactions มาตรฐาน 27 คอลัมน์
 * ใช้ร่วมทุก writer (saveTransaction / doPost / saveTransfer / future AP-AR / installment)
 * เพื่อให้ schema มีจุดแก้จุดเดียว ลดโอกาส column เลื่อน
 *
 * Schema (index 0-based):
 *   0  txId              13 whtAmount          | 21 apArStatus  ('' = ปกติ/settled, 'AP', 'AR')
 *   1  timestamp         14 netAmount          | 22 paymentDate (yyyy-MM-dd ตอน settle)
 *   2  transactionDate   15 taxInvoiceNo       | 23 poGroupId   (กลุ่มแบ่งจ่ายงวด)
 *   3  type              16 taxInvoiceDate     | 24 installmentNo
 *   4  accountType       17 receiptImageUrl    | 25 installmentTotal
 *   5  category          18 status ('ปกติ')    | 26 dueDate
 *   6  contactName       19 transferId         |
 *   7  description       20 entityId           |
 *   8  baseAmount        9 discount  10 amountAfterDiscount  11 vatAmount  12 whtRate
 *
 * @param {string}  txId            - Transaction ID (TR-yyyyMMdd-NNNN)
 * @param {Date}    dateObj         - timestamp object (ใช้สร้าง col 1)
 * @param {Object}  data            - ฟิลด์หลัก (transactionDate, type, accountType, category,
 *                                     contactName, description, baseAmount, discount,
 *                                     amountAfterDiscount, vatAmount, whtRate, whtAmount,
 *                                     netAmount, taxInvoiceNo, taxInvoiceDate, entityId)
 * @param {string}  receiptImageUrl - URL รูปใบเสร็จ (col 17) — ส่ง '' ถ้าไม่มี
 * @param {Object} [extra]          - ฟิลด์เสริม col 18-26:
 *                                     { status, transferId, apArStatus, paymentDate,
 *                                       poGroupId, installmentNo, installmentTotal, dueDate }
 * @returns {Array} แถวความยาว 27 ช่อง พร้อม appendRow / setValues
 */
function buildTxRow_(txId, dateObj, data, receiptImageUrl, extra) {
  extra = extra || {};
  return [
    txId,                                                                              // 0  txId
    Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"), // 1  timestamp
    data.transactionDate,                                                              // 2  transactionDate
    data.type,                                                                         // 3  type (รายรับ/รายจ่าย/โอนระหว่างบัญชี)
    data.accountType,                                                                  // 4  accountType = ชื่อบัญชีจริง [Option A]
    data.category,                                                                     // 5  category
    data.contactName,                                                                  // 6  contactName
    data.description,                                                                  // 7  description
    data.baseAmount, data.discount, data.amountAfterDiscount, data.vatAmount,          // 8-11
    data.whtRate, data.whtAmount, data.netAmount,                                      // 12-14
    data.taxInvoiceNo, data.taxInvoiceDate,                                            // 15-16
    receiptImageUrl || '',                                                             // 17 receiptImageUrl
    extra.status || 'ปกติ',                                                            // 18 status
    extra.transferId || '',                                                            // 19 transferId
    data.entityId || '',                                                               // 20 entityId [Multi-Entity]
    extra.apArStatus || '',                                                            // 21 apArStatus ['' = settled/ปกติ]
    extra.paymentDate || '',                                                           // 22 paymentDate
    extra.poGroupId || '',                                                             // 23 poGroupId
    extra.installmentNo || '',                                                         // 24 installmentNo
    extra.installmentTotal || '',                                                      // 25 installmentTotal
    extra.dueDate || ''                                                                // 26 dueDate
  ];
}

/**
 * [Phase 0 / เตรียม Phase 2] map ชนิดรายการ → ฝั่ง AP/AR
 *
 * [Option A] ฝั่งหนี้ตัดสินจาก "type" ของรายการ ไม่ใช่จาก col 4 (ชื่อบัญชี)
 *   - เรียกเฉพาะตอนสร้างบิล "ตั้งค้าง" ใน Phase 2 (#5) เท่านั้น แล้วส่งผลผ่าน extra.apArStatus
 *   - รายการปกติ (จ่าย/รับเงินสดทันที) ไม่เรียกฟังก์ชันนี้ → col 21 = '' โดย default
 *
 * @param {string} type - 'รายจ่าย' | 'รายรับ'
 * @returns {string} 'AP' (เจ้าหนี้) | 'AR' (ลูกหนี้) | ''
 */
function deriveApArStatus_(type) {
  if (type === 'รายจ่าย') return 'AP';   // เราติดเงินเขา = เจ้าหนี้ (Account Payable)
  if (type === 'รายรับ')  return 'AR';   // เขาติดเงินเรา = ลูกหนี้ (Account Receivable)
  return '';
}

/**
 * [Phase 0] Migration: ขยายชีท Transactions เดิมจาก 21 → 27 คอลัมน์ + ใส่ header
 *
 * รันครั้งเดียวจาก Apps Script editor (เลือกฟังก์ชัน migrateBackfillTxColumns → Run)
 * - idempotent: รันซ้ำได้ ไม่พัง (เขียน header ทับค่าเดิมเฉย ๆ)
 * - แถวข้อมูลเก่า col 21-26 จะเป็นค่าว่าง '' = ตีความเป็น "ปกติ/settled" อัตโนมัติ
 *   (ทุก filter ใช้ if (row[21]) continue → '' เป็น falsy จึงไม่ถูกข้าม)
 * - Performance: 1 read header + 1 write header (ไม่วน getValue ราย cell)
 *
 * @returns {string} ข้อความสรุปผล
 */
function migrateBackfillTxColumns() {
  const cfg   = getConfig_();
  const ss    = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Transactions');
  if (!sheet) return '❌ ไม่พบชีท Transactions';

  const TOTAL_COLS  = 27;
  // header col 21-26 (ตำแหน่ง 1-based = 22-27)
  const NEW_HEADERS = ['สถานะ AP/AR', 'วันที่ชำระ', 'PO Group ID', 'งวดที่', 'จำนวนงวด', 'วันครบกำหนด'];

  // 1) ขยายจำนวนคอลัมน์ของชีทให้พอ (ปกติ Google Sheet default 26 → ต้องเพิ่มอีก 1)
  const maxCols = sheet.getMaxColumns();
  if (maxCols < TOTAL_COLS) {
    sheet.insertColumnsAfter(maxCols, TOTAL_COLS - maxCols);
  }

  // 2) เขียน header ของ 6 คอลัมน์ใหม่ (1 write)
  sheet.getRange(1, 22, 1, NEW_HEADERS.length).setValues([NEW_HEADERS]);

  const lastRow = sheet.getLastRow();
  const dataRows = Math.max(0, lastRow - 1);
  return `✅ Backfill เสร็จ: Transactions = ${TOTAL_COLS} คอลัมน์ | header col 21-26 เพิ่มแล้ว | แถวข้อมูลเดิม ${dataRows} แถว (col 21-26 = ว่าง = ปกติ)`;
}

/**
 * [Phase A] Migration: ขยายชีท Transaction_Items 7 → 11 คอลัมน์ + ใส่ header
 *   เพิ่ม col 7 ส่วนลด% · col 8 ส่วนลดบาท · col 9 หมวดหมู่ · col 10 ระบุงาน
 * รันครั้งเดียวจาก editor (เลือก migrateBackfillItemColumns → Run) — idempotent
 * แถวเดิม col 7-10 = ว่าง (ส่วนลด 0, หมวด/งานว่าง) ไม่กระทบการคำนวณ
 * @returns {string}
 */
function migrateBackfillItemColumns() {
  const cfg   = getConfig_();
  const ss    = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Transaction_Items');
  if (!sheet) return '❌ ไม่พบชีท Transaction_Items';

  const TOTAL_COLS  = 11;
  const NEW_HEADERS = ['ส่วนลด %', 'ส่วนลด บาท', 'หมวดหมู่', 'ระบุงาน'];   // col 7-10 (1-based 8-11)

  const maxCols = sheet.getMaxColumns();
  if (maxCols < TOTAL_COLS) sheet.insertColumnsAfter(maxCols, TOTAL_COLS - maxCols);
  sheet.getRange(1, 8, 1, NEW_HEADERS.length).setValues([NEW_HEADERS]);

  const dataRows = Math.max(0, sheet.getLastRow() - 1);
  return `✅ Backfill เสร็จ: Transaction_Items = ${TOTAL_COLS} คอลัมน์ | header col 7-10 เพิ่มแล้ว | แถวเดิม ${dataRows} แถว (ส่วนลด=ว่าง, หมวด/งาน=ว่าง)`;
}
