// === File cleanup: temp PDF_Export_* (global PDF_EXPORT_PATTERN_) ===
// ==========================================
// File Cleanup Helpers
// ==========================================

/**
 * Regex pattern สำหรับชื่อไฟล์ที่ระบบสร้างขึ้นเท่านั้น
 * รูปแบบ: PDF_Export_<timestamp 13 หลัก> เช่น PDF_Export_1731401234567
 * @private
 */
var PDF_EXPORT_PATTERN_ = /^PDF_Export_\d{13}$/;

/**
 * ตรวจสอบว่าชื่อไฟล์เป็น temp PDF export ที่ระบบสร้างขึ้นหรือไม่
 * @private
 */
function isTempPDFExport_(fileName) {
  return PDF_EXPORT_PATTERN_.test(fileName);
}

/**
 * ลบไฟล์ Google Drive ถาวร (ไม่ผ่าน Trash)
 * ใช้ Advanced Drive Service ถ้ามี → ไม่งั้น fallback ไป setTrashed
 * @private
 */
function deletePermanently_(fileId) {
  if (!fileId) return;
  try {
    Drive.Files.remove(fileId);
    return;
  } catch (e) {
    Logger.log('Drive.Files.remove ไม่สำเร็จ: ' + e.toString());
  }
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
  } catch (e2) {
    Logger.log('Cleanup ล้มเหลวสำหรับ ' + fileId + ': ' + e2.toString());
  }
}

/**
 * ลบเฉพาะไฟล์ที่ระบบสร้างขึ้นจริงๆ (ตรวจ regex ^PDF_Export_\d{13}$ ก่อนลบ)
 * วิธีรัน: Apps Script Editor → dropdown → cleanupOrphanedPDFExports → ▶ Run
 * @returns {number} จำนวนไฟล์ที่ลบ
 */
function cleanupOrphanedPDFExports() {
  let deleted = 0;
  let skipped = 0;
  const files = DriveApp.searchFiles('title contains "PDF_Export_"');

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    if (!isTempPDFExport_(name)) {
      Logger.log('⏭ ข้าม (ชื่อไม่ตรง pattern): ' + name);
      skipped++;
      continue;
    }
    try {
      deletePermanently_(file.getId());
      Logger.log('🗑 ลบแล้ว: ' + name);
      deleted++;
    } catch (e) {
      Logger.log('❌ ลบไม่ได้: ' + name + ' — ' + e.toString());
    }
  }

  Logger.log(`✅ สรุป: ลบ ${deleted} ไฟล์ | ข้าม ${skipped} ไฟล์ (ไม่ตรง pattern)`);
  return deleted;
}

