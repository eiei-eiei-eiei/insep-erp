export type Entity = {
  entity_id: string;
  name: string;
  excise_id: string | null;
  is_vat: boolean;
  // ── ข้อมูลที่ขึ้นหัวเอกสารการค้า (D44 · migration 0023) ──
  name_eng?: string | null;
  tax_id?: string | null;
  branch?: string | null;
  address?: string | null;
  phone?: string | null;
  bank_line?: string | null;
};
export type AccountRow = { account_name: string; entity_ids: string[]; opening_balance: number; kind: string | null };
export type Contact = {
  contact_id: string;
  name: string;
  tax_id: string | null;
  branch: string | null;
  address: string | null;
  contact_type: string | null;
  roles: string[] | null;
};
export type MaterialOpt = { material_id: string; name: string; unit: string | null };

export type Bootstrap = {
  role: string;
  entities: Entity[];
  accounts: AccountRow[];
  contacts: Contact[];
  materials: MaterialOpt[];
  expenseCats: string[];
  incomeCats: string[];
  whtRates: string[];
  taxAccounts: string[];
  /** หมวดรายจ่ายที่จุดชนวน "รับวัตถุดิบเข้าสต็อกผลิต" (D80) — ตั้งได้ที่แท็บตั้งค่า */
  forwardCats: string[];
  /** ★ ที่ลูกค้าตั้งเองจริง ๆ (ว่างได้) — หน้าตั้งค่าต้องใช้ตัวนี้ ไม่ใช่ forwardCats
   *  🪤 โชว์ค่าปริยายเป็น chip = ผู้ใช้นึกว่าบันทึกแล้ว พอเพิ่มตัวที่ 2 ค่าปริยายหลุดเงียบ ๆ (D74) */
  forwardCatsSet: string[];
  // ★ branding / docEntityId / line ย้ายไปหน้าตั้งค่ากลาง /settings แล้ว (D63)
};
