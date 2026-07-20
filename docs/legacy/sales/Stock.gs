// ============================================================
// 📦 STOCK (live stock, cache, manual move)
// ============================================================


/**
 * ข้อ 1: ดึง balance ของ productId เดียวจาก Stock_Product
 * @param {string} productId
 * @returns {{ available: number, unit: string, name: string }}
 */
function getLiveStock_(productId) {
  const map = getAllLiveStock_();
  const key = (productId || '').toString().trim();
  const entry = map[key];
  return {
    available: entry ? entry.balance : 0,
    name:      entry ? entry.name    : '',
    unit:      'ขวด',
  };
}

/**
 * ข้อ 2: อ่าน Stock_Product + Master_Product ครั้งเดียว (cross-app)
 * - Stock_Product schema: [productId, balance, lastUpdated]
 * - Master_Product: col A = productId, col E = ชื่อสินค้า
 * เปิด spreadsheet แอปผลิตครั้งเดียว อ่าน 2 sheet
 * @returns {Object<string, {balance: number, name: string}>}
 */

/**
 * ข้อ 2: อ่าน Stock_Product + Master_Product ครั้งเดียว (cross-app)
 * - Stock_Product schema: [productId, balance, lastUpdated]
 * - Master_Product: col A = productId, col E = ชื่อสินค้า
 * เปิด spreadsheet แอปผลิตครั้งเดียว อ่าน 2 sheet
 * @returns {Object<string, {balance: number, name: string}>}
 */
function getAllLiveStock_() {
  const liquorSheetId = PropertiesService.getScriptProperties().getProperty('LIQUOR_SHEET_ID');
  if (!liquorSheetId || liquorSheetId === 'YOUR_LIQUOR_SPREADSHEET_ID') {
    console.warn('[Live Stock] ยังไม่ได้ตั้ง LIQUOR_SHEET_ID — คืน map ว่าง');
    return {};
  }

  try {
    const liquorSS    = SpreadsheetApp.openById(liquorSheetId);   // expensive — ทำครั้งเดียว
    const stockSheet  = liquorSS.getSheetByName('Stock_Product');
    if (!stockSheet) {
      console.error('[Live Stock] ไม่พบ sheet Stock_Product ในแอปผลิต');
      return {};
    }

    // สร้าง nameMap จาก Master_Product (col A = productId, col E = ชื่อ) ก่อน
    const nameMap = {};
    const masterSheet = liquorSS.getSheetByName('Master_Product');
    if (masterSheet) {
      const mData = masterSheet.getDataRange().getValues();
      for (let i = 1; i < mData.length; i++) {
        const pid = mData[i][0] ? mData[i][0].toString().trim() : '';
        if (!pid) continue;
        nameMap[pid] = mData[i][4] ? mData[i][4].toString().trim() : '';   // col E (index 4)
      }
    } else {
      console.warn('[Live Stock] ไม่พบ sheet Master_Product — จะแสดงชื่อเป็น productId แทน');
    }

    // รวม balance + name
    const data = stockSheet.getDataRange().getValues();
    const map  = {};
    for (let i = 1; i < data.length; i++) {   // row 0 = header
      const pid = data[i][0] ? data[i][0].toString().trim() : '';
      if (!pid) continue;
      map[pid] = {
        balance: Number(data[i][1]) || 0,        // Stock_Product col B
        name:    nameMap[pid] || pid,            // fallback: productId ถ้าไม่เจอชื่อ
      };
    }
    return map;
  } catch (err) {
    // เช่น permission ยังไม่ได้แชร์ spreadsheet → คืน map ว่าง
    console.error('[Live Stock] อ่าน Stock_Product/Master_Product ไม่สำเร็จ:', err);
    return {};
  }
}

/**
 * ข้อ 3: wrapper อ่าน stock map ผ่าน CacheService (TTL 2 นาที)
 * @returns {Object<string, {balance: number, name: string}>}
 */

/**
 * ข้อ 3: wrapper อ่าน stock map ผ่าน CacheService (TTL 2 นาที)
 * @returns {Object<string, {balance: number, name: string}>}
 */
function getStockMapWithCache_() {
  const cache = CacheService.getScriptCache();   // script-wide (shared ทุก user)
  const KEY   = 'STOCK_MAP_ALL';

  const cached = cache.get(KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) { /* corrupt → โหลดใหม่ */ }
  }

  const map = getAllLiveStock_();
  try {
    const json = JSON.stringify(map);
    // CacheService จำกัด 100KB/key — ถ้าเกินจะ throw, ข้ามการ cache ไป
    if (json.length < 100000) cache.put(KEY, json, 120);   // 120 วินาที = 2 นาที
  } catch (err) {
    console.warn('[Live Stock] cache put ไม่สำเร็จ (อาจใหญ่เกิน 100KB):', err);
  }
  return map;
}

/**
 * ข้อ 3: ลบ cache stock — เรียกหลัง confirmFulfillment สำเร็จ
 * (balance ที่ผลิตเปลี่ยนแล้ว ครั้งหน้าต้องดึงใหม่)
 */

/**
 * ข้อ 3: ลบ cache stock — เรียกหลัง confirmFulfillment สำเร็จ
 * (balance ที่ผลิตเปลี่ยนแล้ว ครั้งหน้าต้องดึงใหม่)
 */
function invalidateStockCache_() {
  CacheService.getScriptCache().remove('STOCK_MAP_ALL');
  console.log('[Live Stock] invalidate cache STOCK_MAP_ALL แล้ว');
}

/**
 * สร้าง Map ข้อมูลลูกค้า (taxId, branch, address) จาก sheet custdata
 */

function getCurrentStockData() {
  try {
    // ดึง stock ทั้งหมดจาก Stock_Product (แอปผลิต) ผ่าน cache
    // structure: { productId: { balance, name } }
    const liveStockMap = getStockMapWithCache_();

    const list = [];
    for (const productId in liveStockMap) {
      const entry = liveStockMap[productId];
      list.push({
        itemCode:     productId,
        itemName:     entry.name || productId,
        category:     'สุรา',          // Stock_Product เก็บเฉพาะสินค้าผลิต (สุรา)
        unit:         'ขวด',
        currentStock: entry.balance,
        isLive:       true,
      });
    }
    // เรียงตาม productId ให้ลำดับคงที่
    list.sort((a, b) => a.itemCode < b.itemCode ? -1 : a.itemCode > b.itemCode ? 1 : 0);
    return list;
  } catch (e) { throw new Error(e.message); }
}

function processManualStockMove(payload, userName) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cfg       = getConfig();
    const ss        = SpreadsheetApp.openByUrl(cfg.sheetUrl);
    const curSheet  = ss.getSheetByName('curstock');
    const moveSheet = ss.getSheetByName('stockmove');
    if (!curSheet || !moveSheet) throw new Error("ไม่พบชีทระบบสต็อก");

    const data = curSheet.getDataRange().getValues();
    let rowIndex = -1, intStock = 0, itemName = "";

    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === payload.itemCode) {
        rowIndex = i + 1;
        itemName = data[i][1].toString();
        intStock = Number(data[i][4]) || 0;
        break;
      }
    }
    if (rowIndex === -1) throw new Error("ไม่พบรหัสสินค้านี้ในฐานข้อมูล (curstock)");

    const qtyInput = Number(payload.qty) || 0;
    let sumStock = intStock;
    let actionTypeStr = payload.actionType;

    if (payload.actionType === 'IN') {
      sumStock = intStock + Math.abs(qtyInput);
    } else if (payload.actionType === 'OUT') {
      sumStock = intStock - Math.abs(qtyInput);
    } else if (payload.actionType === 'ADJUST') {
      sumStock = intStock + qtyInput;
      actionTypeStr = qtyInput >= 0 ? 'ADJUST_IN' : 'ADJUST_OUT';
    }

    curSheet.getRange(rowIndex, 5).setValue(sumStock);
    moveSheet.appendRow([new Date(), payload.itemCode, itemName, intStock, actionTypeStr, Math.abs(qtyInput), payload.refNo, sumStock, userName, payload.remarks]);
    SpreadsheetApp.flush();
    return { success: true, newStock: sumStock };
  } catch (e) { return { success: false, message: e.message }; }
  finally { lock.releaseLock(); }
}
