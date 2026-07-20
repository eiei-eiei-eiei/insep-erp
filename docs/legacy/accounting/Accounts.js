// =========================================================================
// FILE: Accounts.gs  [6/8]
// [Phase B/C] โอนเงินระหว่างบัญชี + ยอดคงเหลือ + statement
// =========================================================================

// =========================================================================
// [Phase C] ระบบโอนเงินระหว่างบัญชี (Inter-Account Transfer)
// =========================================================================

/**
 * [Phase C] สร้าง Transfer ID แบบ Running Number รายวัน
 * รูปแบบ: TRF-yyyyMMdd-NNNN (เช่น TRF-20260607-0001)
 * ใช้ LockService กัน race condition เช่นเดียวกับ getNextTxId_
 * @returns {string}
 */
function getNextTransferId_() {
  const tz      = Session.getScriptTimeZone();
  const dateStr = Utilities.formatDate(new Date(), tz, "yyyyMMdd");
  const propKey = `TRF_COUNTER_${dateStr}`;

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props   = PropertiesService.getScriptProperties();
    const current = parseInt(props.getProperty(propKey) || '0', 10);
    const next    = current + 1;
    props.setProperty(propKey, next.toString());
    return `TRF-${dateStr}-${next.toString().padStart(4, '0')}`;
  } finally {
    lock.releaseLock();
  }
}

/**
 * [Phase C] บันทึกการโอนเงินระหว่างบัญชี — 2 rows ใน Transactions sheet
 *
 * Row 1 (ต้นทาง): type='โอนระหว่างบัญชี', accountType=fromAccount, netAmount=-amount
 *   → เงินออกจากบัญชีต้นทาง
 * Row 2 (ปลายทาง): type='โอนระหว่างบัญชี', accountType=toAccount, netAmount=+amount
 *   → เงินเข้าบัญชีปลายทาง
 *
 * - ทั้ง 2 rows ผูกกันด้วย transferId (col 19)
 * - ครอบด้วย LockService เพื่อให้ทั้งคู่บันทึกสำเร็จหรือล้มเหลวพร้อมกัน
 * - exclude ออกจาก Dashboard/VAT/WHT อัตโนมัติ เพราะ filter เหล่านั้น
 *   เช็ค taxAccountSet + type ไม่ match 'รายรับ'/'รายจ่าย'
 *
 * @param {Object} data
 *   data.fromAccount  - ชื่อบัญชีต้นทาง
 *   data.toAccount    - ชื่อบัญชีปลายทาง
 *   data.amount       - จำนวนเงินที่โอน (> 0)
 *   data.transferDate - "yyyy-MM-dd"
 *   data.note         - หมายเหตุ (optional)
 * @returns {{ success, transferId, txIdFrom, txIdTo, message }}
 */
function saveTransfer(data) {
  // Validate เบื้องต้นก่อนแตะ sheet
  if (!data.fromAccount || !data.toAccount) {
    return { success: false, message: 'กรุณาระบุบัญชีต้นทางและปลายทาง' };
  }
  if (data.fromAccount === data.toAccount) {
    return { success: false, message: 'บัญชีต้นทางและปลายทางต้องไม่ใช่บัญชีเดียวกัน' };
  }
  const amount = parseFloat(data.amount);
  if (!amount || amount <= 0) {
    return { success: false, message: 'จำนวนเงินต้องมากกว่า 0' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const cfg        = getConfig_();
    const ss         = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const txSheet    = ss.getSheetByName('Transactions');
    const tz         = Session.getScriptTimeZone();
    const now        = new Date();   // [Phase 0] buildTxRow_ สร้าง timestamp (col 1) จาก now เอง
    const transferId = getNextTransferId_();
    const txIdFrom   = getNextTxId_();
    const txIdTo     = getNextTxId_();
    const txDate     = data.transferDate || Utilities.formatDate(now, tz, "yyyy-MM-dd");
    const note       = data.note ? data.note.trim() : '';
    // [Multi-Entity] โอนภายในกิจการเดียว — ใช้ entity ที่เลือกบนหน้าจอ
    const txEntityId = data.entityId || cfg.DEFAULT_ENTITY_ID;

    // description บอก direction ให้ชัด — แสดงใน statement ทั้งสองฝั่ง
    const descFrom = `โอนออกไป [${data.toAccount}]${note ? ' · ' + note : ''}`;
    const descTo   = `รับโอนจาก [${data.fromAccount}]${note ? ' · ' + note : ''}`;

    // [Phase 0] ใช้ buildTxRow_ (27 คอลัมน์) แทน inline array — ผูก 2 row ด้วย extra.transferId (col 19)
    // baseAmount/discount/vat/wht = 0 เพราะไม่ใช่ transaction เชิงพาณิชย์
    // netAmount ต้นทาง = -amount (เงินออก), ปลายทาง = +amount (เงินเข้า)
    // โอนเงิน = เคลื่อนไหวจริงทันที → apArStatus '' โดย default
    const baseFrom = {
      transactionDate: txDate, type: 'โอนระหว่างบัญชี', accountType: data.fromAccount,
      category: 'โอนระหว่างบัญชี', contactName: '', description: descFrom,
      baseAmount: 0, discount: 0, amountAfterDiscount: 0, vatAmount: 0, whtRate: 0, whtAmount: 0,
      netAmount: -amount, taxInvoiceNo: '', taxInvoiceDate: txDate, entityId: txEntityId
    };
    const baseTo = Object.assign({}, baseFrom, {
      accountType: data.toAccount, description: descTo, netAmount: amount
    });

    const rowFrom = buildTxRow_(txIdFrom, now, baseFrom, '', { transferId: transferId });
    const rowTo   = buildTxRow_(txIdTo,   now, baseTo,   '', { transferId: transferId });

    // batch setValues 2 rows — 1 API call, atomicity ดีกว่า 2 appendRow
    const lastRow = txSheet.getLastRow();
    txSheet.getRange(lastRow + 1, 1, 2, rowFrom.length).setValues([rowFrom, rowTo]);

    return {
      success   : true,
      transferId: transferId,
      txIdFrom  : txIdFrom,
      txIdTo    : txIdTo,
      message   : `โอนเงิน ${amount.toLocaleString('th-TH', {minimumFractionDigits: 2})} บาท เรียบร้อยแล้ว`
    };
  } catch (e) {
    console.error(`[saveTransfer] ${e.message}`);
    return { success: false, message: e.message };
  } finally {
    lock.releaseLock();
  }
}

// =========================================================================
// [Phase B] ระบบดูยอดคงเหลือและการเคลื่อนไหวเงิน (Account Balances & Statement)
// =========================================================================

/**
 * [Phase B] คำนวณยอดคงเหลือสะสมตลอดกาลของทุกบัญชี ณ วันสิ้นเดือนที่เลือก
 *
 * - นับ netAmount (col[14]) — ยอดสุทธิที่เงินเข้า/ออกจริง
 * - รายรับ (+บวก), รายจ่าย (-ลบ)
 * - อ่าน sheet ครั้งเดียว แล้วคำนวณทุกบัญชีพร้อมกัน
 *
 * @param {string} upToPeriod - "yyyy-MM" คำนวณถึงสิ้นเดือนนี้ (inclusive)
 * @returns {{ success: boolean, balances: Array, grandTotal: number }}
 *   balances: [{ accountType, totalIn, totalOut, balance, isTaxAccount }]
 */
function getAccountBalances(upToPeriod, entityId) {
  try {
    const cfg = getConfig_();
    const ss  = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);

    // คำนวณขอบบนของ period: สิ้นเดือน upToPeriod (วันที่ 1 เดือนถัดไป)
    const [yr, mo] = upToPeriod.split('-').map(Number);
    const cutoff = new Date(yr, mo, 1); // วันที่ 1 เดือนถัดไป = exclusive upper bound

    const taxAccountSet = getTaxAccountSet_(ss);
    const txSheet = ss.getSheetByName('Transactions');
    if (!txSheet) return { success: true, balances: [], grandTotal: 0 };

    const data = txSheet.getDataRange().getValues();

    // map: accountName → { totalIn, totalOut }
    // หมายเหตุ: ยอดบัญชีจริง = ทุกรายการของบัญชีนั้น "ข้ามทุก entity" (บัญชีใช้ร่วม)
    // จึง "ไม่" filter ด้วย entityId ตรงนี้ — entity ใช้แค่คัดว่าจะ "แสดง" บัญชีไหน
    const accMap = {};
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[18] !== 'ปกติ') continue;  // ข้ามรายการที่ถูกยกเลิก
      if (row[21]) continue;             // [Phase 2] ข้าม AP/AR ค้าง (เงินยังไม่เคลื่อน)

      const dateVal = row[2];
      const txDate  = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
      if (isNaN(txDate.getTime()) || txDate >= cutoff) continue;

      const accName = String(row[4] || '').trim();
      const txType  = row[3];
      const net     = parseFloat(row[14]) || 0;

      if (!accMap[accName]) accMap[accName] = { totalIn: 0, totalOut: 0 };
      if (txType === 'รายรับ') {
        accMap[accName].totalIn += net;
      } else if (txType === 'รายจ่าย') {
        accMap[accName].totalOut += net;
      } else if (txType === 'โอนระหว่างบัญชี') {
        if (net > 0) accMap[accName].totalIn  += net;
        else         accMap[accName].totalOut += Math.abs(net);
      }
    }

    // รายชื่อบัญชีที่จะแสดง + opening balance
    // 1) ถ้ามีชีท Accounts → ใช้เป็นหลัก (มี openingBalance + entityIds สำหรับ filter)
    // 2) ถ้ายังไม่มี → fallback ไป Settings col A (พฤติกรรมเดิม, opening = 0)
    const accountsMeta = getAccounts_();
    const openingOf  = {};   // accountName → openingBalance
    const entityIdsOf= {};   // accountName → entityIds[]
    let displayNames = [];

    if (accountsMeta.length > 0) {
      accountsMeta.forEach(a => {
        // filter ตาม entity ที่เลือก (บัญชีใช้ร่วมโผล่ในทุก entity ที่ระบุ)
        const visible = (!entityId || entityId === 'ALL' || a.entityIds.length === 0 || a.entityIds.indexOf(entityId) !== -1);
        if (!visible) return;
        displayNames.push(a.accountName);
        openingOf[a.accountName]   = a.openingBalance;
        entityIdsOf[a.accountName] = a.entityIds;
      });
    } else {
      const settingsSheet = ss.getSheetByName('Settings');
      if (settingsSheet) {
        const sData = settingsSheet.getDataRange().getDisplayValues();
        for (let i = 1; i < sData.length; i++) {
          const name = (sData[i][0] || '').trim();
          if (name) displayNames.push(name);
        }
      }
      // เพิ่มบัญชีที่มีรายการแต่ไม่อยู่ใน Settings (กัน data ขาด)
      Object.keys(accMap).forEach(acc => { if (displayNames.indexOf(acc) === -1) displayNames.push(acc); });
    }

    let grandTotal = 0;
    const balances = displayNames.map(name => {
      const { totalIn = 0, totalOut = 0 } = accMap[name] || {};
      const opening = openingOf[name] || 0;
      const balance = opening + totalIn - totalOut;
      grandTotal += balance;
      const ids = entityIdsOf[name] || [];
      return {
        accountType   : name,
        openingBalance: opening,
        totalIn       : totalIn,
        totalOut      : totalOut,
        balance       : balance,
        isTaxAccount  : taxAccountSet.has(name),
        shared        : ids.length > 1
      };
    });

    return { success: true, balances, grandTotal, upToPeriod };
  } catch (e) {
    console.error(`[getAccountBalances] ${e.message}`);
    return { success: false, message: e.message };
  }
}

/**
 * [Phase B] ดึงรายการเคลื่อนไหวของบัญชีที่เลือก แบบ statement ธนาคาร
 *
 * - Opening balance = ยอดสะสมก่อนเดือนที่เลือก
 * - รายการในเดือน = filter transactionDate อยู่ใน period
 * - Running balance คำนวณสะสมต่อเนื่องจาก opening
 * - เรียงตามวันที่ asc, txId asc (กัน timestamp เดียวกันสลับกัน)
 *
 * @param {string} accountType - ชื่อบัญชีที่ต้องการดู
 * @param {string} period      - "yyyy-MM" เดือนที่ต้องการดู statement
 * @returns {{ success, accountType, period, openingBalance, rows, closingBalance }}
 *   rows: [{ txId, date, type, category, contactName, description,
 *             debit, credit, runningBalance }]
 */
function getAccountStatement(accountType, period) {
  try {
    const cfg = getConfig_();
    const ss  = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const tz  = Session.getScriptTimeZone();

    const [yr, mo] = period.split('-').map(Number);
    // ขอบเดือน: วันที่ 1 ของเดือน (inclusive start) และวันที่ 1 เดือนถัดไป (exclusive end)
    const periodStart = new Date(yr, mo - 1, 1);
    const periodEnd   = new Date(yr, mo, 1);

    const txSheet = ss.getSheetByName('Transactions');
    if (!txSheet) return { success: true, accountType, period, openingBalance: 0, rows: [], closingBalance: 0 };

    const data = txSheet.getDataRange().getValues();

    // [Multi-Entity] เริ่ม opening จากยอดยกมาของบัญชี (Accounts['openingBalance']) ถ้ามี
    const acctMeta = getAccounts_().find(a => a.accountName === accountType);
    let openingBalance = acctMeta ? acctMeta.openingBalance : 0;
    const periodRows   = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[18] !== 'ปกติ') continue;
      if (row[21]) continue;             // [Phase 2] ข้าม AP/AR ค้าง
      if (String(row[4] || '').trim() !== accountType) continue;

      const dateVal = row[2];
      let txDate;
      if (dateVal instanceof Date) {
        txDate = dateVal;
      } else {
        txDate = new Date(dateVal);
      }
      if (isNaN(txDate.getTime())) continue;

      const net    = parseFloat(row[14]) || 0;
      const txType = row[3];

      // [Phase C] คำนวณ debit/credit/effect ตาม type
      let credit = 0, debit = 0, effect = 0;
      if (txType === 'รายรับ') {
        credit = net; effect = net;
      } else if (txType === 'รายจ่าย') {
        debit = net; effect = -net;
      } else if (txType === 'โอนระหว่างบัญชี') {
        // net บวก = รับโอนเข้า (credit), net ลบ = โอนออก (debit)
        if (net > 0) { credit = net;         effect =  net; }
        else         { debit  = Math.abs(net); effect = net; }
      }

      if (txDate < periodStart) {
        // รายการก่อนเดือน → สะสมใน opening balance
        openingBalance += effect;
      } else if (txDate >= periodStart && txDate < periodEnd) {
        // รายการในเดือน → เก็บไว้แสดง
        let dateStr;
        if (dateVal instanceof Date) {
          dateStr = Utilities.formatDate(dateVal, tz, "yyyy-MM-dd");
        } else {
          dateStr = dateVal.toString().substring(0, 10);
        }
        periodRows.push({
          txId          : row[0],
          date          : dateStr,
          type          : txType,
          category      : row[5],
          contactName   : row[6],
          description   : row[7],
          transferId    : row[19] ? String(row[19]).trim() : '',  // [Phase C]
          debit         : debit,
          credit        : credit,
          _effect       : effect   // ใช้คำนวณ running balance — ไม่ส่งไปหน้าเว็บ
        });
      }
    }

    // เรียงตามวันที่ asc แล้วตาม txId asc (format TR-yyyyMMdd-NNNN)
    periodRows.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.txId < b.txId ? -1 : 1;
    });

    // คำนวณ running balance สะสมจาก opening
    let runningBalance = openingBalance;
    const rows = periodRows.map(row => {
      runningBalance += row._effect;
      return {
        txId          : row.txId,
        date          : row.date,
        type          : row.type,
        category      : row.category,
        contactName   : row.contactName,
        description   : row.description,
        transferId    : row.transferId,   // [Phase C]
        debit         : row.debit,
        credit        : row.credit,
        runningBalance: runningBalance
      };
    });

    const closingBalance = openingBalance + periodRows.reduce((s, r) => s + r._effect, 0);

    return {
      success        : true,
      accountType,
      period,
      openingBalance,
      rows,
      closingBalance
    };
  } catch (e) {
    console.error(`[getAccountStatement] ${e.message}`);
    return { success: false, message: e.message };
  }
}
