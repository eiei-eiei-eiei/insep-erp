// ============================================================
// ⚙️ CONFIG + UTIL + LINE NOTIFY
// ไม่มี global นอกฟังก์ชัน (อ่าน config ผ่าน getConfig() ทุกครั้ง)
// ============================================================


/**
 * ดึง Config ทั้งหมดจาก Script Properties
 * @returns {{ sheetUrl: string, accountingApiUrl: string, liquorApiUrl: string, token: string }}
 */
function getConfig() {
  const props = PropertiesService.getScriptProperties();
  const cfg = {
    sheetUrl:          props.getProperty('SHEET_URL'),
    accountingApiUrl:  props.getProperty('ACCOUNTING_API_URL'),
    liquorApiUrl:      props.getProperty('LIQUOR_API_URL'),
    token:             props.getProperty('API_TOKEN'),
  };

  if (!cfg.sheetUrl || !cfg.token) {
    throw new Error('❌ Script Properties ยังไม่ได้ตั้งค่า — กรุณารัน setupScriptProperties() ก่อน');
  }
  return cfg;
}

/**
 * รันครั้งเดียวตอน deploy เพื่อใส่ค่า Script Properties
 */

/**
 * รันครั้งเดียวตอน deploy เพื่อใส่ค่า Script Properties
 */
function setupScriptProperties() {
  PropertiesService.getScriptProperties().setProperties({
    'SHEET_URL':            'https://docs.google.com/spreadsheets/d/1O2WI1KggiEJry7tQLOWau1TYPLW8WXUZMCDJYla5Jh8/edit',
    'ACCOUNTING_API_URL':   'https://script.google.com/macros/s/AKfycbxQtwScMx_YwI5rf8ggBKoPmQACPQAgAQl19kNQgGiYRjGGi8phgE4AXo14PzVK_82W/exec',
    'LIQUOR_API_URL':       'https://script.google.com/macros/s/AKfycbw9Gft4-1ew4Xjkyb0hx6TDDsJkHlQP0TdD8xlmOa18FRwlp4hoP4GELG9GzSWpkFLsUA/exec',
    'API_TOKEN':            'Domesuperduperhandsome',
    // Spreadsheet ID ของแอปผลิต (สำหรับอ่าน Stock_Product) — ดูวิธีหาใน step-by-step ท้ายแชท
    'LIQUOR_SHEET_ID':      'YOUR_LIQUOR_SPREADSHEET_ID',
    // LINE Messaging API — ตั้งค่าหลังได้ token จาก LINE Developers Console
    'LINE_CHANNEL_TOKEN':   'YOUR_LINE_CHANNEL_ACCESS_TOKEN',
    'LINE_GROUP_ID':        'YOUR_LINE_GROUP_OR_CHAT_ID',
  });
  console.log('✅ Script Properties ตั้งค่าเรียบร้อย — ตรวจสอบได้ที่ Project Settings > Script Properties');
}

// =============================================================
// 🛠️ HELPERS — ฟังก์ชันกลาง ใช้ร่วมกันทุกที่
// =============================================================

/**
 * จัดรูปแบบ Tax ID ให้ครบ 13 หลักเสมอ
 * แก้ปัญหา Google Sheets ตัด 0 นำหน้าทิ้งเมื่อ format เป็นตัวเลข
 */

/**
 * จัดรูปแบบ Tax ID ให้ครบ 13 หลักเสมอ
 * แก้ปัญหา Google Sheets ตัด 0 นำหน้าทิ้งเมื่อ format เป็นตัวเลข
 */
function formatTaxId(raw) {
  const s = raw ? raw.toString().trim() : '';
  if (/^\d+$/.test(s) && s.length > 0 && s.length < 13) {
    return s.padStart(13, '0');
  }
  return s;
}

// =============================================================
// 📲 LINE NOTIFY — ส่งข้อความแจ้งเตือนผ่าน LINE Messaging API
// Properties ที่ต้องตั้ง: LINE_CHANNEL_TOKEN, LINE_GROUP_ID
// Silent fail: ถ้าส่งไม่สำเร็จ → log error แต่ไม่ throw
// (ห้ามให้ business logic หลักล้มเพราะ LINE)
// =============================================================

/**
 * ส่งข้อความ push ไปยัง LINE Group/Chat
 * @param {string} text - ข้อความที่จะส่ง (รองรับ \n)
 */

/**
 * ส่งข้อความ push ไปยัง LINE Group/Chat
 * @param {string} text - ข้อความที่จะส่ง (รองรับ \n)
 */
function sendLineNotification(text) {
  try {
    const props = PropertiesService.getScriptProperties();
    const token   = props.getProperty('LINE_CHANNEL_TOKEN');
    const groupId = props.getProperty('LINE_GROUP_ID');

    if (!token || !groupId) {
      console.warn('[LINE] ยังไม่ได้ตั้งค่า LINE_CHANNEL_TOKEN หรือ LINE_GROUP_ID — ข้าม notification');
      return;
    }

    const body = {
      to:       groupId,
      messages: [{ type: 'text', text: text }],
    };

    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method:             'post',
      contentType:        'application/json',
      headers:            { 'Authorization': 'Bearer ' + token },
      payload:            JSON.stringify(body),
      muteHttpExceptions: true,
    });

    const code = res.getResponseCode();
    if (code !== 200) {
      console.error(`[LINE] ส่งไม่สำเร็จ | status=${code} | body=${res.getContentText().substring(0, 200)}`);
    }
  } catch (err) {
    // Silent fail — ไม่ throw เพื่อไม่ให้กระทบ business logic
    console.error('[LINE] Exception:', err);
  }
}

/**
 * ทดสอบการส่ง LINE Notification
 * วิธีรัน: เปิด Apps Script Editor → เลือก testLineNotification → ▶ Run
 */

/**
 * ทดสอบการส่ง LINE Notification
 * วิธีรัน: เปิด Apps Script Editor → เลือก testLineNotification → ▶ Run
 */
function testLineNotification() {
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
  sendLineNotification(`🔔 ทดสอบ LINE Notification\nInsep ERP | ${now}\nถ้าเห็นข้อความนี้ แสดงว่าตั้งค่าถูกต้องแล้ว ✅`);
  console.log('testLineNotification: ส่งแล้ว — ตรวจสอบใน LINE Group');
}

// =============================================================
// 🏭 LIVE STOCK — อ่าน Stock_Product จากแอปผลิตโดยตรง (cross-app)
// แอปผลิต maintain running balance ให้แล้ว → อ่าน O(1) ไม่ต้อง SUM log
// ต้อง: 1) ตั้ง Property LIQUOR_SHEET_ID  2) แชร์ spreadsheet แอปผลิต (view)
// =============================================================

/**
 * ข้อ 1: ดึง balance ของ productId เดียวจาก Stock_Product
 * @param {string} productId
 * @returns {{ available: number, unit: string, name: string }}
 */

/**
 * แปลงค่าจาก sheet เป็น boolean
 * Google Sheets checkbox return boolean true/false ตรงๆ
 * แต่ถ้าใส่มือเป็น 'TRUE'/'FALSE'/'YES'/'1' ก็รองรับ
 */
function isTruthy(v) {
  if (v === true) return true;
  if (v === false || v === null || v === undefined || v === '') return false;
  const s = v.toString().trim().toUpperCase();
  return s === 'TRUE' || s === 'YES' || s === 'Y' || s === '1';
}

// =============================================================
// 🔢 SERIAL COUNTER — Running number ด้วย PropertiesService
// ป้องกันเลขซ้ำจาก concurrent users + ไม่ต้อง scan sheet ทุกครั้ง
//
// Properties keys ที่ระบบจะสร้างขึ้น (ทำงานอัตโนมัติ):
//   COUNTER_QU_yyMMdd   - QU รายวัน
//   COUNTER_ORD_yyMMdd  - ORD รายวัน
//   COUNTER_INV_yyMMdd  - INV รายวัน
//   COUNTER_TAX_yyMMdd  - TAX รายวัน
//   COUNTER_C           - Customer ID ต่อเนื่อง
// =============================================================

/**
 * สร้างเลขรันนิ่งแบบ atomic ผ่าน PropertiesService
 *
 * ⚠️ Caller ต้องครอบ LockService — ทุก caller ในไฟล์นี้มี lock อยู่แล้ว ✅
 *
 * @param {string} prefix - 'QU' | 'ORD' | 'INV' | 'TAX' | 'C'
 * @param {Object} [opts]
 * @param {boolean} [opts.daily=true] - true = reset รายวัน, false = running ต่อเนื่อง
 * @param {number}  [opts.pad=3] - จำนวนหลัก zero-pad
 * @param {function(string):number} [opts.seed] - ครั้งแรกที่ key นี้ถูกเรียก → seed จาก sheet
 * @returns {string} เช่น "QU260512-001" หรือ "C042"
 */

/**
 * สร้างเลขรันนิ่งแบบ atomic ผ่าน PropertiesService
 *
 * ⚠️ Caller ต้องครอบ LockService — ทุก caller ในไฟล์นี้มี lock อยู่แล้ว ✅
 *
 * @param {string} prefix - 'QU' | 'ORD' | 'INV' | 'TAX' | 'C'
 * @param {Object} [opts]
 * @param {boolean} [opts.daily=true] - true = reset รายวัน, false = running ต่อเนื่อง
 * @param {number}  [opts.pad=3] - จำนวนหลัก zero-pad
 * @param {function(string):number} [opts.seed] - ครั้งแรกที่ key นี้ถูกเรียก → seed จาก sheet
 * @returns {string} เช่น "QU260512-001" หรือ "C042"
 */
function getNextSerial(prefix, opts) {
  opts = opts || {};
  const daily = opts.daily !== false;
  const pad   = opts.pad || 3;
  const props = PropertiesService.getScriptProperties();

  const dateStr = daily
    ? Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyMMdd")
    : '';
  const key = daily ? `COUNTER_${prefix}_${dateStr}` : `COUNTER_${prefix}`;

  // อ่านค่าปัจจุบัน — ถ้ายังไม่มี (key ใหม่) → seed จาก sheet
  let current = parseInt(props.getProperty(key) || '', 10);
  if (isNaN(current)) {
    current = typeof opts.seed === 'function' ? (Number(opts.seed(dateStr)) || 0) : 0;
  }

  // Atomic increment
  const next = current + 1;
  props.setProperty(key, next.toString());

  const padded = ('0'.repeat(pad) + next).slice(-pad);
  return daily ? `${prefix}${dateStr}-${padded}` : `${prefix}${padded}`;
}

/**
 * (Optional) Reset counter ของ prefix+date ที่ระบุ
 * ใช้กรณี debug หรือต้อง re-migration
 */

/**
 * (Optional) Reset counter ของ prefix+date ที่ระบุ
 * ใช้กรณี debug หรือต้อง re-migration
 */
function resetCounter(prefix, dateStr) {
  const key = dateStr ? `COUNTER_${prefix}_${dateStr}` : `COUNTER_${prefix}`;
  PropertiesService.getScriptProperties().deleteProperty(key);
  console.log(`🗑️ Reset counter: ${key}`);
}

// =============================================================
// 🧹 COUNTER CLEANUP — ลบ daily counter เก่าที่ตายแล้ว
// COUNTER_<PREFIX>_<yyMMdd> ของวันก่อนๆ ไม่มีใครอ่านอีก (key ฝังวันที่)
// → ลบทิ้งกัน Script Properties โตไม่จำกัด (เพดาน 500KB)
// ⚠️ ลบเฉพาะ daily counter — COUNTER_C (ต่อเนื่อง) / config / ACC_SYNC_* ปลอดภัย
// =============================================================

/**
 * ลบ daily counter ที่เก่ากว่า keepDays วัน (default 30)
 * @param {number} [keepDays=30]
 * @returns {number} จำนวน key ที่ลบ
 */
function cleanupOldCounters_(keepDays) {
  const days   = keepDays || 30;
  const props  = PropertiesService.getScriptProperties();
  const all    = props.getProperties();   // อ่านทั้งหมดครั้งเดียว (เลี่ยง getProperty ใน loop)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  // เทียบเป็น string yyMMdd ได้ เพราะ zero-pad + เรียง year→month→day ตามเวลา
  const cutoffStr = Utilities.formatDate(cutoff, Session.getScriptTimeZone(), 'yyMMdd');

  let deleted = 0;
  Object.keys(all).forEach(function (key) {
    // match เฉพาะ daily counter: COUNTER_<PREFIX ตัวใหญ่>_<yyMMdd 6 หลัก>
    const m = key.match(/^COUNTER_[A-Z]+_(\d{6})$/);
    if (m && m[1] < cutoffStr) {
      props.deleteProperty(key);
      deleted++;
    }
  });
  console.log(`🧹 cleanupOldCounters_: ลบ ${deleted} keys (เก่ากว่า ${days} วัน)`);
  return deleted;
}

/**
 * ตัว trigger รายเดือน — เรียก cleanupOldCounters_ (handler ห้ามมี arg)
 */
function monthlyCounterCleanup() {
  cleanupOldCounters_(30);
}

/**
 * 🛠️ ติดตั้ง trigger cleanup รายเดือน (รันครั้งเดียวหลัง deploy)
 * ทุกวันที่ 1 เวลา ~03:00 · ลบ trigger เดิมของ handler นี้ก่อน กันซ้ำ
 */
function setupCounterCleanupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'monthlyCounterCleanup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('monthlyCounterCleanup').timeBased().onMonthDay(1).atHour(3).create();
  return '✅ ติดตั้ง trigger monthlyCounterCleanup (ทุกวันที่ 1 ~03:00) เรียบร้อย';
}
