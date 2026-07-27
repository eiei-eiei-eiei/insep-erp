/**
 * lib/pdf/wht50 — เติมฟอร์ม 50ทวิ ลง AcroForm PDF (กลไก B: fill fields ด้วยชื่อ)
 * port verbatim จาก accounting/_js_wht_pdf.html — ⚠️ ห้ามแก้ชื่อ field/พิกัดจำนวนเงิน/ขนาดฟอนต์
 *   ต่างจากเดิมแค่: ใช้ pdf-lib จาก npm (แทน global) + รับ template/font เป็น bytes
 * template/font โหลดจาก Supabase Storage (getPdfAssetUrl signed URL) ฝั่ง caller
 */
import { PDFDocument, TextAlignment, type PDFPage, type PDFForm } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export const WHT_TEMPLATE_KEY = "wht/wh3_template.pdf";

export type Wht50Doc = {
  docNo: string;
  entInfo: { name?: string; address?: string; taxId?: string };
  payeeName?: string;
  payeeAddress?: string;
  payeeTaxId?: string;
  pndType: string; // 'ภ.ง.ด.3' / 'ภ.ง.ด.53' ฯลฯ
  seq: number | string; // 1-6 ประเภทเงินได้
  dateText?: string;
  amount: number;
  whtAmount: number;
  otherDesc?: string;
  bahtText?: string;
  issueDateISO?: string; // วันที่ออกหนังสือ = transaction_date
};

// ── MAPPING field (ยืนยันด้วย test-fill แล้ว ห้ามแก้) ──────────────────────────
const CFG = {
  header: { bookNo: "book_no", runNo: "run_no" },
  issuer: { tinComb: "id1", tin13: "tin1", name: "name1", addr: "add1" },
  payee: { tinComb: "id1_2", tin13: "tin1_2", name: "name2", addr: "add2" },
  item: "item",
  pndChk: {
    "ภ.ง.ด.1ก": "chk1",
    "ภ.ง.ด.1ก พิเศษ": "chk2",
    "ภ.ง.ด.2": "chk3",
    "ภ.ง.ด.3": "chk4",
    "ภ.ง.ด.2ก": "chk5",
    "ภ.ง.ด.3ก": "chk6",
    "ภ.ง.ด.53": "chk7",
  } as Record<string, string>,
  rows: {
    "1": { date: "date1", pay: "pay1.0", tax: "tax1.0", spec: null as string | null },
    "2": { date: "date2", pay: "pay1.1", tax: "tax1.1", spec: null as string | null },
    "3": { date: "date3", pay: "pay1.2", tax: "tax1.2", spec: null as string | null },
    "4": { date: "date4", pay: "pay1.3", tax: "tax1.3", spec: null as string | null },
    "5": { date: "date14.0", pay: "pay1.13.0", tax: "tax1.13.0", spec: null as string | null },
    "6": { date: null as string | null, pay: "pay1.14", tax: "tax1.14", spec: "spec3" },
  } as Record<string, { date: string | null; pay: string; tax: string; spec: string | null }>,
  totalWords: "total",
  payerType: { hak: "chk8", issueAll: "chk9", issueOnce: "chk10", other: "chk11", otherSpec: "spec4" },
  issueDate: { d: "date_pay", m: "month_pay", y: "year_pay" },
  clearButton: "clear data",
  amountCols: {
    pay: { dividerX: 474.8, rightX: 490.0 },
    tax: { dividerX: 546.1, rightX: 560.5 },
  },
};

const SIZE = { docNo: 13, nameAddr: 11, amount: 11, issueDate: 12 };
const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

/** 13 หลัก → "d dddd ddddd dd d" (คั่นกลุ่มด้วยช่องว่าง) */
function fmtTinComb(t: string): string {
  const s = String(t || "").replace(/\D/g, "");
  if (s.length !== 13) return s;
  return `${s[0]} ${s.slice(1, 5)} ${s.slice(5, 10)} ${s.slice(10, 12)} ${s[12]}`;
}

async function fillOne(outDoc: PDFDocument, data: Wht50Doc, templateBytes: Uint8Array, fontBytes: Uint8Array) {
  const tplDoc = await PDFDocument.load(templateBytes);
  tplDoc.registerFontkit(fontkit);
  const thai = await tplDoc.embedFont(fontBytes, { subset: true });
  const form: PDFForm = tplDoc.getForm();
  const page: PDFPage = tplDoc.getPage(0);

  try { form.removeField(form.getButton(CFG.clearButton)); } catch { /* ไม่มีก็ข้าม */ }

  const setText = (name: string | null, val: unknown, size?: number, align?: TextAlignment) => {
    if (name == null || val == null || val === "") return;
    try {
      const f = form.getTextField(name);
      f.setText(String(val));
      if (size) f.setFontSize(size);
      if (align !== undefined) f.setAlignment(align);
      f.updateAppearances(thai);
    } catch { /* ไม่พบ field ก็ข้าม */ }
  };
  const check = (name: string | null | undefined) => {
    if (!name) return;
    try { form.getCheckBox(name).check(); } catch { /* ไม่พบ checkbox ก็ข้าม */ }
  };
  // วาดจำนวนเงินแยก บาท|สตางค์ ลง page ตรง ๆ (กันหลักหน่วยตกกรอบทศนิยม)
  const drawAmount = (fieldName: string, value: number, col: { dividerX: number; rightX: number }, size: number) => {
    const v = parseFloat(String(value));
    if (Number.isNaN(v)) return;
    const baht = Math.floor(v).toLocaleString("en-US");
    const satang = Math.round((v - Math.floor(v)) * 100).toString().padStart(2, "0");
    let rect;
    try { rect = form.getTextField(fieldName).acroField.getWidgets()[0].getRectangle(); } catch { return; }
    const baseY = rect.y + (rect.height - size) / 2 + size * 0.18;
    const bw = thai.widthOfTextAtSize(baht, size);
    page.drawText(baht, { x: col.dividerX - 3 - bw, y: baseY, size, font: thai });
    const sw = thai.widthOfTextAtSize(satang, size);
    page.drawText(satang, { x: col.dividerX + ((col.rightX - col.dividerX) - sw) / 2, y: baseY, size, font: thai });
  };

  const issuer = data.entInfo || {};
  setText(CFG.header.runNo, data.docNo, SIZE.docNo);

  setText(CFG.issuer.name, issuer.name, SIZE.nameAddr);
  setText(CFG.issuer.addr, issuer.address, SIZE.nameAddr);
  setText(CFG.issuer.tinComb, fmtTinComb(issuer.taxId ?? ""));

  setText(CFG.payee.name, data.payeeName, SIZE.nameAddr);
  setText(CFG.payee.addr, data.payeeAddress, SIZE.nameAddr);
  setText(CFG.payee.tinComb, fmtTinComb(data.payeeTaxId ?? ""));

  check(CFG.pndChk[data.pndType]);

  const row = CFG.rows[String(data.seq)] || CFG.rows["6"];
  setText(row.date, data.dateText, SIZE.amount);
  drawAmount(row.pay, data.amount, CFG.amountCols.pay, SIZE.amount);
  drawAmount(row.tax, data.whtAmount, CFG.amountCols.tax, SIZE.amount);
  if (row.spec && data.otherDesc) setText(row.spec, data.otherDesc);

  setText(CFG.totalWords, data.bahtText);
  check(CFG.payerType.hak);

  const issueDt = data.issueDateISO ? new Date(data.issueDateISO) : new Date();
  if (!Number.isNaN(issueDt.getTime())) {
    setText(CFG.issueDate.d, issueDt.getDate(), SIZE.issueDate, TextAlignment.Center);
    setText(CFG.issueDate.m, TH_MONTHS[issueDt.getMonth()], SIZE.issueDate, TextAlignment.Center);
    setText(CFG.issueDate.y, issueDt.getFullYear() + 543, SIZE.issueDate, TextAlignment.Center);
  }

  form.flatten();
  const [outPage] = await outDoc.copyPages(tplDoc, [0]);
  outDoc.addPage(outPage);
}

/** สร้าง PDF 50ทวิ (หลายใบรวมไฟล์เดียว) — คืน bytes */
export async function buildWht50Pdf(list: Wht50Doc[], templateBytes: Uint8Array, fontBytes: Uint8Array): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  for (const d of list) await fillOne(out, d, templateBytes, fontBytes);
  return out.save();
}
