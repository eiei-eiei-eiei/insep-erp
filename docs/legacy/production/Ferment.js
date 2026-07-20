// === Ferment monitor: getFermentMonitorData/Multi, getMonitoredDistilledBatches, getFermentHistoryBatchList ===
/**
 * ดึงประวัติการวัดค่าหมัก (pH/Brix/อุณหภูมิ) ของ Batch ที่ระบุ
 * เรียงตามวันที่+เวลา (เก่า→ใหม่) สำหรับแสดงตารางและกราฟแนวโน้ม
 * Performance: อ่านชีทครั้งเดียวด้วย readSheet() แล้ว filter ใน memory (ไม่มี getValue ใน loop)
 * @param {string} batch - รหัส Batch
 * @return {{success:boolean, data:Array<{date,time,ph,brix,temp,note}>, message?:string}}
 */
function getFermentMonitorData(batch) {
  try {
    if (!batch) return { success: true, data: [] };
    const tz = Session.getScriptTimeZone() || 'GMT+7';
    const rows = readSheet('Log_FermentMonitor');

    // วันที่/เวลาอาจถูก Sheets แปลงเป็น Date object ตอนเขียน → format กลับให้ frontend ใช้ตรงๆ
    const fmt = (v, pattern) =>
      (v instanceof Date) ? Utilities.formatDate(v, tz, pattern) : String(v == null ? '' : v);

    const data = rows
      .filter(r => String(r['รหัสBatch']) === String(batch))
      .map(r => ({
        date: fmt(r['วันที่วัด'], 'yyyy-MM-dd'),
        time: fmt(r['เวลาที่วัด'], 'HH:mm'),
        ph:   r['pH'],
        brix: r['Brix'],
        temp: r['อุณหภูมิ'],
        note: r['หมายเหตุ'] || ''
      }))
      .sort((a, b) => (a.date + ' ' + a.time).localeCompare(b.date + ' ' + b.time));

    return { success: true, data: data };
  } catch (e) {
    return { success: false, message: e.toString(), data: [] };
  }
}

/**
 * รายชื่อ batch ที่กลั่นไปแล้ว (มีใน Log_Distill) และมีบันทึกการหมักใน Log_FermentMonitor
 * ใช้สำหรับปุ่มดูประวัติบันทึกการหมักย้อนหลัง
 * @return {{success:boolean, data:Array<{batch,productName}>, message?:string}}
 */
function getMonitoredDistilledBatches() {
  try {
    const monitor = readSheet('Log_FermentMonitor');
    const distill = readSheet('Log_Distill');
    const distilled = new Set();
    distill.forEach(d => { const b = String(d['รหัสBatchที่นำมากลั่น'] || ''); if (b) distilled.add(b); });

    const seen = {};
    const list = [];
    monitor.forEach(m => {
      const b = String(m['รหัสBatch'] || '');
      if (!b || seen[b] || !distilled.has(b)) return;   // เฉพาะที่กลั่นแล้ว + มีบันทึกหมัก
      seen[b] = true;
      list.push({ batch: b, productName: String(m['ชื่อสุรา'] || '') });
    });
    return { success: true, data: list };
  } catch (e) {
    return { success: false, message: e.toString(), data: [] };
  }
}

/**
 * ดึงบันทึกการหมักของหลาย batch พร้อมกัน (อ่านชีทครั้งเดียว) สำหรับกราฟเปรียบเทียบ
 * @param {string[]} batches
 * @return {{success:boolean, data:Object<batch, Array>}}
 */
function getFermentMonitorMulti(batches) {
  try {
    const tz = Session.getScriptTimeZone() || 'GMT+7';
    const want = new Set((batches || []).map(String));
    const rows = readSheet('Log_FermentMonitor');
    const fmt = (v, p) => (v instanceof Date) ? Utilities.formatDate(v, tz, p) : String(v == null ? '' : v);
    const out = {};
    want.forEach(b => out[b] = []);
    rows.forEach(r => {
      const b = String(r['รหัสBatch'] || '');
      if (!want.has(b)) return;
      out[b].push({
        date: fmt(r['วันที่วัด'], 'yyyy-MM-dd'),
        time: fmt(r['เวลาที่วัด'], 'HH:mm'),
        ph:   r['pH'],
        brix: r['Brix'],
        temp: r['อุณหภูมิ']
      });
    });
    Object.keys(out).forEach(b => out[b].sort((a, b2) => (a.date + ' ' + a.time).localeCompare(b2.date + ' ' + b2.time)));
    return { success: true, data: out };
  } catch (e) {
    return { success: false, message: e.toString(), data: {} };
  }
}

/**
 * รายชื่อ batch ที่มีบันทึกการหมัก (Log_FermentMonitor) + วันที่ลงหมัก (จาก Log_Ferment)
 * ใช้สำหรับหน้าประวัติหมัก-กลั่น (คิด "วันจากเริ่มหมัก")
 * @return {{success:boolean, data:Array<{batch,productName,startDate}>}}
 */
function getFermentHistoryBatchList() {
  try {
    const monitor    = readSheet('Log_FermentMonitor');
    const distillRun = readSheet(DISTILL_RUN_SHEET);
    const ferment    = readSheet('Log_Ferment');
    const tz = Session.getScriptTimeZone() || 'GMT+7';
    const fmtDate = v => (v instanceof Date) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : String(v == null ? '' : v).slice(0, 10);

    const startMap = {};
    ferment.forEach(f => {
      const b = String(f['รหัสBatch'] || '');
      if (b && !startMap[b]) startMap[b] = fmtDate(f['วันที่ลงหมัก']);
    });

    // union: batch ที่มีข้อมูลหมัก หรือ กลั่น (เรียงตามที่พบครั้งแรก)
    const nameMap = {};
    monitor.forEach(m => { const b = String(m['รหัสBatch'] || ''); if (b && !nameMap[b]) nameMap[b] = String(m['ชื่อสุรา'] || ''); });
    distillRun.forEach(d => { const b = String(d['รหัสBatch'] || ''); if (b && !nameMap[b]) nameMap[b] = String(d['ชื่อสุรา'] || ''); });

    const seen = {}; const order = [];
    const add = b => { if (b && !seen[b]) { seen[b] = true; order.push(b); } };
    monitor.forEach(m => add(String(m['รหัสBatch'] || '')));
    distillRun.forEach(d => add(String(d['รหัสBatch'] || '')));

    const list = order.map(b => ({ batch: b, productName: nameMap[b] || '', startDate: startMap[b] || '' }));
    return { success: true, data: list };
  } catch (e) {
    return { success: false, message: e.toString(), data: [] };
  }
}

