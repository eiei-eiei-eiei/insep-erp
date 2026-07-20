// === Distill run tracking (global DISTILL_RUN_SHEET): start/save/get/list/multi ===
// ==========================================
// ติดตามการกลั่น (Distillation Run Tracking)
// 1 batch กลั่นได้หลายหม้อ (potNo) — ทุก reading ลง Log_DistillRun
// ปิด batch → สรุปเขียน Log_Distill 1 แถว ผ่าน saveTransaction('distill')
// (สำคัญ: ต้อง 1 แถว/batch เท่านั้น เพราะรายงาน ภส.๐๗-๐๑/๑ หักส่าต่อ 1 แถว = ส่าทั้ง batch)
// ==========================================

const DISTILL_RUN_SHEET = 'Log_DistillRun';

/**
 * เริ่มกลั่นหม้อใหม่: สร้าง runId + หา potNo ถัดไปของ batch + เขียนแถว marker (t=0)
 * ใช้ LockService กัน potNo ชนกันถ้าเปิดหลายแท็บ
 * @return {{success:boolean, runId?:string, potNo?:number, startTs?:number, message?:string}}
 */
function startDistillRun(batch, productName, chargeVol) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(DISTILL_RUN_SHEET);
    if (!sheet) throw new Error('ไม่พบชีท ' + DISTILL_RUN_SHEET);
    if (!batch) throw new Error('ไม่ได้ระบุ Batch');

    // หา potNo ถัดไป = max potNo ของ batch นี้ + 1 (อ่านชีทครั้งเดียว)
    const rows = readSheet(DISTILL_RUN_SHEET);
    let maxPot = 0;
    rows.forEach(r => {
      if (String(r['รหัสBatch']) === String(batch)) {
        const p = parseInt(r['potNo'], 10);
        if (!isNaN(p) && p > maxPot) maxPot = p;
      }
    });
    const potNo = maxPot + 1;

    const now = new Date();
    const tz  = Session.getScriptTimeZone() || 'GMT+7';
    const runId = 'DR-' + Utilities.formatDate(now, tz, 'yyyyMMdd-HHmmss');

    // แถว marker เริ่มกลั่น: ช่วง="เริ่มกลั่น", นาทีที่=0, ช่องวัดว่าง + ปริมาณน้ำหมักที่กลั่น (col 17)
    sheet.appendRow([
      now, runId, potNo, batch, productName, 0, 'เริ่มกลั่น',
      '', '', '', '', '', '', '', '', '',
      (chargeVol === undefined || chargeVol === null || chargeVol === '' ? '' : chargeVol)
    ]);

    return { success: true, runId: runId, potNo: potNo, startTs: now.getTime() };
  } catch (e) {
    return { success: false, message: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * บันทึก reading ระหว่างกลั่น 1 แถว ลง Log_DistillRun
 * ดีกรี@20C / นาทีที่ / อัตราการไหล คำนวณฝั่ง client แล้วส่งมาเก็บ (UI ตอบสนองทันที)
 * ใช้บันทึก marker "จบหม้อ" ด้วย (phase='จบหม้อ')
 */
function saveDistillReading(p) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(DISTILL_RUN_SHEET);
    if (!sheet) throw new Error('ไม่พบชีท ' + DISTILL_RUN_SHEET);
    sheet.appendRow([
      new Date(), p.runId, p.potNo, p.batch, p.productName, p.minute, p.phase,
      p.abvObs, p.tempSpirit, p.abv20, p.cumVol, p.flowRate,
      p.vaporTemp, p.potTemp, p.coolTemp, p.note, (p.fermCharge || '')
    ]);
    return { success: true, message: 'บันทึกค่าเรียบร้อย' };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * โหลด reading ทั้งหมดของ batch (ทุกหม้อ) สำหรับ resume + แสดงผล + รวมยอดปิด batch
 * คืน ts (epoch ms) ของแต่ละแถวให้ client คำนวณเวลาเดินต่อได้แม้ปิดเบราว์เซอร์ไป
 */
function getDistillRunData(batch) {
  try {
    if (!batch) return { success: true, data: [] };
    const rows = readSheet(DISTILL_RUN_SHEET);
    const data = rows
      .filter(r => String(r['รหัสBatch']) === String(batch))
      .map(r => ({
        ts:         (r['timestamp'] instanceof Date) ? r['timestamp'].getTime() : null,
        runId:      String(r['runId'] || ''),
        potNo:      parseInt(r['potNo'], 10) || 0,
        minute:     r['นาทีที่'],
        phase:      String(r['ช่วง'] || ''),
        abvObs:     r['ดีกรีที่อ่าน'],
        tempSpirit: r['อุณหภูมิสุรา'],
        abv20:      r['ดีกรี@20C'],
        cumVol:     r['ปริมาณสะสม'],
        flowRate:   r['อัตราการไหล'],
        vaporTemp:  r['อุณหภูมิไอ'],
        potTemp:    r['อุณหภูมิหม้อต้ม'],
        coolTemp:   r['อุณหภูมิน้ำหล่อเย็น'],
        note:       r['หมายเหตุ'] || '',
        fermCharge: r['ปริมาณน้ำหมักที่กลั่น']
      }))
      .sort((a, b) => (a.potNo - b.potNo) || ((a.ts || 0) - (b.ts || 0)));
    return { success: true, data: data };
  } catch (e) {
    return { success: false, message: e.toString(), data: [] };
  }
}

/**
 * รายชื่อ batch ที่กลั่นจบแล้ว (มีใน Log_Distill) และมีประวัติใน Log_DistillRun
 * ใช้สำหรับโหมดดูประวัติ-กราฟย้อนหลัง
 * @return {{success:boolean, data:Array<{batch,productName}>, message?:string}}
 */
function getDistilledBatchList() {
  try {
    const distill = readSheet('Log_Distill');
    const runRows = readSheet(DISTILL_RUN_SHEET);
    const runBatches = new Set();
    runRows.forEach(r => { const b = String(r['รหัสBatch'] || ''); if (b) runBatches.add(b); });

    const seen = {};
    const list = [];
    distill.forEach(d => {
      const b = String(d['รหัสBatchที่นำมากลั่น'] || '');
      if (!b || seen[b] || !runBatches.has(b)) return;   // เฉพาะที่มีประวัติการกลั่น
      seen[b] = true;
      list.push({ batch: b, productName: String(d['ชื่อสุรา'] || '') });
    });
    return { success: true, data: list };
  } catch (e) {
    return { success: false, message: e.toString(), data: [] };
  }
}

/**
 * ดึง reading การกลั่นของหลาย batch พร้อมกัน (อ่านชีทครั้งเดียว) สำหรับกราฟเปรียบเทียบ
 * @param {string[]} batches
 * @return {{success:boolean, data:Object<batch, Array>}}
 */
function getDistillRunMulti(batches) {
  try {
    const want = new Set((batches || []).map(String));
    const rows = readSheet(DISTILL_RUN_SHEET);
    const out = {};
    want.forEach(b => out[b] = []);
    rows.forEach(r => {
      const b = String(r['รหัสBatch'] || '');
      if (!want.has(b)) return;
      out[b].push({
        potNo:      parseInt(r['potNo'], 10) || 0,
        minute:     r['นาทีที่'],
        phase:      String(r['ช่วง'] || ''),
        abv20:      r['ดีกรี@20C'],
        cumVol:     r['ปริมาณสะสม'],
        vaporTemp:  r['อุณหภูมิไอ'],
        potTemp:    r['อุณหภูมิหม้อต้ม'],
        coolTemp:   r['อุณหภูมิน้ำหล่อเย็น'],
        flowRate:   r['อัตราการไหล'],
        fermCharge: r['ปริมาณน้ำหมักที่กลั่น']
      });
    });
    // ค่าหัวใจสุดท้ายที่ยืนยันตอนปิด batch (อ้างอิงจริงจาก Log_Distill ไม่ใช่ค่าเฉลี่ยจาก readings)
    const distill = readSheet('Log_Distill');
    const finalMap = {};
    distill.forEach(d => {
      const b = String(d['รหัสBatchที่นำมากลั่น'] || '');
      if (want.has(b)) finalMap[b] = { vol: parseFloat(d['ปริมาณน้ำสุราที่ได้(ลิตร)']) || 0, abv: parseFloat(d['ดีกรี']) || 0 };
    });
    return { success: true, data: out, final: finalMap };
  } catch (e) {
    return { success: false, message: e.toString(), data: {}, final: {} };
  }
}

