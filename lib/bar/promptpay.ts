/**
 * lib/bar/promptpay — สร้าง payload ของ QR พร้อมเพย์แบบ **ระบุยอด** (D96)
 *
 * ── ทำไมคำนวณเอง ไม่พึ่ง API ──────────────────────────────────────────────
 * QR พร้อมเพย์เป็นมาตรฐาน EMVCo ที่ประกอบจากการต่อ string ตาม tag แล้วปิดท้ายด้วย
 * CRC16 — ไม่มี API ไม่มีค่าธรรมเนียม ไม่ต้องสมัครอะไร และ **ไม่ต้องพึ่งเน็ตตอนสร้าง**
 *
 * ── 🚨 จุดอันตรายที่สุดของไฟล์นี้ ─────────────────────────────────────────
 * · CRC ผิด        → QR สแกนไม่ติด = **ล้มแบบปลอดภัย** (รู้ตัวทันที)
 * · เลขปลายทางผิด → **เงินเข้าบัญชีคนแปลกหน้า และไม่มีอะไรฟ้องเลย**
 *   ⇒ ห้ามมี fallback ของเลขพร้อมเพย์เด็ดขาด (หลักเดียวกับโทเคน LINE ใน CLAUDE.md
 *     ที่ห้าม fallback ไป env เพราะจะยิงเข้ากลุ่มลูกค้าคนอื่น)
 *   ⇒ ตั้งค่าไม่ครบ = `promptPayPayload()` คืน `null` และหน้าจอต้องปิดปุ่ม QR
 *     **ห้ามเดาเลข ห้ามใช้ค่าปริยาย**
 *
 * ── 🚩 สิ่งที่เทสไฟล์นี้พิสูจน์ไม่ได้ ──────────────────────────────────────
 * เทสยืนยันได้แค่ว่า **โครงสร้างถูกตามสเปกและ CRC คำนวณถูก**
 * ตัวที่พิสูจน์ว่า "เงินเข้าบัญชีที่ถูกต้องจริง" คือ **สแกนด้วยแอปธนาคารจริง**
 * → หน้าตั้งค่าต้องโชว์ QR ตัวอย่าง 1 บาท ให้ผู้ใช้สแกนยืนยันชื่อบัญชีปลายทางหนึ่งครั้ง
 *   (ตาคนคือด่านเดียวที่ตรวจข้อนี้ได้ — บทเรียนเดียวกับ D94 ที่ต้องเรนเดอร์ PDF จริงให้ดู)
 */

export type PromptPayType = "mobile" | "natid" | "ewallet";

export type PromptPayTarget = {
  type: PromptPayType;
  /** เลขดิบตามที่ผู้ใช้กรอก — มีขีด เว้นวรรค วงเล็บได้ ฟังก์ชันนี้ตัดให้เอง */
  id: string;
};

/** Application ID ของพร้อมเพย์ — ค่าคงที่ของมาตรฐาน ห้ามแก้ */
const AID_PROMPTPAY = "A000000677010111";

/** ยอดสูงสุดที่ยัดลงช่อง tag 54 ได้ (13 อักขระรวมจุด) — เกินนี้ไม่ใช่บิลบาร์แล้ว */
const MAX_AMOUNT = 9_999_999.99;

/** ตัดทุกอย่างที่ไม่ใช่ตัวเลข — ผู้ใช้พิมพ์ `081-234-5678` มาได้ */
const digitsOf = (s: string) => (s ?? "").replace(/\D/g, "");

/**
 * ประกอบ 1 field ตามรูปแบบ EMVCo: `ID(2) + LEN(2) + VALUE`
 * 🪤 ความยาวนับเป็น**อักขระ** และต้องเติม 0 ข้างหน้าให้ครบ 2 หลักเสมอ
 *    (`"9"` ต้องเป็น `"09"` ไม่ใช่ `"9"` — ผิดแล้วทั้ง payload เลื่อนหมด)
 */
function tlv(id: string, value: string): string {
  return id + String(value.length).padStart(2, "0") + value;
}

/**
 * CRC-16/CCITT-FALSE — poly 0x1021 · init 0xFFFF · ไม่กลับบิต · ไม่ XOR ตอนจบ
 *
 * 🚨 มี CRC16 หลายสายพันธุ์ที่ใช้ poly ตัวเดียวกันแต่ init/reflect ต่างกัน
 *    หยิบผิดสายพันธุ์ = ได้เลข 4 หลักที่หน้าตาสมเหตุสมผลทุกประการ แต่ QR สแกนไม่ติด
 *    ★ ค่าตรวจมาตรฐานของสายพันธุ์นี้: CRC("123456789") = 0x29B1 (ล็อกไว้ในเทส)
 */
export function crc16ccitt(input: string): number {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/**
 * เลขปลายทางในรูปแบบที่มาตรฐานต้องการ — คืน `null` ถ้าเลขใช้ไม่ได้
 *
 * · mobile  : เบอร์ไทย 10 หลัก → `0066` + 9 หลักหลัง (รวม 13)
 *             🪤 ต้อง **ตัด 0 ตัวหน้าทิ้งก่อน** เติม 66 ไม่งั้นได้ 14 หลักและผิดคน
 * · natid   : เลขบัตรประชาชน / เลขนิติบุคคล 13 หลักตามตรง
 * · ewallet : 15 หลักตามตรง
 */
export function normalizePromptPayId(target: PromptPayTarget): string | null {
  const d = digitsOf(target.id);
  if (target.type === "mobile") {
    // รับทั้ง 0812345678 · 66812345678 · 812345678
    let local = d;
    if (local.startsWith("66") && local.length === 11) local = local.slice(2);
    else if (local.startsWith("0") && local.length === 10) local = local.slice(1);
    if (local.length !== 9) return null;
    // 🐛 **เจอจากเทส B1**: `"081234567"` (9 หลักแต่มี 0 นำ) เคยผ่านด่านความยาวมาได้
    //    เพราะเงื่อนไขตัด 0 ข้างบนบังคับความยาว 10 → เลขถูกส่งต่อทั้งดุ้นแล้วได้
    //    `0066081234567` ซึ่งเป็น **คนละเบอร์และหน้าตาปกติทุกประการ**
    //    เบอร์มือถือไทยหลังตัด 0 นำ ขึ้นต้นด้วย 6/8/9 เสมอ — ขึ้นต้น 0 = กรอกมาผิด
    if (local.startsWith("0")) return null;
    return ("0066" + local).padStart(13, "0");
  }
  if (target.type === "natid") return d.length === 13 ? d : null;
  if (target.type === "ewallet") return d.length === 15 ? d : null;
  return null;
}

/** sub-tag ของ tag 29 ตามชนิดปลายทาง */
const SUBTAG: Record<PromptPayType, string> = {
  mobile: "01",
  natid: "02",
  ewallet: "03",
};

/**
 * คำชี้ทางว่าไปตั้งเลขพร้อมเพย์ได้ที่ไหน
 *
 * 🚨 **ต่อท้ายเฉพาะหน้าจอที่ไม่ใช่หน้าตั้งค่า** — ขึ้นคำว่า *"ไปตั้งที่ ตั้งค่าบาร์"*
 *    บนหน้าตั้งค่าบาร์เอง คือการบอกให้ผู้ใช้เดินไปยังที่ที่เขายืนอยู่แล้ว
 *    (ตระกูล D91/0059: ตรรกะถูก แต่ประโยคที่ผู้ใช้อ่านแล้วสรุปผิด)
 * ★ ประโยคยังอยู่ใน lib ที่เดียว — หน้าจอไม่แต่งประโยคเอง
 */
export const PROMPTPAY_WHERE = "ไปตั้งที่ แท็บตั้งค่า ของบาร์";

/**
 * เหตุผลที่สร้าง QR ไม่ได้ (ภาษาไทย) — `null` = ใช้ได้
 * ★ หน้าจอเรียกตัวนี้เพื่อ **ปิดปุ่มพร้อมบอกว่าต้องไปแก้อะไร** (กติกา D83)
 * @param opts.showWhere ต่อท้ายคำชี้ทางว่าไปตั้งที่ไหน — **ปริยายไม่ต่อ**
 *        หน้าตั้งค่าบาร์ไม่ต้องส่ง · หน้าขาย/หน้าอื่นส่ง `true`
 */
export function promptPayError(
  target: PromptPayTarget | null | undefined,
  opts: { showWhere?: boolean } = {},
): string | null {
  if (!target || !digitsOf(target.id))
    return "ยังไม่ได้ตั้งเลขพร้อมเพย์" + (opts.showWhere ? " — " + PROMPTPAY_WHERE : "");
  if (!normalizePromptPayId(target)) {
    if (target.type === "mobile") return "เบอร์พร้อมเพย์ต้องเป็นเบอร์มือถือ 10 หลัก";
    if (target.type === "natid") return "เลขประจำตัวผู้เสียภาษี/บัตรประชาชน ต้องมี 13 หลัก";
    return "เลข e-Wallet ต้องมี 15 หลัก";
  }
  return null;
}

/**
 * payload ของ QR พร้อมเพย์ระบุยอด — คืน `null` เมื่อสร้างไม่ได้ (**ห้ามคืนค่ามั่ว**)
 *
 * ลำดับ tag ตามมาตรฐาน: 00 → 01 → 29 → 53 → 54 → 58 → 63
 * · tag 01 = `"12"` (dynamic / ใช้ครั้งเดียว) เพราะเราระบุยอดเสมอ
 *   🪤 ใส่ `"11"` (static) ทั้งที่มียอด = แอปธนาคารบางเจ้าปล่อยให้แก้ยอดได้เอง
 */
export function promptPayPayload(input: {
  target: PromptPayTarget | null | undefined;
  amount: number;
}): string | null {
  const { target, amount } = input;
  if (!target || promptPayError(target)) return null;
  const id = normalizePromptPayId(target);
  if (!id) return null;
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) return null;

  const merchant = tlv("29", tlv("00", AID_PROMPTPAY) + tlv(SUBTAG[target.type], id));

  const body =
    tlv("00", "01") +
    tlv("01", "12") +
    merchant +
    tlv("53", "764") +
    tlv("54", amount.toFixed(2)) +
    tlv("58", "TH");

  // CRC คิดจาก body + "6304" (คือหัวและความยาวของช่อง CRC เอง) แล้วต่อค่า 4 หลักท้าย
  const withCrcHeader = body + "6304";
  return withCrcHeader + crc16ccitt(withCrcHeader).toString(16).toUpperCase().padStart(4, "0");
}

/**
 * ตรวจว่า payload ที่ได้มาถูกต้องไหม — ใช้ในเทสและใช้ตรวจซ้ำก่อนเรนเดอร์ QR
 * ★ แยกออกมาเป็นฟังก์ชันเพราะ "สร้างถูก" กับ "ตรวจว่าถูก" ควรเป็นคนละเส้นทางโค้ด
 *   ไม่งั้นบั๊กเดียวกันจะทำให้ทั้งสองฝั่งผิดพร้อมกันแล้วเทสยังเขียว
 */
export function isValidPromptPayPayload(payload: string): boolean {
  if (payload.length < 8) return false;
  const body = payload.slice(0, -4);
  const given = payload.slice(-4).toUpperCase();
  if (!body.endsWith("6304")) return false;
  return crc16ccitt(body).toString(16).toUpperCase().padStart(4, "0") === given;
}

/**
 * แยก payload กลับเป็น map ของ tag — ใช้ในเทสเพื่อยืนยันว่าค่าที่ใส่เข้าไปอยู่ครบจริง
 * (อ่านค่ากลับมาดู ดีกว่าเทียบกับ string ยาว ๆ ที่อ่านไม่ออกว่าผิดตรงไหน)
 */
export function parseEmvTags(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!Number.isFinite(len)) break;
    out[id] = payload.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}
