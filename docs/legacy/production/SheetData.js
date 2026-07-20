// === Sheet IO: readSheet, getMasterAndInitialData, getLatestBatchNumber, getRemainingDistillVol, saveTransaction ===
// ==========================================
// Helper Functions (อ่าน/เขียน Sheet)
// ==========================================

function readSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  const rows = data.slice(1);
  return rows.map(row => {
    let obj = {};
    headers.forEach((header, i) => obj[header] = row[i]);
    return obj;
  });
}

function getMasterAndInitialData() {
  try {
    const materials   = readSheet('Master_Material');
    const containers  = readSheet('Master_Container');
    const products    = readSheet('Master_Product');
    const fermentData = readSheet('Log_Ferment');
    const distillData = readSheet('Log_Distill');

    const distilledBatches = new Set();
    distillData.forEach(d => {
      if (d['รหัสBatchที่นำมากลั่น']) distilledBatches.add(String(d['รหัสBatchที่นำมากลั่น']));
    });

    // ปริมาณน้ำหมักรวมต่อ batch = ผลรวมวัตถุดิบหลัก (ค่าแรกของ 'จำนวนวัตถุดิบที่ใช้')
    // = ตัวเดียวกับฐานคิดส่าในรายงาน ภส.๐๗-๐๑/๑ (ไม่ต้องเพิ่มคอลัมน์ใน Log_Ferment)
    const fermVolMap = {};
    fermentData.forEach(f => {
      const b = String(f['รหัสBatch']);
      const v = parseFloat(String(f['จำนวนวัตถุดิบที่ใช้']).split(',')[0]) || 0;
      fermVolMap[b] = (fermVolMap[b] || 0) + v;
    });

    const pendingBatchesMap = new Map();
    fermentData.forEach(f => {
      const batch = String(f['รหัสBatch']);
      if (batch && !distilledBatches.has(batch)) {
        pendingBatchesMap.set(batch, { batch: batch, productName: f['ชื่อสุรา'], fermVol: fermVolMap[batch] || 0 });
      }
    });

    return {
      success:        true,
      message:        'โหลดข้อมูลสำเร็จ',
      materials:      materials,
      containers:     containers,
      products:       products,
      pendingBatches: Array.from(pendingBatchesMap.values())
    };
  } catch (e) {
    return {
      success:        false,
      message:        'โหลดข้อมูลไม่สำเร็จ: ' + e.toString(),
      materials:      [],
      containers:     [],
      products:       [],
      pendingBatches: []
    };
  }
}

function getLatestBatchNumber(dateString) {
  try {
    if (!dateString) return { success: true, data: "" };
    const date = new Date(dateString);
    const thaiYear = date.getFullYear() + 543;
    const yearSuffix = String(thaiYear).slice(-2);
    const fermentData = readSheet('Log_Ferment');
    let maxNum = 0;

    fermentData.forEach(f => {
      const batch = String(f['รหัสBatch'] || "");
      if (batch.endsWith("/" + yearSuffix)) {
        const num = parseInt(batch.split("/")[0], 10);
        if (!isNaN(num) && num > maxNum) maxNum = num;
      }
    });
    return { success: true, data: (maxNum + 1) + "/" + yearSuffix };
  } catch (e) {
    return { success: false, message: e.toString(), data: "" };
  }
}

function getRemainingDistillVol(productName) {
  try {
    if (!productName) return { success: true, data: 0 };
    const distillData = readSheet('Log_Distill');
    const diluteData  = readSheet('Log_Dilute');

    let sumDistill = 0;
    distillData.forEach(d => {
      if (d['ชื่อสุรา'] === productName) {
        sumDistill += parseFloat(d['ปริมาณน้ำสุราที่ได้(ลิตร)']) || 0;
      }
    });

    let sumDilute = 0;
    diluteData.forEach(d => {
      if (d['ชื่อสุรา'] === productName) {
        sumDilute += parseFloat(d['ปริมาณสุราตั้งต้น(ลิตร)']) || 0;
      }
    });

    const remaining = sumDistill - sumDilute;
    return { success: true, data: remaining > 0 ? remaining : 0 };
  } catch (e) {
    return { success: false, message: e.toString(), data: 0 };
  }
}

// ==========================================
// บันทึกข้อมูลลง Log Sheets
// ==========================================
function saveTransaction(type, data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const timestamp = new Date();
  try {
    if (type === 'material') {
      const sheet = ss.getSheetByName('Log_Material');
      sheet.appendRow([timestamp, data.date, data.transType, data.materialId, data.amount, data.docRef, data.note]);
    } else if (type === 'ferment') {
      const sheetFerm = ss.getSheetByName('Log_Ferment');
      const sheetMat  = ss.getSheetByName('Log_Material');
      const matIds    = data.materials.map(m => m.id).join(", ");
      const matAmounts = data.materials.map(m => m.amount).join(", ");
      sheetFerm.appendRow([
        timestamp, data.date, data.productName, data.batch,
        data.containerId, data.qty, matIds, matAmounts
      ]);
      data.materials.forEach(m => {
        if (m.id && m.amount) {
          sheetMat.appendRow([
            timestamp, data.date, "จ่าย", m.id, m.amount, data.batch, "เบิกไปหมัก (อัตโนมัติ)"
          ]);
        }
      });
    } else if (type === 'distill') {
      const sheet = ss.getSheetByName('Log_Distill');
      sheet.appendRow([timestamp, data.date, data.productName, data.batch, data.vol, data.abv]);
    } else if (type === 'dilute') {
      const sheet = ss.getSheetByName('Log_Dilute');
      sheet.appendRow([
        timestamp, data.date, data.productName, data.bottleSize,
        data.startVol, data.startAbv, data.water, data.finalVol, data.finalAbv, data.note
      ]);
    } else if (type === 'product') {
      // === Atomic: append Log_Product + update Stock_Product ภายใต้ Lock เดียวกัน ===
      // (log สำเร็จ → balance ต้องสำเร็จด้วย กัน balance เพี้ยน)
      const lock = LockService.getScriptLock();
      lock.waitLock(30000);
      try {
        const sheet = ss.getSheetByName('Log_Product');
        sheet.appendRow([timestamp, data.date, data.transType, data.productId, data.amount, data.note]);

        // อัปเดต running balance (ใช้ NoLock เพราะถือ lock อยู่แล้ว)
        const delta = computeStockDelta_(data.transType, data.amount);
        updateStockBalanceNoLock_(data.productId, delta);
      } finally {
        lock.releaseLock();
      }
    } else if (type === 'fermentMonitor') {
      // === บันทึกผลการติดตามหมัก (pH/Brix/อุณหภูมิ) รายครั้ง ===
      // 1 แถว = 1 ครั้งที่วัด รองรับวัดหลายรอบต่อวัน (เก็บละเอียดถึงเวลาที่วัด)
      const sheet = ss.getSheetByName('Log_FermentMonitor');
      if (!sheet) throw new Error("ไม่พบชีท Log_FermentMonitor");
      sheet.appendRow([
        timestamp, data.date, data.time, data.batch, data.productName,
        data.ph, data.brix, data.temp, data.note
      ]);
    } else {
      throw new Error("ไม่พบประเภทข้อมูลที่ต้องการบันทึก");
    }
    return { success: true, message: "บันทึกข้อมูลเรียบร้อยแล้ว" };
  } catch (error) {
    return { success: false, message: error.toString() };
  }
}

