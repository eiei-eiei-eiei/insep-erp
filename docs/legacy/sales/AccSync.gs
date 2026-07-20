// ============================================================
// 🔁 ACCOUNTING BACKGROUND SYNC (queue + time-trigger)
// แทนการยิง accounting API แบบ synchronous ตอนกดบันทึก
// → เขียนงานลงชีท acc_sync_queue แล้วให้ time-trigger (ทุก 1 นาที) ยิงทีหลัง
// idempotencyKey เดิม → retry ปลอดภัย ไม่ยิงซ้ำ · แอปบัญชี "ไม่ต้องแก้อะไร" (payload เดิม)
// ไม่มี global นอกฟังก์ชัน (ตามธรรมเนียมแอปขาย) — ค่าคงที่ประกาศใน getAccSyncConst_()
// ============================================================


/**
 * ค่าคงที่ของระบบคิว (รวมไว้ที่เดียว เลี่ยง global นอกฟังก์ชัน)
 * @returns {{ sheetName: string, maxAttempts: number, batch: number, lastRunKey: string, intervalMs: number }}
 */
function getAccSyncConst_() {
  return {
    sheetName:  'acc_sync_queue',
    maxAttempts: 5,      // ยิงพลาดครบ N ครั้ง → status=failed (รอกดยิงเองในหน้าคิว)
    batch:       20,     // ยิงสูงสุดกี่งาน/รอบ trigger (กันชน execution time limit)
    lastRunKey:  'ACC_SYNC_LASTRUN',
    intervalMs:  60000,  // รอบ trigger = 1 นาที
  };
}

/**
 * หา/สร้างชีทคิว acc_sync_queue (สร้าง header ถ้ายังไม่มี)
 * schema: A queueId · B idempotencyKey · C quNo · D customerName · E netAmount
 *         F payloadJson · G status · H attempts · I lastError · J createdAt · K doneAt
 */
function getAccSyncSheet_(ss) {
  const c  = getAccSyncConst_();
  let sh = ss.getSheetByName(c.sheetName);
  if (!sh) {
    sh = ss.insertSheet(c.sheetName);
    sh.appendRow([
      'queueId', 'idempotencyKey', 'quNo', 'customerName', 'netAmount',
      'payloadJson', 'status', 'attempts', 'lastError', 'createdAt', 'doneAt',
    ]);
  }
  return sh;
}

/**
 * เพิ่มงานลงคิว (เรียกจาก processB2BOrderAction แทนการยิง API ตรง)
 * @param {Spreadsheet} ss
 * @param {Object} payload - accPayload เต็มที่จะยิงไปแอปบัญชี (snapshot ตอนนี้)
 * @param {Object} meta - { quNo, customerName, netAmount } สำหรับโชว์ในหน้าคิว
 * @returns {string} queueId
 */
function enqueueAccSync_(ss, payload, meta) {
  const sh  = getAccSyncSheet_(ss);
  const now = new Date();
  const queueId = 'Q' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyMMddHHmmss')
                + '-' + Math.floor(Math.random() * 1000);
  sh.appendRow([
    queueId,
    payload.idempotencyKey || '',
    meta.quNo || '',
    meta.customerName || '',
    Number(meta.netAmount) || 0,
    JSON.stringify(payload),
    'pending',
    0,
    '',
    now,
    '',
  ]);
  return queueId;
}

/**
 * ยิงงาน 1 แถวไปแอปบัญชี (helper) — duplicate flag ถือว่าสำเร็จ (idempotent replay)
 * @returns {{ ok: boolean, error: string }}
 */
function fireAccSyncRow_(cfg, payloadJson) {
  try {
    const res = UrlFetchApp.fetch(cfg.accountingApiUrl, {
      method:             'post',
      contentType:        'application/json',
      payload:            payloadJson,
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    const text = res.getContentText();
    if (code === 200 || code === 201) {
      return { ok: true, error: '' };   // (รวม duplicate:true = สำเร็จ)
    }
    return { ok: false, error: 'HTTP ' + code + ': ' + text.substring(0, 200) };
  } catch (e) {
    return { ok: false, error: 'NETWORK: ' + e.message };
  }
}

/**
 * ⏱️ ตัว trigger — ยิงงาน pending ในคิว (เรียกทุก 1 นาที + เรียกเองได้)
 * @returns {{ ran: boolean, processed?: number, reason?: string }}
 */
function processAccSyncQueue() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ran: false, reason: 'busy' };
  try {
    const c   = getAccSyncConst_();
    const cfg = getConfig();
    const ss  = SpreadsheetApp.openByUrl(cfg.sheetUrl);
    const sh  = getAccSyncSheet_(ss);

    const data = sh.getDataRange().getValues();   // row 0 = header
    let processed = 0;

    for (let i = 1; i < data.length && processed < c.batch; i++) {
      if (data[i][6] !== 'pending') continue;     // เฉพาะงานที่รอยิง
      processed++;

      const rowNum = i + 1;
      const r      = fireAccSyncRow_(cfg, data[i][5]);

      if (r.ok) {
        sh.getRange(rowNum, 7, 1, 3).setValues([['done', Number(data[i][7]) || 0, '']]);  // status/attempts/lastError
        sh.getRange(rowNum, 11).setValue(new Date());                                      // doneAt
      } else {
        const attempts = (Number(data[i][7]) || 0) + 1;
        const st = attempts >= c.maxAttempts ? 'failed' : 'pending';
        sh.getRange(rowNum, 7, 1, 3).setValues([[st, attempts, r.error]]);
      }
    }

    SpreadsheetApp.flush();
    PropertiesService.getScriptProperties().setProperty(c.lastRunKey, String(Date.now()));
    return { ran: true, processed: processed };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 🛠️ ติดตั้ง trigger ทุก 1 นาที — รันครั้งเดียวหลัง deploy
 * (ลบ trigger เดิมของฟังก์ชันนี้ก่อน กันซ้ำ)
 */
function setupAccSyncTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processAccSyncQueue') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processAccSyncQueue').timeBased().everyMinutes(1).create();
  return '✅ ติดตั้ง trigger processAccSyncQueue ทุก 1 นาที เรียบร้อย';
}

/**
 * ให้ UI: งานที่ค้าง (pending + failed) + เวลา lastRun + serverNow (สำหรับ countdown)
 */
function getAccSyncQueue() {
  const c   = getAccSyncConst_();
  const cfg = getConfig();
  const ss  = SpreadsheetApp.openByUrl(cfg.sheetUrl);
  const sh  = getAccSyncSheet_(ss);

  const data = sh.getDataRange().getValues();
  const jobs = [];
  for (let i = 1; i < data.length; i++) {
    const status = data[i][6];
    if (status === 'done') continue;   // โชว์เฉพาะ pending/failed
    jobs.push({
      queueId:       data[i][0],
      idempotencyKey: data[i][1],
      quNo:          data[i][2],
      customerName:  data[i][3],
      netAmount:     Number(data[i][4]) || 0,
      status:        status,
      attempts:      Number(data[i][7]) || 0,
      lastError:     data[i][8] || '',
      createdAt:     data[i][9] instanceof Date ? data[i][9].toLocaleString('th-TH') : (data[i][9] || ''),
    });
  }

  const lastRunStr = PropertiesService.getScriptProperties().getProperty(c.lastRunKey);
  return {
    jobs:       jobs,
    lastRunAt:  lastRunStr ? Number(lastRunStr) : null,
    serverNow:  Date.now(),
    intervalMs: c.intervalMs,
  };
}

/**
 * ยิงงานเดียวเดี๋ยวนี้ (ปุ่ม "ยิงเลย" ในหน้าคิว) — พลาดคง pending ไว้ (ไม่ปล่อยค้าง failed)
 */
function retryAccSyncNow(queueId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const cfg = getConfig();
    const ss  = SpreadsheetApp.openByUrl(cfg.sheetUrl);
    const sh  = getAccSyncSheet_(ss);
    const data = sh.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] !== queueId) continue;
      if (data[i][6] === 'done') return { success: true, status: 'done' };

      const rowNum = i + 1;
      const r      = fireAccSyncRow_(cfg, data[i][5]);

      if (r.ok) {
        sh.getRange(rowNum, 7, 1, 3).setValues([['done', Number(data[i][7]) || 0, '']]);
        sh.getRange(rowNum, 11).setValue(new Date());
        SpreadsheetApp.flush();
        return { success: true, status: 'done' };
      }
      const attempts = (Number(data[i][7]) || 0) + 1;
      sh.getRange(rowNum, 7, 1, 3).setValues([['pending', attempts, r.error]]);
      SpreadsheetApp.flush();
      return { success: false, status: 'pending', error: r.error };
    }
    return { success: false, error: 'ไม่พบงานนี้ในคิว' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ยิงทั้งคิวเดี๋ยวนี้ (ปุ่ม "ยิงทั้งหมด") — reset failed→pending ก่อน แล้วรัน processAccSyncQueue
 */
function runAccSyncNow() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const cfg = getConfig();
    const ss  = SpreadsheetApp.openByUrl(cfg.sheetUrl);
    const sh  = getAccSyncSheet_(ss);
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][6] === 'failed') sh.getRange(i + 1, 7).setValue('pending');   // reset ให้ retry
    }
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return processAccSyncQueue();   // จับ lock เองข้างใน (เรียกนอก lock ด้านบน)
}
