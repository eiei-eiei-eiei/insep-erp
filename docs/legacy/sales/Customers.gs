// ============================================================
// 👤 B2B CUSTOMERS
// ============================================================


/**
 * สร้าง Map ข้อมูลลูกค้า (taxId, branch, address) จาก sheet custdata
 */
function buildCustMap(ss) {
  const custSheet = ss.getSheetByName('custdata') || ss.getSheetByName('btbcustomers');
  const custMap = {};
  if (!custSheet) return custMap;

  const cData = custSheet.getDataRange().getValues();
  for (let i = 1; i < cData.length; i++) {
    if (!cData[i][0]) continue;
    custMap[cData[i][0].toString()] = {
      address:  cData[i][2] ? cData[i][2].toString() : '',
      taxId:    formatTaxId(cData[i][3]),
      branch:   cData[i][8] ? cData[i][8].toString() : '',
      // idx 9 = isExport (boolean): TRUE = ลูกค้าจำหน่ายต่างประเทศ → ใช้ตัดสิน transType
      isExport: isTruthy(cData[i][9]),
    };
  }
  return custMap;
}

/**
 * แปลงค่าจาก sheet เป็น boolean
 * Google Sheets checkbox return boolean true/false ตรงๆ
 * แต่ถ้าใส่มือเป็น 'TRUE'/'FALSE'/'YES'/'1' ก็รองรับ
 */

function getB2BCustomers() {
  try {
    const cfg   = getConfig();
    const ss    = SpreadsheetApp.openByUrl(cfg.sheetUrl);
    const sheet = ss.getSheetByName('custdata') || ss.getSheetByName('btbcustomers');
    if (!sheet) return [];

    const data = sheet.getDataRange().getValues();
    const list = [];
    for (let i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      list.push({
        id:         data[i][0].toString(),
        name:       data[i][1] ? data[i][1].toString() : '',
        address:    data[i][2] ? data[i][2].toString() : '',
        taxId:      formatTaxId(data[i][3]),
        phone:      data[i][4] ? data[i][4].toString() : '',
        email:      data[i][5] ? data[i][5].toString() : '',
        creditTerm: Number(data[i][6]) || 0,
        salename:   data[i][7] ? data[i][7].toString().trim() : '',
        branch:     data[i][8] ? data[i][8].toString().trim() : '',
        // idx 9 = isExport: TRUE = ลูกค้าจำหน่ายต่างประเทศ
        isExport:   isTruthy(data[i][9]),
      });
    }
    return list;
  } catch (e) { throw new Error(e.message); }
}

function addB2BCustomer(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cfg   = getConfig();
    const ss    = SpreadsheetApp.openByUrl(cfg.sheetUrl);
    const sheet = ss.getSheetByName('custdata') || ss.getSheetByName('btbcustomers');
    if (!sheet) throw new Error("ไม่พบชีทลูกค้าในระบบ");

    // 🔢 ใช้ atomic counter — daily=false เพราะ C001 ต่อเนื่อง ไม่ reset รายวัน
    const newId = getNextSerial('C', {
      daily: false,
      seed: () => {
        // Migration: scan sheet ครั้งแรกเท่านั้น (ครั้งต่อไป Properties มีค่าแล้ว)
        const data = sheet.getDataRange().getValues();
        let max = 0;
        for (let i = 1; i < data.length; i++) {
          const idStr = data[i][0];
          if (idStr && idStr.toString().startsWith('C')) {
            const num = parseInt(idStr.toString().substring(1), 10);
            if (!isNaN(num) && num > max) max = num;
          }
        }
        return max;
      },
    });

    const safeTaxId = payload.taxId ? "'" + payload.taxId.toString() : "";
    const safePhone = payload.phone ? "'" + payload.phone.toString() : "";
    const exportFlag = isTruthy(payload.isExport);

    // ⚠️ ลำดับ column ต้องตรงกับ schema: A=id, B=name, C=address, D=taxId, E=phone, F=email, G=creditTerm, H=saleName, I=branch, J=isExport
    sheet.appendRow([newId, payload.name, payload.address, safeTaxId, safePhone, payload.email || "", payload.creditTerm || 0, payload.saleName, payload.branch || "", exportFlag]);
    SpreadsheetApp.flush();
    return {
      success: true,
      customer: {
        id: newId, name: payload.name, address: payload.address, taxId: payload.taxId,
        branch: payload.branch || "", phone: payload.phone || "", email: payload.email || "",
        creditTerm: payload.creditTerm || 0, salename: payload.saleName, isExport: exportFlag,
      },
    };
  } catch (e) { return { success: false, message: e.message }; }
  finally { lock.releaseLock(); }
}
