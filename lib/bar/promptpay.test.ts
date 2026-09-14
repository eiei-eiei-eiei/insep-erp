import { describe, it, expect } from "vitest";
import {
  crc16ccitt,
  normalizePromptPayId,
  promptPayError,
  promptPayPayload,
  isValidPromptPayPayload,
  parseEmvTags,
  type PromptPayTarget,
} from "./promptpay";

/**
 * golden **B1** — QR พร้อมเพย์ (D96)
 *
 * 🚩 **ขอบเขตที่เทสชุดนี้พิสูจน์ได้ และที่พิสูจน์ไม่ได้**
 *    พิสูจน์ได้ : CRC เป็นสายพันธุ์ที่ถูก · โครงสร้าง TLV ถูกตามสเปก · เลขปลายทางถูกแปลงถูก
 *    พิสูจน์ไม่ได้: **เงินจะเข้าบัญชีที่ถูกต้องจริงไหม** — ตัวที่ตอบข้อนี้คือการสแกน
 *    ด้วยแอปธนาคารจริงแล้วอ่านชื่อบัญชีปลายทางด้วยตา (อยู่ในเฟส 5 ของแผน)
 *    ★ เขียนไว้ตรง ๆ เพื่อไม่ให้ใครอ่านว่า "เทสเขียว = ปลอดภัยแล้ว"
 */

const mobile = (id: string): PromptPayTarget => ({ type: "mobile", id });
const natid = (id: string): PromptPayTarget => ({ type: "natid", id });

describe("CRC-16/CCITT-FALSE — ต้องเป็นสายพันธุ์ที่ถูก", () => {
  /**
   * 🚨 ค่าตรวจมาตรฐานที่เผยแพร่ทั่วโลกของสายพันธุ์ CCITT-FALSE
   *    (poly 0x1021 · init 0xFFFF · ไม่กลับบิต · ไม่ XOR ตอนจบ)
   *    สายพันธุ์อื่นที่ใช้ poly เดียวกันจะได้ค่าอื่น → ข้อนี้คือด่านที่แยกมันออกจากกัน
   */
  it("CRC('123456789') = 0x29B1 — ค่าตรวจมาตรฐานของ CCITT-FALSE", () => {
    expect(crc16ccitt("123456789")).toBe(0x29b1);
  });

  it("สตริงว่าง = ค่าเริ่มต้น 0xFFFF (ยืนยันว่า init ไม่ใช่ 0x0000)", () => {
    expect(crc16ccitt("")).toBe(0xffff);
  });

  it("เปลี่ยนตัวอักษรเดียว CRC ต้องเปลี่ยน (กันฟังก์ชันที่คืนค่าคงที่แล้วเทสผ่านฟรี)", () => {
    expect(crc16ccitt("A")).not.toBe(crc16ccitt("B"));
  });
});

describe("เลขปลายทาง — แปลงตามชนิด", () => {
  it("เบอร์มือถือ 10 หลัก → 0066 + 9 หลักหลัง (รวม 13)", () => {
    expect(normalizePromptPayId(mobile("0812345678"))).toBe("0066812345678");
    expect(normalizePromptPayId(mobile("0812345678"))).toHaveLength(13);
  });

  it("🪤 ต้องตัด 0 ตัวหน้าทิ้งก่อนเติม 66 — ไม่งั้นได้ 14 หลักและเป็นคนละคน", () => {
    const v = normalizePromptPayId(mobile("0899999999"))!;
    expect(v).toBe("0066899999999");
    expect(v).not.toContain("660");
  });

  it("รับเบอร์ที่มีขีด/เว้นวรรค/วงเล็บได้ — ผู้ใช้พิมพ์ยังไงก็ได้ผลเดียวกัน", () => {
    const want = "0066812345678";
    for (const raw of ["081-234-5678", "081 234 5678", "(081) 234-5678", "0812345678"]) {
      expect(normalizePromptPayId(mobile(raw)), raw).toBe(want);
    }
  });

  it("รับรูปแบบ 66xxxxxxxxx และ 9 หลักล้วนด้วย", () => {
    expect(normalizePromptPayId(mobile("66812345678"))).toBe("0066812345678");
    expect(normalizePromptPayId(mobile("812345678"))).toBe("0066812345678");
  });

  it("เบอร์ยาว/สั้นผิด = null ไม่ใช่เดาให้", () => {
    for (const bad of ["08123456789", "", "abc", "12345"]) {
      expect(normalizePromptPayId(mobile(bad)), bad).toBeNull();
    }
  });

  /**
   * 🐛 บั๊กจริงที่เทสข้อนี้จับได้ตอนเขียน (D96)
   *
   * `"081234567"` มี 9 หลักพอดี แต่ยังมี 0 นำติดมา — เงื่อนไขตัด 0 บังคับความยาว 10
   * มันจึงรอดมาถึงด่านความยาวแล้วถูกยอมรับ ได้ `0066081234567` = **คนละเบอร์**
   *
   * 🚨 นี่คือรูปแบบความผิดพลาดที่อันตรายที่สุดของไฟล์นี้: **QR สแกนติดปกติ CRC ถูกต้อง
   *    ทุกอย่างดูดี แต่เงินเข้าบัญชีคนอื่น** — ไม่มีอะไรในระบบฟ้องได้เลย
   */
  it("🚨 9 หลักที่ยังมี 0 นำ = ผิด ไม่ใช่เบอร์ที่ตัด 0 แล้ว (เบอร์ไทยขึ้นต้น 6/8/9)", () => {
    expect(normalizePromptPayId(mobile("081234567"))).toBeNull();
    expect(normalizePromptPayId(mobile("012345678"))).toBeNull();
    // ของจริงที่ต้องผ่าน — กันแก้บั๊กแล้วเผลอปิดเบอร์ที่ถูกต้องไปด้วย
    for (const ok of ["612345678", "812345678", "912345678"]) {
      expect(normalizePromptPayId(mobile(ok)), ok).toBe("0066" + ok);
    }
  });

  it("เลขประจำตัวผู้เสียภาษี 13 หลักใช้ตามตรง · ผิดจำนวน = null", () => {
    expect(normalizePromptPayId(natid("1234567890123"))).toBe("1234567890123");
    expect(normalizePromptPayId(natid("1-2345-67890-12-3"))).toBe("1234567890123");
    expect(normalizePromptPayId(natid("123456789012"))).toBeNull();
  });

  it("e-Wallet ต้อง 15 หลัก", () => {
    expect(normalizePromptPayId({ type: "ewallet", id: "123456789012345" })).toBe("123456789012345");
    expect(normalizePromptPayId({ type: "ewallet", id: "1234567890123" })).toBeNull();
  });
});

describe("🚨 ไม่ได้ตั้งค่า = ไม่มี QR — ห้ามมี fallback", () => {
  it("ไม่มีเลขปลายทาง → payload เป็น null และมีข้อความไทยบอกว่าต้องไปตั้งที่ไหน", () => {
    expect(promptPayPayload({ target: null, amount: 100 })).toBeNull();
    expect(promptPayError(null)).toContain("ยังไม่ได้ตั้งเลขพร้อมเพย์");
    // 🚨 คำว่า "ไปตั้งที่ …" ต้องมาเมื่อขอเท่านั้น — หน้าตั้งค่าบาร์เองห้ามชี้กลับมาที่ตัวเอง
    expect(promptPayError(null)).not.toContain("ไปตั้งที่");
    expect(promptPayError(null, { showWhere: true })).toContain("ไปตั้งที่");
  });

  it("เลขผิดรูปแบบ → null + บอกว่าผิดยังไง (ไม่ใช่เงียบ)", () => {
    expect(promptPayPayload({ target: mobile("0812"), amount: 100 })).toBeNull();
    expect(promptPayError(mobile("0812"))).toContain("10 หลัก");
    expect(promptPayError(natid("123"))).toContain("13 หลัก");
  });

  it("ยอดเงินไม่ถูกต้อง = ไม่สร้าง QR (0 · ติดลบ · NaN · เกินเพดาน)", () => {
    const t = mobile("0812345678");
    for (const amt of [0, -1, NaN, Infinity, 10_000_000]) {
      expect(promptPayPayload({ target: t, amount: amt }), String(amt)).toBeNull();
    }
  });

  it("ตั้งค่าครบ = ไม่มีข้อความ error", () => {
    expect(promptPayError(mobile("0812345678"))).toBeNull();
  });
});

describe("โครงสร้าง payload ตามมาตรฐาน EMVCo", () => {
  const payload = promptPayPayload({ target: mobile("0812345678"), amount: 180 })!;
  const tags = parseEmvTags(payload);

  it("สร้างได้จริง และตรวจ CRC ตัวเองผ่าน", () => {
    expect(payload).toBeTruthy();
    expect(isValidPromptPayPayload(payload)).toBe(true);
  });

  it("tag 00 = '01' (payload format indicator)", () => {
    expect(tags["00"]).toBe("01");
  });

  it("🪤 tag 01 = '12' (ใช้ครั้งเดียว) ไม่ใช่ '11' — QR ที่ระบุยอดต้องแก้ยอดเองไม่ได้", () => {
    expect(tags["01"]).toBe("12");
  });

  it("tag 29 มี AID ของพร้อมเพย์ + เลขปลายทางอยู่ใน sub-tag 01 (มือถือ)", () => {
    const sub = parseEmvTags(tags["29"]);
    expect(sub["00"]).toBe("A000000677010111");
    expect(sub["01"]).toBe("0066812345678");
    expect(sub["02"]).toBeUndefined();
  });

  it("เลขบัตรประชาชนอยู่ sub-tag 02 (คนละช่องกับมือถือ)", () => {
    const p = promptPayPayload({ target: natid("1234567890123"), amount: 50 })!;
    const sub = parseEmvTags(parseEmvTags(p)["29"]);
    expect(sub["02"]).toBe("1234567890123");
    expect(sub["01"]).toBeUndefined();
  });

  it("สกุลเงิน 764 (บาท) และประเทศ TH", () => {
    expect(tags["53"]).toBe("764");
    expect(tags["58"]).toBe("TH");
  });

  it("ยอดเงินมีทศนิยม 2 ตำแหน่งเสมอ", () => {
    expect(tags["54"]).toBe("180.00");
    expect(parseEmvTags(promptPayPayload({ target: mobile("0812345678"), amount: 7.5 })!)["54"])
      .toBe("7.50");
    expect(parseEmvTags(promptPayPayload({ target: mobile("0812345678"), amount: 1234.05 })!)["54"])
      .toBe("1234.05");
  });

  it("🪤 ความยาวใน TLV ต้องเป็น 2 หลักเติมศูนย์เสมอ — ผิดแล้วทั้ง payload เลื่อน", () => {
    // tag 53 ค่ายาว 3 → ต้องเป็น "5303764" ไม่ใช่ "533764"
    expect(payload).toContain("5303764");
    expect(payload).toContain("5802TH");
  });

  it("ลำดับ tag ต้องเป็น 00 → 01 → 29 → 53 → 54 → 58 → 63", () => {
    const order = ["00", "01", "29", "53", "54", "58", "63"];
    const pos = order.map((t) => payload.indexOf(t + String(tags[t]?.length ?? 4).padStart(2, "0")));
    // ใช้วิธีอ่านลำดับจาก parser แทนการหา index ดิบ (ค่าซ้ำกันได้)
    const seen: string[] = [];
    let i = 0;
    while (i + 4 <= payload.length) {
      const id = payload.slice(i, i + 2);
      const len = Number(payload.slice(i + 2, i + 4));
      seen.push(id);
      i += 4 + len;
    }
    expect(seen).toEqual(order);
    expect(pos.length).toBe(order.length);
  });

  it("จบด้วย tag 63 ยาว 4 (CRC) เสมอ", () => {
    expect(payload.slice(-8, -4)).toBe("6304");
    expect(payload.slice(-4)).toMatch(/^[0-9A-F]{4}$/);
  });
});

describe("CRC ผูกกับเนื้อหา — แก้อะไรนิดเดียวต้องไม่ผ่านการตรวจ", () => {
  const t = mobile("0812345678");

  it("เปลี่ยนยอดเงิน CRC ต้องเปลี่ยนตาม", () => {
    const a = promptPayPayload({ target: t, amount: 100 })!;
    const b = promptPayPayload({ target: t, amount: 101 })!;
    expect(a.slice(-4)).not.toBe(b.slice(-4));
  });

  it("🚨 เปลี่ยนเลขปลายทาง CRC ต้องเปลี่ยน — กันสลับเลขแล้ว QR ยังสแกนติด", () => {
    const a = promptPayPayload({ target: mobile("0812345678"), amount: 100 })!;
    const b = promptPayPayload({ target: mobile("0899999999"), amount: 100 })!;
    expect(a.slice(-4)).not.toBe(b.slice(-4));
    expect(a).not.toBe(b);
  });

  it("แก้ตัวเลขกลาง payload แล้วการตรวจต้องไม่ผ่าน", () => {
    const p = promptPayPayload({ target: t, amount: 100 })!;
    const tampered = p.replace("100.00", "900.00");
    expect(tampered).not.toBe(p);
    expect(isValidPromptPayPayload(tampered)).toBe(false);
  });

  it("ตัด CRC ทิ้งหรือใส่มั่ว = ไม่ผ่าน", () => {
    const p = promptPayPayload({ target: t, amount: 100 })!;
    expect(isValidPromptPayPayload(p.slice(0, -4) + "0000")).toBe(false);
    expect(isValidPromptPayPayload("")).toBe(false);
  });

  it("ยอดเดิมเลขเดิม = payload เดิมเป๊ะ (deterministic — ไม่มีอะไรสุ่ม)", () => {
    expect(promptPayPayload({ target: t, amount: 250 })).toBe(
      promptPayPayload({ target: t, amount: 250 }),
    );
  });
});
