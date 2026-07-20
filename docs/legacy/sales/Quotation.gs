// ============================================================
// 📝 QUOTATION (เมนู, running number, save/update QU)
// ============================================================


function getB2BMenuData() {
  try {
    const cfg      = getConfig();
    const ss       = SpreadsheetApp.openByUrl(cfg.sheetUrl);
    const menuSheet  = ss.getSheetByName('menu_b2b');
    // curstock ยังอ่านอยู่ แต่ใช้เป็น fallback สำหรับสินค้าที่ไม่ใช่สุรา (manual adjustment only)
    const stockSheet = ss.getSheetByName('curstock');
    if (!menuSheet) return [];

    // ข้อ 4: ดึง Live Stock จาก Stock_Product ผ่าน cache (TTL 2 นาที)
    // สำหรับสินค้า category="สุรา" ที่มี productId — แอปผลิต maintain balance ให้แล้ว
    const liveStockMap = getStockMapWithCache_();

    // Fallback: curstock สำหรับสินค้าที่ไม่ใช่สุรา (category ≠ "สุรา" หรือไม่มี productId)
    const curStockMap = {};
    if (stockSheet) {
      const stockData = stockSheet.getDataRange().getValues();
      for (let i = 1; i < stockData.length; i++) {
        if (!stockData[i][0]) continue;
        curStockMap[stockData[i][0].toString().trim()] = Number(stockData[i][4]) || 0;
      }
    }

    const data = menuSheet.getDataRange().getValues();
    const menuList = [];
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      const itemCode   = data[i][3] ? data[i][3].toString().trim() : '';
      const category   = data[i][2] ? data[i][2].toString().trim() : '';
      const multiplier = Number(data[i][4]) || 1;

      // สินค้าสุราที่มี productId → ใช้ Live Stock จาก Stock_Product
      // สินค้าอื่น หรือสุราที่ไม่มี productId → fallback curstock
      const isLive = category === 'สุรา' && itemCode !== '';
      let rawStock = null;
      if (isLive) {
        // liveStockMap structure: { productId: { balance, name } }
        rawStock = liveStockMap[itemCode] ? liveStockMap[itemCode].balance : null;
      } else if (itemCode !== '') {
        rawStock = curStockMap[itemCode] ?? null;
      }

      // แปลงหน่วย: Stock_Product และ curstock เก็บหน่วยย่อย (ขวด)
      // menu แสดงหน่วยขาย (ลัง) → หาร multiplier
      const stockQty = rawStock !== null ? Math.floor(rawStock / multiplier) : null;

      menuList.push({
        name:       data[i][0].toString().trim(),
        price:      Number(data[i][1]) || 0,
        category,
        itemCode,
        multiplier,
        stockQty,
        // isLive: true = ดึงจาก Stock_Product (แอปผลิต), false = curstock
        // ใช้แสดง label "🏭 Live" ใน UI
        isLive,
      });
    }
    return menuList;
  } catch (e) { throw new Error(e.message); }
}

/**
 * สร้างเลข INV/TAX แบบ atomic ผ่าน PropertiesService
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - btbtransaction (สำหรับ seed ครั้งแรก)
 * @param {'INV'|'TAX'} prefix
 */

/**
 * สร้างเลข INV/TAX แบบ atomic ผ่าน PropertiesService
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - btbtransaction (สำหรับ seed ครั้งแรก)
 * @param {'INV'|'TAX'} prefix
 */
function generateRunningNumber(sheet, prefix) {
  return getNextSerial(prefix, {
    seed: (dateStr) => {
      // Migration: scan sheet ครั้งแรกของวันใหม่เท่านั้น
      const data = sheet.getDataRange().getValues();
      // TAX เช็คทั้ง taxNo1 (idx 18) และ taxNo2 (idx 19), INV เช็คแค่ invNo (idx 17)
      const colsToCheck = prefix === 'TAX' ? [18, 19] : [17];
      let max = 0;
      for (let i = 1; i < data.length; i++) {
        for (const colIdx of colsToCheck) {
          const cellValue = data[i][colIdx];
          if (!cellValue) continue;
          const docs = cellValue.toString().split('|');
          for (const d of docs) {
            if (d.trim().startsWith(prefix + dateStr)) {
              const parts = d.split('-');
              if (parts.length >= 2) {
                const no = parseInt(parts[parts.length - 1], 10);
                if (!isNaN(no) && no > max) max = no;
              }
            }
          }
        }
      }
      return max;
    },
  });
}

function saveB2BQuotation(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cfg        = getConfig();
    const ss         = SpreadsheetApp.openByUrl(cfg.sheetUrl);
    const transSheet = ss.getSheetByName('btbtransaction');
    const salesSheet = ss.getSheetByName('btbsales');
    if (!transSheet || !salesSheet) throw new Error("หาแท็บ 'btbtransaction' หรือ 'btbsales' ไม่พบ");

    const timestamp = new Date();

    // 🔢 สร้าง seed function ที่ scan sheet เฉพาะ column และ prefix ที่กำหนด
    // ใช้ครั้งเดียวต่อ key ใหม่ (วันใหม่) — ครั้งต่อไปอ่านจาก Properties ตรงๆ
    const seedFromSheet = (col, prefixForMatch) => (dateStr) => {
      const data = transSheet.getDataRange().getValues();
      let max = 0;
      for (let i = 1; i < data.length; i++) {
        const v = data[i][col] ? data[i][col].toString() : '';
        if (v.startsWith(prefixForMatch + dateStr)) {
          const num = parseInt(v.split('-')[1], 10);
          if (!isNaN(num) && num > max) max = num;
        }
      }
      return max;
    };

    const quNo    = getNextSerial('QU',  { seed: seedFromSheet(4,  'QU')  });
    const orderNo = getNextSerial('ORD', { seed: seedFromSheet(11, 'ORD') });

    const quExp = new Date(timestamp);
    quExp.setDate(quExp.getDate() + 15);

    const newRow = new Array(31).fill("");
    newRow[0]  = timestamp;
    newRow[1]  = payload.customer.id;
    newRow[2]  = payload.customer.name;
    newRow[3]  = payload.saleName || "";
    newRow[4]  = quNo;
    newRow[5]  = quExp.toLocaleDateString('th-TH');
    newRow[6]  = payload.subTotal;
    newRow[7]  = payload.discount;
    newRow[8]  = payload.subDiscount;
    newRow[9]  = payload.vatAmount;
    newRow[10] = payload.grandTotal;
    newRow[11] = orderNo;
    newRow[12] = "รอคอนเฟิร์ม";
    newRow[13] = 0;
    newRow[14] = payload.netPayable || payload.grandTotal;
    newRow[20] = payload.remarks    || "";
    newRow[25] = payload.whtPercent || 0;
    newRow[26] = payload.whtAmount  || 0;
    newRow[27] = payload.netPayable || payload.grandTotal;
    newRow[30] = payload.category   || "รายได้ค่าสินค้า";

    transSheet.appendRow(newRow);

    const salesData = payload.items.map(item => [
      timestamp, payload.customer.id, payload.customer.name, quNo,
      item.name, item.qty, item.price, item.price * item.qty,
    ]);
    if (salesData.length > 0) salesSheet.getRange(salesSheet.getLastRow() + 1, 1, salesData.length, 8).setValues(salesData);

    SpreadsheetApp.flush();

    // 📲 LINE 2.1 — แจ้งออเดอร์ใหม่
    try {
      const totalFmt = (payload.grandTotal || 0).toLocaleString('th-TH', { minimumFractionDigits: 0 });
      sendLineNotification(
        `🛒 ออเดอร์ใหม่\n[${quNo}] ${payload.customer.name}\n${payload.items.length} รายการ | ยอด ฿${totalFmt}`
      );
    } catch (_) {}

    return {
      success:   true,
      quNo,
      orderNo,
      timestamp: timestamp.toLocaleString('th-TH'),
      quExp:     quExp.toLocaleDateString('th-TH'),
    };
  } catch (e) { return { success: false, message: e.message }; }
  finally { lock.releaseLock(); }
}

/**
 * แก้ไขใบเสนอราคาที่มีอยู่ (เฉพาะ status "รอคอนเฟิร์ม")
 * - QU, ORD, วันที่ไม่เปลี่ยน
 * - อัปเดตยอดเงินและรายการสินค้า
 * - ลบ btbsales rows เก่า → เขียนใหม่
 */

/**
 * แก้ไขใบเสนอราคาที่มีอยู่ (เฉพาะ status "รอคอนเฟิร์ม")
 * - QU, ORD, วันที่ไม่เปลี่ยน
 * - อัปเดตยอดเงินและรายการสินค้า
 * - ลบ btbsales rows เก่า → เขียนใหม่
 */
function updateB2BQuotation(quNo, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cfg        = getConfig();
    const ss         = SpreadsheetApp.openByUrl(cfg.sheetUrl);
    const transSheet = ss.getSheetByName('btbtransaction');
    const salesSheet = ss.getSheetByName('btbsales');
    if (!transSheet || !salesSheet) throw new Error("ไม่พบชีท btbtransaction หรือ btbsales");

    // หา row ของ QU นี้ + ตรวจสอบสถานะ
    const transData = transSheet.getDataRange().getValues();
    let rowIndex = -1, orderNo = quNo;
    for (let i = 1; i < transData.length; i++) {
      if (transData[i][4] === quNo) {
        if (transData[i][12] !== 'รอคอนเฟิร์ม') {
          return { success: false, message: `แก้ไขไม่ได้ — สถานะปัจจุบันคือ "${transData[i][12]}"` };
        }
        rowIndex = i + 1;   // 1-indexed สำหรับ getRange
        orderNo  = transData[i][11] || quNo;
        break;
      }
    }
    if (rowIndex === -1) return { success: false, message: `ไม่พบใบเสนอราคา ${quNo} ในระบบ` };

    const timestamp = new Date();

    // อัปเดต btbtransaction — ยอดเงินและหมายเหตุ (QU/ORD/วันที่คงเดิม)
    const rowRange  = transSheet.getRange(rowIndex, 1, 1, 31);
    const rowValues = rowRange.getValues()[0];
    rowValues[3]  = payload.saleName    || rowValues[3];
    rowValues[6]  = payload.subTotal;
    rowValues[7]  = payload.discount;
    rowValues[8]  = payload.subDiscount;
    rowValues[9]  = payload.vatAmount;
    rowValues[10] = payload.grandTotal;
    rowValues[14] = payload.netPayable  || payload.grandTotal;
    rowValues[20] = payload.remarks     || "";
    rowValues[25] = payload.whtPercent  || 0;
    rowValues[26] = payload.whtAmount   || 0;
    rowValues[27] = payload.netPayable  || payload.grandTotal;
    rowValues[30] = payload.category    || "รายได้ค่าสินค้า";
    rowRange.setValues([rowValues]);

    // ลบ btbsales rows เก่าของ QU นี้ (จากล่างขึ้นบนเพื่อไม่ให้ index เลื่อน)
    const salesData  = salesSheet.getDataRange().getValues();
    const toDelete   = [];
    for (let i = 1; i < salesData.length; i++) {
      if (salesData[i][3] === quNo) toDelete.push(i + 1);   // 1-indexed
    }
    for (let i = toDelete.length - 1; i >= 0; i--) {
      salesSheet.deleteRow(toDelete[i]);
    }

    // เขียน btbsales ใหม่
    const newSalesData = payload.items.map(item => [
      timestamp, payload.customer.id, payload.customer.name, quNo,
      item.name, item.qty, item.price, item.price * item.qty,
    ]);
    if (newSalesData.length > 0) {
      salesSheet.getRange(salesSheet.getLastRow() + 1, 1, newSalesData.length, 8).setValues(newSalesData);
    }

    SpreadsheetApp.flush();

    // 📲 LINE — แจ้งแก้ไขออเดอร์
    try {
      const totalFmt = (payload.grandTotal || 0).toLocaleString('th-TH', { minimumFractionDigits: 0 });
      sendLineNotification(`✏️ แก้ไขออเดอร์\n[${quNo}] ${payload.customer.name}\n${payload.items.length} รายการ | ยอด ฿${totalFmt}`);
    } catch (_) {}

    return { success: true, quNo, orderNo };
  } catch (e) { return { success: false, message: e.message }; }
  finally { lock.releaseLock(); }
}
