import type { Branding } from "@/lib/shared/branding";
export type Entity = { entity_id: string; name: string; excise_id: string | null; is_vat: boolean };
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
};
