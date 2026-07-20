// =========================================================================
// FILE: Config.gs  [1/8]
// CONFIG + setup + format utils ที่ใช้ร่วมทุกไฟล์
// ⚠️ global ที่ประกาศที่นี่ (configCache_) ห้ามประกาศซ้ำในไฟล์อื่น
// =========================================================================

// =========================================================================
// CONFIG — ไม่มี hardcode ทุกค่าเก็บใน Script Properties
// วิธีตั้งค่าครั้งแรก: รันฟังก์ชัน setupScriptProperties() แล้วไปแก้ที่
// Extensions > Apps Script > Project Settings > Script Properties
// =========================================================================

/**
 * ดึง config ทั้งหมดจาก Script Properties ในครั้งเดียว
 * ใช้ trailing underscore (_) เพื่อบอกว่าเป็น private helper
 * @returns {Object}
 */
// Module-level cache — reset อัตโนมัติทุก execution (GAS stateless)
// ทำให้ PropertiesService ถูกเรียกแค่ครั้งแรกของ execution เท่านั้น
let configCache_ = null;

function getConfig_() {
  if (configCache_) return configCache_;   // cache hit: ข้าม PropertiesService
  const p = PropertiesService.getScriptProperties();
  configCache_ = {
    SPREADSHEET_ID    : p.getProperty('SPREADSHEET_ID'),
    API_TOKEN         : p.getProperty('API_TOKEN'),
    LOGIN_PASSWORD    : p.getProperty('LOGIN_PASSWORD'),
    LIQUOR_API_URL    : p.getProperty('LIQUOR_API_URL'),
    COMPANY_NAME      : p.getProperty('COMPANY_NAME'),
    COMPANY_TAX_ID    : p.getProperty('COMPANY_TAX_ID'),
    COMPANY_BRANCH    : p.getProperty('COMPANY_BRANCH'),
    COMPANY_ADDRESS   : p.getProperty('COMPANY_ADDRESS'),
    ANTHROPIC_API_KEY  : p.getProperty('ANTHROPIC_API_KEY'),  // สำหรับ feature สแกนใบเสร็จ
    RECEIPT_FOLDER_ID  : p.getProperty('RECEIPT_FOLDER_ID'),  // B.2.4: Google Drive folder สำหรับเก็บสลิป
    // [Phase D / Multi-Entity] entity เริ่มต้นของรายรับที่มาจาก doPost (แอปขาย)
    // และ entity ที่ผูกกับธุรกิจสุรา — ใช้ตัดสินว่าจะ forward RECEIVE_MATERIAL ไปแอปผลิตไหม
    DEFAULT_ENTITY_ID  : p.getProperty('DEFAULT_ENTITY_ID') || 'EID01',
    LIQUOR_ENTITY_ID   : p.getProperty('LIQUOR_ENTITY_ID')  || 'EID01',
  };
  return configCache_;
}

/**
 * [Phase A] อ่านรายชื่อบัญชีที่อยู่ในระบบภาษี จาก Settings sheet column E (taxAccounts)
 *
 * - เรียกครั้งละ 1 ครั้งต่อ function ที่ต้องการ — ไม่ loop อ่าน sheet ซ้ำ
 * - Fallback: ถ้า col E ว่างทั้งหมด → ใช้ ['บัญชีบริษัท'] เพื่อ backward-compat
 *   (ไม่ต้องกรอก Settings ก็ยังทำงานได้เหมือนเดิม)
 *
 * @param {Spreadsheet} ss - SpreadsheetApp object ที่เปิดไว้แล้ว (ไม่เปิดซ้ำ)
 * @returns {Set<string>} ชื่อบัญชีในระบบภาษี
 */
function getTaxAccountSet_(ss) {
  const taxAccounts = [];
  const sheet = ss.getSheetByName('Settings');
  if (sheet) {
    // header row = row 1 → ข้อมูลเริ่ม row 2 (index 1)
    // col E = index 4
    const data = sheet.getDataRange().getDisplayValues();
    for (let i = 1; i < data.length; i++) {
      const val = (data[i][4] || '').trim();
      if (val) taxAccounts.push(val);
    }
  }
  // Fallback กัน Settings ที่ยังไม่ได้กรอก col E
  if (taxAccounts.length === 0) taxAccounts.push('บัญชีบริษัท');
  return new Set(taxAccounts);
}

/**
 * รันฟังก์ชันนี้ครั้งเดียวเพื่อ seed ค่าเริ่มต้นเข้า Script Properties
 * หลังจากนั้นให้ไปแก้ค่าได้ที่:
 * Extensions > Apps Script > (ไอคอนฟันเฟือง) Project Settings > Script Properties
 * ⚠️  อย่า deploy ก่อนตรวจสอบ API_TOKEN, LOGIN_PASSWORD, LIQUOR_API_URL
 */
function setupScriptProperties() {
  PropertiesService.getScriptProperties().setProperties({
    'SPREADSHEET_ID'    : '1bPPT-Wb3gVn2q4xlxG_UHESQfXoakfcLwEpdx5YDCRM',
    'API_TOKEN'         : 'Domesuperduperhandsome',
    'LOGIN_PASSWORD'    : 'Domehandsome',
    'LIQUOR_API_URL'    : 'https://script.google.com/macros/s/AKfycbw9Gft4-1ew4Xjkyb0hx6TDDsJkHlQP0TdD8xlmOa18FRwlp4hoP4GELG9GzSWpkFLsUA/exec',
    'COMPANY_NAME'      : 'บริษัท อินทร์ เสพเทมเบ้อ จำกัด',
    'COMPANY_TAX_ID'    : '0605567002178',
    'COMPANY_BRANCH'    : 'สำนักงานใหญ่',
    'COMPANY_ADDRESS'   : '5/15 หมู่ที่ 8 ตำบลท่าน้ำอ้อย อำเภอพยุหะคีรี จังหวัดนครสวรรค์ 60130',
    'ANTHROPIC_API_KEY' : 'sk-ant-api03-ใส่-key-จริงที่นี่',  // ← แก้ก่อน deploy
    'SCAN_DAILY_LIMIT'  : '100',  // จำนวน scan สูงสุดต่อ user ต่อวัน (SCAN-1)
    'RECEIPT_FOLDER_ID' : '1jviKAd0dJ-KPMXflWIWsa6x5GnrYr5DJ',  // B.2.4: folder เก็บสลิป
    'DEFAULT_ENTITY_ID' : 'EID01',  // [Multi-Entity] รายรับจากแอปขาย → ลง entity นี้
    'LIQUOR_ENTITY_ID'  : 'EID01',  // [Multi-Entity] entity ธุรกิจสุรา → forward ต้นทุนสุราไปแอปผลิต
  });
  Logger.log('✅ Script Properties ตั้งค่าเรียบร้อย — ตรวจสอบได้ที่ Project Settings > Script Properties');
}

// =========================================================================
// ฟังก์ชันแปลงตัวเลขเป็นตัวอักษรภาษาไทย (บาทถ้วน)
// =========================================================================
function ThaiBaht(number) {
  const numberText = "ศูนย์,หนึ่ง,สอง,สาม,สี่,ห้า,หก,เจ็ด,แปด,เก้า,สิบ".split(",");
  const unitText = "สิบ,ร้อย,พัน,หมื่น,แสน,ล้าน".split(",");
  if (number === 0 || !number) return "ศูนย์บาทถ้วน";
  let strNum = Number(number).toFixed(2).toString();
  let bahtText = "";
  let baht = strNum.split(".")[0];
  let satang = strNum.split(".")[1];

  function convertToText(str) {
    let text = "";
    let len = str.length;
    for (let i = 0; i < len; i++) {
      let n = parseInt(str.charAt(i));
      if (n !== 0) {
        if (i === (len - 1) && n === 1 && len > 1 && str.charAt(len-2) !== '0') {
          text += "เอ็ด";
        } else if (i === (len - 2) && n === 2) {
          text += "ยี่";
        } else if (i === (len - 2) && n === 1) {
          text += "";
        } else {
          text += numberText[n];
        }
        let unitIndex = len - i - 2;
        if (unitIndex >= 0) text += unitText[unitIndex % 6];
      }
    }
    return text;
  }

  if (parseInt(baht) > 0) bahtText += convertToText(baht) + "บาท";
  if (parseInt(satang) > 0) bahtText += convertToText(satang) + "สตางค์";
  else bahtText += "ถ้วน";

  return bahtText;
}

// =========================================================================
// ฟังก์ชันจัดการฟอร์แมต เลขภาษี (13 หลัก) และ สาขา (5 หลัก) สำหรับทุกรายงาน
// =========================================================================
function formatTaxId(taxId) {
  if (!taxId || taxId === "-") return "-";
  // ลบพวกอักขระพิเศษ หรือ ' ที่อาจจะแอบติดมาตอนเซฟลง Sheets
  let t = taxId.toString().replace(/['" ]/g, '').trim();
  // ถ้าเป็นตัวเลขล้วน และยาวไม่ถึง 13 ให้เติม 0 ข้างหน้า
  if (/^[0-9]+$/.test(t) && t.length > 0 && t.length < 13) {
    return t.padStart(13, '0');
  }
  return t || "-";
}

function formatBranch(branch) {
  if (!branch || branch === "-" || branch === "สำนักงานใหญ่" || branch === "00000") {
    return { isHQ: true, text: "00000" };
  }
  let b = branch.toString().trim();
  // ถ้าเป็นตัวเลข และความยาวไม่ถึง 5 หลัก ให้เติม 0 ข้างหน้า
  if (/^[0-9]+$/.test(b) && b.length > 0 && b.length < 5) {
    return { isHQ: false, text: b.padStart(5, '0') };
  }
  return { isHQ: false, text: b };
}