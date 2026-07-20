// === Reports (global REPORT_TEMPLATE_FOLDER_ID): template/font + ภส.๐๗ report data + getThaiMonthYear ===
// (ระบบออกรายงานเดิมแบบ Sheets→PDF ถูกแทนที่ด้วยการเติมฟอร์ม PDF จริงฝั่ง client แล้ว)



// =========================================================
// [ใหม่] เติมฟอร์มจริง (PDF vector) แบบ overlay — ขนานกับรายงานเดิม
// Template อยู่ใน Google Drive folder + ฟอนต์ Sarabun โหลดผ่าน UrlFetchApp
// =========================================================

const REPORT_TEMPLATE_FOLDER_ID = '1chaDKOfLxgCbLT0oWHGJDEhoXzkZnrVK';

/** อ่านไฟล์ template PDF จากโฟลเดอร์ Drive ตามชื่อ → base64 */
function getReportTemplateB64(filename) {
  try {
    const folder = DriveApp.getFolderById(REPORT_TEMPLATE_FOLDER_ID);
    const it = folder.getFilesByName(filename);
    if (!it.hasNext()) return { success: false, message: 'ไม่พบไฟล์ "' + filename + '" ในโฟลเดอร์ template' };
    return { success: true, b64: Utilities.base64Encode(it.next().getBlob().getBytes()) };
  } catch (e) { return { success: false, message: e.toString() }; }
}

/**
 * โหลดฟอนต์ไทย (.ttf) จากโฟลเดอร์ template ใน Drive → base64
 * สแกนหาไฟล์นามสกุล .ttf ไฟล์แรกในโฟลเดอร์ (ผู้ใช้อัปโหลดเอง)
 * แนะนำ: THSARABUNIT๙.TTF (ตรงกับฟอนต์ในฟอร์ม, เลขเป็นเลขไทย)
 *        ถ้าต้องการเลขอารบิก ให้ใช้ THSARABUN.TTF แทน
 */
function getSarabunFontB64() {
  try {
    const folder = DriveApp.getFolderById(REPORT_TEMPLATE_FOLDER_ID);
    const it = folder.getFiles();
    while (it.hasNext()) {
      const file = it.next();
      const name = String(file.getName()).toLowerCase();
      if (name.slice(-4) === '.ttf') {
        return { success: true, b64: Utilities.base64Encode(file.getBlob().getBytes()) };
      }
    }
    return { success: false, message: 'ไม่พบไฟล์ฟอนต์ (.ttf) ในโฟลเดอร์ template — กรุณาอัปโหลด THSARABUNIT๙.TTF เข้าโฟลเดอร์' };
  } catch (e) { return { success: false, message: e.toString() }; }
}

/**
 * จัดรูปวันที่เป็น dd/mm/yy (ปี = พ.ศ. 2 หลักท้าย) สำหรับช่อง "วันเดือนปี" ในฟอร์มรายวัน
 * เช่น day=5, monthStr="2026-06" → "05/06/69"
 */
function fmtDateDMY_(day, monthStr) {
  const parts = String(monthStr).split('-');
  const yy = ((parseInt(parts[0], 10) || 0) + 543) % 100;
  const dd = String(day).padStart(2, '0');
  const mm = String(parseInt(parts[1], 10) || 0).padStart(2, '0');
  return dd + '/' + mm + '/' + String(yy).padStart(2, '0');
}

/**
 * ข้อมูลรายงานวัตถุดิบ (ภส.๐๗-๐๑/๑) เป็น JSON สำหรับเติมลงฟอร์ม PDF
 * ใช้ logic เดียวกับ processMaterialReport (ไม่แตะของเดิม)
 */
function getMaterialReportData(monthStr, materialId) {
  try {
    const cfg = getConfig_();
    const logData = readSheet('Log_Material');
    const materials = readSheet('Master_Material');
    const targetDate = new Date(monthStr + '-01');
    const targetYear = targetDate.getFullYear(), targetMonth = targetDate.getMonth();
    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

    const mat = materials.find(m => m['รหัสวัตถุดิบ'] === materialId);
    const matName = mat ? mat['ชื่อวัตถุดิบ'] : materialId;
    const unit = mat ? (mat['หน่วยนับ'] || '') : '';

    let bfBalance = 0, monthIn = 0, monthOut = 0, yearIn = 0, yearOut = 0;
    const dailyData = {};
    for (let i = 1; i <= 31; i++) dailyData[i] = { in: 0, out: 0, ref: [], batches: [] };

    logData.forEach(row => {
      if (row['รหัสวัตถุดิบ'] !== materialId) return;
      const d = new Date(row['วันที่']); if (isNaN(d.getTime())) return;
      const qty = parseFloat(row['จำนวน']) || 0;
      const type = row['ประเภท(รับ/จ่าย)'];
      const docRef = String(row['หลักฐานเลขที่'] || row['เลขที่เอกสารอ้างอิง'] || '').trim();
      if (d.getFullYear() < targetYear || (d.getFullYear() === targetYear && d.getMonth() < targetMonth)) { if (type === 'รับ') bfBalance += qty; else bfBalance -= qty; }
      if (d.getFullYear() === targetYear && d.getMonth() <= targetMonth) { if (type === 'รับ') yearIn += qty; else yearOut += qty; }
      if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
        const day = d.getDate();
        if (type === 'รับ') { monthIn += qty; dailyData[day].in += qty; if (docRef) dailyData[day].ref.push(docRef); }
        else { monthOut += qty; dailyData[day].out += qty; if (docRef) dailyData[day].batches.push(docRef); }
      }
    });

    const grid = [];
    let bal = bfBalance;
    for (let i = 1; i <= daysInMonth; i++) {
      const dIn = dailyData[i].in, dOut = dailyData[i].out;
      bal = bal + dIn - dOut;
      let desc = '';
      if (dIn > 0 || dOut > 0) {
        desc = matName;
        const ub = [...new Set(dailyData[i].batches)].filter(b => b);
        if (ub.length) desc += ' ' + ub.join(', ');
      }
      grid.push({ day: i, date: fmtDateDMY_(i, monthStr), desc: desc, ref: dailyData[i].ref.length ? dailyData[i].ref.join(', ') : '', inv: dIn > 0 ? dIn : null, outv: dOut > 0 ? dOut : null, bal: bal });
    }

    // ประเภทสุรา: ดึงจาก Master_Product แถวแรก (ใช้ในหัวฟอร์ม ๐๗-๐๑/๑)
    const firstProd = readSheet('Master_Product')[0];
    const liquorType = firstProd ? (firstProd['ประเภทสุรา'] || '') : '';

    return {
      success: true, company: cfg.companyName || '', exciseId: cfg.exciseId || '',
      monthThai: getThaiMonthYear(monthStr), materialName: matName, unit: unit, liquorType: liquorType,
      bfBalance: bfBalance, monthIn: monthIn, monthOut: monthOut, yearIn: yearIn, yearOut: yearOut, grid: grid
    };
  } catch (e) { return { success: false, message: e.toString() }; }
}

/**
 * ข้อมูลรายงานสุราบรรจุขวด (ภส.๐๗-๐๒/๑(๒)) เป็น JSON สำหรับเติมฟอร์ม PDF
 * mirror logic ของ processProductReport (ไม่แตะของเดิม)
 */
function getProductReportData(monthStr, productId) {
  try {
    const cfg = getConfig_();
    const logData = readSheet('Log_Product');
    const products = readSheet('Master_Product');
    const targetDate = new Date(monthStr + '-01');
    const targetYear = targetDate.getFullYear(), targetMonth = targetDate.getMonth();
    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

    const prd = products.find(p => p['รหัสสินค้า'] === productId);
    const prdName = prd ? (prd['ชื่อสุรา'] || productId) : productId;
    const degree = prd ? (prd['ดีกรี'] || '') : '';
    const sizeNum = prd ? parseFloat(prd['ขนาดขวด(ลิตร)']) : NaN;
    const bottleSize = isNaN(sizeNum) ? '' : sizeNum.toFixed(3);
    const liquorType = prd ? (prd['ประเภทสุรา'] || '') : '';
    const liquorKind = prd ? (prd['ชนิดสุรา'] || '') : '';
    const prdDesc = prdName + (degree ? ' ' + degree + '%' : '') + (bottleSize ? ' ' + bottleSize + 'L' : '');

    let bfBalance = 0, monthIn = 0, monthOut = 0, yearIn = 0, yearOut = 0;
    const dailyData = {};
    for (let i = 1; i <= 31; i++) dailyData[i] = { in: 0, out: 0, ref: [] };

    logData.forEach(row => {
      if (row['รหัสสินค้า'] !== productId) return;
      const d = new Date(row['วันที่']); if (isNaN(d.getTime())) return;
      const qty = parseFloat(row['จำนวน(ขวด)']) || 0;
      const type = row['ประเภท(รับ/จ่าย)'];
      const note = String(row['ลูกค้า/หมายเหตุ'] || row['หมายเหตุ'] || '');
      if (d.getFullYear() < targetYear || (d.getFullYear() === targetYear && d.getMonth() < targetMonth)) { if (type === 'รับ') bfBalance += qty; else bfBalance -= qty; }
      if (d.getFullYear() === targetYear && d.getMonth() <= targetMonth) { if (type === 'รับ') yearIn += qty; else yearOut += qty; }
      if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
        const day = d.getDate();
        if (type === 'รับ') { monthIn += qty; dailyData[day].in += qty; }
        else { monthOut += qty; dailyData[day].out += qty; const m = note.match(/(ORD\d{6}-\d{3})/); if (m) dailyData[day].ref.push(m[1]); }
      }
    });

    const grid = [];
    let bal = bfBalance;
    for (let i = 1; i <= daysInMonth; i++) {
      const dIn = dailyData[i].in, dOut = dailyData[i].out;
      bal = bal + dIn - dOut;
      grid.push({ day: i, date: fmtDateDMY_(i, monthStr), desc: (dIn > 0 || dOut > 0) ? prdDesc : '', ref: dailyData[i].ref.length ? [...new Set(dailyData[i].ref)].join(', ') : '', inv: dIn > 0 ? dIn : null, outv: dOut > 0 ? dOut : null, bal: bal });
    }

    return {
      success: true, company: cfg.companyName || '', exciseId: cfg.exciseId || '',
      monthThai: getThaiMonthYear(monthStr), productName: prdName, degree: degree,
      bottleSize: bottleSize, unit: 'ขวด', liquorType: liquorType, liquorKind: liquorKind,
      bfBalance: bfBalance, monthIn: monthIn, monthOut: monthOut, yearIn: yearIn, yearOut: yearOut, grid: grid
    };
  } catch (e) { return { success: false, message: e.toString() }; }
}

/**
 * ข้อมูลรายงานบัญชีผลิตสุรา (ภส.๐๗-๐๒/๑(๑)) เป็น JSON สำหรับเติมฟอร์ม PDF
 * mirror logic ของ processProductionReport (ไม่แตะของเดิม)
 *  - 1 แถว = 1 วันที่มีกิจกรรม (รวมหม้อ; Log_Distill เป็น 1 batch = 1 แถวอยู่แล้ว)
 *  - คำนวณ ยอดยกมา(3 ช่อง) / รวมเดือนนี้ / รวมแต่ต้นปี / คงเหลือปลายเดือน ครบทุกช่อง
 *  - ตัวเลขคืนเป็น number ดิบ (frontend จัดรูปด้วย rfFmt) — flow ที่เป็น 0 คืน null เพื่อเว้นว่าง,
 *    คอลัมน์คงเหลือคืนค่าเสมอ (แม้ 0)
 * Performance: อ่านแต่ละชีต 1 ครั้ง (ไม่มี getValue ใน loop)
 */
function getProductionReportData(monthStr, productId) {
  try {
    const cfg = getConfig_();
    const masterData = getMasterAndInitialData();
    if (!masterData || !masterData.success) throw new Error((masterData && masterData.message) || 'โหลดข้อมูล master ไม่สำเร็จ');

    const fermLog = readSheet('Log_Ferment');
    const distLog = readSheet('Log_Distill');
    const diluLog = readSheet('Log_Dilute');
    const packLog = readSheet('Log_Product');

    const targetDate  = new Date(monthStr + '-01');
    const targetYear  = targetDate.getFullYear();
    const targetMonth = targetDate.getMonth();
    const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

    // resolve สินค้า (mirror processProductionReport: aggregate ตาม "ชื่อสุรา")
    const targetProduct = masterData.products.find(p => String(p['รหัสสินค้า']) === String(productId));
    let productName = '', targetProductIds = [], degree = '', liquorType = '';
    if (targetProduct) {
      productName      = targetProduct['ชื่อสุรา'];
      targetProductIds = [String(productId)];
      degree           = targetProduct['ดีกรี'] || '';
      liquorType       = targetProduct['ประเภทสุรา'] || '';
    } else {
      productName      = productId;
      targetProductIds = masterData.products.filter(p => p['ชื่อสุรา'] === productName).map(p => String(p['รหัสสินค้า']));
      const anyP = masterData.products.find(p => p['ชื่อสุรา'] === productName);
      if (anyP) { degree = anyP['ดีกรี'] || ''; liquorType = anyP['ประเภทสุรา'] || ''; }
    }

    // ยอดยกมา (ก่อนเดือนเป้าหมาย) + ตัวสะสมรวมเดือน/ปี
    let bfSaa = 0, bfDistill = 0, bfDilute = 0;
    let monthFermSaa = 0, monthDistSaa = 0, monthDiluStart = 0, monthPackVol = 0;
    let yearFermSaa  = 0, yearDistSaa  = 0, yearDiluStart  = 0, yearPackVol  = 0;

    const daily = {};
    for (let i = 1; i <= 31; i++) {
      daily[i] = {
        fermBatch: [], fermQty: 0, fermSaa: 0,
        distBatch: [], distFermQty: 0, distFermVolAvg: [], distSaa: 0, distVol: 0, distAbv: [],
        diluStartVol: 0, diluFinalVol: 0, diluNote: [],
        packVol: 0, packSize: [], packQty: 0
      };
    }

    // ข้อมูล batch หมัก (ปริมาณส่ารวม + เฉลี่ยต่อภาชนะ)
    const batchInfo = {};
    fermLog.forEach(row => {
      if (row['ชื่อสุรา'] === productName) {
        const batch    = String(row['รหัสBatch']);
        const qty      = parseFloat(row['จำนวนภาชนะ(หน่วย)']) || 0;
        const totalSaa = parseFloat(String(row['จำนวนวัตถุดิบที่ใช้']).split(',')[0]) || 0;
        batchInfo[batch] = { qty: qty, volPerTank: qty > 0 ? totalSaa / qty : 0, totalSaa: totalSaa };
      }
    });

    // (5) การหมักส่า
    fermLog.forEach(row => {
      if (row['ชื่อสุรา'] !== productName) return;
      const d = new Date(row['วันที่ลงหมัก']); if (isNaN(d.getTime())) return;
      const batch    = String(row['รหัสBatch']);
      const qty      = parseFloat(row['จำนวนภาชนะ(หน่วย)']) || 0;
      const totalSaa = batchInfo[batch] ? batchInfo[batch].totalSaa : 0;
      if (d.getFullYear() < targetYear || (d.getFullYear() === targetYear && d.getMonth() < targetMonth)) bfSaa += totalSaa;
      if (d.getFullYear() === targetYear && d.getMonth() <= targetMonth) yearFermSaa += totalSaa;
      if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
        const day = d.getDate();
        monthFermSaa += totalSaa;
        if (batch && !daily[day].fermBatch.includes(batch)) daily[day].fermBatch.push(batch);
        daily[day].fermQty += qty;
        daily[day].fermSaa += totalSaa;
      }
    });

    // (6) การนำน้ำหมักส่าไปกลั่น + (8) ปริมาณ/ดีกรีที่กลั่นได้
    distLog.forEach(row => {
      if (row['ชื่อสุรา'] !== productName) return;
      const d = new Date(row['วันที่กลั่น']); if (isNaN(d.getTime())) return;
      const batch   = String(row['รหัสBatchที่นำมากลั่น']);
      const saaUsed = batchInfo[batch] ? batchInfo[batch].totalSaa : 0;
      const distVol = parseFloat(row['ปริมาณน้ำสุราที่ได้(ลิตร)']) || 0;
      const abv     = parseFloat(row['ดีกรี']) || 0;
      if (d.getFullYear() < targetYear || (d.getFullYear() === targetYear && d.getMonth() < targetMonth)) { bfSaa -= saaUsed; bfDistill += distVol; }
      if (d.getFullYear() === targetYear && d.getMonth() <= targetMonth) yearDistSaa += saaUsed;
      if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
        const day = d.getDate();
        monthDistSaa += saaUsed;
        if (batch && !daily[day].distBatch.includes(batch)) daily[day].distBatch.push(batch);
        daily[day].distFermQty += (batchInfo[batch] ? batchInfo[batch].qty : 0);
        if (batchInfo[batch]) daily[day].distFermVolAvg.push(batchInfo[batch].volPerTank);
        daily[day].distSaa += saaUsed;
        daily[day].distVol += distVol;
        if (abv > 0) daily[day].distAbv.push(abv);
      }
    });

    // (9) ปริมาณน้ำสุราที่นำไปปรุงแต่ง
    diluLog.forEach(row => {
      if (row['ชื่อสุรา'] !== productName) return;
      const d = new Date(row['วันที่ปรุงแต่ง']); if (isNaN(d.getTime())) return;
      const startVol = parseFloat(row['ปริมาณสุราตั้งต้น(ลิตร)']) || 0;
      const finalVol = parseFloat(row['ปริมาณสุราหลังปรุง(ลิตร)']) || 0;
      const finalAbv = parseFloat(row['ดีกรีหลังปรุง']) || 0;
      if (d.getFullYear() < targetYear || (d.getFullYear() === targetYear && d.getMonth() < targetMonth)) { bfDistill -= startVol; bfDilute += finalVol; }
      if (d.getFullYear() === targetYear && d.getMonth() <= targetMonth) yearDiluStart += startVol;
      if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
        const day = d.getDate();
        monthDiluStart += startVol;
        daily[day].diluStartVol += startVol;
        daily[day].diluFinalVol += finalVol;
        daily[day].diluNote.push('ปรุงปรับดีกรี ' + finalAbv + ' ได้ปริมาณ ' + finalVol.toFixed(2) + ' ลิตร');
      }
    });

    // (11) บรรจุขวด (Log_Product type "รับ")
    packLog.forEach(row => {
      if (row['ประเภท(รับ/จ่าย)'] !== 'รับ') return;
      const prodId = String(row['รหัสสินค้า']);
      if (!targetProductIds.includes(prodId)) return;
      const d = new Date(row['วันที่']); if (isNaN(d.getTime())) return;
      const product = masterData.products.find(p => String(p['รหัสสินค้า']) === prodId);
      if (!product) return;
      const qty      = parseFloat(row['จำนวน(ขวด)']) || 0;
      const size     = parseFloat(product['ขนาดขวด(ลิตร)']) || 0;
      const totalVol = qty * size;
      if (d.getFullYear() < targetYear || (d.getFullYear() === targetYear && d.getMonth() < targetMonth)) bfDilute -= totalVol;
      if (d.getFullYear() === targetYear && d.getMonth() <= targetMonth) yearPackVol += totalVol;
      if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
        const day = d.getDate();
        monthPackVol += totalVol;
        daily[day].packVol += totalVol;
        daily[day].packQty += qty;
        if (!daily[day].packSize.includes(size)) daily[day].packSize.push(size);
      }
    });

    // สร้าง grid เฉพาะวันที่มีกิจกรรม + running balance ต่อเนื่องทั้งเดือน
    const grid = [];
    let curSaa = bfSaa, curDist = bfDistill, curDilu = bfDilute;
    const numOrNull = (v) => (v && v !== 0) ? v : null;
    for (let i = 1; i <= daysInMonth; i++) {
      const dData = daily[i];
      curSaa  = curSaa  + dData.fermSaa      - dData.distSaa;
      curDist = curDist + dData.distVol      - dData.diluStartVol;
      curDilu = curDilu + dData.diluFinalVol - dData.packVol;
      const hasActivity = dData.fermBatch.length || dData.distBatch.length ||
                          dData.fermQty || dData.distVol || dData.diluStartVol || dData.packVol;
      if (!hasActivity) continue;
      const avgFermVol     = dData.fermQty > 0 ? dData.fermSaa / dData.fermQty : 0;
      const avgDistFermVol = dData.distFermVolAvg.length > 0 ? dData.distFermVolAvg.reduce((a, b) => a + b, 0) / dData.distFermVolAvg.length : 0;
      const avgAbv         = dData.distAbv.length > 0 ? dData.distAbv.reduce((a, b) => a + b, 0) / dData.distAbv.length : 0;
      const packSizeStr    = dData.packSize.length > 0 ? dData.packSize.map(s => { const n = parseFloat(s); return isNaN(n) ? '-' : n.toFixed(3); }).join(', ') : '';
      grid.push({
        day:            i,
        date:           fmtDateDMY_(i, monthStr),
        fermBatch:      dData.fermBatch.length ? dData.fermBatch.join(', ') : '',
        fermQty:        numOrNull(dData.fermQty),
        avgFermVol:     numOrNull(avgFermVol),
        fermSaa:        numOrNull(dData.fermSaa),
        distBatch:      dData.distBatch.length ? dData.distBatch.join(', ') : '',
        distFermQty:    numOrNull(dData.distFermQty),
        avgDistFermVol: numOrNull(avgDistFermVol),
        distSaa:        numOrNull(dData.distSaa),
        curSaa:         curSaa,
        avgAbv:         numOrNull(avgAbv),
        distVol:        numOrNull(dData.distVol),
        diluStartVol:   numOrNull(dData.diluStartVol),
        curDist:        curDist,
        packSize:       packSizeStr,
        packQty:        numOrNull(dData.packQty),
        packVol:        numOrNull(dData.packVol),
        curDilu:        curDilu,
        note:           dData.diluNote.length ? dData.diluNote.join(', ') : ''
      });
    }

    return {
      success: true,
      company: cfg.companyName || '', exciseId: cfg.exciseId || '',
      monthThai: getThaiMonthYear(monthStr),
      productName: productName, liquorType: liquorType, degree: degree,
      bfSaa: bfSaa, bfDistill: bfDistill, bfDilute: bfDilute,
      monthFermSaa: monthFermSaa, monthDistSaa: monthDistSaa, monthDiluStart: monthDiluStart, monthPackVol: monthPackVol,
      yearFermSaa: yearFermSaa, yearDistSaa: yearDistSaa, yearDiluStart: yearDiluStart, yearPackVol: yearPackVol,
      endSaa: curSaa, endDist: curDist, endDilu: curDilu,
      grid: grid
    };
  } catch (e) { return { success: false, message: e.toString() }; }
}

/**
 * ข้อมูลงบเดือน (ภส.๐๗-๐๔/๑) เป็น JSON สำหรับเติมฟอร์ม PDF
 * mirror logic ของ processSummaryReportLongSheet (ไม่แตะของเดิม)
 *  - เมทริกซ์ 2 ตาราง: งบวัตถุดิบ + งบการผลิตสุรา (คอลัมน์ = รายการ)
 *  - คืนเฉพาะรายการที่มีความเคลื่อนไหว/ยอดยกมา (active-only)
 *  - header ประเภท/ชนิดสุรา ดึงจากสินค้าที่ active ตัวแรก (fallback master ตัวแรก)
 *  - ตัวเลขคืนเป็น number ดิบ (frontend จัดรูป + แสดง "-" เมื่อ 0 ตาม formatVal เดิม)
 * Performance: อ่าน Log_Material/Log_Product อย่างละ 1 ครั้ง (ไม่มี getValue ใน loop)
 */
function getSummaryReportData(monthStr) {
  try {
    const cfg = getConfig_();
    const masterData = getMasterAndInitialData();
    if (!masterData || !masterData.success) throw new Error((masterData && masterData.message) || 'โหลดข้อมูล master ไม่สำเร็จ');

    const targetDate  = new Date(monthStr + '-01');
    const targetYear  = targetDate.getFullYear();
    const targetMonth = targetDate.getMonth();

    const matAgg = {};
    masterData.materials.forEach(m => {
      matAgg[m['รหัสวัตถุดิบ']] = { name: m['ชื่อวัตถุดิบ'], unit: m['หน่วยนับ'] || '', bf: 0, inv: 0, outMain: 0, outOther: 0, damage: 0, misc: 0 };
    });
    const prodAgg = {};
    masterData.products.forEach(p => {
      prodAgg[p['รหัสสินค้า']] = { name: p['ชื่อสุรา'], degree: p['ดีกรี'] || '', size: p['ขนาดขวด(ลิตร)'], type: p['ประเภทสุรา'] || '', kind: p['ชนิดสุรา'] || '', bf: 0, inv: 0, outLocal: 0, outExport: 0, damage: 0, misc: 0 };
    });

    readSheet('Log_Material').forEach(row => {
      const id = String(row['รหัสวัตถุดิบ']); if (!matAgg[id]) return;
      const d = new Date(row['วันที่']); if (isNaN(d.getTime())) return;
      const qty = parseFloat(row['จำนวน']) || 0;
      const type = String(row['ประเภท(รับ/จ่าย)']);
      if (d.getFullYear() < targetYear || (d.getFullYear() === targetYear && d.getMonth() < targetMonth)) {
        matAgg[id].bf += (type === 'รับ' ? qty : -qty);
      } else if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
        if (type === 'รับ') matAgg[id].inv += qty;
        else if (type === 'จ่าย') matAgg[id].outMain += qty;
        else if (type === 'ผลิตสินค้าอื่น') matAgg[id].outOther += qty;
        else if (type === 'เสียหาย') matAgg[id].damage += qty;
        else if (type === 'อื่นๆ' || type === 'อื่น ๆ') matAgg[id].misc += qty;
      }
    });

    readSheet('Log_Product').forEach(row => {
      const id = String(row['รหัสสินค้า']); if (!prodAgg[id]) return;
      const d = new Date(row['วันที่']); if (isNaN(d.getTime())) return;
      const qty = parseFloat(row['จำนวน(ขวด)']) || 0;
      const type = String(row['ประเภท(รับ/จ่าย)']);
      if (d.getFullYear() < targetYear || (d.getFullYear() === targetYear && d.getMonth() < targetMonth)) {
        prodAgg[id].bf += (type === 'รับ' ? qty : -qty);
      } else if (d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
        if (type === 'รับ') prodAgg[id].inv += qty;
        else if (type === 'จ่าย') prodAgg[id].outLocal += qty;
        else if (type === 'จำหน่ายต่างประเทศ') prodAgg[id].outExport += qty;
        else if (type === 'แตกหักเสียหาย' || type === 'เสียหาย') prodAgg[id].damage += qty;
        else if (type === 'อื่นๆ' || type === 'อื่น ๆ') prodAgg[id].misc += qty;
      }
    });

    const prodActive = (p) => p.bf || p.inv || p.outLocal || p.outExport || p.damage || p.misc;

    // วัตถุดิบ: ใส่ครบทุกตัวใน master (ตัวที่ไม่เคลื่อนไหว → ค่า 0 ทุกช่อง frontend แสดง "-")
    const materials = Object.values(matAgg).map(m => {
      const total = m.bf + m.inv;
      const balance = total - (m.outMain + m.outOther + m.damage + m.misc);
      return { name: m.name, unit: m.unit, bf: m.bf, inv: m.inv, total: total, outMain: m.outMain, outOther: m.outOther, damage: m.damage, misc: m.misc, balance: balance };
    });
    const products = Object.values(prodAgg).filter(prodActive).map(p => {
      const total = p.bf + p.inv;
      const balance = total - (p.outLocal + p.outExport + p.damage + p.misc);
      const sizeNum = parseFloat(p.size);
      const sizeStr = isNaN(sizeNum) ? '-' : sizeNum.toFixed(3);
      return { name: p.name, degree: p.degree, size: sizeStr, unit: 'ขวด', bf: p.bf, inv: p.inv, total: total, outLocal: p.outLocal, outExport: p.outExport, damage: p.damage, misc: p.misc, balance: balance };
    });

    // header ประเภท/ชนิดสุรา จากสินค้า active ตัวแรก (fallback master ตัวแรก)
    const firstP = Object.values(prodAgg).find(prodActive) || masterData.products[0];
    const liquorType = firstP ? (firstP.type || firstP['ประเภทสุรา'] || '') : '';
    const liquorKind = firstP ? (firstP.kind || firstP['ชนิดสุรา'] || '') : '';

    return {
      success: true,
      company: cfg.companyName || '', exciseId: cfg.exciseId || '',
      monthThai: getThaiMonthYear(monthStr),
      liquorType: liquorType, liquorKind: liquorKind,
      materials: materials, products: products
    };
  } catch (e) { return { success: false, message: e.toString() }; }
}

// ==========================================
// Utility Functions
// ==========================================

function getThaiMonthYear(monthStr) {
  if (!monthStr) return "";
  const months = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  const parts = monthStr.split("-");
  if (parts.length !== 2) return monthStr;
  return `${months[parseInt(parts[1], 10) - 1]} ${parseInt(parts[0], 10) + 543}`;
}