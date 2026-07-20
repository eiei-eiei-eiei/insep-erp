// === Stock running balance (Stock_Product) + query ===
// ==========================================
// Stock Running Balance (Materialized Balance Pattern)
// Sheet "Stock_Product": col A = productId | col B = balance | col C = lastUpdated
//
// หลักการ:
//   - ทุกครั้งที่เขียน Log_Product → อัปเดต balance ทันที (+/- amount)
//   - อ่านสต็อก = อ่าน balance ตรงๆ O(1) ไม่ต้อง SUM ทั้ง log
//   - Log_Product ยังเก็บครบเป็น audit trail
//   - recomputeStockProduct_() ใช้ซ่อม/seed ถ้า balance เพี้ยน
//
// ทิศทาง balance ตาม type ใน Log_Product:
//   + (บวก): "รับ"
//   - (ลบ):  "จ่าย", "จำหน่ายต่างประเทศ", "แตกหักเสียหาย", "เสียหาย", "อื่นๆ", "อื่น ๆ"
// ==========================================

/**
 * ตรวจว่า type เป็นการ "รับเข้า" (บวก) หรือไม่
 * ทุก type ที่ไม่ใช่ "รับ" ถือเป็นการจ่ายออก (ลบ)
 * @private
 */
function isStockInbound_(type) {
  return String(type).trim() === 'รับ';
}

/**
 * คำนวณ delta (+/-) สำหรับ balance จาก type และจำนวน
 * @private
 * @param {string} type   - ประเภทจาก Log_Product column 2
 * @param {number} amount - จำนวน(ขวด)
 * @returns {number} delta (บวกถ้ารับ, ลบถ้าจ่าย)
 */
function computeStockDelta_(type, amount) {
  const n = parseFloat(amount) || 0;
  return isStockInbound_(type) ? n : -n;
}

/**
 * คืน reference ของ sheet Stock_Product — สร้างใหม่พร้อม header ถ้ายังไม่มี
 * @private
 */
function getStockProductSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Stock_Product');
  if (!sheet) {
    sheet = ss.insertSheet('Stock_Product');
    sheet.appendRow(['productId', 'balance', 'lastUpdated']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * อัปเดต balance ของ productId โดย "ไม่" acquire lock เอง
 * ใช้เมื่อ caller ถือ LockService อยู่แล้ว (เช่นใน saveTransaction)
 * @private
 * @param {string} productId
 * @param {number} delta - จำนวนที่จะบวก/ลบ
 * @returns {number} balance ใหม่หลังอัปเดต
 */
function updateStockBalanceNoLock_(productId, delta) {
  if (!productId) return null;
  const sheet = getStockProductSheet_();
  const now = new Date();
  const lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    // อ่านเฉพาะ column productId เพื่อหา row (performance)
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(productId)) {
        const rowIdx = i + 2;
        const cur = parseFloat(sheet.getRange(rowIdx, 2).getValue()) || 0;
        const next = cur + delta;
        // เขียน balance + lastUpdated พร้อมกัน (2 cells ติดกัน)
        sheet.getRange(rowIdx, 2, 1, 2).setValues([[next, now]]);
        return next;
      }
    }
  }

  // ไม่เจอ productId → เพิ่ม row ใหม่
  sheet.appendRow([productId, delta, now]);
  return delta;
}

/**
 * อัปเดต balance ของ productId (มี LockService กัน race condition)
 * ใช้สำหรับเรียกแบบเดี่ยวๆ ที่ยังไม่ได้ถือ lock
 * @private
 * @param {string} productId
 * @param {number} delta
 * @returns {number} balance ใหม่
 */
function updateStockBalance_(productId, delta) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return updateStockBalanceNoLock_(productId, delta);
  } finally {
    lock.releaseLock();
  }
}

/**
 * คำนวณ balance ใหม่ทั้งหมดจาก Log_Product แล้วเขียนทับ Stock_Product
 * ใช้ seed ครั้งแรก หรือซ่อมเมื่อ balance เพี้ยน
 *
 * - อ่าน Master_Product → productId ทุกตัว (init balance = 0)
 * - อ่าน Log_Product ทั้งหมด → บวก/ลบ ตาม type
 * - เขียน batch setValues ครั้งเดียว
 * - มี LockService ครอบ กัน update ชนระหว่าง recompute
 *
 * @private
 * @returns {{ success: boolean, message: string, count: number }}
 */
function recomputeStockProduct_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    const masterProducts = readSheet('Master_Product');
    const logProducts    = readSheet('Log_Product');

    // 1. init balance = 0 สำหรับทุก productId ใน Master (รักษาลำดับตาม Master)
    const balanceMap = {};
    const order = [];
    masterProducts.forEach(p => {
      const id = String(p['รหัสสินค้า']);
      if (id && !(id in balanceMap)) {
        balanceMap[id] = 0;
        order.push(id);
      }
    });

    // 2. รวมยอดจาก Log_Product
    logProducts.forEach(row => {
      const id   = String(row['รหัสสินค้า']);
      if (!id) return;
      const type = row['ประเภท(รับ/จ่าย)'];
      const qty  = row['จำนวน(ขวด)'];
      const delta = computeStockDelta_(type, qty);

      if (id in balanceMap) {
        balanceMap[id] += delta;
      } else {
        // log มี product ที่ไม่อยู่ใน Master → ยังนับให้ (กันข้อมูลหาย)
        balanceMap[id] = delta;
        order.push(id);
      }
    });

    // 3. เขียนทับ Stock_Product (batch)
    const sheet = getStockProductSheet_();
    const now = new Date();
    const rows = order.map(id => [id, balanceMap[id], now]);

    // เคลียร์ข้อมูลเก่าใต้ header ก่อน
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      sheet.getRange(2, 1, lastRow - 1, 3).clearContent();
    }
    // เขียนใหม่ครั้งเดียว
    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, 3).setValues(rows);
    }

    SpreadsheetApp.flush();
    return { success: true, message: `คำนวณสต็อกใหม่สำเร็จ ${rows.length} รายการ`, count: rows.length };
  } catch (e) {
    return { success: false, message: 'คำนวณสต็อกใหม่ไม่สำเร็จ: ' + e.toString(), count: 0 };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Wrapper สำหรับรัน recompute แบบ manual จาก Apps Script Editor
 *
 * (recomputeStockProduct_ ลงท้ายด้วย "_" เป็น private function จึงไม่โผล่ใน
 *  dropdown ให้เลือกรัน — ฟังก์ชันนี้ไม่มี "_" จึงเลือกรันได้)
 *
 * วิธีรัน: Apps Script Editor → dropdown ชื่อฟังก์ชัน → runRecomputeStock → ▶ Run
 * แล้วดูผลใน Execution Log
 */
function runRecomputeStock() {
  const result = recomputeStockProduct_();
  Logger.log(result.message);
  return result;
}

/**
 * Wrapper สำหรับ Time-driven Trigger รายสัปดาห์ (safety net / self-healing)
 * ตั้ง trigger ให้เรียกฟังก์ชันนี้ (ดูขั้นตอนตั้ง trigger ในข้อ 6)
 */
function weeklyRecomputeStock() {
  const result = recomputeStockProduct_();
  Logger.log('[Weekly Recompute] ' + result.message);
  return result;
}

// ==========================================
// Stock Query Functions (ข้อ 4)
// อ่าน balance จาก Stock_Product โดยตรง — O(1) ไม่ต้อง SUM log
//
// 💡 หมายเหตุสำหรับแอปขาย:
//    แนะนำให้อ่าน Stock_Product sheet โดยตรงผ่าน SpreadsheetApp.openById()
//    แทนการเรียกฟังก์ชันนี้ผ่าน doPost เพราะเร็วกว่าและไม่ต้อง round-trip
//    ฟังก์ชันเหล่านี้ไว้ใช้ใน UI แอปผลิตเอง หรือ debug
// ==========================================

/**
 * อ่าน balance ของ productId จาก Stock_Product
 * @param {string} productId
 * @returns {{ success: boolean, productId: string, balance: number, lastUpdated: string }}
 */
function getProductStock(productId) {
  try {
    if (!productId) throw new Error('กรุณาระบุ productId');

    const sheet = getStockProductSheet_();
    const lastRow = sheet.getLastRow();

    if (lastRow >= 2) {
      const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
      for (let i = 0; i < data.length; i++) {
        if (String(data[i][0]) === String(productId)) {
          return {
            success:     true,
            productId:   String(data[i][0]),
            balance:     parseFloat(data[i][1]) || 0,
            lastUpdated: data[i][2] ? Utilities.formatDate(new Date(data[i][2]), 'GMT+7', 'yyyy-MM-dd HH:mm:ss') : '-'
          };
        }
      }
    }

    // ไม่พบ productId ใน Stock_Product → balance = 0
    return { success: true, productId: productId, balance: 0, lastUpdated: '-' };
  } catch (e) {
    return { success: false, productId: productId, balance: 0, lastUpdated: '-', message: e.toString() };
  }
}

/**
 * อ่าน balance ทั้งหมดจาก Stock_Product (โหลดทีเดียว)
 * @returns {{ success: boolean, items: Array<{productId, balance, lastUpdated}> }}
 */
function getAllProductStock() {
  try {
    const sheet   = getStockProductSheet_();
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) return { success: true, items: [] };

    const data  = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    const items = data
      .filter(row => row[0] !== '')
      .map(row => ({
        productId:   String(row[0]),
        balance:     parseFloat(row[1]) || 0,
        lastUpdated: row[2] ? Utilities.formatDate(new Date(row[2]), 'GMT+7', 'yyyy-MM-dd HH:mm:ss') : '-'
      }));

    return { success: true, items: items };
  } catch (e) {
    return { success: false, items: [], message: e.toString() };
  }
}

