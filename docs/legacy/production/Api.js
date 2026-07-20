// === API: idempotency, doGet, doPost (RECEIVE_MATERIAL/SELL_PRODUCT), setupPermissions, include() ===
// ==========================================
// Idempotency Helpers (ป้องกัน double-insert จาก SELL_PRODUCT)
// Schema ของ API_Log sheet:
//   col A: timestamp | col B: action | col C: idempotencyKey | col D: status | col E: message
// ==========================================

function isIdempotentDuplicate_(key, action) {
  if (!key) return false;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('API_Log');
  if (!sheet || sheet.getLastRow() < 2) return false;

  const data = sheet.getRange(2, 2, sheet.getLastRow() - 1, 2).getValues();
  return data.some(row => String(row[0]) === String(action) && String(row[1]) === String(key));
}

function logApiCall_(key, action, status, message) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('API_Log');
  if (!sheet) {
    sheet = ss.insertSheet('API_Log');
    sheet.appendRow(['timestamp', 'action', 'idempotencyKey', 'status', 'message']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([new Date(), action, key || '', status, message || '']);
}

// ==========================================
// ฟังก์ชันเปิดหน้าเว็บ
// ==========================================
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Insep - ระบบจัดการโรงสุรา')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ==========================================
// ฟังก์ชันรับข้อมูลจากระบบภายนอก (Webhook API)
// ==========================================
function doPost(e) {
  const EXPECTED_TOKEN = getConfig_().expectedToken;
  let response = { success: false, message: "" };

  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("ไม่มีข้อมูลส่งมา (Empty Payload)");
    }

    const data = JSON.parse(e.postData.contents);

    if (data.token !== EXPECTED_TOKEN) {
      response.message = "ไม่อนุญาตให้เข้าถึง: Token ไม่ถูกต้อง";
      return ContentService.createTextOutput(JSON.stringify(response))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const action = data.action;
    const payload = data.payload || {};

    if (action === "RECEIVE_MATERIAL") {
      let items = payload.items || [];
      if (payload.materialName && payload.amount && items.length === 0) {
        items.push({ materialName: payload.materialName, amount: payload.amount });
      }

      if (items.length === 0) throw new Error("ไม่มีข้อมูลรายการวัตถุดิบ (items)");

      const materials = readSheet('Master_Material');
      let savedCount = 0;

      items.forEach(item => {
        if (!item.materialName || !item.amount) return;

        const foundMat = materials.find(m => String(m['ชื่อวัตถุดิบ']).trim() === String(item.materialName).trim());
        if (!foundMat) {
          throw new Error(`ไม่พบชื่อวัตถุดิบ '${item.materialName}' ในฐานข้อมูล กรุณาตรวจสอบการสะกดคำ`);
        }

        const saveResult = saveTransaction('material', {
          date: payload.date || Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd"),
          transType: "รับ",
          materialId: foundMat['รหัสวัตถุดิบ'],
          amount: item.amount,
          docRef: payload.docRef || "",
          note: payload.note || "รับจากระบบจัดซื้อ API"
        });

        if (!saveResult.success) throw new Error(saveResult.message);
        savedCount++;
      });

      response = { success: true, message: `บันทึกรับวัตถุดิบสำเร็จ ${savedCount} รายการ` };

    } else if (action === "SELL_PRODUCT") {
      let items = payload.items || [];
      if (payload.productId && payload.amount && items.length === 0) {
        items.push({ productId: payload.productId, amount: payload.amount });
      }

      if (items.length === 0) throw new Error("ไม่มีข้อมูลรายการสินค้า (items)");

      // --- Idempotency Check ---
      // ถ้า key ซ้ำ → return success โดยไม่ append log และไม่ update balance (skip ทั้งคู่)
      const idempotencyKey = payload.idempotencyKey || '';
      if (idempotencyKey && isIdempotentDuplicate_(idempotencyKey, 'SELL_PRODUCT')) {
        return ContentService.createTextOutput(JSON.stringify({
          success: true,
          message: `ข้ามบันทึกซ้ำ: idempotencyKey "${idempotencyKey}" ประมวลผลไปแล้ว`
        })).setMimeType(ContentService.MimeType.JSON);
      }

      let savedCount = 0;

      items.forEach(item => {
        if (!item.productId || !item.amount) return;

        // saveTransaction('product') จะ append Log_Product + update Stock_Product
        // แบบ atomic ภายใต้ LockService เดียวกัน
        const saveResult = saveTransaction('product', {
          date: payload.date || Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd"),
          transType: payload.transType || "จ่าย",
          productId: item.productId,
          amount: item.amount,
          note: payload.note || "ตัดสต็อกจากการขาย API"
        });

        if (!saveResult.success) throw new Error(saveResult.message);
        savedCount++;
      });

      if (idempotencyKey) {
        logApiCall_(idempotencyKey, 'SELL_PRODUCT', 'success', `บันทึกขายสินค้าสำเร็จ ${savedCount} รายการ`);
      }

      response = { success: true, message: `บันทึกขายสินค้าสำเร็จ ${savedCount} รายการ` };

    } else {
      throw new Error("Action ไม่ถูกต้อง (ต้องเป็น RECEIVE_MATERIAL หรือ SELL_PRODUCT)");
    }

  } catch (err) {
    response.success = false;
    response.message = err.toString();
  }

  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

function setupPermissions() {
  UrlFetchApp.fetch("https://www.google.com");
  try { DriveApp.getRootFolder(); DriveApp.getFileById("dummy").setTrashed(true); } catch(e) {}
}


// === include() helper สำหรับ HTML template (เพิ่มตอนแตกไฟล์) ===
/**
 * รวมไฟล์ HTML ย่อยเข้า template หลัก
 * ใช้คู่กับ <?!= include('ชื่อไฟล์'); ?> ใน Index.html
 * doGet ใช้ createTemplateFromFile('Index').evaluate() อยู่แล้ว จึงประมวลผล tag นี้ได้
 */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}
