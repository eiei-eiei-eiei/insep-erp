// ============================================================
// 🚪 ENTRY POINT + AUTH
// include() helper สำหรับ HtmlService template stitching + doGet + auth
// ============================================================


/**
 * Stitch ไฟล์ .html ย่อยเข้าด้วยกัน (ใช้ใน index.html ผ่าน <?!= include('ชื่อไฟล์'); ?>)
 * @param {string} filename - ชื่อไฟล์ html (case-sensitive, ไม่ต้องใส่ .html)
 * @returns {string} เนื้อหา html ของไฟล์นั้น
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Entry point ของเว็บแอป — ใช้ createTemplateFromFile + evaluate() เพื่อให้ <?!= include() ?> ทำงาน
 * (เดิมใช้ createHtmlOutputFromFile ซึ่งจะไม่ประมวลผล scriptlet)
 */
function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Sep Bar - ERP (B2B & Warehouse)')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getInTeamAuth() {
  try {
    const cfg = getConfig();
    const ss = SpreadsheetApp.openByUrl(cfg.sheetUrl);
    const sheet = ss.getSheetByName('inteam');
    if (!sheet) throw new Error("ไม่พบแท็บชีท 'inteam'");

    const data = sheet.getDataRange().getValues();
    const list = [];
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      list.push({
        name:     data[i][0].toString().trim(),
        password: data[i][1] ? data[i][1].toString().trim() : '',
        role:     data[i][2] ? data[i][2].toString().trim().toLowerCase() : 'sale',
      });
    }
    return list;
  } catch (e) { throw new Error(e.message); }
}
