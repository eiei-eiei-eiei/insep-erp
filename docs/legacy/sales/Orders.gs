// ============================================================
// 📚 B2B ORDERS (history, actions, order items)
// ============================================================


/**
 * แปลง 1 row ของ btbtransaction (array index 0–30) → order object
 * ใช้ร่วมกันระหว่าง getB2BOrdersHistory (โหลดทั้งหมด)
 * และ processB2BOrderAction (คืน order เดียวที่อัปเดตแล้ว ให้ frontend patch in-place)
 *
 * ⚠️ ไม่รวม customerAddress/customerTaxId/customerBranch (มาจาก custMap แยก)
 *    — frontend ที่ patch in-place จะเก็บค่าเดิม 3 ช่องนี้ไว้ (ไม่เปลี่ยนระหว่าง action)
 * @param {Array} row - row.getValues()[0] ของ btbtransaction (31 ช่อง)
 * @returns {Object} order object (schema เดียวกับ history แต่ไม่มี cust fields)
 */
function mapRowToB2BOrder(row) {
  const toDate = (v) => v instanceof Date ? v : (v ? new Date(v) : null);
  return {
    timestamp:          toDate(row[0]) ? toDate(row[0]).toLocaleDateString('th-TH') : '',
    customerName:       row[2] || '',
    subTotal:           Number(row[6])  || 0,
    discount:           Number(row[7])  || 0,
    subDiscount:        Number(row[8])  || 0,
    vatAmount:          Number(row[9])  || 0,
    grandTotal:         Number(row[10]) || 0,
    quNo:               row[4].toString(),
    quExp:              toDate(row[5]) ? toDate(row[5]).toLocaleDateString('th-TH') : (row[5] || ''),
    orderNo:            row[11] ? row[11].toString() : '',
    status:             row[12] || 'รอคอนเฟิร์ม',
    deposit:            Number(row[13]) || 0,
    outstandingBalance: Number(row[14]) || 0,
    dueDate:            row[15] ? (row[15] instanceof Date ? row[15].toLocaleDateString('th-TH') : row[15]) : '',
    paymentMethod:      row[16] || '',
    invNo:              row[17] || '',
    taxNo1:             row[18] || '',
    taxNo2:             row[19] || '',
    remarks:            row[20] || '',
    docDate1:           row[21] ? Utilities.formatDate(new Date(row[21]), Session.getScriptTimeZone(), "yyyy-MM-dd") : '',
    docDate2:           row[22] ? Utilities.formatDate(new Date(row[22]), Session.getScriptTimeZone(), "yyyy-MM-dd") : '',
    checkDetail1:       row[23] || '',
    checkDetail2:       row[24] || '',
    whtPercent:         Number(row[25]) || 0,
    whtAmount:          Number(row[26]) || 0,
    netPayable:         Number(row[27]) || 0,
    docToPrint:         row[28] || '',
    nextStatus:         row[29] || '',
    category:           row[30] || 'รายได้ค่าสินค้า',
  };
}

function getB2BOrdersHistory() {
  try {
    const cfg     = getConfig();
    const ss      = SpreadsheetApp.openByUrl(cfg.sheetUrl);
    const sheet   = ss.getSheetByName('btbtransaction');
    if (!sheet) return [];

    const custMap = buildCustMap(ss);
    const data    = sheet.getDataRange().getValues();
    const orders  = [];

    for (let i = 1; i < data.length; i++) {
      if (!data[i][4] || !data[i][4].toString().startsWith('QU')) continue;

      const cId  = data[i][1] ? data[i][1].toString() : '';
      const cust = custMap[cId] || {};

      // map ฟิลด์จาก row + เติม cust fields (address/taxId/branch) จาก custMap
      const order = mapRowToB2BOrder(data[i]);
      order.customerAddress = cust.address || '';
      order.customerTaxId   = cust.taxId  || '';
      order.customerBranch  = cust.branch || '';
      orders.push(order);
    }
    return orders.reverse();
  } catch (e) { throw new Error("Load Error: " + e.message); }
}

function processB2BOrderAction(quNo, action, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cfg        = getConfig();
    const ss         = SpreadsheetApp.openByUrl(cfg.sheetUrl);
    const sheet      = ss.getSheetByName('btbtransaction');
    const salesSheet = ss.getSheetByName('btbsales');
    const data       = sheet.getDataRange().getValues();

    let rowIndex = -1, currentStatus = "", outstandingBalance = 0;
    for (let i = 1; i < data.length; i++) {
      if (data[i][4] === quNo) {
        rowIndex           = i + 1;
        currentStatus      = data[i][12];
        outstandingBalance = Number(data[i][14]) || 0;
        break;
      }
    }
    if (rowIndex === -1) throw new Error("ไม่พบออเดอร์นี้ในระบบ");

    let newStatus = currentStatus;
    const updateData = {};
    let dateColToUpdate = -1;

    if (payload.chequeDetails) {
      if (action === 'DEPOSIT_AND_SEND') { updateData.checkDetail1 = payload.chequeDetails; }
      else                               { updateData.checkDetail2 = payload.chequeDetails; }
    }

    // --- ประมวลผลสถานะ ---
    if (action === 'DEPOSIT_AND_SEND') {
      newStatus = "รอคลังจัดส่ง";
      updateData.deposit            = (Number(data[rowIndex-1][13]) || 0) + Number(payload.amount);
      updateData.outstandingBalance = outstandingBalance - payload.amount;
      updateData.paymentMethod      = payload.method;
      if (!data[rowIndex-1][17]) updateData.invNo  = generateRunningNumber(sheet, 'INV');
      if (!data[rowIndex-1][18]) updateData.taxNo1 = generateRunningNumber(sheet, 'TAX');
      const dueDateObj = new Date(payload.docDate);
      dueDateObj.setDate(dueDateObj.getDate() + (Number(payload.creditDays) || 0));
      updateData.dueDate    = Utilities.formatDate(dueDateObj, Session.getScriptTimeZone(), "dd/MM/yyyy");
      updateData.docToPrint = 'invoice,tax-invoice-deposit';
      updateData.nextStatus = 'ส่งของแล้วรอชำระยอดค้าง';
      dateColToUpdate = 22;

    } else if (action === 'FULL_PAYMENT_AND_SEND') {
      newStatus = "รอคลังจัดส่ง";
      updateData.outstandingBalance = 0;
      updateData.paymentMethod      = payload.method;
      if (!data[rowIndex-1][18]) updateData.taxNo1 = generateRunningNumber(sheet, 'TAX');
      updateData.docToPrint = 'tax-invoice-receipt-do';
      updateData.nextStatus = 'ปิดการขาย';
      dateColToUpdate = currentStatus === 'รอชำระเงิน (จ่ายเต็ม)' ? 23 : 22;

    } else if (action === 'SEND_TO_WH') {
      newStatus = "รอคลังจัดส่ง";
      if (!data[rowIndex-1][17]) updateData.invNo = generateRunningNumber(sheet, 'INV');
      const dueDateObj = new Date(payload.docDate);
      dueDateObj.setDate(dueDateObj.getDate() + (Number(payload.creditDays) || 0));
      updateData.dueDate    = Utilities.formatDate(dueDateObj, Session.getScriptTimeZone(), "dd/MM/yyyy");
      updateData.docToPrint = 'invoice';
      updateData.nextStatus = "ส่งของแล้วรอชำระเงิน";
      dateColToUpdate = 22;

    } else if (action === 'ISSUE_INVOICE_FULL') {
      newStatus = "รอชำระเงิน (จ่ายเต็ม)";
      if (!data[rowIndex-1][17]) updateData.invNo = generateRunningNumber(sheet, 'INV');
      // docToPrint = 'invoice' → บอก WH ว่าเอกสารชุดแรกคืออะไร
      // FULL_PAYMENT_AND_SEND ที่จะถูกเรียกต่อจะ overwrite เป็น 'tax-invoice-receipt-do'
      updateData.docToPrint = 'invoice';
      dateColToUpdate = 22;

    } else if (action === 'PAY_BALANCE' || action === 'FULL_PAYMENT_LATER') {
      newStatus = "ปิดการขาย";
      updateData.paymentMethod      = payload.method;
      updateData.outstandingBalance = 0;
      if (action === 'PAY_BALANCE') {
        if (!data[rowIndex-1][19]) updateData.taxNo2 = generateRunningNumber(sheet, 'TAX');
      } else {
        if (!data[rowIndex-1][18]) updateData.taxNo1 = generateRunningNumber(sheet, 'TAX');
      }
      dateColToUpdate = 23;
    }

    // --- อัปเดต Sheet (B.1.1: batch setValues แทน 13 setValue แยก) ---
    // อ่าน row เดิมทั้ง row แล้ว overwrite เฉพาะ column ที่ต้องการ
    // เพื่อไม่ให้ลบค่าเดิมในช่องที่ไม่ได้ update
    const rowRange    = sheet.getRange(rowIndex, 1, 1, 31);
    const rowValues   = rowRange.getValues()[0];   // array 31 ช่อง (index 0–30)

    // col index ใน array = column number - 1
    rowValues[12] = newStatus;
    if (updateData.deposit            !== undefined) rowValues[13] = updateData.deposit;
    if (updateData.outstandingBalance !== undefined) rowValues[14] = updateData.outstandingBalance;
    if (updateData.dueDate            !== undefined) rowValues[15] = updateData.dueDate;
    if (updateData.paymentMethod      !== undefined) rowValues[16] = updateData.paymentMethod;
    if (updateData.invNo)                            rowValues[17] = updateData.invNo;
    if (updateData.taxNo1)                           rowValues[18] = updateData.taxNo1;
    if (updateData.taxNo2)                           rowValues[19] = updateData.taxNo2;
    if (updateData.checkDetail1       !== undefined) rowValues[23] = updateData.checkDetail1;
    if (updateData.checkDetail2       !== undefined) rowValues[24] = updateData.checkDetail2;
    if (updateData.docToPrint)                       rowValues[28] = updateData.docToPrint;
    if (updateData.nextStatus)                       rowValues[29] = updateData.nextStatus;
    if (dateColToUpdate > 0 && payload.docDate)      rowValues[dateColToUpdate - 1] = payload.docDate;

    rowRange.setValues([rowValues]);   // 1 API call แทน 13 ครั้ง

    SpreadsheetApp.flush();

    // 🌐 ยิง API ระบบบัญชี
    let isPayment = false, isFirstPayment = false, accNet = 0;
    let accountingApiWarning = "";

    if (action === 'DEPOSIT_AND_SEND') {
      isPayment = true; isFirstPayment = true;
      accNet    = Number(payload.amount) || 0;
    } else if (action === 'FULL_PAYMENT_AND_SEND' || action === 'FULL_PAYMENT_LATER') {
      isPayment = true; isFirstPayment = true;
      accNet    = outstandingBalance;
    } else if (action === 'PAY_BALANCE') {
      isPayment = true; isFirstPayment = false;
      accNet    = outstandingBalance;
    }

    if (isPayment && accNet >= 0) {
      const custId  = data[rowIndex-1][1];
      const custMap = buildCustMap(ss);
      const cust    = custMap[custId ? custId.toString() : ''] || {};

      const accWhtRate = Number(data[rowIndex-1][25]) || 0;
      const accPreVat  = accWhtRate > 0 ? accNet / (1 + 0.07 - accWhtRate / 100) : accNet / 1.07;
      const accVat     = accPreVat * 0.07;
      const accWht     = accPreVat * (accWhtRate / 100);
      let accBase = 0, accDiscount = 0;

      if (action === 'FULL_PAYMENT_AND_SEND' || action === 'FULL_PAYMENT_LATER') {
        accBase     = Number(data[rowIndex-1][6]) || 0;
        accDiscount = Number(data[rowIndex-1][7]) || 0;
      } else {
        accBase     = accPreVat;
        accDiscount = 0;
      }

      const itemsArray = [];
      if (isFirstPayment) {
        const sData     = salesSheet.getDataRange().getValues();
        const targetRef = data[rowIndex-1][11] || quNo;
        for (let s = 1; s < sData.length; s++) {
          if (sData[s][3] === quNo || sData[s][3] === targetRef) {
            const iQty   = Number(sData[s][5]);
            const iPrice = Number(sData[s][6]);
            itemsArray.push({
              itemName:   sData[s][4].toString(),
              quantity:   iQty,
              inVat:      Math.round(iPrice * 1.07 * 100) / 100,
              exVat:      iPrice,
              totalPrice: Math.round(iPrice * iQty * 100) / 100,
            });
          }
        }
      }

      const taxDocNo = updateData.taxNo2 || updateData.taxNo1 || updateData.invNo
        || data[rowIndex-1][19] || data[rowIndex-1][18] || data[rowIndex-1][17] || "-";

      // 🔑 idempotencyKey สำหรับแอปบัญชี (blueprint section 2.1)
      // ใช้ orderNo เป็น base (unique 1:1 ต่อ order ทั้งระบบ)
      // PAY_BALANCE ใช้ suffix "-balance" เพราะเป็น transaction คนละครั้งกับเงินมัดจำ
      // ⚠️ ปัจจุบันรองรับ 2 transactions/order (deposit + balance)
      //   ถ้าเพิ่ม action ในอนาคต (เช่น partial payment ครั้งที่ 3+) ต้องคิด suffix ใหม่
      const orderRefForKey = data[rowIndex-1][11] || quNo;
      const accIdempotencyKey = action === 'PAY_BALANCE'
        ? `${orderRefForKey}-balance`
        : orderRefForKey;

      const accPayload = {
        token:                cfg.token,
        idempotencyKey:       accIdempotencyKey,
        accountType:          "กสิกร insep",
        category:             data[rowIndex-1][30] || "รายได้จากการขาย",
        contactName:          data[rowIndex-1][2],
        taxId:                cust.taxId  || '',
        branch:               cust.branch || 'สำนักงานใหญ่',
        address:              cust.address || '',
        description:          `อ้างอิง QU: ${quNo}${payload.method ? ` (${payload.method})` : ''}`,
        baseAmount:           Math.round(accBase     * 100) / 100,
        discount:             Math.round(accDiscount * 100) / 100,
        amountAfterDiscount:  Math.round(accPreVat   * 100) / 100,
        vatAmount:            Math.round(accVat      * 100) / 100,
        whtRate:              accWhtRate,
        whtAmount:            Math.round(accWht      * 100) / 100,
        netAmount:            accNet,
        taxInvoiceNo:         taxDocNo,
        taxInvoiceDate:       payload.docDate || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"),
        items:                itemsArray,
      };

      // 🔁 Background sync: เขียนงานลงคิว acc_sync_queue แทนการยิง API ตรง
      // → คืน success ให้หน้าจอทันที (ไม่รอ network) · trigger processAccSyncQueue ยิงบัญชีทีหลัง
      // idempotencyKey เดิม → retry ปลอดภัย · แอปบัญชีไม่ต้องแก้ (payload เดิม)
      try {
        enqueueAccSync_(ss, accPayload, {
          quNo:         quNo,
          customerName: data[rowIndex-1][2],
          netAmount:    accNet,
        });
      } catch (err) {
        // เขียนคิวไม่สำเร็จ = ออเดอร์บันทึกแล้วแต่ยังไม่เข้าคิวบัญชี → แจ้ง user ให้ยิงเองในหน้าคิว
        console.error("Enqueue Acc Sync Error:", err);
        accountingApiWarning = "[บันทึกออเดอร์แล้ว แต่ยังไม่เข้าคิว sync บัญชี — โปรดตรวจหน้าคิว]";
      }
    }

    // 📲 LINE 2.2 — แจ้งรับชำระเงิน (เฉพาะ action ที่มีการรับเงิน)
    if (isPayment && accNet >= 0) {
      try {
        const actionLabel = action === 'DEPOSIT_AND_SEND'  ? 'มัดจำ'
                          : action === 'PAY_BALANCE'        ? 'ชำระยอดค้าง'
                          : 'ชำระเต็ม';
        const amtFmt  = accNet.toLocaleString('th-TH', { minimumFractionDigits: 0 });
        const custName = data[rowIndex-1][2] || '';
        const orderRef = data[rowIndex-1][11] || quNo;

        // ยอดคงค้างหลังอัปเดต (0 ถ้าปิดการขาย)
        const remainingBalance = updateData.outstandingBalance !== undefined
          ? updateData.outstandingBalance
          : Number(data[rowIndex-1][14]) || 0;

        let msg = `💰 รับชำระเงิน\n[${orderRef}] ${custName}\n${actionLabel} ฿${amtFmt}`;
        if (remainingBalance > 0) {
          msg += `\nคงค้าง ฿${remainingBalance.toLocaleString('th-TH', { minimumFractionDigits: 0 })}`;
        }
        sendLineNotification(msg);
      } catch (_) {}
    }

    // คืน order ที่อัปเดตแล้ว (จาก rowValues ที่เพิ่งเขียนลง sheet)
    // → frontend patch in-place ใน b2bOrders ได้เลย ไม่ต้อง reload ทั้งก้อน
    return {
      success:    true,
      newStatus,
      apiWarning: accountingApiWarning,
      order:      mapRowToB2BOrder(rowValues),
    };
  } catch (e) { throw new Error(e.message); }
  finally { lock.releaseLock(); }
}

function getB2BOrderItems(quNo) {
  try {
    const cfg        = getConfig();
    const ss         = SpreadsheetApp.openByUrl(cfg.sheetUrl);
    const transSheet = ss.getSheetByName('btbtransaction');
    const transData  = transSheet.getDataRange().getValues();

    let targetRef = quNo;
    for (let i = 1; i < transData.length; i++) {
      if (transData[i][4] === quNo) { targetRef = transData[i][11] || quNo; break; }
    }

    const salesSheet = ss.getSheetByName('btbsales');
    if (!salesSheet) return [];

    const data  = salesSheet.getDataRange().getValues();
    const items = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][3] === quNo || data[i][3] === targetRef) {
        items.push({ name: data[i][4], qty: Number(data[i][5]), price: Number(data[i][6]) });
      }
    }
    return items;
  } catch (e) { throw new Error(e.message); }
}
