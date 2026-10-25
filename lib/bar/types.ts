/**
 * lib/bar/types — ชนิดข้อมูลกลางของโมดูลบาร์ (D96)
 *
 * ★ ไฟล์นี้ไม่มีตรรกะเลยสักบรรทัด — ตรรกะทั้งหมดอยู่ในไฟล์ที่มี golden test คุม
 * 🚨 ห้าม import อะไรจาก `lib/sales` หรือ `lib/production` (กติกาเหล็กข้อ 1 + D92)
 */

/** ของที่บาร์มี — `qty`/`costPerUnit` อยู่ในหน่วยฐาน (หน่วยที่สูตรกิน ไม่ใช่หน่วยที่ซื้อ) */
export type BarItem = {
  itemId: string;
  name: string;
  /** หน่วยฐาน: 'ml' | 'ขวด' | 'ชิ้น' | 'g' */
  unit: string;
  qty: number;
  costPerUnit: number;
  /** 1 หน่วยซื้อ = กี่หน่วยฐาน (ขวด 700ml → 700) · null = ซื้อเป็นหน่วยฐานอยู่แล้ว */
  packSize?: number | null;
  /** ป้ายหน่วยซื้อสำหรับแสดงผล — 'ขวด (700 ml)' */
  packLabel?: string | null;
  lowQty?: number | null;
  active?: boolean;
  /** ลำดับในแถบปุ่มลัด "ใช้บ่อย" ของหน้าสร้างเมนู · null = ไม่ได้ปักหมุด (D127) */
  pinSort?: number | null;
};

/**
 * 1 บรรทัดในสูตร — อ้าง **ขวดตรง** (`itemId`) หรือ **ช่องเหล้าประจำบ้าน** (`slotId`) อย่างใดอย่างหนึ่ง (D127)
 *
 * 🚨 ช่องต้องถูกแปลงเป็นขวดก่อนคิดต้นทุน/ตัดสต็อกทุกครั้ง — `resolveRecipe()` ใน houseSlot.ts
 *    ชนิดข้อมูลตั้งใจให้ `itemId` เป็น `string | undefined` ⇒ โค้ดที่หยิบ `itemId` ไปใช้ตรง ๆ
 *    โดยไม่แปลงช่องก่อน **build ไม่ผ่าน** (บทเรียน D84 — ของใหม่ต้องไม่ตกเข้า else เงียบ ๆ)
 */
export type BarRecipeLine =
  | { itemId: string; qty: number; slotId?: undefined }
  | { slotId: string; qty: number; itemId?: undefined };

/** บรรทัดสูตรที่แปลงช่องเป็นขวดแล้ว — ใช้คิดต้นทุน/ตัดสต็อก */
export type BarItemLine = { itemId: string; qty: number };

/**
 * ช่องเหล้าประจำบ้าน (House Gin / House Vodka …) — ชี้ไปที่ขวด 1 ตัวเสมอ (D127)
 * 🚨 `itemId` **ว่างไม่ได้** (ผู้ใช้เลือก: บังคับเลือกขวดตั้งแต่สร้าง) ⇒ ไม่มีสถานะ "ช่องว่าง"
 *    ที่จะทำให้ขายแล้วต้นทุน 0 เงียบ ๆ
 */
export type HouseSlot = { slotId: string; name: string; itemId: string; sort: number };

/** ชุดตกแต่ง — กดแล้วบวกจำนวนเข้าบรรทัดของวัตถุดิบนั้นในสูตร (D127) */
export type BarGarnish = { garnishId: string; name: string; itemId: string; qty: number; sort: number };

/**
 * เมนูขาย — โหมดต้นทุนตัดสินจาก `recipe` และ `fixedCost` (ดู `menuMode()` ใน recipe.ts)
 * 🚨 `createdFor` เป็น **ป้ายบอกที่มา ไม่ใช่สิทธิ์** — ห้ามเอาไปกรองเมนูออกจากคนอื่น
 */
export type BarMenu = {
  menuId: string;
  name: string;
  price: number;
  /** โหมด "ต้นทุนตายตัว" (อาหาร/กับแกล้มที่ BOM ไม่คุ้มจะคีย์) · null = ไม่ใช่โหมดนี้ */
  fixedCost?: number | null;
  categoryId: string;
  /** ว่าง = ยังไม่มีสูตร */
  recipe: BarRecipeLine[];
  method?: string | null;
  glass?: string | null;
  note?: string | null;
  createdFor?: string | null;
  active?: boolean;
  /** ลำดับในหมวดของตัวเอง (ว่าง = ต่อท้ายตามชื่อ) */
  sort?: number | null;
  /** ลำดับในหน้า "ทั้งหมด" — ตั้งแยกจาก `sort` (D108 · ผู้ใช้เลือกให้แต่ละหน้าไม่มีผลต่อกัน) */
  sortAll?: number | null;
};

/** 1 บรรทัดในตะกร้า/บิล */
export type CartLine = {
  menuId: string | null;
  /** snapshot ชื่อ ณ ตอนสั่ง — เมนูถูกเปลี่ยนชื่อทีหลังได้ */
  menuName: string;
  qty: number;
  price: number;
  /** ส่วนลดต่อรายการ (บาท) — **นี่คือตัวจริงที่ลงบัญชี** */
  lineDiscount?: number;
  /**
   * ผู้ใช้เลือกลดเป็น % — เก็บไว้เพื่อ **คิดบาทสดระหว่างที่ยังอยู่ในถาด** และพิมพ์บนสลิป
   * 🚨 ไม่ใช่ตัวเงิน · พอส่งเข้าบิลแล้วค่าบาทถูกแช่ลง DB และ % ไม่มีผลอีก (D75)
   */
  lineDiscountPct?: number | null;
  /** ของแถม — ยอดขาย 0 แต่ **ต้นทุนยังนับ** */
  isComp?: boolean;
};

/** รอบขาย — `start === end` แปลว่า "ไม่ได้ตั้งรอบ" (ใช้วันตามปฏิทิน) */
export type SaleWindow = {
  /** 'HH:mm' */
  start: string;
  /** 'HH:mm' */
  end: string;
};

export type BarCategory = {
  categoryId: string;
  name: string;
  sort: number;
  isSystem?: boolean;
};

/** หมวดที่เมนูใหม่จากหน้าขายตกลงมา — ห้ามลบ (`is_system`) */
export const CUSTOM_CATEGORY_ID = "custom";
