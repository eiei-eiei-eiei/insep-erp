// =========================================================================
// FILE: Scan.gs  [3/8]
// ส่วนที่ 0: AI Receipt Scanner — อ่านใบเสร็จ/ใบกำกับภาษีด้วย Claude Vision
// ⚠️ global ที่ประกาศที่นี่ (SCAN_DEFAULT_DAILY_LIMIT) ห้ามประกาศซ้ำในไฟล์อื่น
// =========================================================================

const SCAN_DEFAULT_DAILY_LIMIT = 100;   // จำนวน scan สูงสุดต่อ user ต่อวัน (default)

/**
 * SCAN-1: ตรวจ rate limit ของ user ต่อวัน
 * - key: SCAN_COUNT_<yyyyMMdd>_<email>
 * - ถ้า user email ดึงไม่ได้ (publish anonymous) → ใช้ "anonymous" แทน
 * @returns {{ allowed: boolean, current: number, limit: number, userKey: string }}
 */
function checkScanRateLimit_() {
  const props    = PropertiesService.getScriptProperties();
  const limit    = parseInt(props.getProperty('SCAN_DAILY_LIMIT') || SCAN_DEFAULT_DAILY_LIMIT, 10);
  const email    = Session.getActiveUser().getEmail() || 'anonymous';
  const dateStr  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd");
  const propKey  = `SCAN_COUNT_${dateStr}_${email}`;
  const current  = parseInt(props.getProperty(propKey) || '0', 10);

  return {
    allowed : current < limit,
    current : current,
    limit   : limit,
    userKey : propKey,
    email   : email
  };
}

/**
 * SCAN-1: เพิ่ม counter หลัง scan สำเร็จ + auto-cleanup key เก่ากว่า 7 วัน
 * แยก lock เพื่อกัน race condition (2 user scan พร้อมกัน → counter ผิด)
 */
function incrementScanCounter_(userKey) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const props   = PropertiesService.getScriptProperties();
    const current = parseInt(props.getProperty(userKey) || '0', 10);
    props.setProperty(userKey, (current + 1).toString());

    // Auto-cleanup: ลบ key SCAN_COUNT_* เก่ากว่า 7 วัน (ทำเฉพาะ ~5% ของ request เพื่อ perf)
    if (Math.random() < 0.05) {
      cleanupOldScanCounters_(props);
    }
  } finally {
    lock.releaseLock();
  }
}

/** ลบ key SCAN_COUNT_<yyyyMMdd>_* ที่เก่ากว่า 7 วัน */
function cleanupOldScanCounters_(props) {
  const tz         = Session.getScriptTimeZone();
  const cutoff     = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr  = Utilities.formatDate(cutoff, tz, "yyyyMMdd");
  const allKeys    = props.getKeys();
  let deleted = 0;
  allKeys.forEach(function(k) {
    const m = k.match(/^SCAN_COUNT_(\d{8})_/);
    if (m && m[1] < cutoffStr) { props.deleteProperty(k); deleted++; }
  });
  if (deleted > 0) console.log(`[cleanupOldScanCounters_] ลบ key เก่า ${deleted} อัน`);
}

/**
 * SCAN-2: บันทึก log การ scan ทุกครั้ง (success/error/rate_limit)
 * Sheet: Scan_Log [timestamp, userEmail, status, confidence, errorMessage]
 * ใช้ try/catch ครอบทั้งหมด เพราะ log fail ไม่ควรทำให้ scan fail
 */
function logScanAttempt_(userEmail, status, confidence, errorMessage) {
  try {
    const cfg = getConfig_();
    const ss  = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    let sheet = ss.getSheetByName('Scan_Log');
    if (!sheet) {
      sheet = ss.insertSheet('Scan_Log');
      sheet.appendRow(['timestamp', 'userEmail', 'status', 'confidence', 'errorMessage']);
    }
    sheet.appendRow([
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      userEmail || 'anonymous',
      status,
      confidence || '-',
      errorMessage || '-'
    ]);
  } catch (e) {
    console.error(`[logScanAttempt_] log failed: ${e.message}`);
  }
}

/**
 * รับรูปภาพใบเสร็จจาก client แล้วส่งไป Anthropic API เพื่อ extract ข้อมูล
 * @param {string} base64Data - base64 string ของรูปภาพ (ไม่รวม data:image/...;base64, prefix)
 * @param {string} mimeType   - ชนิดไฟล์ เช่น "image/jpeg", "image/png"
 * @returns {{ success: boolean, data?: Object, message?: string }}
 */
function scanReceiptWithAI(base64Data, mimeType) {
  // ดึง email ออกมาก่อน เพื่อใช้ log ได้ทุก branch
  const rateInfo = checkScanRateLimit_();

  try {
    const cfg = getConfig_();

    if (!cfg.ANTHROPIC_API_KEY || cfg.ANTHROPIC_API_KEY.includes('ใส่-key')) {
      logScanAttempt_(rateInfo.email, 'error', null, 'API key not configured');
      return { success: false, message: 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ใน Script Properties' };
    }

    // SCAN-1: เช็ค rate limit ก่อนยิง API จริง
    if (!rateInfo.allowed) {
      logScanAttempt_(rateInfo.email, 'rate_limit', null, `${rateInfo.current}/${rateInfo.limit}`);
      return {
        success: false,
        message: `เกินจำนวนสแกนรายวัน (${rateInfo.current}/${rateInfo.limit}) — กรุณาลองใหม่พรุ่งนี้`
      };
    }

    const systemPrompt = `คุณเป็น AI ผู้เชี่ยวชาญในการอ่านตัวเลขและข้อมูลจากใบเสร็จและใบกำกับภาษีของไทย
ให้ extract ข้อมูลออกมาเป็น JSON เท่านั้น ไม่ต้องมีข้อความอื่น ไม่ต้องมี markdown code block
โฟกัสที่ตัวเลขและรหัสเป็นหลัก สำหรับข้อความภาษาไทยถ้าอ่านไม่ชัดให้ใส่ null`;

    const userPrompt = `อ่านข้อมูลจากใบเสร็จ/ใบกำกับภาษีนี้ แล้ว return JSON ตาม schema นี้:
{
  "taxId"          : "เลขภาษีของผู้ออกบิล 13 หลัก (ตัวเลขล้วน ไม่มี dash)",
  "taxInvoiceNo"   : "เลขที่ใบกำกับภาษี",
  "taxInvoiceDate" : "วันที่ในรูปแบบ yyyy-MM-dd",
  "description"    : "รายละเอียดสั้นๆ ของบิลนี้ไม่เกิน 50 ตัวอักษร",
  "hasVat"         : true หรือ false (มีรายการ VAT ในบิลไหม),
  "priceType"      : "incl_vat" ถ้าราคาในบิลรวม VAT แล้ว, "excl_vat" ถ้าราคายังไม่รวม VAT, "unknown" ถ้าไม่แน่ใจ,
  "items": [
    { "itemName": "ชื่อสินค้า/บริการ (ถ้าอ่านไม่ชัดให้ใส่ null)", "quantity": 1, "scannedPrice": ราคาต่อหน่วยที่อ่านได้เป็นตัวเลข }
  ],
  "confidence"      : "high" หรือ "medium" หรือ "low",
  "uncertainFields" : ["ชื่อ field ที่ไม่แน่ใจ"]
}

กฎสำคัญ:
- taxId คือเลขของผู้ขาย/ผู้ออกบิล ไม่ใช่ผู้ซื้อ ใส่เฉพาะตัวเลข 13 หลัก
- priceType: ดูจากบิล — ถ้ามีบรรทัด VAT แยกต่างหาก แปลว่าราคา item เป็น excl_vat, ถ้าราคารวม VAT ไว้ในราคาเดียวคือ incl_vat
- scannedPrice คือราคาต่อหน่วยที่อ่านได้จากบิล (ไม่ต้องคำนวณ VAT เพิ่ม)
- ถ้าอ่านชื่อสินค้าภาษาไทยไม่ชัดให้ใส่ null อย่าเดา
- return เฉพาะ JSON เท่านั้น`;

    const requestBody = {
      model     : 'claude-haiku-4-5-20251001',  // ใช้ Haiku ประหยัด cost สำหรับ OCR
      max_tokens: 1024,
      system    : systemPrompt,
      messages  : [{
        role   : 'user',
        content: [
          {
            type  : 'image',
            source: { type: 'base64', media_type: mimeType, data: base64Data }
          },
          { type: 'text', text: userPrompt }
        ]
      }]
    };

    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method             : 'post',
      contentType        : 'application/json',
      muteHttpExceptions : true,
      headers            : {
        'x-api-key'         : cfg.ANTHROPIC_API_KEY,
        'anthropic-version' : '2023-06-01'
      },
      payload: JSON.stringify(requestBody)
    });

    const responseCode = response.getResponseCode();
    if (responseCode !== 200) {
      const errText = response.getContentText();
      console.error(`[scanReceiptWithAI] API error ${responseCode}: ${errText}`);
      logScanAttempt_(rateInfo.email, 'error', null, `HTTP ${responseCode}`);
      return { success: false, message: `Anthropic API ตอบกลับ error ${responseCode} — กรุณาตรวจสอบ API Key` };
    }

    const responseJson = JSON.parse(response.getContentText());
    const rawText      = responseJson.content[0].text.trim();

    // ลบ markdown code block ออกถ้า model ใส่มาให้
    const cleanJson = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    // แยก try/catch สำหรับ JSON.parse โดยเฉพาะ
    // เพราะถ้า Claude return text แปลก (เช่น "ขออภัย อ่านบิลไม่ออก") จะ throw ที่นี่
    let extracted;
    try {
      extracted = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error(`[scanReceiptWithAI] JSON.parse failed. Raw response: ${rawText}`);
      logScanAttempt_(rateInfo.email, 'error', null, 'JSON parse failed: ' + rawText.substring(0, 200));
      return {
        success: false,
        message: 'AI ตอบกลับในรูปแบบที่อ่านไม่ได้ — ลองสแกนใหม่หรือถ่ายให้ชัดกว่านี้'
      };
    }

    // SCAN-1: scan สำเร็จ → +1 counter
    // SCAN-2: log success พร้อม confidence
    incrementScanCounter_(rateInfo.userKey);
    logScanAttempt_(rateInfo.email, 'success', extracted.confidence || '-', '-');

    return { success: true, data: extracted };

  } catch (e) {
    console.error(`[scanReceiptWithAI] ${e.message}`);
    logScanAttempt_(rateInfo.email, 'error', null, e.message);
    return { success: false, message: `เกิดข้อผิดพลาด: ${e.message}` };
  }
}