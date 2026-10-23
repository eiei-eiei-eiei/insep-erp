/**
 * lib/accounting/bankAccounts — กติกาบัญชีเงิน (D125)
 *
 * ★ บิลอ้างบัญชีด้วย "ชื่อ" (ยกมาจากชีทเดิม) ⇒ เปลี่ยนชื่อ/ลบต้องไปทาง RPC ของ 0089 เท่านั้น
 *   (`fn_rename_bank_account` ตามไปแก้ทุกที่ที่เก็บชื่อ · `fn_delete_bank_account` ลบได้เฉพาะที่ไม่มีใครใช้)
 * ★ ประโยคบนจอทุกตัวตัดสินที่นี่ ไม่ใช่ในคอมโพเนนต์ (D84/D91)
 */

/**
 * kind ของ app_settings ที่เก็บ "ชื่อบัญชีเงิน"
 * 🚨 ต้องตรงกับ `fn_account_setting_kinds()` ใน migration 0089 (bankAccountsSql.test.ts เทียบให้)
 *    ตกตัวไหน = เปลี่ยนชื่อบัญชีแล้วค่าตั้งนั้นชี้ไปบัญชีที่ไม่มีอยู่ เงียบ ๆ
 */
export const ACCOUNT_SETTING_LABEL = {
  sales_revenue_account: "บัญชีรับรายได้ขาย (ตั้งค่า → กิจการ)",
  bar_revenue_account: "บัญชีรายได้บาร์ (บาร์ → ตั้งค่า)",
  bar_cash_account: "บัญชีเงินสดบาร์ (บาร์ → ตั้งค่า)",
  payroll_pay_account: "บัญชีจ่ายเงินเดือน (เงินเดือน → ตั้งค่า)",
  payroll_sso_account: "บัญชีจ่ายประกันสังคม (เงินเดือน → ตั้งค่า)",
  payroll_wht_account: "บัญชีจ่ายภาษีเงินเดือน (เงินเดือน → ตั้งค่า)",
  tax_account: "บัญชีในระบบภาษี (ไม่ใช้แล้ว · D124)",
} as const;
export type AccountSettingKind = keyof typeof ACCOUNT_SETTING_LABEL;
export const ACCOUNT_SETTING_KINDS = Object.keys(ACCOUNT_SETTING_LABEL) as AccountSettingKind[];

/** ปิดใช้หรือเปล่า — ค่าว่าง (ข้อมูลก่อน 0089) ถือว่าใช้อยู่ */
export function isActiveAccount(a: { active?: boolean | null }): boolean {
  return a.active !== false;
}

type Acc = { account_name: string; entity_ids?: string[] | null; active?: boolean | null };

/**
 * บัญชีที่ให้เลือกในช่องบัญชีของกิจการนี้
 * · `entity_ids` ว่าง = ใช้ร่วมทุกกิจการ · `entityId` = "ALL" หรือว่าง = ไม่กรองกิจการ
 * · ตัดบัญชีที่ปิดใช้ออก **ยกเว้น `keep`** (ค่าที่เลือกอยู่แล้วในบิลที่เปิดมาแก้ —
 *   ตัดทิ้งแล้ว Select จะโชว์ว่าง แล้วกดบันทึก = บิลเก่าหลุดบัญชีเงียบ ๆ)
 */
export function accountsFor<T extends Acc>(accounts: T[], entityId: string | null | undefined, keep?: string | null): T[] {
  return accounts.filter((a) => {
    if (keep && a.account_name === keep) return true;
    if (!isActiveAccount(a)) return false;
    const ids = a.entity_ids ?? [];
    return !entityId || entityId === "ALL" || ids.length === 0 || ids.includes(entityId);
  });
}

/** ฉบับชื่อล้วน (หน้าตั้งค่าที่โหลดแค่ชื่อ) — ตัดที่ปิดใช้ออก ยกเว้นค่าที่เลือกอยู่ */
export function activeAccountNames(rows: { account_name: string; active?: boolean | null }[], keep?: string | null): string[] {
  return rows.filter((r) => isActiveAccount(r) || (keep && r.account_name === keep)).map((r) => r.account_name);
}

/** ตรวจชื่อบัญชีก่อนส่ง — `self` = ชื่อเดิมของบัญชีที่กำลังแก้ (ไม่นับว่าซ้ำกับตัวเอง) */
export function accountNameError(name: string, existing: string[], self?: string | null): string | null {
  const nm = name.trim();
  if (!nm) return "กรอกชื่อบัญชี";
  if (nm.length > 60) return "ชื่อบัญชียาวเกิน 60 ตัวอักษร";
  if (nm !== (self ?? "") && existing.some((e) => e.trim() === nm)) return `มีบัญชีชื่อ "${nm}" อยู่แล้ว`;
  return null;
}

export type AccountUsage = { txCount: number; payCount: number; legCount: number; settingKinds: string[] };

/** ข้อความสั้นบนแถว — "ใช้ใน 120 บิล · ตั้งเป็น บัญชีรับรายได้ขาย" / "ยังไม่มีรายการ" */
export function usageText(u: AccountUsage | undefined): string {
  if (!u) return "—";
  const parts: string[] = [];
  const bills = u.txCount + u.payCount;
  if (bills > 0) parts.push(`ใช้ใน ${bills.toLocaleString("th-TH")} รายการ`);
  if (u.legCount > 0) parts.push("ขาลงบัญชีเงินเดือน");
  for (const k of u.settingKinds) parts.push(ACCOUNT_SETTING_LABEL[k as AccountSettingKind]?.split(" (")[0] ?? k);
  return parts.length ? parts.join(" · ") : "ยังไม่มีรายการ";
}

/**
 * ลบได้ไหม — null = ลบได้ · ข้อความ = เหตุผลที่ลบไม่ได้ + ต้องทำอะไรแทน
 * 🚨 ตัวตัดสินจริงอยู่ใน `fn_delete_bank_account` (ตรวจซ้ำที่ DB) — ตัวนี้มีไว้อธิบายบนจอก่อนกด
 */
export function deleteBlockReason(u: AccountUsage | undefined): string | null {
  if (!u) return "ยังโหลดข้อมูลการใช้งานไม่เสร็จ";
  if (u.txCount + u.payCount > 0) return "มีรายการใช้บัญชีนี้อยู่ — ลบไม่ได้ (บิลเก่าจะหาบัญชีไม่เจอ) ใช้ ปิดใช้ แทน";
  if (u.legCount > 0) return "ถูกตั้งเป็นบัญชีของขาลงบัญชีเงินเดือน — เปลี่ยนที่ เงินเดือน → ตั้งค่า ก่อน";
  if (u.settingKinds.length > 0) {
    const where = u.settingKinds.map((k) => ACCOUNT_SETTING_LABEL[k as AccountSettingKind] ?? k).join(" · ");
    return `ถูกตั้งค่าใช้อยู่ที่ ${where} — เปลี่ยนการตั้งค่านั้นก่อน`;
  }
  return null;
}

/** คำเตือนก่อนปิดใช้ — null = ไม่มีอะไรต้องเตือน */
export function deactivateWarn(u: AccountUsage | undefined, balance: number | null): string | null {
  const notes: string[] = [];
  if (balance != null && Math.abs(balance) >= 0.005) {
    notes.push(`ยังมียอดคงเหลือ ${balance.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท (ยอดยังแสดงในหน้า บัญชี & เงินสด)`);
  }
  if (u && u.settingKinds.length > 0) {
    notes.push(`ยังถูกตั้งค่าใช้อยู่ที่ ${u.settingKinds.map((k) => ACCOUNT_SETTING_LABEL[k as AccountSettingKind] ?? k).join(" · ")} — ระบบยังลงเงินเข้าบัญชีนี้ต่อจนกว่าจะเปลี่ยน`);
  }
  if (u && u.legCount > 0) notes.push("ยังเป็นบัญชีของขาลงบัญชีเงินเดือน");
  return notes.length ? notes.join(" · ") : null;
}

/** สรุปหลังเปลี่ยนชื่อสำเร็จ (จากผลของ fn_rename_bank_account) */
export function renameDoneText(r: { tx?: number; payments?: number; legs?: number; settings?: number }): string {
  const n = (r.tx ?? 0) + (r.payments ?? 0);
  const extra = (r.legs ?? 0) + (r.settings ?? 0);
  const parts = [n > 0 ? `แก้ตามในบิล ${n.toLocaleString("th-TH")} รายการ` : "", extra > 0 ? `ค่าตั้ง ${extra} จุด` : ""].filter(Boolean);
  return parts.length ? `เปลี่ยนชื่อแล้ว — ${parts.join(" · ")}` : "เปลี่ยนชื่อแล้ว";
}

/** คำเตือนในป๊อปอัพก่อนกดบันทึก เมื่อชื่อถูกเปลี่ยน */
export function renameWarnText(oldName: string, u: AccountUsage | undefined): string {
  const bills = (u?.txCount ?? 0) + (u?.payCount ?? 0);
  const refs = (u?.legCount ?? 0) + (u?.settingKinds.length ?? 0);
  if (bills === 0 && refs === 0) return `เปลี่ยนชื่อจาก “${oldName}” — บัญชีนี้ยังไม่มีบิลหรือค่าตั้งที่อ้างถึง`;
  const what = [bills > 0 ? `บิล ${bills.toLocaleString("th-TH")} รายการ` : "", refs > 0 ? `ค่าตั้ง ${refs} จุด` : ""].filter(Boolean).join(" และ ");
  return `เปลี่ยนชื่อจาก “${oldName}” — ระบบจะแก้ชื่อตามใน${what}ให้ด้วย` + (bills > 0 ? " (ประวัติการแก้ไขจะมีแถวเพิ่มตามจำนวนบิล)" : "");
}
