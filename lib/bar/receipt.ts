/**
 * lib/bar/receipt — **เนื้อหา** ของสลิป/ใบเสร็จ (golden B8 · D96)
 *
 * ★ ไฟล์นี้ตัดสินว่า "บนกระดาษมีอะไรบ้าง" — ส่วน HTML/CSS อยู่ใน `print80.ts`
 *   แยกกันเพราะเนื้อหาต้องมีเทสคุม ส่วนหน้าตาต้องดูด้วยตา (บทเรียน D94)
 *
 * ── 🚨 กติกาข้อเดียวที่ห้ามพลาด: QR บนกระดาษที่จ่ายแล้ว = ลูกค้าจ่ายซ้ำ ────────
 * QR บนจอหายไปเองเมื่อปิดหน้า แต่ **กระดาษอยู่กับลูกค้าตลอดไป**
 * ถ้าใบที่ปิดบิลแล้วยังมี QR ติดอยู่ ลูกค้าหยิบมาสแกนอีกทีคืนหน้า = โอนซ้ำ
 * ⇒ `hasQr` ผูกกับ `status === 'เปิดอยู่'` **เท่านั้น** ตัดสินที่นี่จุดเดียว
 *   (ตระกูลเดียวกับ D91/0059 — ตรรกะถูกแต่กระดาษบอกอีกอย่าง)
 *
 * ── 🚫 ไม่พิมพ์ป้ายช่องทาง/งาน ลงบิล (ผู้ใช้สั่ง) ──────────────────────────
 *   ป้ายนั้นมีไว้ดูรายงานว่า "บูธงานนี้คุ้มไหม" ไม่ใช่ข้อมูลที่ลูกค้าต้องเห็น
 */
import type { CartLine } from "./types";
import { lineAmount, type BarTotals } from "./totals";
import { vatFromGross, vatLabel, type VatSplit } from "./vat";
import {
  fillTokens,
  legalNameLine,
  resolveLayout,
  shopNameOf,
  type ReceiptLayout,
  type ResolvedLayout,
} from "./layout";

export type BarSaleStatus = "เปิดอยู่" | "ปกติ" | "ยกเลิก";

export type DocKind = "bill-unpaid" | "bill-paid" | "receipt";

/**
 * ── หัวกระดาษของกิจการที่จด VAT (D96 เฟส F) ─────────────────────────────────
 * 🚨 ผู้ประกอบการจด VAT ที่ขายปลีกต้องออก **ใบกำกับภาษีอย่างย่อ** ทุกครั้งที่ขาย
 *    ⇒ ใบเสร็จของบาร์ที่จด VAT คือใบกำกับอย่างย่อในตัว ไม่ใช่เอกสารคนละใบ
 * ⚠️ **การใช้เครื่อง POS ออกใบกำกับอย่างย่อต้องยื่นขออนุมัติสรรพากรก่อน**
 *    ระบบพร้อมออกให้ แต่คนต้องไปขอเอง → `docs/GOLIVE_CHECKLIST.md`
 */
const TITLE_VAT: Record<DocKind, string> = {
  "bill-unpaid": "ใบแจ้งรายการ",
  "bill-paid": "ใบแจ้งรายการ",
  receipt: "ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ",
};

export type ReceiptSeller = {
  name: string;
  address?: string | null;
  taxId?: string | null;
  branch?: string | null;
  phone?: string | null;
  /**
   * กิจการนี้จด VAT ไหม (D96 เฟส F)
   * 🚨 ไม่ได้ส่งมา = **ถือว่าไม่จด** — เดาว่าจดแล้วออกใบกำกับให้คนที่ไม่ได้จด
   *    คือความผิดตาม ม.86/13 ส่วนเดาว่าไม่จดแค่ทำให้ใบขาดข้อมูล (แก้ได้ ไม่ผิดกฎหมาย)
   */
  isVat?: boolean;
};

export type ReceiptBuyer = {
  name: string;
  address?: string | null;
  taxId?: string | null;
  branch?: string | null;
};

export type ReceiptInput = {
  status: BarSaleStatus;
  saleNo: string;
  rcptNo?: string | null;
  /** ขอออกใบเสร็จรับเงินหรือยัง */
  wantReceipt?: boolean;
  lines: readonly (CartLine & { voidedAt?: string | null })[];
  totals: BarTotals;
  seller: ReceiptSeller;
  buyer?: ReceiptBuyer | null;
  /**
   * เวลาที่ปิดบิล — ใช้เป็น {วันที่} ในข้อความหัว/ท้ายบิลเท่านั้น
   * 🚫 **ไม่มีช่อง `method` แล้ว** — ตราชำระแล้วถูกตัดออก จึงไม่มีใครอ่านค่านั้นอีก
   *    (ปล่อยช่องที่ไม่มีใครอ่านไว้ = ช่องหลอกแบบ `employees.end_date` ของ D76)
   */
  closedAt?: string | null;
  printedAt: string;
  footer?: string | null;
  /** payload จาก `promptPayPayload()` — `null` = ตั้งค่าไม่ครบ */
  qrPayload?: string | null;
  /** ผังที่ผู้ใช้จัดเอง (D96 เฟส G) — ไม่ส่งมา = ใช้ผังปริยาย */
  layout?: Partial<ReceiptLayout> | null;
  /** ป้ายช่องทาง/งาน — พิมพ์ก็ต่อเมื่อผู้ใช้เปิดสวิตช์เอง (ปริยายปิด) */
  channel?: string | null;
  /**
   * ข้อความกำกับส่วนลดท้ายบิล เช่น `"10%"` (D96)
   * 🚨 **เป็นคำอธิบายเท่านั้น** — ตัวเงินที่พิมพ์คือ `totals.discount` ซึ่งถูกคิดมาแล้ว
   *    ห้ามให้กระดาษคิด % เอง ไม่งั้นเลขบนใบกับเลขในบัญชีจะไม่ตรงกัน
   */
  discountLabel?: string | null;
};

export type ReceiptLine = { name: string; qty: number; price: number; amount: number; comp: boolean };

export type ReceiptDoc = {
  kind: DocKind;
  /** หัวกระดาษภาษาไทย */
  title: string;
  docNo: string;
  lines: ReceiptLine[];
  totals: BarTotals;
  seller: ReceiptSeller;
  buyer: ReceiptBuyer | null;
  /** โชว์ QR ไหม — ดูเหตุผลหัวไฟล์ */
  hasQr: boolean;
  qrPayload: string | null;
  /** ผังที่เรนเดอร์จริง — `print80.ts` วนตามนี้ ไม่ใช่ลำดับตายตัวในตัวมันเอง */
  layout: ResolvedLayout;
  /**
   * ชื่อร้านที่พิมพ์บนหัวกระดาษ — ผู้ใช้ตั้งเองในผัง · ไม่ได้ตั้ง = ชื่อกิจการ
   * 🚨 กระดาษต้องอ่านชื่อจาก **ตัวนี้** ไม่ใช่ `seller.name` (ไม่งั้นชื่อที่ตั้งไว้ไม่มีผล)
   */
  shopName: string;
  /**
   * ชื่อตามทะเบียนที่พิมพ์กำกับใต้ชื่อร้าน — `null` = ไม่ต้องพิมพ์
   * ★ มีเฉพาะกิจการจด VAT ที่ตั้งชื่อร้านต่างจากชื่อทะเบียน (ใบกำกับต้องมีชื่อผู้ประกอบการ)
   */
  legalName: string | null;
  logoUrl: string | null;
  /** ข้อความหัวบิลที่แทนค่าตัวแปรแล้ว */
  headText: string;
  channel: string | null;
  /** ข้อความกำกับส่วนลดท้ายบิล เช่น "10%" — null = กรอกเป็นบาท/ไม่มีส่วนลด */
  discountLabel: string | null;
  /**
   * ยอดแยกภาษี — `null` เมื่อกิจการไม่ได้จด VAT (สลิปหน้าตาเดิมทุกประการ)
   * ★ ถอดจาก `totals.grandTotal` = เงินที่รับจริง (golden B11)
   */
  vat: VatSplit | null;
  /** "ภาษีมูลค่าเพิ่ม 7%" — null คู่กับ `vat` */
  vatLabel: string | null;
  /**
   * ประทับ "บิลนี้ถูกยกเลิก" — `null` = บิลปกติ
   *
   * 🚫 **ไม่มีตรา "ชำระแล้ว · วิธีจ่าย · เวลา" อีกแล้ว** (ผู้ใช้สั่งตัดออก) —
   *    ใบเสร็จบอกอยู่แล้วว่ารับเงินแล้ว การประทับซ้ำเป็นกล่องรกกระดาษเปล่า ๆ
   * 🚨 แต่ **บิลที่ถูกยกเลิกยังต้องเขียนบนกระดาษเสมอ** ไม่งั้นใบที่ยกเลิกแล้ว
   *    พิมพ์ออกมาหน้าตาเหมือนใบปกติ (`voidStamp` จึงอยู่ใน `ALWAYS_ON`)
   */
  voidStamp: string | null;
  printedAt: string;
  footer: string | null;
};

/** ชนิดเอกสารที่ควรออก จากสถานะบิล + ผู้ใช้กดขอใบเสร็จหรือยัง */
export function docKind(input: Pick<ReceiptInput, "status" | "wantReceipt">): DocKind {
  if (input.wantReceipt) return "receipt";
  return input.status === "เปิดอยู่" ? "bill-unpaid" : "bill-paid";
}

const TITLE: Record<DocKind, string> = {
  "bill-unpaid": "ใบแจ้งรายการ",
  "bill-paid": "ใบแจ้งรายการ",
  receipt: "ใบเสร็จรับเงิน",
};

/**
 * มี QR ได้ไหม
 * 🚨 เงื่อนไขเดียว: **บิลยังไม่ถูกปิด** · ใบเสร็จไม่มี QR เด็ดขาด
 *    (ไม่ผูกกับ `method` — ลูกค้าอาจเปลี่ยนใจจ่ายสดหลังเห็นบิลแล้ว)
 */
export function shouldShowQr(input: Pick<ReceiptInput, "status" | "wantReceipt" | "qrPayload">): boolean {
  if (docKind(input) !== "bill-unpaid") return false;
  return Boolean(input.qrPayload);
}

/** ประกอบเอกสาร — ไม่มี HTML สักตัวอักษรเดียว */
export function buildReceipt(input: ReceiptInput): ReceiptDoc {
  const kind = docKind(input);
  const live = input.lines.filter((l) => !l.voidedAt);
  const hasQr = shouldShowQr(input);

  const voidStamp = input.status === "ยกเลิก" ? "บิลนี้ถูกยกเลิก" : null;

  // 🚨 ถอดภาษีจาก **ยอดสุทธิ** เท่านั้น (หลังส่วนลด + ปัดเศษ) — ดูเหตุผลใน vat.ts
  const isVat = Boolean(input.seller.isVat);
  const vat = isVat ? vatFromGross(input.totals.grandTotal) : null;

  /**
   * 🚨 กติกาที่บังคับตามกฎหมาย (บรรทัดที่ปิดไม่ได้เมื่อจด VAT) ตัดสินใน
   *    `resolveLayout()` **ที่เดียว** — ห้ามให้หน้าจอกับกระดาษตัดสินคนละที่
   */
  const layout = resolveLayout(input.layout, { isVat });

  /**
   * ★ ตัวแปรในข้อความหัว/ท้าย แทนค่าที่นี่ **ก่อนถึงกระดาษ**
   *   กระดาษไม่ควรรู้จักเรื่องตัวแปรเลย (มันมีหน้าที่วาดอย่างเดียว)
   */
  const shopName = shopNameOf(layout.shopName, input.seller.name);

  const tokens = {
    // ★ ตัวแปร {ชื่อร้าน} = ชื่อที่พิมพ์บนหัวกระดาษ ไม่ใช่ชื่อกิจการ
    //   (ผู้ใช้กดแทรกตัวแปรแล้วต้องได้ชื่อเดียวกับที่ตาเห็นข้างบน)
    ชื่อร้าน: shopName,
    เลขบิล: kind === "receipt" ? (input.rcptNo ?? input.saleNo) : input.saleNo,
    ยอด: input.totals.grandTotal.toLocaleString("en-US", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }),
    วันที่: (input.closedAt ?? input.printedAt).split(" ")[0] ?? "",
    ชื่อลูกค้า: input.buyer?.name ?? "",
  };

  return {
    kind,
    title: (isVat ? TITLE_VAT : TITLE)[kind],
    docNo: kind === "receipt" ? (input.rcptNo ?? input.saleNo) : input.saleNo,
    lines: live.map((l) => ({
      name: l.menuName,
      qty: l.qty,
      price: l.price,
      amount: lineAmount(l),
      comp: Boolean(l.isComp),
    })),
    totals: input.totals,
    seller: input.seller,
    buyer: input.buyer ?? null,
    hasQr,
    qrPayload: hasQr ? (input.qrPayload ?? null) : null,
    layout,
    shopName,
    legalName: legalNameLine({ shopName, sellerName: input.seller.name, isVat }),
    // ★ โลโก้อยู่ในผังของบาร์เอง **ไม่ใช่โลโก้แบรนด์ของ tenant**
    //   บาร์มักขายในนามอีกกิจการหนึ่ง (คนละแบรนด์กับโรงกลั่น)
    logoUrl: layout.logoUrl || null,
    headText: fillTokens(layout.headText, tokens),
    channel: input.channel?.trim() || null,
    discountLabel: input.totals.discount > 0 ? (input.discountLabel ?? null) : null,
    vat,
    vatLabel: vat ? vatLabel() : null,
    voidStamp,
    printedAt: input.printedAt,
    // ★ ข้อความท้ายบิลมาจาก 2 ทาง — ผังใหม่ (แทนค่าตัวแปรได้) หรือค่าเดิมที่ส่งมาตรง ๆ
    //   ผังชนะเมื่อมีค่า เพื่อให้ที่ตั้งค่าใหม่เป็นแหล่งความจริงเดียว
    footer: fillTokens(layout.footer, tokens).trim() || input.footer?.trim() || null,
  };
}
