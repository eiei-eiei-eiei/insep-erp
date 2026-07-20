// =========================================================================
// FILE: Entities.gs  [2/8]
// [Multi-Entity] หลายกิจการ (Entities) + บัญชีธนาคารใช้ร่วม (Accounts) + migration
// ⚠️ global ที่ประกาศที่นี่ (TX_ENTITY_COL) ห้ามประกาศซ้ำในไฟล์อื่น
// ฟังก์ชัน setup: setupEntityAccountSheets() / migrateBackfillEntityId(dryRun)
// =========================================================================

const TX_ENTITY_COL = 20;   // index ของคอลัมน์ entityId ใน Transactions (column U)

/** หา sheet ตามชื่อ ถ้าไม่มีให้สร้างพร้อม header (กัน null .getRange/.appendRow) */
function getOrCreateSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length) sheet.appendRow(headers);
  }
  return sheet;
}

/**
 * รันครั้งเดียวเพื่อสร้างชีท Entities + Accounts พร้อมหัวคอลัมน์ (ไม่ใส่ข้อมูล)
 * จากนั้นผู้ใช้กรอกข้อมูลกิจการ/บัญชีเองในชีท
 *  - Entities: 1 แถว = 1 กิจการ
 *  - Accounts: 1 แถว = 1 บัญชี (entityIds = id กิจการที่ใช้บัญชีนี้ คั่นด้วย comma ถ้าใช้ร่วม)
 */
function setupEntityAccountSheets() {
  const ss = SpreadsheetApp.openById(getConfig_().SPREADSHEET_ID);
  getOrCreateSheet_(ss, 'Entities', ['entityId', 'name', 'type', 'isVat', 'taxId', 'branch', 'address']);
  getOrCreateSheet_(ss, 'Accounts', ['accountId', 'accountName', 'entityIds', 'kind', 'openingBalance', 'openingDate']);
  Logger.log('✅ สร้างชีท Entities + Accounts (หัวคอลัมน์) เรียบร้อย — กรอกข้อมูลในชีทได้เลย');
}

/** อ่านรายชื่อกิจการทั้งหมดจากชีท Entities → array ของ object */
function getEntities_() {
  const ss = SpreadsheetApp.openById(getConfig_().SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Entities');
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    out.push({
      entityId: String(data[i][0]).trim(),
      name    : data[i][1],
      type    : data[i][2],
      isVat   : data[i][3] === true || String(data[i][3]).toUpperCase() === 'TRUE',
      taxId   : data[i][4] ? String(data[i][4]).replace(/^'/, '') : '',
      branch  : data[i][5] || '',
      address : data[i][6] || ''
    });
  }
  return out;
}

/** หา entity เดียวจาก id (คืน null ถ้าไม่เจอ) */
function getEntityById_(entityId) {
  if (!entityId) return null;
  return getEntities_().find(e => e.entityId === entityId) || null;
}

/**
 * ข้อมูลหัวกระดาษของกิจการสำหรับรายงาน (ภพ.30 / ภงด / 50ทวิ)
 * fallback ไปใช้ COMPANY_* ใน Script Properties ถ้าไม่พบ entity (backward-compat)
 */
function getEntityInfo_(entityId) {
  const cfg = getConfig_();
  const e = getEntityById_(entityId);
  if (e && e.name) {
    return { name: e.name, taxId: e.taxId || '', branch: e.branch || 'สำนักงานใหญ่', address: e.address || '' };
  }
  return {
    name   : cfg.COMPANY_NAME,
    taxId  : cfg.COMPANY_TAX_ID,
    branch : cfg.COMPANY_BRANCH,
    address: cfg.COMPANY_ADDRESS
  };
}

/**
 * อ่านบัญชีทั้งหมดจากชีท Accounts → array ของ object
 * key หลักที่ใช้จับคู่กับ Transactions col 4 = accountName
 * entityIds รองรับหลาย entity (บัญชีใช้ร่วม) คั่นด้วย comma เช่น "EID01,EID02"
 */
function getAccounts_() {
  const ss = SpreadsheetApp.openById(getConfig_().SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Accounts');
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][1]) continue;   // ต้องมี accountName
    const entIds = String(data[i][2] || '').split(',').map(x => x.trim()).filter(x => x);
    out.push({
      accountId     : String(data[i][0] || '').trim(),
      accountName   : String(data[i][1]).trim(),
      entityIds     : entIds,
      kind          : data[i][3] || '',
      openingBalance: parseFloat(data[i][4]) || 0,
      openingDate   : data[i][5] || ''
    });
  }
  return out;
}

/**
 * [Migration] เติม entityId (col U) ให้ Transactions แถวเก่าที่ยังว่าง
 *  - ค่าเริ่มต้น = LEGACY_DEFAULT_ENTITY_ID (ข้อมูลเก่าทั้งหมดเป็นของ EID01)
 *  - dryRun = true (default): แค่รายงานว่าจะแก้กี่แถว ไม่เขียนจริง
 *  - รันจริง: migrateBackfillEntityId(false)
 *  ปลอดภัย: เขียนเฉพาะคอลัมน์ U ที่ว่าง ไม่แตะคอลัมน์อื่น รันซ้ำได้ (idempotent)
 */
function migrateBackfillEntityId(dryRun) {
  if (dryRun === undefined) dryRun = true;
  const LEGACY_DEFAULT_ENTITY_ID = 'EID01';   // ⚠️ แก้ตรงนี้ถ้าข้อมูลเก่าไม่ใช่ EID01

  const ss = SpreadsheetApp.openById(getConfig_().SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Transactions');
  if (!sheet) return { success: false, message: 'ไม่พบชีท Transactions' };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, message: 'ไม่มีข้อมูลให้ migrate', toFix: 0 };

  const col = TX_ENTITY_COL + 1;   // column U = 21
  const range = sheet.getRange(2, col, lastRow - 1, 1);
  const vals = range.getValues();

  let toFix = 0;
  for (let i = 0; i < vals.length; i++) {
    if (!String(vals[i][0] || '').trim()) { vals[i][0] = LEGACY_DEFAULT_ENTITY_ID; toFix++; }
  }

  if (!dryRun && toFix > 0) range.setValues(vals);

  const msg = dryRun
    ? `[DRY-RUN] พบ ${toFix} แถวที่ entityId ว่าง — จะเซ็ตเป็น "${LEGACY_DEFAULT_ENTITY_ID}". รันจริงด้วย migrateBackfillEntityId(false)`
    : `✅ เติม entityId="${LEGACY_DEFAULT_ENTITY_ID}" ให้ ${toFix} แถวเรียบร้อย`;
  Logger.log(msg);
  return { success: true, dryRun: dryRun, toFix: toFix, message: msg };
}

/** helper: รายการนี้อยู่ใน scope ของ entity ที่เลือกไหม (entityId ว่าง/ALL = ดูทุกกิจการ) */
function inEntityScope_(rowEntityId, scopeEntityId) {
  if (!scopeEntityId || scopeEntityId === 'ALL') return true;
  return String(rowEntityId || '').trim() === scopeEntityId;
}
