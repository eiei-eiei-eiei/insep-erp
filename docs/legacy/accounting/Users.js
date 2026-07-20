// =========================================================================
// FILE: Users.gs  [10/10]
// [Phase 1] Multi-user login — ชีท Users + ตรวจรหัส (hashed) + จำกัดสิทธิ์ตาม role/entity
//
// ชีท Users (4 คอลัมน์): [username, passwordHash, role, allowedEntityId]
//   - role = 'main'  → เจ้าของ เข้าถึงทุกอย่าง (บันทึก/โอน/ทุกกิจการ)
//   - role อื่น (เช่น 'AIM') → ดูอย่างเดียว + ถูกล็อกให้เห็นเฉพาะ allowedEntityId
//   - allowedEntityId = 'ALL' → เห็นทุกกิจการ (ปกติใช้กับ main)
//
// ⚠️ การตั้งค่าครั้งแรก:
//   1) แก้ array ใน genUserHashes() → กด Run → เปิด Execution log copy hash
//   2) สร้างชีท "Users" ใส่หัว 4 คอลัมน์ + วาง username/hash/role/allowedEntityId
//   ถ้ายังไม่มีชีท Users → ระบบ fallback ใช้รหัสเดิม (LOGIN_PASSWORD) เป็น main อัตโนมัติ
//   (กัน "ล็อกตัวเองออกจากระบบ" ระหว่างยังตั้งค่าไม่เสร็จ)
// =========================================================================

/**
 * [Phase 1] SHA-256 → hex string (lowercase) ใช้เก็บรหัสผ่านแบบไม่ plaintext
 * @param {string} text - รหัสผ่าน plaintext
 * @returns {string} hash 64 ตัวอักษร hex
 */
function hashPassword(text) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  // byte → 2-digit hex, ต่อกันเป็น string เดียว
  return raw.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

/**
 * [Phase 1] อ่านรายชื่อผู้ใช้จากชีท Users
 * @returns {Array<{username, passwordHash, role, allowedEntityId}>} ([] ถ้าไม่มีชีท)
 */
function getUsers_() {
  const ss    = SpreadsheetApp.openById(getConfig_().SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Users');
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();   // อ่านครั้งเดียว
  const out  = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;   // ข้ามแถวว่าง
    out.push({
      username       : String(data[i][0]).trim(),
      passwordHash   : String(data[i][1] || '').trim().toLowerCase(),
      role           : String(data[i][2] || '').trim(),
      allowedEntityId: String(data[i][3] || '').trim()
    });
  }
  return out;
}

/**
 * [Phase 1] ตรวจสอบ login — แทน verifyPassword เดิม (รหัสเดียว hardcoded)
 *
 * ลำดับการตรวจ:
 *   1) ถ้ายังไม่มีชีท Users / ว่าง → bootstrap: รหัสตรง LOGIN_PASSWORD = login เป็น main
 *      (กันล็อกตัวเองช่วงตั้งค่า — พอสร้างชีท Users แล้ว path นี้จะไม่ถูกใช้)
 *   2) มีชีท Users → match username + hash(password)
 *
 * @param {string} username
 * @param {string} password
 * @returns {{ success, role?, allowedEntityId?, displayName?, message? }}
 */
function verifyUser(username, password) {
  try {
    if (!password) return { success: false, message: 'กรุณากรอกรหัสผ่าน' };

    const users = getUsers_();

    // [Bootstrap / fallback] ยังไม่ได้ตั้งชีท Users → ใช้รหัสเดิมเป็น main
    if (users.length === 0) {
      if (password === getConfig_().LOGIN_PASSWORD) {
        return { success: true, role: 'main', allowedEntityId: 'ALL', displayName: 'admin' };
      }
      return { success: false, message: 'รหัสผ่านไม่ถูกต้อง' };
    }

    // [ปกติ] match username (case-insensitive) + เทียบ hash
    const inputHash = hashPassword(password);
    const u = users.find(x => x.username.toLowerCase() === String(username || '').trim().toLowerCase());
    if (!u || u.passwordHash !== inputHash) {
      return { success: false, message: 'username หรือรหัสผ่านไม่ถูกต้อง' };
    }

    return {
      success        : true,
      role           : u.role || 'AIM',           // ไม่ระบุ role = สิทธิ์จำกัด
      allowedEntityId: u.allowedEntityId || 'ALL',
      displayName    : u.username
    };
  } catch (e) {
    console.error(`[verifyUser] ${e.message}`);
    return { success: false, message: e.message };
  }
}

/**
 * [Phase 1 / Setup util] สร้าง password hash สำหรับวางลงชีท Users
 *
 * วิธีใช้:
 *   1) แก้ array users ด้านล่าง (username, รหัส plaintext ที่ต้องการ)
 *   2) เลือกฟังก์ชัน genUserHashes ใน editor → กด Run
 *   3) เปิด Execution log → copy hash ไปวางใน col B ของชีท Users
 *   ⚠️ อย่าเก็บรหัส plaintext ไว้ในโค้ดหลัง setup เสร็จ (แก้ array กลับเป็นค่าหลอก)
 */
function genUserHashes() {
  const users = [
    ['admin', 'เปลี่ยนรหัสนี้'],   // main user (เจ้าของ) — role='main', allowedEntityId='ALL'
    ['aim01', 'เปลี่ยนรหัสนี้'],   // ผู้ใช้จำกัดสิทธิ์ — role='AIM', allowedEntityId=EIDxx
  ];
  users.forEach(u => Logger.log(u[0] + '  =>  ' + hashPassword(u[1])));
}
