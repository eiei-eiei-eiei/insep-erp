import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BLOCK_KEYS, BLOCK_LABEL, DEFAULT_ORDER, TOKENS,
  defaultLayout, fillTokens, moveBlock, paperMetrics, resolveLayout,
  type BlockKey,
  type ReceiptLayout,
  filledButOff,
  TEXT_BLOCKS,
} from "./layout";
import { buildReceipt } from "./receipt";
import { barTotals } from "./totals";
import { receiptHtml, receiptCss } from "./print80";

/** golden **B14** — ผู้ใช้จัดหน้าตาบิลเอง (D96 ภาค 2 เฟส G) */

const NO_VAT = { isVat: false };
const VAT = { isVat: true };

describe("resolveLayout — ทนของแปลกได้เสมอ (golden B14)", () => {
  it("ไม่เคยตั้งค่า → ได้ลำดับปริยายครบทุกบล็อก", () => {
    const l = resolveLayout(null, NO_VAT);
    expect(l.order).toEqual(DEFAULT_ORDER);
  });

  /**
   * 🚩 **ข้อสำคัญที่สุดของชุดนี้** — ค่าที่บันทึกไว้เป็นของเวอร์ชันเก่า
   *    ถ้าเรนเดอร์ตามลิสต์นั้นตรง ๆ บล็อกที่เพิ่มทีหลังจะไม่โผล่บนกระดาษเลย
   *    โดยไม่มี error อะไรเลย (ตระกูล D84)
   */
  it("🚨 บล็อกที่เพิ่มทีหลังต้องถูกเติมกลับ ไม่ใช่หายจากกระดาษ", () => {
    const old: BlockKey[] = ["shopName", "lines", "totals"];
    const l = resolveLayout({ order: old }, NO_VAT);
    expect(l.order.slice(0, 3)).toEqual(old);
    for (const k of BLOCK_KEYS) {
      expect(l.order, `บล็อก ${k} หายจากผัง`).toContain(k);
    }
    expect(l.order).toHaveLength(BLOCK_KEYS.length);
  });

  it("คีย์ที่ไม่รู้จัก (ของเวอร์ชันที่ถูกลบไปแล้ว) ถูกตัดทิ้ง ไม่ทำให้พัง", () => {
    const l = resolveLayout(
      { order: ["shopName", "ของเก่าที่ลบไปแล้ว" as BlockKey, "lines"] },
      NO_VAT,
    );
    expect(l.order).not.toContain("ของเก่าที่ลบไปแล้ว");
    expect(l.order).toHaveLength(BLOCK_KEYS.length);
  });

  it("คีย์ซ้ำถูกยุบเหลือตัวเดียว (ไม่พิมพ์บล็อกซ้ำสองรอบ)", () => {
    const l = resolveLayout({ order: ["lines", "lines", "shopName"] }, NO_VAT);
    expect(l.order.filter((k) => k === "lines")).toHaveLength(1);
    expect(l.order).toHaveLength(BLOCK_KEYS.length);
  });

  it("ค่าเพี้ยนสิ้นเชิง (ไม่ใช่ array) → กลับไปใช้ปริยาย ไม่โยน error", () => {
    const l = resolveLayout({ order: "พัง" as unknown as BlockKey[] }, NO_VAT);
    expect(l.order).toEqual(DEFAULT_ORDER);
  });
});

describe("บล็อกที่ปิดไม่ได้", () => {
  it("ชื่อร้าน / รายการ / ยอดรวม ปิดไม่ได้เสมอ แม้จะสั่งปิดมา", () => {
    const l = resolveLayout({ off: ["shopName", "lines", "totals"] }, NO_VAT);
    for (const k of ["shopName", "lines", "totals"] as BlockKey[]) {
      expect(l.on(k), `${k} ต้องยังเปิด`).toBe(true);
      expect(l.locked(k), `${k} ต้องล็อก`).toBe(true);
    }
  });

  /**
   * 🚨 ปล่อยให้ปิดได้ = ออกใบกำกับที่ใช้ไม่ได้ตามกฎหมายทั้งคืน
   *    โดยไม่มีอะไรบนจอฟ้องเลย
   */
  it("🚨 จด VAT → เลขภาษี · เลขที่เอกสาร · วันที่ · ยอดภาษี ปิดไม่ได้", () => {
    const off: BlockKey[] = ["sellerTaxId", "docNo", "printedAt", "vat"];
    const l = resolveLayout({ off }, VAT);
    for (const k of off) {
      expect(l.on(k), `${k} ต้องยังเปิดเมื่อจด VAT`).toBe(true);
      expect(l.locked(k), `${k} ต้องล็อกเมื่อจด VAT`).toBe(true);
    }
  });

  it("🚨 ทางกลับ — ไม่จด VAT ปิดบรรทัดพวกนั้นได้ตามใจ", () => {
    const off: BlockKey[] = ["sellerTaxId", "docNo", "printedAt", "vat"];
    const l = resolveLayout({ off }, NO_VAT);
    for (const k of off) {
      expect(l.on(k), `${k} ต้องปิดได้เมื่อไม่จด VAT`).toBe(false);
      expect(l.locked(k)).toBe(false);
    }
  });

  it("บล็อกที่เริ่มมาปิดไว้ (โลโก้ · ป้ายช่องทาง · ข้อความหัว) ต้องปิดจริงตั้งแต่ยังไม่ตั้งค่า", () => {
    const l = resolveLayout(null, NO_VAT);
    expect(l.on("logo")).toBe(false);
    expect(l.on("channel")).toBe(false);
    expect(l.on("headText")).toBe(false);
    // ★ แต่ปิดไม่ได้ ≠ ล็อก — เปิดเองได้
    expect(l.locked("channel")).toBe(false);
  });

  it("บันทึก off เป็นลิสต์ว่าง = เปิดทุกอย่าง (รวมป้ายช่องทางที่เดิมปิด)", () => {
    const l = resolveLayout({ off: [] }, NO_VAT);
    expect(l.on("channel")).toBe(true);
  });
});

/**
 * 🐛 **บั๊กที่เจอบนจอตอนเทสเฟส G** — การ์ดตั้งค่าเขียนเหตุผลเองว่า
 *    `isVat ? "ใบกำกับภาษีต้องมี" : "ไม่มีแล้วไม่ใช่บิล"`
 *    ⇒ พอกิจการจด VAT **ชื่อร้าน / รายการ / ยอดรวม** ซึ่งถูกล็อกด้วย `ALWAYS_ON`
 *    (ไม่เกี่ยวกับ VAT เลย) กลับขึ้นเหตุผลว่า *"ใบกำกับภาษีต้องมี"*
 *
 * 🚨 ตรรกะถูกทุกประการ — ล็อกถูกตัว ปิดไม่ได้จริง — **ที่ผิดคือประโยคที่ผู้ใช้อ่านแล้วสรุป**
 *    ผู้ใช้ที่อ่านแล้วเข้าใจว่า "ถ้าเลิกจด VAT ก็เอาชื่อร้านออกได้" กำลังเข้าใจผิด
 *    (ตระกูล D91/0059 · D80)
 *
 * ⇒ เหตุผลย้ายมาตัดสินใน lib ที่มีเทสคุม **ห้ามตัดสินในคอมโพเนนต์** (D84/D88)
 */
describe("🐛 เหตุผลที่ปิดไม่ได้ ต้องตรงกับชุดที่ล็อกจริง", () => {
  const ALWAYS: BlockKey[] = ["shopName", "lines", "totals"];
  // ★ `voidStamp` ก็อยู่ใน ALWAYS_ON แต่มีเหตุผลเฉพาะของตัวเอง — เทสแยกด้านล่าง
  const VAT_ONLY: BlockKey[] = ["sellerTaxId", "docNo", "printedAt", "vat"];

  it("🚨 กิจการจด VAT — ชื่อร้าน/รายการ/ยอดรวม ต้อง **ไม่** อ้างใบกำกับภาษี", () => {
    const l = resolveLayout(null, VAT);
    for (const k of ALWAYS) {
      expect(l.lockReason(k), `${k} ต้องมีเหตุผล`).toBe("ปิดไม่ได้ — ไม่มีแล้วไม่ใช่บิล");
      expect(l.lockReason(k)).not.toContain("ใบกำกับภาษี");
    }
  });

  it("ไม่จด VAT — ชื่อร้าน/รายการ/ยอดรวม ยังล็อกด้วยเหตุผลเดิมเป๊ะ (ไม่ขึ้นกับ VAT)", () => {
    const vat = resolveLayout(null, VAT);
    const no = resolveLayout(null, NO_VAT);
    for (const k of ALWAYS) expect(no.lockReason(k)).toBe(vat.lockReason(k));
  });

  /**
   * 🚨 ค่าที่ลูกค้าบันทึกไว้ก่อน D97 ยังเขียนว่า `paidStamp`
   *    ทิ้งคีย์เก่าเฉย ๆ = ตราบิลยกเลิกเด้งไปต่อท้ายสุด **ใต้ข้อความท้ายบิล**
   *    ทั้งที่ลูกค้าไม่ได้สั่งให้ย้าย — การเปลี่ยนชื่อคีย์เป็นเรื่องของเรา ไม่ใช่ของเขา
   */
  it("🪤 ผังเก่าที่เขียนว่า paidStamp ต้องกลายเป็น voidStamp **ที่ตำแหน่งเดิม**", () => {
    const saved = { order: ["shopName", "lines", "totals", "paidStamp", "footer"] as BlockKey[] };
    const l = resolveLayout(saved, NO_VAT);
    expect(l.order.indexOf("voidStamp")).toBe(3);
    expect(l.order.indexOf("footer")).toBe(4);
    expect(l.order).not.toContain("paidStamp" as BlockKey);
    // ★ คีย์ที่เหลือยังถูกเติมต่อท้ายตามปกติ
    expect(new Set(l.order).size).toBe(l.order.length);
    expect(l.order.length).toBe(BLOCK_KEYS.length);
  });

  it("🚨 ตราบิลยกเลิกปิดไม่ได้ และเหตุผลต้องเป็นของตัวเอง (ไม่ใช่ 'ไม่ใช่บิล')", () => {
    for (const o of [VAT, NO_VAT]) {
      const l = resolveLayout(null, o);
      expect(l.locked("voidStamp")).toBe(true);
      expect(l.lockReason("voidStamp")).toContain("ยกเลิก");
      // ★ สั่งปิดมาจากค่าที่บันทึกไว้ก็ยังเปิดอยู่
      expect(resolveLayout({ off: ["voidStamp"] }, o).on("voidStamp")).toBe(true);
    }
  });

  it("บรรทัดของกฎหมายได้เหตุผลใบกำกับภาษี **เฉพาะตอนจด VAT**", () => {
    const vat = resolveLayout(null, VAT);
    const no = resolveLayout(null, NO_VAT);
    for (const k of VAT_ONLY) {
      expect(vat.lockReason(k), k).toBe("ปิดไม่ได้ — ใบกำกับภาษีต้องมี");
      expect(no.lockReason(k), `${k} ไม่จด VAT ต้องปิดได้`).toBeNull();
    }
  });

  /** ★ `locked()` คำนวณจาก `lockReason()` ⇒ สองตัวนี้หลุดจากกันไม่ได้ */
  it("locked() กับ lockReason() ต้องตรงกันทุกบล็อก ทั้งจดและไม่จด VAT", () => {
    for (const opts of [NO_VAT, VAT]) {
      const l = resolveLayout(null, opts);
      for (const k of BLOCK_KEYS) {
        expect(l.locked(k), `${k} (isVat=${opts.isVat})`).toBe(l.lockReason(k) !== null);
      }
    }
  });

  it("บล็อกที่ปิดได้ ต้องไม่มีเหตุผลค้างอยู่", () => {
    const l = resolveLayout(null, VAT);
    for (const k of ["logo", "channel", "headText", "buyer", "qr", "footer"] as BlockKey[]) {
      expect(l.lockReason(k), k).toBeNull();
    }
  });

  /**
   * 🚩 เทสอ่านซอร์สหน้าจอ — กติกาอยู่ 2 ฝั่งที่ TypeScript มองไม่ทะลุ
   *    (lib ตัดสินเหตุผล · คอมโพเนนต์เป็นคนพิมพ์ลงจอ)
   *    เผลอกลับไปแต่งประโยคเองอีกครั้ง = ไม่มี error ทั้งคู่
   */
  it("🚩 การ์ดตั้งค่าต้องไม่แต่งประโยค 'ปิดไม่ได้' เอง", () => {
    const src = readFileSync(
      path.join(__dirname, "../../app/(app)/bar/_components/ReceiptLayoutCard.tsx"),
      "utf8",
    );
    // ตัดคอมเมนต์ออกก่อน — คำอธิบายว่า "เคยเขียนผิดแบบนี้" มีสิทธิ์อยู่ในไฟล์
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("ปิดไม่ได้ —");
    expect(code).toContain("L.lockReason(k)");
  });
});

/**
 * 🐛 **บั๊กที่ 2 ที่เจอบนจอตอนเทสเฟส G** — `headText` อยู่ใน `DEFAULT_OFF`
 *    ผู้ใช้พิมพ์ข้อความหัวบิลลงไป **พรีวิวไม่ขยับเลยและไม่มีอะไรอธิบาย**
 *    จะสรุปว่าช่องนี้เสีย ทั้งที่ระบบทำถูกตามที่ตั้งไว้
 * 🚨 *ทุกครั้งที่ระบบไม่ทำอะไรให้ ต้องบอกว่าทำไม* (D92)
 */
describe("🐛 กรอกข้อความไว้แต่บล็อกปิดอยู่", () => {
  it("พิมพ์ข้อความหัวบิลตั้งแต่ยังไม่เคยตั้งค่า (headText ปริยายปิด) → ต้องเตือน", () => {
    const saved: Partial<ReceiptLayout> = { headText: "ยินดีต้อนรับ" };
    const L = resolveLayout(saved, NO_VAT);
    expect(L.on("headText"), "ปริยายต้องปิดจริง").toBe(false);
    expect(filledButOff(saved, L)).toEqual(["headText"]);
  });

  it("ทางกลับ — เปิดบล็อกแล้วต้องเงียบ", () => {
    const saved: Partial<ReceiptLayout> = { headText: "ยินดีต้อนรับ", off: [] };
    expect(filledButOff(saved, resolveLayout(saved, NO_VAT))).toEqual([]);
  });

  it("ปิดบล็อกแต่ไม่ได้กรอกอะไร → ไม่เตือน (ไม่มีอะไรหาย)", () => {
    const saved: Partial<ReceiptLayout> = { off: ["headText", "footer"] };
    expect(filledButOff(saved, resolveLayout(saved, NO_VAT))).toEqual([]);
  });

  it("ช่องว่างล้วนไม่นับว่ากรอก", () => {
    const saved: Partial<ReceiptLayout> = { headText: "   ", off: ["headText"] };
    expect(filledButOff(saved, resolveLayout(saved, NO_VAT))).toEqual([]);
  });

  it("ท้ายบิลก็โดนกฎเดียวกัน (ปริยายเปิด แต่ปิดเองได้)", () => {
    const saved: Partial<ReceiptLayout> = { footer: "ขอบคุณครับ", off: ["footer"] };
    expect(filledButOff(saved, resolveLayout(saved, NO_VAT))).toEqual(["footer"]);
  });

  it("ชื่อฟิลด์ข้อความต้องเป็นคีย์บล็อกจริง (ไม่งั้น on() ถามผิดตัวเงียบ ๆ)", () => {
    for (const k of TEXT_BLOCKS) expect(BLOCK_KEYS).toContain(k);
  });
});

/**
 * 🐛 **บั๊กที่ 3** — กดปุ่มแทรกตัวแปรแล้วพิมพ์ต่อ ตัวอักษรไปแทรก **หัวช่อง**
 *    (เคอร์เซอร์เด้งไปตำแหน่ง 0 หลัง re-render ของ controlled input)
 *    "ขอบคุณ" + แทรก {ชื่อร้าน} + " แล้วพบกันใหม่" → " แล้วพบกันใหม่ขอบคุณ{ชื่อร้าน}"
 * 🚨 ข้อความนี้ถูกพิมพ์ลงบิลจริงทุกใบ
 */
describe("🚩 กดแทรกตัวแปรแล้วต้องพิมพ์ต่อได้", () => {
  it("การ์ดต้องคืนเคอร์เซอร์ไปท้ายช่องหลังแทรก", () => {
    const src = readFileSync(
      path.join(__dirname, "../../app/(app)/bar/_components/ReceiptLayoutCard.tsx"),
      "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain("setSelectionRange");
    expect(code).toContain(".focus()");
  });
});

describe("ค่าอื่น ๆ", () => {
  it("กระดาษรับได้แค่ 80 กับ 58 · ค่าอื่นตกกลับเป็น 80", () => {
    expect(resolveLayout({ paper: 58 }, NO_VAT).paper).toBe(58);
    expect(resolveLayout({ paper: 80 }, NO_VAT).paper).toBe(80);
    expect(resolveLayout({ paper: 99 as never }, NO_VAT).paper).toBe(80);
    expect(resolveLayout(null, NO_VAT).paper).toBe(80);
  });

  it("🚨 QR ต้องกว้าง ≥ 25 มม. ทุกขนาดกระดาษ (ต่ำกว่านั้นสแกนไม่ติด)", () => {
    expect(paperMetrics(80)).toEqual({ printable: 72, qr: 30 });
    const p58 = paperMetrics(58);
    expect(p58.printable).toBe(48);
    expect(p58.qr).toBeGreaterThanOrEqual(25);
    expect(p58.qr).toBeLessThanOrEqual(p58.printable);
  });

  it("ข้อความหัว/ท้ายที่ไม่ได้ตั้ง = ค่าว่าง ไม่ใช่ undefined", () => {
    const l = resolveLayout(null, NO_VAT);
    expect(l.headText).toBe("");
    expect(l.footer).toBe("");
  });

  it("defaultLayout() ครบทุกบล็อก และมีชื่อไทยครบ", () => {
    expect(defaultLayout().order).toHaveLength(BLOCK_KEYS.length);
    for (const k of BLOCK_KEYS) expect(BLOCK_LABEL[k], `ไม่มีชื่อไทยของ ${k}`).toBeTruthy();
  });
});

describe("moveBlock — ย้ายด้วย ▲▼ ไม่ใช่ลาก", () => {
  const o: BlockKey[] = ["logo", "shopName", "lines"];
  it("ย้ายขึ้น/ลงได้ 1 ขั้น", () => {
    expect(moveBlock(o, "shopName", -1)).toEqual(["shopName", "logo", "lines"]);
    expect(moveBlock(o, "shopName", 1)).toEqual(["logo", "lines", "shopName"]);
  });
  it("สุดขอบแล้วไม่ขยับ และไม่ทำลิสต์พัง", () => {
    expect(moveBlock(o, "logo", -1)).toEqual(o);
    expect(moveBlock(o, "lines", 1)).toEqual(o);
  });
  it("คีย์ที่ไม่อยู่ในลิสต์ → คืนลิสต์เดิม", () => {
    expect(moveBlock(o, "footer", -1)).toEqual(o);
  });
});

describe("fillTokens — ชุดปิด กดแทรกอย่างเดียว", () => {
  const v = { ชื่อร้าน: "บาร์ทดสอบ", เลขบิล: "B260913-006", ยอด: "260.00" };

  it("แทนค่าที่รู้จัก", () => {
    expect(fillTokens("ขอบคุณที่มา {ชื่อร้าน} นะครับ", v)).toBe("ขอบคุณที่มา บาร์ทดสอบ นะครับ");
    expect(fillTokens("บิล {เลขบิล} · {ยอด} บาท", v)).toBe("บิล B260913-006 · 260.00 บาท");
  });

  /**
   * 🚨 พิมพ์ชื่อตัวแปรผิดหนึ่งตัว แล้วบิลทั้งคืนพิมพ์คำว่า undefined = ของเสียทั้งม้วน
   */
  it("🚨 ตัวแปรที่ไม่รู้จัก → คงข้อความเดิม ห้ามกลายเป็น undefined", () => {
    expect(fillTokens("สวัสดี {ชื่อรัาน}", v)).toBe("สวัสดี {ชื่อรัาน}");
    expect(fillTokens("{อะไรก็ไม่รู้}", v)).toBe("{อะไรก็ไม่รู้}");
    expect(fillTokens("{}", v)).toBe("{}");
  });

  it("ตัวแปรที่รู้จักแต่ไม่มีข้อมูล (บิลไม่ระบุลูกค้า) → ค่าว่าง ไม่ทิ้งวงเล็บไว้", () => {
    expect(fillTokens("ขอบคุณ {ชื่อลูกค้า} ครับ", v)).toBe("ขอบคุณ  ครับ");
  });

  it("มีช่องว่างรอบชื่อตัวแปรก็ยังใช้ได้", () => {
    expect(fillTokens("{ ชื่อร้าน }", v)).toBe("บาร์ทดสอบ");
  });

  it("ข้อความว่าง / ไม่มีตัวแปร → คืนตามเดิม", () => {
    expect(fillTokens("", v)).toBe("");
    expect(fillTokens("ขอบคุณครับ", v)).toBe("ขอบคุณครับ");
  });

  it("ชุดตัวแปรเป็นชุดปิด — ไม่มีเงื่อนไข ไม่มีสูตร (กันซ้ำรอย D67/D70)", () => {
    expect([...TOKENS]).toEqual(["ชื่อร้าน", "เลขบิล", "ยอด", "วันที่", "ชื่อลูกค้า"]);
    // ★ ถ้าวันหนึ่งมีคนเติม `{if …}` หรือ `{sum(…)}` เข้ามา เทสนี้จะแดงทันที
    expect(TOKENS.every((t) => /^[ก-๙a-zA-Z ]+$/.test(t))).toBe(true);
  });
});

/**
 * 🚩 ผังต้องมีผลกับ **กระดาษจริง** ไม่ใช่แค่กับตัวมันเอง
 *    เทสชั้นนี้เรียก `receiptHtml()` ตัวเดียวกับที่พิมพ์ — ถ้าวันหนึ่งมีคนเพิ่มบล็อก
 *    แล้วลืมเขียนตัวเรนเดอร์ หรือเรนเดอร์ตามลำดับตายตัว เทสจะแดงทันที
 */
describe("🚩 ผังมีผลกับกระดาษจริง (เรียก receiptHtml)", () => {
  const lines = [{ menuId: "x", menuName: "Negroni", qty: 1, price: 260 }];
  const doc = (layout: Partial<ReceiptLayout> | null, isVat = false) =>
    buildReceipt({
      status: "ปกติ",
      saleNo: "B1",
      rcptNo: "BR1",
      wantReceipt: true,
      lines,
      totals: barTotals(lines, {}),
      seller: { name: "บาร์ทดสอบ", address: "123 ถนนทดสอบ", taxId: "0105558123456", isVat },
      printedAt: "13/09/2569 23:00",
      channel: "บูธ Craft Fest",
      layout,
    });

  it("ปิดที่อยู่ร้าน → หายจากกระดาษจริง", () => {
    expect(receiptHtml(doc(null))).toContain("123 ถนนทดสอบ");
    expect(receiptHtml(doc({ off: ["sellerAddress"] }))).not.toContain("123 ถนนทดสอบ");
  });

  it("สลับลำดับแล้วตำแหน่งบนกระดาษสลับตาม", () => {
    const normal = receiptHtml(doc(null));
    expect(normal.indexOf("บาร์ทดสอบ")).toBeLessThan(normal.indexOf("Negroni"));

    const flipped = receiptHtml(doc({ order: ["lines", "shopName"] }));
    expect(flipped.indexOf("Negroni")).toBeLessThan(flipped.indexOf("บาร์ทดสอบ"));
  });

  /** 🚨 สลับลำดับแล้วเนื้อหาต้องครบเท่าเดิม — ไม่ใช่หายไปกับการเรียงใหม่ */
  it("🚨 สลับลำดับแล้วเนื้อหาไม่หาย", () => {
    const keep = ["บาร์ทดสอบ", "123 ถนนทดสอบ", "Negroni", "260.00", "BR1"];
    const flipped = receiptHtml(doc({ order: ["footer", "lines", "totals", "shopName"] }));
    for (const t of keep) expect(flipped, `หาย: ${t}`).toContain(t);
  });

  it("🚨 จด VAT + สั่งปิดทุกอย่างที่ปิดได้ → บรรทัดบังคับยังอยู่ครบ", () => {
    const html = receiptHtml(doc({ off: [...BLOCK_KEYS] }, true));
    expect(html).toContain("ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ"); // หัวกระดาษ
    expect(html).toContain("บาร์ทดสอบ"); // ชื่อผู้ขาย
    expect(html).toContain("0105558123456"); // เลขภาษี
    expect(html).toContain("BR1"); // เลขที่เอกสาร
    expect(html).toContain("13/09/2569"); // วันที่
    expect(html).toContain("ภาษีมูลค่าเพิ่ม"); // ยอดภาษี
    expect(html).toContain("Negroni"); // รายการ
  });

  it("🚨 ทางกลับ — ไม่จด VAT ปิดทุกอย่างที่ปิดได้ → เหลือแค่ที่จำเป็นจริง ๆ", () => {
    const html = receiptHtml(doc({ off: [...BLOCK_KEYS] }, false));
    expect(html).toContain("บาร์ทดสอบ");
    expect(html).toContain("Negroni");
    expect(html).not.toContain("0105558123456");
    expect(html).not.toContain("123 ถนนทดสอบ");
  });

  it("ตัวแปรในข้อความท้ายบิลถูกแทนค่าก่อนถึงกระดาษ", () => {
    const html = receiptHtml(doc({ footer: "ขอบคุณที่มา {ชื่อร้าน} · บิล {เลขบิล}" }));
    expect(html).toContain("ขอบคุณที่มา บาร์ทดสอบ · บิล BR1");
    expect(html).not.toContain("{ชื่อร้าน}");
  });

  it("กระดาษ 58 มม. → CSS กว้าง 48 มม. และ QR ยังไม่ต่ำกว่า 25 มม.", () => {
    expect(receiptCss(58)).toContain("width: 48mm");
    expect(receiptCss(58)).toMatch(/\.qr \{[^}]*width: (2[5-9]|[3-9]\d)mm/);
    expect(receiptCss(80)).toContain("width: 72mm");
  });

  it("ตัวหนังสือใหญ่เปลี่ยนขนาดฟอนต์จริง", () => {
    expect(receiptCss(80, false)).toContain("font-size: 12pt");
    expect(receiptCss(80, true)).toContain("font-size: 14pt");
  });
});

/**
 * 🚨 **โลโก้ของบาร์แยกจากโลโก้แบรนด์โดยตั้งใจ** (ผู้ใช้ทักเอง 2026-09-14)
 *    บาร์มักขายในนาม **อีกกิจการหนึ่ง** (เช่น EID02) ซึ่งเป็นคนละแบรนด์กับโรงกลั่น
 *    ใช้ร่วมกัน = บิลบาร์ขึ้นโลโก้โรงเหล้าให้ลูกค้าเห็น ผิดว่าใครเป็นผู้ขายบนกระดาษใบนั้น
 *    ★ เก็บใน JSON ของผัง จึงไม่ต้องเพิ่ม kind และไม่ต้องมี migration
 */
describe("🚩 โลโก้เป็นของบาร์เอง", () => {
  const lines = [{ menuId: "x", menuName: "Negroni", qty: 1, price: 260 }];
  const doc = (layout: Partial<ReceiptLayout>) =>
    buildReceipt({
      status: "ปกติ",
      saleNo: "B1",
      lines,
      totals: barTotals(lines, {}),
      seller: { name: "บาร์ทดสอบ" },
      printedAt: "14/09/2569 00:30",
      layout,
    });

  it("ไม่ใส่ลิงก์ → ไม่มีรูปบนกระดาษ แม้เปิดบล็อกโลโก้ไว้", () => {
    const html = receiptHtml(doc({ off: [] }));
    expect(html).not.toContain("<img");
  });

  it("ใส่ลิงก์ + เปิดบล็อก → รูปขึ้นบนกระดาษ", () => {
    const html = receiptHtml(doc({ off: [], logoUrl: "https://x/logo.png" }));
    expect(html).toContain("https://x/logo.png");
  });

  it("ใส่ลิงก์แต่ปิดบล็อกไว้ (ค่าปริยาย) → ไม่ขึ้น", () => {
    expect(receiptHtml(doc({ logoUrl: "https://x/logo.png" }))).not.toContain("<img");
  });

  it("ลิงก์ถูก escape — ห้ามให้ค่าที่ผู้ใช้พิมพ์หลุดเป็น HTML", () => {
    const html = receiptHtml(doc({ off: [], logoUrl: '"><script>x</script>' }));
    expect(html).not.toContain("<script>");
  });
});
