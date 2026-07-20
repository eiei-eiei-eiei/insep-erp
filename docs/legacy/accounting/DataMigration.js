function migrateOldData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const oldSheet = ss.getSheetByName("OldData");
  const transSheet = ss.getSheetByName("Transactions");
  const itemsSheet = ss.getSheetByName("Transaction_Items");

  if (!oldSheet || !transSheet || !itemsSheet) {
    throw new Error("ไม่พบ Sheet ที่ต้องการ กรุณาเช็คชื่อ OldData, Transactions, หรือ Transaction_Items อีกครั้ง");
  }

  const oldData = oldSheet.getDataRange().getValues();
  const headers = oldData[0];
  const rows = oldData.slice(1);

  // ฟังก์ชันช่วยหาลำดับคอลัมน์จากชื่อหัวตาราง
  const getIdx = (name) => headers.indexOf(name);

  // ฟังก์ชันช่วยแมพค่าจาก wtw เป็น Type และ Account_Type
  function mapWtw(wtwCode) {
    const code = (wtwCode || "").toString().trim().toUpperCase();
    if (code === "TTC") return { type: "รายรับ", accType: "บัญชีบริษัท" };
    if (code === "CTT" || code === "BTT") return { type: "รายจ่าย", accType: "บัญชีบริษัท" };
    if (code === "OTT") return { type: "รายจ่าย", accType: "บัญชีนอก" };
    if (code === "CTB" || code === "TTB") return { type: "รายรับ", accType: "บัญชีบริษัท" };
    if (code === "TTO") return { type: "รายรับ", accType: "บัญชีนอก" };
    if (code === "OOO" || code === "MTT") return { type: "", accType: "" };
    return { type: "", accType: "" }; // Default fallback
  }

  // 1. จัดกลุ่มข้อมูลตามเลขบิล (Bill NO.)
  let groupedBills = {};

  rows.forEach(row => {
    let billNo = row[getIdx("Bill NO.")];
    let wtw = (row[getIdx("wtw")] || "").toString().trim().toUpperCase();

    // กรองขยะ: ถ้าไม่มีเลขบิล หรือ wtw เป็น KMD, YKK ให้ข้ามบรรทัดนี้ไปเลย (ไม่บันทึก)
    if (!billNo || wtw === "KMD" || wtw === "YKK") return;

    if (!groupedBills[billNo]) {
      groupedBills[billNo] = [];
    }
    
    // เก็บข้อมูลทุกคอลัมน์ของบรรทัดนี้ลงในกลุ่ม
    let rowData = {};
    for(let c=0; c < headers.length; c++) {
      rowData[headers[c]] = row[c];
    }
    groupedBills[billNo].push(rowData);
  });

  let transactionsOutput = [];
  let itemsOutput = [];
  const timestamp = new Date();
  const yyyyMMdd = Utilities.formatDate(timestamp, "GMT+7", "yyyyMMdd");

  // 2. ประมวลผลแยกตามบิล
  for (let billNo in groupedBills) {
    let billRows = groupedBills[billNo];
    
    // เช็คว่าบิลนี้มีแถวที่เป็น MMM หรือไม่
    let hasMMM = billRows.some(r => r["wtw"].toString().toUpperCase() === "MMM");
    
    let headerRow, itemRows;

    if (hasMMM) {
      // เคส A: บิลพิเศษ (มี MMM)
      headerRow = billRows.find(r => r["wtw"].toString().toUpperCase() !== "MMM");
      itemRows = billRows.filter(r => r["wtw"].toString().toUpperCase() === "MMM");
      
      // กันเหนียวกรณีข้อมูลแปลกๆ (มี MMM แต่ไม่มีสรุป)
      if (!headerRow && itemRows.length > 0) headerRow = itemRows[0]; 
    } else {
      // เคส B: บิลปกติ (ไม่มี MMM)
      headerRow = billRows[0]; // ใช้บรรทัดแรกเป็นหัวบิล
      itemRows = billRows;     // ทุกบรรทัดเป็นรายการสินค้า
    }

    // ข้ามถ้าไม่มีข้อมูลให้ทำต่อ (Safety check)
    if (!headerRow || itemRows.length === 0) continue;

    // --- สร้างหัวบิล (Transaction) ---
    let txId = `TR-${yyyyMMdd}-${Math.floor(100000 + Math.random() * 900000)}`;
    let mapping = mapWtw(headerRow["wtw"]);
    
    let totalBase = 0, totalVat = 0, totalNet = 0;

    // --- สร้างรายการสินค้า (Transaction Items) ---
    itemRows.forEach((item, i) => {
      let itemId = `${txId}-${(i + 1).toString().padStart(2, "0")}`;
      
      // โลจิคเรื่องราคา
      let priceExvat = Number(item["price"] || 0); // Exvat คือ price เลย
      let priceInvat = priceExvat * 1.07;          // Invat คือ price * 1.07 เสมอ
      let qty = Number(item["qty"] || 0);
      
      // ดึงยอดรวมจากบรรทัดของไอเท็มนั้นๆ (อิงตามยอดเดิมของคุณ)
      let itemTotalSumprice = Number(item["sumprice"] || (priceExvat * qty));
      
      itemsOutput.push([
        itemId, txId, item["menu"], qty, priceInvat, priceExvat, itemTotalSumprice
      ]);

      // สะสมยอดเข้าหัวบิล
      totalBase += itemTotalSumprice;
      totalVat += Number(item["vat"] || 0);
      totalNet += Number(item["total"] || itemTotalSumprice);
    });

    // ดึงค่ามาจัดเตรียมลงตาราง Transactions
    // ลำดับคอลัมน์: ID, Timestamp, Date, Type, Account_Type, Category, Contact_Name, Description, Base_Amount, Discount, Amount_After_Disc, VAT, WHT_R, WHT_A, Net_Amount, Tax_No, Tax_Date, URL, Status
    transactionsOutput.push([
      txId, timestamp, headerRow["date"], mapping.type, mapping.accType, headerRow["Sub Cat"], headerRow["sub"], headerRow["Bill Name"],
      totalBase, 0, totalBase, totalVat, 0, 0, totalNet, "", "", "", "ปกติ"
    ]);
  }

  // 3. เขียนข้อมูลลง Sheet ใหม่
  if (transactionsOutput.length > 0) {
    transSheet.getRange(transSheet.getLastRow() + 1, 1, transactionsOutput.length, 19).setValues(transactionsOutput);
  }
  if (itemsOutput.length > 0) {
    itemsSheet.getRange(itemsSheet.getLastRow() + 1, 1, itemsOutput.length, 7).setValues(itemsOutput);
  }

  SpreadsheetApp.getUi().alert("สุดยอดครับ! ย้ายข้อมูลเสร็จสมบูรณ์ จำนวนทั้งหมด " + transactionsOutput.length + " บิล");
}