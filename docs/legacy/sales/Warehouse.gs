// ============================================================
// 🏢 WAREHOUSE (orders รอจัดส่ง + ตัดสต็อก)
// ============================================================


function getPendingWarehouseOrders() {
  try {
    const cfg = getConfig();
    const ss = SpreadsheetApp.openByUrl(cfg.sheetUrl);
    const sheet     = ss.getSheetByName('btbtransaction');
    const salesSheet = ss.getSheetByName('btbsales');
    if (!sheet || !salesSheet) return [];

    const custMap = buildCustMap(ss);

    const salesData = salesSheet.getDataRange().getValues();
    const itemsMap = {};
    for (let i = 1; i < salesData.length; i++) {
      const qNo = salesData[i][3];
      if (!qNo) continue;
      if (!itemsMap[qNo]) itemsMap[qNo] = [];
      itemsMap[qNo].push({ name: salesData[i][4], qty: Number(salesData[i][5]), price: Number(salesData[i][6]) });
    }

    const data = sheet.getDataRange().getValues();
    const orders = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][12] !== 'รอคลังจัดส่ง' || !data[i][4]) continue;

      const quNo  = data[i][4].toString();
      const cId   = data[i][1] ? data[i][1].toString() : '';
      const cust  = custMap[cId] || {};
      const orderDate = data[i][0] instanceof Date ? data[i][0] : new Date(data[i][0]);

      orders.push({
        timestamp:       Utilities.formatDate(orderDate, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"),
        documentDate:    Utilities.formatDate(orderDate, Session.getScriptTimeZone(), "dd/MM/yyyy"),
        quNo,
        orderNo:         data[i][11] ? data[i][11].toString() : '',
        customerName:    data[i][2] || '',
        customerAddress: cust.address || '',
        customerTaxId:   cust.taxId   || '',
        customerBranch:  cust.branch  || '',
        subTotal:        Number(data[i][6])  || 0,
        discount:        Number(data[i][7])  || 0,
        subDiscount:     Number(data[i][8])  || 0,
        vatAmount:       Number(data[i][9])  || 0,
        grandTotal:      Number(data[i][10]) || 0,
        deposit:         Number(data[i][13]) || 0,
        outstandingBalance: Number(data[i][14]) || 0,
        paymentMethod:   data[i][16] || '',
        invNo:           data[i][17] || '',
        taxNo1:          data[i][18] || '',
        taxNo2:          data[i][19] || '',
        chequeDetails:   data[i][23] || data[i][24] || '',
        whtPercent:      Number(data[i][25]) || 0,
        whtAmount:       Number(data[i][26]) || 0,
        netPayable:      Number(data[i][27]) || 0,
        docToPrint:      data[i][28] || '',
        nextStatus:      data[i][29] || '',
        items:           itemsMap[quNo] || [],
      });
    }
    return orders;
  } catch (e) { throw new Error("Load WH Error: " + e.message); }
}

function confirmFulfillmentAndDeductStock(quNo, userName) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const cfg = getConfig();
    const ss = SpreadsheetApp.openByUrl(cfg.sheetUrl);
    const transSheet    = ss.getSheetByName('btbtransaction');
    const salesSheet    = ss.getSheetByName('btbsales');
    const menuSheet     = ss.getSheetByName('menu_b2b');
    const curStockSheet = ss.getSheetByName('curstock');
    const stockMoveSheet = ss.getSheetByName('stockmove');

    if (!curStockSheet || !stockMoveSheet) throw new Error("ไม่พบชีท curstock หรือ stockmove ในระบบ");

    // B.1.3: buildCustMap ครั้งเดียว ใช้ร่วมทั้งฟังก์ชัน
    // (ก่อนหน้าเคย call 2 ครั้ง: ต้น function + ใน liquor API block)
    const custMap = buildCustMap(ss);

    const transData = transSheet.getDataRange().getValues();
    let rowIndex = -1, nextStatus = "ส่งของแล้ว", orderNo = quNo, customerName = "", customerId = "";

    for (let i = 1; i < transData.length; i++) {
      if (transData[i][4] === quNo && transData[i][12] === 'รอคลังจัดส่ง') {
        rowIndex     = i + 1;
        orderNo      = transData[i][11] || quNo;
        nextStatus   = transData[i][29] || "ส่งของแล้ว";
        customerName = transData[i][2]  || "";
        customerId   = transData[i][1] ? transData[i][1].toString() : "";
        break;
      }
    }
    if (rowIndex === -1) throw new Error("ออเดอร์นี้ถูกจัดส่งไปแล้ว หรือไม่พบข้อมูลในระบบ");

    const salesData = salesSheet.getDataRange().getValues();
    const itemsToDeduct = [];
    for (let i = 1; i < salesData.length; i++) {
      if (salesData[i][3] === quNo) itemsToDeduct.push({ name: salesData[i][4], qty: Number(salesData[i][5]) });
    }

    const menuData = menuSheet.getDataRange().getValues();
    const itemMap = {};
    for (let i = 1; i < menuData.length; i++) {
      if (!menuData[i][0]) continue;
      itemMap[menuData[i][0].toString().trim()] = {
        category:   menuData[i][2] ? menuData[i][2].toString().trim() : '',
        code:       menuData[i][3] ? menuData[i][3].toString().trim() : '',
        multiplier: Number(menuData[i][4]) || 1,
      };
    }

    const stockData = curStockSheet.getDataRange().getValues();
    const stockMoveRecords = [];
    const timestamp = new Date();
    const liquorItems   = [];
    const stockSummary  = [];   // 📲 เก็บไว้สำหรับ LINE 2.3+2.4

    for (let i = 0; i < itemsToDeduct.length; i++) {
      const orderItem = itemsToDeduct[i];
      const mapping   = itemMap[orderItem.name.trim()];
      if (!mapping || !mapping.code) continue;

      const realQtyToDeduct = orderItem.qty * mapping.multiplier;
      let foundStockIndex = -1, intStock = 0, itemNameWH = "";

      for (let j = 1; j < stockData.length; j++) {
        if (stockData[j][0] === mapping.code) {
          foundStockIndex = j;
          itemNameWH = stockData[j][1];
          intStock   = Number(stockData[j][4]) || 0;
          break;
        }
      }

      if (foundStockIndex !== -1) {
        const sumStock = intStock - realQtyToDeduct;
        stockData[foundStockIndex][4] = sumStock;
        stockMoveRecords.push([timestamp, mapping.code, itemNameWH, intStock, "OUT", realQtyToDeduct, orderNo, sumStock, userName, "จัดส่งออเดอร์ B2B"]);

        // เก็บ unit จาก curstock column D (index 3)
        const unit = stockData[foundStockIndex][3] ? stockData[foundStockIndex][3].toString() : '';
        stockSummary.push({ name: itemNameWH || orderItem.name, remaining: sumStock, unit });
      }

      // แยกออกมานอก curstock block — สินค้าสุราต้องยิง API ผลิตเสมอ
      // ไม่ขึ้นกับว่ามีใน curstock หรือไม่ (curstock อาจไม่มีสินค้าใหม่ที่เพิ่งผลิต)
      if (mapping.category === "สุรา") {
        const cleanProductId = String(mapping.code).trim();
        const cleanAmount    = Number(realQtyToDeduct);
        if (!cleanProductId) {
          console.error(`[API สุรา] ⚠️ ไม่ส่งสินค้า ${orderItem.name} เพราะรหัสสินค้า (คอลัมน์ D) ว่างเปล่า`);
        } else if (cleanAmount <= 0 || isNaN(cleanAmount)) {
          console.error(`[API สุรา] ⚠️ ไม่ส่งสินค้า ${orderItem.name} เพราะจำนวนจัดส่งเป็น 0`);
        } else {
          liquorItems.push({ productId: cleanProductId, amount: cleanAmount });
        }
      }
    }

    if (stockData.length > 1) curStockSheet.getRange(1, 1, stockData.length, stockData[0].length).setValues(stockData);
    if (stockMoveRecords.length > 0) stockMoveSheet.getRange(stockMoveSheet.getLastRow() + 1, 1, stockMoveRecords.length, 10).setValues(stockMoveRecords);

    transSheet.getRange(rowIndex, 13).setValue(nextStatus);
    SpreadsheetApp.flush();

    // 📲 LINE 2.3 — แจ้งจัดส่ง + 2.4 แสดงคงเหลือของทุกสินค้าในออเดอร์
    try {
      let msg = `📦 ส่งของแล้ว\n[${orderNo}] ${customerName}\n${stockSummary.length} รายการ`;
      if (stockSummary.length > 0) {
        msg += '\n—';
        stockSummary.forEach(s => {
          const rem = s.remaining.toLocaleString('th-TH', { minimumFractionDigits: 0 });
          msg += `\n• ${s.name}: คงเหลือ ${rem}${s.unit ? ' ' + s.unit : ''}`;
        });
      }
      sendLineNotification(msg);
    } catch (_) {}

    // 🌐 ยิง API ระบบผลิตสุรา
    let liquorApiWarning = "";
    if (liquorItems.length > 0) {
      try {
        // ✅ ใช้ flag isExport จาก custdata แทน regex ภาษาไทย (blueprint ข้อ 4)
        // แก้ปัญหา: ลูกค้าไทยชื่อภาษาอังกฤษ (เช่น "Kasikorn PLC") ถูกจัดเป็นส่งออกผิด → ผิดภาษีสรรพสามิต
        // custMap ถูก cache ไว้ตั้งแต่ต้นฟังก์ชัน — ไม่ต้อง buildCustMap ซ้ำ (B.1.3)
        const cust      = custMap[customerId] || {};
        const transTypeStr = cust.isExport ? "จำหน่ายต่างประเทศ" : "จ่าย";
        const todayStr     = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

        const liquorPayload = {
          token:   cfg.token,
          action:  "SELL_PRODUCT",
          payload: {
            // 🔑 idempotencyKey (blueprint ข้อ 5): ใช้ orderNo เพราะ unique ทั่วระบบ
            // + 1 orderNo = 1 fulfillment ตาม business rule
            // ฝั่งแอปผลิตต้อง implement การตรวจ key นี้ก่อนบันทึก (TODO ในแชทแอปผลิต)
            idempotencyKey: orderNo,
            date:           todayStr,
            transType:      transTypeStr,
            note:           `ลูกค้า: ${customerName} (${orderNo})`,
            items:          liquorItems,
          },
        };

        console.log("🚀 Payload ที่ส่งไป API สุรา: " + JSON.stringify(liquorPayload, null, 2));

        const liquorResponse = UrlFetchApp.fetch(cfg.liquorApiUrl, {
          method:             "post",
          contentType:        "application/json",
          payload:            JSON.stringify(liquorPayload),
          muteHttpExceptions: true,
        });

        const resCode = liquorResponse.getResponseCode();
        const resText = liquorResponse.getContentText();

        if (resCode === 200 && !resText.includes('"success":false')) {
          console.log(`✅ ส่ง API สุราสำเร็จ! | Response: ${resText}`);
          // ข้อ 5: SELL_PRODUCT สำเร็จ → แอปผลิต -balance แล้ว → invalidate cache
          // ครั้งถัดไปที่โหลด menu จะดึง balance ใหม่จาก Stock_Product
          invalidateStockCache_();
        } else {
          console.error(`❌ ส่ง API สุราถูกตีกลับ! | Status: ${resCode} | Response: ${resText}`);
          liquorApiWarning = `[API สุราตีกลับ: ${resText.substring(0, 50)}]`;
          // ไม่ invalidate cache เพราะ balance ที่ผลิตยังไม่เปลี่ยน
        }
      } catch (err) {
        console.error("Liquor API Sync Error (Network issue):", err);
        liquorApiWarning = "[ไม่สามารถเชื่อมต่อ API สุราได้]";
      }
    }

    return { success: true, newStatus: nextStatus, apiWarning: liquorApiWarning };
  } catch (error) { return { success: false, message: error.message }; }
  finally { lock.releaseLock(); }
}
