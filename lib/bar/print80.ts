/**
 * lib/bar/print80 — เรนเดอร์เอกสารบาร์ลงกระดาษความร้อน 80 มม. (D96)
 *
 * ★ ไฟล์นี้มีแต่ **หน้าตา** — เนื้อหาทั้งหมดมาจาก `receipt.ts` ที่มี golden B8 คุม
 *   (แยกกันเพราะเนื้อหาต้องเทสได้ ส่วนหน้าตาต้องดูด้วยตาบนกระดาษจริง — บทเรียน D94)
 *
 * ── เส้นทางพิมพ์ ──────────────────────────────────────────────────────────
 * เปิดหน้าต่างใหม่ → `window.print()` → ผู้ใช้เลือก **RawBT** ในกล่องพิมพ์ของ Android
 * RawBT รับ HTML แล้วส่งเข้าเครื่อง Xprinter XP-T80Q ทางบลูทูธ
 * ⇒ เราไม่ต้องเขียน ESC/POS สักไบต์ · ผู้ใช้เทสเส้นทางนี้ผ่านแล้ว
 *
 * ── 🪤 ข้อจำกัดของกระดาษความร้อนที่ต้องเผื่อไว้ ────────────────────────────
 * · 203 dpi · กระดาษ 80 มม. พิมพ์ได้จริง ~72 มม. ≈ 576 dot
 * · contrast ต่ำกว่าหมึกจริงมาก → ตัวเล็กและเส้นบางอ่านไม่ออก
 * · QR ต้องกว้าง ≥ 25 มม. + มี quiet zone ขาวรอบ ๆ ไม่งั้นสแกนไม่ติด
 * · `image-rendering: pixelated` — ปล่อยให้เบราว์เซอร์ปรับ antialiasing = ขอบเบลอ
 *
 * 🚩 **build/lint/test มองไม่เห็นเรื่องนี้เลย** ต้องพิมพ์จริงแล้วสแกนด้วยแอปธนาคารจริง
 */
import type { ReceiptDoc } from "./receipt";
import { paperMetrics, type BlockKey } from "./layout";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const money = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * CSS ของกระดาษ — ★ คิดจากขนาดที่ผู้ใช้เลือก (80 หรือ 58 มม.) ไม่ใช่ค่าตายตัวอีกแล้ว
 * 🚨 `size: <กว้าง> auto` — ความสูง `auto` เพราะกระดาษม้วนไม่มีขอบล่าง
 *    ใส่ความสูงตายตัวเมื่อไหร่ เครื่องจะเดินกระดาษเปล่ายาวเป็นเมตรทุกใบ
 */
export function receiptCss(paper: 80 | 58 = 80, fontLarge = false): string {
  const { printable, qr } = paperMetrics(paper);
  return `
@page { size: ${paper}mm auto; margin: 0; }
* { box-sizing: border-box; }
body {
  width: ${printable}mm; margin: 0 auto; padding: 3mm 0 6mm;
  font-family: "Sarabun", "TH Sarabun New", sans-serif;
  font-size: ${fontLarge ? 14 : 12}pt; line-height: 1.35; color: #000; background: #fff;
}
.c { text-align: center; }
.r { text-align: right; }
.b { font-weight: 700; }
.sm { font-size: 10pt; }
.title { font-size: 15pt; font-weight: 700; margin-bottom: 1mm; }
hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
table { width: 100%; border-collapse: collapse; }
td { vertical-align: top; padding: 0.4mm 0; }
.qty { width: 9mm; }
.amt { width: 20mm; text-align: right; white-space: nowrap; }
/* 🚨 QR ต้องคมและมีขอบขาว ไม่งั้นกล้องจับไม่ติดบนกระดาษความร้อน */
.qr { margin: 3mm auto 1mm; width: ${qr}mm; height: ${qr}mm; image-rendering: pixelated; display: block; }
.qrbox { background: #fff; padding: 3mm; display: inline-block; }
.stamp { border: 1px solid #000; padding: 1mm 2mm; display: inline-block; margin-top: 2mm; }
/* 🚨 โลโก้บนกระดาษความร้อนเป็นขาวดำล้วน 203dpi — ภาพสีเทาจะออกมาเป็นด่าง
   grayscale + contrast ช่วยได้ระดับหนึ่ง แต่ **ต้องพิมพ์จริงดูด้วยตา** */
.logo { max-width: ${Math.round(printable * 0.55)}mm; margin: 0 auto 1mm; display: block;
        filter: grayscale(1) contrast(2); image-rendering: pixelated; }
`;
}

/** ตารางส่วนผสมบนสลิป (ไม่ใช้ในเอกสารลูกค้า — เผื่อพิมพ์การ์ดสูตรติดหลังบาร์) */
function rows(doc: ReceiptDoc): string {
  return doc.lines
    .map(
      (l) => `<tr>
  <td class="qty">${l.qty}×</td>
  <td>${esc(l.name)}${l.comp ? ' <span class="sm">(แถม)</span>' : ""}</td>
  <td class="amt">${l.comp ? "—" : money(l.amount)}</td>
</tr>`,
    )
    .join("");
}

function totalsBlock(doc: ReceiptDoc): string {
  const t = doc.totals;
  const line = (label: string, v: string, bold = false) =>
    `<tr><td colspan="2"${bold ? ' class="b"' : ""}>${label}</td><td class="amt${bold ? " b" : ""}">${v}</td></tr>`;
  let out = "";
  if (t.lineDiscountTotal > 0) out += line("ส่วนลดรายการ", "-" + money(t.lineDiscountTotal));
  out += line("รวม", money(t.subTotal));
  if (t.discount > 0) {
    // ★ ป้าย % เป็นแค่คำอธิบาย — ตัวเงินยังเป็น `t.discount` ที่คิดมาแล้วเสมอ
    out += line("ส่วนลดท้ายบิล" + (doc.discountLabel ? ` ${doc.discountLabel}` : ""), "-" + money(t.discount));
  }
  if (t.rounding !== 0) out += line("ปัดเศษ", (t.rounding > 0 ? "+" : "") + money(t.rounding));
  out += line("ยอดสุทธิ", money(t.grandTotal), true);
  /**
   * แยกภาษีใต้ยอดสุทธิ — 🚨 **ยอดรวมต้องเท่ากับเงินที่รับเป๊ะ**
   *    `vatFromGross()` การันตี base + vat = grandTotal อยู่แล้ว (golden B11)
   *    ห้ามคิดสูตรซ้ำที่นี่ ไม่งั้นเลขบนกระดาษกับเลขในบัญชีจะต่างกันเป็นสตางค์
   */
  if (doc.vat) {
    out += line("ยอดก่อนภาษี", money(doc.vat.base));
    out += line(doc.vatLabel ?? "ภาษีมูลค่าเพิ่ม", money(doc.vat.vat));
  }
  return out;
}

/**
 * แปลง payload → SVG ของ QR
 * 🔴 โหลด lib แบบ `await import()` — ไม่งั้นทุกคนที่เปิดแอปโหลดตามไปด้วย (บทเรียน D61/D82)
 */
export async function qrSvg(payload: string): Promise<string> {
  const { default: qrcode } = await import("qrcode-generator");
  // typeNumber 0 = ให้ lib เลือกขนาดเล็กสุดที่พอ · 'M' = ระดับกู้คืน 15%
  // 🪤 ระดับ 'L' เล็กกว่าก็จริง แต่กระดาษความร้อนมีรอยด่างง่าย — 'M' คุ้มกว่า
  const qr = qrcode(0, "M");
  qr.addData(payload);
  qr.make();
  // margin 4 โมดูล = quiet zone ตามสเปก · ขาดแล้วสแกนไม่ติด
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

/** ประกอบ HTML ของเอกสาร 1 ใบ (ยังไม่พิมพ์ — แยกไว้ให้เทส/พรีวิวเรียกได้)
 *
 * ── เรนเดอร์ตาม **ผังที่ผู้ใช้จัดเอง** (D96 เฟส G) ──────────────────────────
 * 🚨 วนตาม `doc.layout.order` **ไม่ใช่ลำดับตายตัวในฟังก์ชันนี้**
 *    เพิ่มบล็อกใหม่ต้องเติมใน `BLOCK_KEYS` (lib/bar/layout.ts) แล้ว TS จะบังคับให้เขียนตัวเรนเดอร์
 *    ⇒ บล็อกใหม่ **ไม่มีทางหายจากกระดาษเงียบ ๆ** (ตระกูล D84)
 * 🚨 บล็อกที่ผู้ใช้ปิด/กฎหมายบังคับ ตัดสินที่ `resolveLayout()` **ที่เดียว** ไม่ตัดสินซ้ำที่นี่
 */
export function receiptHtml(doc: ReceiptDoc, qrMarkup?: string | null): string {
  const s = doc.seller;
  const L = doc.layout;
  const line = (cls: string, html: string) => `<div class="${cls}">${html}</div>`;

  /** 🚨 `Record<BlockKey, …>` — เพิ่มบล็อกแล้วลืมเขียนตัวเรนเดอร์ = build ไม่ผ่าน */
  const render: Record<BlockKey, () => string> = {
    logo: () =>
      doc.logoUrl
        ? `<div class="c"><img class="logo" src="${esc(doc.logoUrl)}" alt=""></div>`
        : "",
    shopName: () =>
      `<div class="c">${line("title", esc(doc.title))}${line("b", esc(s.name))}</div>`,
    sellerAddress: () => (s.address ? line("c sm", esc(s.address)) : ""),
    sellerTaxId: () =>
      s.taxId ? line("c sm", `เลขประจำตัวผู้เสียภาษี ${esc(s.taxId)}`) : "",
    sellerPhone: () => (s.phone ? line("c sm", `โทร ${esc(s.phone)}`) : ""),
    headText: () => (doc.headText ? line("c sm", esc(doc.headText)) : ""),
    docNo: () => line("sm", `เลขที่ ${esc(doc.docNo)}`),
    printedAt: () => line("sm", `พิมพ์ ${esc(doc.printedAt)}`),
    buyer: () =>
      doc.buyer
        ? `<hr>${line("sm b", "ลูกค้า")}${line("sm", esc(doc.buyer.name))}` +
          (doc.buyer.address ? line("sm", esc(doc.buyer.address)) : "") +
          (doc.buyer.taxId ? line("sm", `เลขประจำตัวผู้เสียภาษี ${esc(doc.buyer.taxId)}`) : "")
        : "",
    // ★ ป้ายช่องทาง/งาน — ผู้ใช้เคยสั่งว่าห้ามพิมพ์ จึง **เริ่มมาในสภาพปิด**
    //   ตอนนี้เปิดเองได้แล้ว แต่ต้องเป็นการตัดสินใจของเขา ไม่ใช่ของเรา
    channel: () => (doc.channel ? line("c sm", esc(doc.channel)) : ""),
    lines: () => `<hr><table>${rows(doc)}</table>`,
    totals: () => `<hr><table>${totalsBlock(doc)}</table>`,
    // ★ VAT ถูกพิมพ์รวมอยู่ในตารางยอดแล้ว (ต้องอยู่ติดยอดสุทธิเสมอ) — บล็อกนี้จึงไม่วาดซ้ำ
    //   แต่ยังต้องมีคีย์อยู่ เพื่อให้ผังล็อกมันไว้ไม่ให้ปิดได้เมื่อจด VAT
    vat: () => "",
    compSummary: () =>
      doc.totals.compCount > 0 ? line("sm", `มีของแถม ${doc.totals.compCount} รายการ`) : "",
    qr: () =>
      doc.hasQr && qrMarkup
        ? `<hr><div class="c">
             <div class="b">สแกนเพื่อชำระเงิน</div>
             <div class="sm">พร้อมเพย์ · ยอด ${money(doc.totals.grandTotal)} บาท</div>
             <div class="qrbox"><div class="qr">${qrMarkup}</div></div>
             <div class="sm">ยอดถูกกำหนดไว้ในคิวอาร์แล้ว</div>
           </div>`
        : "",
    paidStamp: () =>
      doc.paidStamp ? `<div class="c"><span class="stamp b">${esc(doc.paidStamp)}</span></div>` : "",
    footer: () => (doc.footer ? `<hr>${line("c sm", esc(doc.footer))}` : ""),
  };

  return L.order
    .filter((k) => L.on(k))
    .map((k) => render[k]())
    .filter(Boolean)
    .join("\n");
}

/**
 * เปิดหน้าต่างพิมพ์
 *
 * 🪤 ต้อง `document.write` ลงหน้าต่างใหม่ ไม่ใช่ print หน้าปัจจุบัน —
 *    หน้าแอปมี CSS ของตัวเองเต็มไปหมด แล้วกระดาษจะออกมาเป็นหน้าเว็บย่อส่วน
 * 🪤 เรียก `print()` หลัง `onload` — เรียกก่อนฟอนต์โหลดเสร็จ RawBT จะได้หน้าเปล่า
 */
export function openPrint80(html: string, title = "เอกสาร", css = receiptCss()) {
  const w = window.open("", "_blank", "width=380,height=700");
  if (!w) return false;
  w.document.write(
    `<!DOCTYPE html><html lang="th"><head><meta charset="utf-8">` +
      `<title>${esc(title)}</title><style>${css}</style></head><body>${html}</body></html>`,
  );
  w.document.close();
  w.onload = () => {
    w.focus();
    w.print();
  };
  return true;
}
