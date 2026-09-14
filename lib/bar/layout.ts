/**
 * lib/bar/layout — ผู้ใช้จัดหน้าตาบิลเองได้ (golden B14 · D96 ภาค 2 เฟส G)
 *
 * ── ขอบเขตที่ตั้งใจ ────────────────────────────────────────────────────────
 * ผู้ใช้ **เรียงลำดับบล็อก · เปิด/ปิดบรรทัด · ใส่ข้อความหัว-ท้าย · เลือกขนาดกระดาษ** ได้
 * แต่ **ไม่ได้เขียน HTML/CSS เอง** — ผู้ใช้เขียนโค้ดไม่ได้ และหน้าตาที่พังจะไม่มีใครรู้
 * จนกว่ากระดาษจะออกมาผิด (CLAUDE.md)
 *
 * ── 🚨 กติกาเหล็ก 3 ข้อ ────────────────────────────────────────────────────
 * 1. **บล็อกใหม่ที่เพิ่มทีหลังต้องไม่หายจากกระดาษ** — ค่าที่บันทึกไว้เป็นของเวอร์ชันเก่า
 *    ถ้าเรนเดอร์ตามลิสต์ที่บันทึกไว้ตรง ๆ บล็อกใหม่จะไม่โผล่เลยโดยไม่มี error
 *    ⇒ `resolveLayout()` **เติมคีย์ที่ขาดกลับเข้าไปเสมอ** ตามลำดับปริยาย (ตระกูล D84)
 * 2. **บรรทัดที่กฎหมายบังคับปิดไม่ได้** — กิจการจด VAT ต้องมีชื่อผู้ขาย · เลขภาษี ·
 *    เลขที่เอกสาร · วันที่ · ยอดภาษี · คำว่าใบกำกับภาษีอย่างย่อ
 *    ปล่อยให้ปิดได้ = ออกใบกำกับที่ใช้ไม่ได้ตามกฎหมายทั้งคืนโดยไม่มีอะไรฟ้อง
 * 3. **QR ยังตัดสินที่ `receipt.ts` จุดเดียว** — ตั้งค่า*ปิด* QR ได้ แต่ **เปิดบนใบที่จ่ายแล้ว
 *    ไม่ได้เด็ดขาด** (กระดาษอยู่กับลูกค้าตลอดไป — หยิบมาสแกนคืนถัดไป = โอนซ้ำ)
 */

/** บล็อกบนกระดาษ 1 ก้อน — เพิ่มคีย์ใหม่ที่นี่แล้ว TS จะบังคับให้เติม label + ลำดับปริยาย */
export const BLOCK_KEYS = [
  "logo",
  "shopName",
  "sellerAddress",
  "sellerTaxId",
  "sellerPhone",
  "headText",
  "docNo",
  "printedAt",
  "buyer",
  "channel",
  "lines",
  "totals",
  "vat",
  "compSummary",
  "qr",
  "voidStamp",
  "footer",
] as const;

export type BlockKey = (typeof BLOCK_KEYS)[number];

/** ลำดับปริยาย — ★ คีย์ที่ขาดจากค่าที่บันทึกไว้จะถูกเติมกลับตามลำดับนี้ */
export const DEFAULT_ORDER: BlockKey[] = [...BLOCK_KEYS];

/** 🚨 `Record<BlockKey, …>` โดยตั้งใจ — เพิ่มบล็อกแล้วลืมตั้งชื่อ = build ไม่ผ่าน (D84) */
export const BLOCK_LABEL: Record<BlockKey, string> = {
  logo: "โลโก้",
  shopName: "หัวกระดาษ + ชื่อร้าน",
  sellerAddress: "ที่อยู่ร้าน",
  sellerTaxId: "เลขประจำตัวผู้เสียภาษี",
  sellerPhone: "เบอร์โทร",
  headText: "ข้อความหัวบิล",
  docNo: "เลขที่เอกสาร",
  printedAt: "วันเวลาที่พิมพ์",
  buyer: "ข้อมูลลูกค้า",
  channel: "ป้ายช่องทาง/งาน",
  lines: "รายการที่สั่ง",
  totals: "ยอดรวม/ส่วนลด",
  vat: "แยกภาษีมูลค่าเพิ่ม",
  compSummary: "สรุปของแถม",
  qr: "คิวอาร์รับเงิน",
  voidStamp: "ตราบิลยกเลิก",
  footer: "ข้อความท้ายบิล",
};

/** บล็อกที่ปิดไม่ได้ไม่ว่ากรณีใด — ไม่มีสิ่งนี้บนกระดาษก็ไม่ใช่บิล */
const ALWAYS_ON: BlockKey[] = ["shopName", "lines", "totals", "voidStamp"];

/**
 * เหตุผลเฉพาะราย สำหรับบล็อกที่ล็อกด้วยเหตุผลอื่นที่ไม่ใช่ "ไม่มีแล้วไม่ใช่บิล"
 * 🚨 `voidStamp` ล็อกเพราะ **บิลที่ถูกยกเลิกต้องบอกบนกระดาษ** — ปิดได้เมื่อไหร่
 *    ใบที่ถูกยกเลิกจะพิมพ์ออกมาหน้าตาเหมือนใบปกติทุกประการ
 */
const ALWAYS_ON_REASON: Partial<Record<BlockKey, string>> = {
  voidStamp: "ปิดไม่ได้ — บิลที่ถูกยกเลิกต้องบอกบนกระดาษ",
};

/**
 * บล็อกที่กฎหมายบังคับเมื่อกิจการจด VAT
 * ⚠️ ผมไม่ใช่ที่ปรึกษาภาษี — รายการนี้อิงข้อกำหนดใบกำกับภาษีอย่างย่อ
 *    ให้ผู้ทำบัญชียืนยันก่อนใช้จริง (ดู `docs/GOLIVE_CHECKLIST.md`)
 */
const VAT_REQUIRED: BlockKey[] = ["sellerTaxId", "docNo", "printedAt", "vat"];

/** บล็อกที่เริ่มมาในสภาพ **ปิด** — เปิดเองได้ */
const DEFAULT_OFF: BlockKey[] = ["logo", "channel", "headText"];

export type PaperWidth = 80 | 58;

/** ค่าที่ผู้ใช้บันทึกไว้ (JSON ก้อนเดียวใน `app_settings` kind `bar_receipt_layout`) */
export type ReceiptLayout = {
  order: BlockKey[];
  /**
   * ชื่อร้านบนหัวกระดาษ — ผู้ใช้กรอกเอง
   *
   * 🚨 **ไม่ใช่ชื่อกิจการ (entity)** — บาร์มีชื่อร้านของตัวเอง ส่วนชื่อกิจการเป็นชื่อ
   *    ทางทะเบียนที่ลูกค้าหน้าบาร์ไม่รู้จัก · ค่าว่าง = ใช้ชื่อกิจการแทน
   *    (กระดาษต้องมีชื่อร้านเสมอ — `shopName` อยู่ใน `ALWAYS_ON`)
   */
  shopName: string;
  /** คีย์ที่ถูกปิด — เก็บ "ที่ปิด" ไม่ใช่ "ที่เปิด" เพื่อให้บล็อกใหม่เปิดเองโดยปริยาย */
  off: BlockKey[];
  headText: string;
  footer: string;
  paper: PaperWidth;
  fontLarge: boolean;
  /**
   * โลโก้บนบิลของบาร์ (URL)
   *
   * 🚨 **แยกจากโลโก้แบรนด์ในหน้าตั้งค่ากลางโดยตั้งใจ** — บาร์มักขายในนาม
   *    **อีกกิจการหนึ่ง** (เช่น EID02 ของเจ้าของ) ซึ่งเป็นคนละแบรนด์กับโรงกลั่น
   *    ใช้โลโก้ร่วมกัน = บิลบาร์ขึ้นโลโก้โรงเหล้าให้ลูกค้าเห็น ซึ่งผิดทั้งภาพลักษณ์
   *    และผิดในแง่ว่าใครเป็นผู้ขายบนกระดาษใบนั้น
   * ★ เก็บใน JSON ของผัง จึง **ไม่ต้องเพิ่ม kind ใหม่และไม่ต้องมี migration**
   *   (นี่คือเหตุผลที่ 0070 เลือกเก็บเป็นก้อนเดียวตั้งแต่แรก)
   */
  logoUrl: string;
};

export type ResolvedLayout = {
  /** ลำดับที่เรนเดอร์จริง — ครบทุกคีย์เสมอ */
  order: BlockKey[];
  /** ชื่อร้านที่ผู้ใช้กรอก (ดิบ · ค่าว่างได้) — ตัวที่พิมพ์จริงใช้ `shopNameOf()` */
  shopName: string;
  /** เปิดอยู่ไหม (รวมกฎบังคับแล้ว) */
  on: (k: BlockKey) => boolean;
  /** ปิดไม่ได้ไหม — ใช้ทำสวิตช์เทาพร้อมเหตุผล ไม่ใช่ซ่อนสวิตช์ (D86) */
  locked: (k: BlockKey) => boolean;
  /**
   * เหตุผลที่ปิดไม่ได้ (ภาษาไทย พร้อมแสดง) — `null` = ปิดได้
   *
   * 🚨 **เหตุผลต้องมาจาก "ชุดไหนเป็นคนล็อก" ไม่ใช่จาก "กิจการจด VAT ไหม"**
   *    ชื่อร้าน/รายการ/ยอดรวม ถูกล็อกด้วย `ALWAYS_ON` เสมอ — ไม่เกี่ยวกับ VAT เลย
   *    เขียนเป็น `isVat ? A : B` ที่หน้าจอ = พอกิจการจด VAT ปุ๊บ ชื่อร้านจะขึ้นเหตุผลว่า
   *    *"ใบกำกับภาษีต้องมี"* ซึ่ง**ไม่จริง** และชวนให้เข้าใจว่าถ้าเลิกจด VAT จะปิดได้
   *    (ตระกูล D91/0059: ตรรกะถูกทุกประการ ที่ผิดคือประโยคที่ผู้ใช้อ่านแล้วสรุป)
   * ★ `locked()` คำนวณจากตัวนี้ตัวเดียว จึงหลุดจากกันไม่ได้
   */
  lockReason: (k: BlockKey) => string | null;
  headText: string;
  footer: string;
  paper: PaperWidth;
  fontLarge: boolean;
  /** URL โลโก้ของบาร์ — ค่าว่าง = ไม่มีโลโก้ (บล็อก `logo` จะไม่วาดอะไร) */
  logoUrl: string;
};

const isKey = (x: unknown): x is BlockKey => BLOCK_KEYS.includes(x as BlockKey);

/**
 * คีย์ที่ **เปลี่ยนชื่อ** ระหว่างทาง — ค่าที่ลูกค้าบันทึกไว้ยังเป็นชื่อเก่า
 *
 * 🚨 ไม่แปลงชื่อให้ = คีย์เก่าถูกทิ้ง แล้วคีย์ใหม่ไปต่อท้ายสุด ⇒ **บล็อกย้ายตำแหน่งเอง
 *    บนกระดาษของลูกค้าที่เคยจัดผังไว้แล้ว** (ตราบิลยกเลิกไปโผล่ใต้ข้อความท้ายบิล)
 * ★ การเปลี่ยนชื่อคีย์เป็นเรื่องของเรา ไม่ใช่การตัดสินใจของลูกค้า — ตำแหน่งต้องอยู่ที่เดิม
 */
const RENAMED: Record<string, BlockKey> = {
  /** D97: เดิมเป็น "ตราชำระแล้ว" · ตอนนี้เหลือเฉพาะตราบิลยกเลิก */
  paidStamp: "voidStamp",
};

/** อ่านคีย์จากค่าที่บันทึกไว้ (แปลงชื่อเก่าให้) — `null` = คีย์ที่ระบบไม่รู้จักแล้ว */
const readKey = (x: unknown): BlockKey | null => {
  const k = typeof x === "string" && x in RENAMED ? RENAMED[x] : x;
  return isKey(k) ? k : null;
};

/**
 * ประกอบผังที่เรนเดอร์จริงจากค่าที่บันทึกไว้
 *
 * 🚨 **ทนของแปลกได้เสมอ** — ค่าที่บันทึกไว้อาจมาจากเวอร์ชันก่อนหน้า มีคีย์ที่ถูกลบไปแล้ว
 *    หรือขาดคีย์ที่เพิ่งเพิ่ม · พังตรงนี้ = พิมพ์บิลไม่ได้ทั้งร้าน
 */
export function resolveLayout(
  saved: Partial<ReceiptLayout> | null | undefined,
  opts: { isVat: boolean },
): ResolvedLayout {
  const savedOrder: BlockKey[] = Array.isArray(saved?.order)
    ? saved!.order.map(readKey).filter((k): k is BlockKey => k !== null)
    : [];
  // ตัดคีย์ซ้ำ แล้วเติมคีย์ที่ขาดต่อท้ายตามลำดับปริยาย (กติกาข้อ 1)
  const seen = new Set<BlockKey>();
  const order: BlockKey[] = [];
  for (const k of savedOrder) {
    if (seen.has(k)) continue;
    seen.add(k);
    order.push(k);
  }
  for (const k of DEFAULT_ORDER) {
    if (!seen.has(k)) order.push(k);
  }

  const off = new Set<BlockKey>(
    Array.isArray(saved?.off)
      ? saved!.off.map(readKey).filter((k): k is BlockKey => k !== null)
      : DEFAULT_OFF,
  );
  const required = new Set<BlockKey>([...ALWAYS_ON, ...(opts.isVat ? VAT_REQUIRED : [])]);

  // ★ `ALWAYS_ON` มาก่อนเสมอ — บล็อกที่อยู่ทั้งสองชุดต้องได้เหตุผลที่จริงกว่า
  const lockReason = (k: BlockKey): string | null => {
    if (ALWAYS_ON.includes(k)) return ALWAYS_ON_REASON[k] ?? "ปิดไม่ได้ — ไม่มีแล้วไม่ใช่บิล";
    if (opts.isVat && VAT_REQUIRED.includes(k)) return "ปิดไม่ได้ — ใบกำกับภาษีต้องมี";
    return null;
  };

  return {
    order,
    shopName: String(saved?.shopName ?? "").trim(),
    on: (k) => required.has(k) || !off.has(k),
    locked: (k) => lockReason(k) !== null,
    lockReason,
    headText: String(saved?.headText ?? ""),
    footer: String(saved?.footer ?? ""),
    paper: saved?.paper === 58 ? 58 : 80,
    fontLarge: Boolean(saved?.fontLarge),
    logoUrl: String(saved?.logoUrl ?? "").trim(),
  };
}

/** ค่าเริ่มต้นสำหรับ tenant ที่ยังไม่เคยตั้ง */
export function defaultLayout(): ReceiptLayout {
  return {
    order: [...DEFAULT_ORDER],
    off: [...DEFAULT_OFF],
    shopName: "",
    headText: "",
    footer: "",
    paper: 80,
    fontLarge: false,
    logoUrl: "",
  };
}

/**
 * ชื่อร้านที่พิมพ์จริงบนกระดาษ
 * 🚨 **ไม่มีทางคืนค่าว่าง** — ยังไม่ได้ตั้งชื่อร้าน = ใช้ชื่อกิจการไปก่อน
 *    กระดาษที่ไม่มีชื่อผู้ขายใช้ไม่ได้ทั้งในแง่ลูกค้าและในแง่กฎหมาย
 */
export function shopNameOf(custom: string | null | undefined, sellerName: string): string {
  return String(custom ?? "").trim() || String(sellerName ?? "").trim();
}

/**
 * บรรทัดชื่อทางทะเบียนที่ต้องพิมพ์กำกับใต้ชื่อร้าน — `null` = ไม่ต้องพิมพ์
 *
 * 🚨 **ใบกำกับภาษีอย่างย่อต้องมีชื่อผู้ประกอบการตามทะเบียน** ตั้งชื่อร้านเป็นชื่อทางการค้า
 *    แล้วชื่อทะเบียนหายไปเลย = ใบกำกับที่ใช้ไม่ได้ทั้งคืนโดยไม่มีอะไรฟ้อง
 * ★ กิจการที่ไม่ได้จด VAT ไม่ต้องมี (ใบเสร็จธรรมดา) · ชื่อตรงกันอยู่แล้วก็ไม่ต้องพิมพ์ซ้ำ
 */
export function legalNameLine(opts: {
  shopName: string;
  sellerName: string;
  isVat: boolean;
}): string | null {
  if (!opts.isVat) return null;
  const legal = String(opts.sellerName ?? "").trim();
  if (!legal || legal === opts.shopName.trim()) return null;
  return legal;
}

/** บล็อกที่เป็น "ข้อความที่ผู้ใช้พิมพ์เอง" — ชื่อฟิลด์กับชื่อบล็อกตรงกันโดยตั้งใจ */
export const TEXT_BLOCKS = ["headText", "footer"] as const;
export type TextBlock = (typeof TEXT_BLOCKS)[number];

/**
 * บล็อกข้อความที่ **กรอกไว้แล้วแต่ปิดอยู่** ⇒ พิมพ์ออกมาจะไม่มีข้อความนั้นบนกระดาษ
 *
 * 🐛 เจอบนจอตอนเทสเฟส G: `headText` อยู่ใน `DEFAULT_OFF` (ปริยายปิด)
 *    ผู้ใช้พิมพ์ข้อความหัวบิลลงไปแล้ว **พรีวิวไม่ขยับเลยและไม่มีอะไรอธิบาย**
 *    จะสรุปว่าช่องนี้เสีย — ทั้งที่ระบบทำถูกตามที่ตั้งไว้
 * 🚨 *ทุกครั้งที่ระบบไม่ทำอะไรให้ ต้องบอกว่าทำไม* (D92)
 */
export function filledButOff(
  saved: Partial<ReceiptLayout> | null | undefined,
  L: ResolvedLayout,
): TextBlock[] {
  return TEXT_BLOCKS.filter((k) => String(saved?.[k] ?? "").trim() !== "" && !L.on(k));
}

/** ย้ายบล็อกขึ้น/ลง 1 ขั้น — ★ ใช้ ▲▼ ไม่ใช่ลาก (ทัชสกรีนชนกับการเลื่อนหน้า · D70) */
export function moveBlock(order: readonly BlockKey[], key: BlockKey, dir: -1 | 1): BlockKey[] {
  const i = order.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return [...order];
  const out = [...order];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/* ── ตัวแปรในข้อความหัว/ท้ายบิล ─────────────────────────────────────────── */

/**
 * 🚨 **ชุดปิด · กดปุ่มแทรกอย่างเดียว** — ห้ามมีเงื่อนไข ห้ามมีสูตร
 *    ไม่งั้นซ้ำรอย "ห้ามทำภาษาสูตร" (D67/D70)
 */
export const TOKENS = ["ชื่อร้าน", "เลขบิล", "ยอด", "วันที่", "ชื่อลูกค้า"] as const;
export type TokenName = (typeof TOKENS)[number];

export type TokenValues = Partial<Record<TokenName, string>>;

/**
 * แทนค่าตัวแปรในข้อความ
 *
 * 🚨 **ตัวแปรที่ไม่รู้จักต้องคงข้อความเดิมไว้ ห้ามกลายเป็น `undefined`**
 *    ผู้ใช้พิมพ์ `{ชื่อรัาน}` ผิดหนึ่งตัว แล้วบิลทั้งคืนพิมพ์คำว่า undefined = ของเสียทั้งม้วน
 * 🚨 ค่าที่มีแต่ไม่มีข้อมูล (เช่นบิลไม่ได้ระบุลูกค้า) → **แทนด้วยค่าว่าง** ไม่ใช่ทิ้งวงเล็บไว้
 */
export function fillTokens(text: string, values: TokenValues): string {
  if (!text) return "";
  return text.replace(/\{([^{}]*)\}/g, (whole, name: string) => {
    const key = name.trim() as TokenName;
    if (!(TOKENS as readonly string[]).includes(key)) return whole; // ไม่รู้จัก = ปล่อยไว้ตามเดิม
    return values[key] ?? "";
  });
}

/* ── ขนาดกระดาษ ──────────────────────────────────────────────────────────── */

/**
 * ความกว้างที่พิมพ์ได้จริง (มม.) — กระดาษ 80 พิมพ์ได้ ~72 · กระดาษ 58 พิมพ์ได้ ~48
 * 🚨 **QR ต้องกว้าง ≥ 25 มม. เสมอ** ต่ำกว่านั้นกล้องจับไม่ติดบนกระดาษความร้อน
 */
export function paperMetrics(paper: PaperWidth): { printable: number; qr: number } {
  const printable = paper === 58 ? 48 : 72;
  const qr = Math.max(25, Math.round(printable * 0.42));
  return { printable, qr };
}
