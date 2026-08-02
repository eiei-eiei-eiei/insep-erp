import type { Branding } from "@/lib/shared/branding";
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
  branding: Branding;
  /** กิจการที่ใช้ออกเอกสารการค้า (app_settings sales_doc_entity) */
  docEntityId: string;
};
