/**
 * D124 — บรรทัดเตือนเหลือง "มี VAT แต่ยังไม่กรอกเลขใบกำกับ"
 * ใช้ร่วมฟอร์มบันทึก (EntryTab) กับฟอร์มแก้บิล (BillsTab) · ประโยคตัดสินใน lib (`missingInvoiceWarn`)
 */
export function MissingInvoiceWarn({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="mt-2 text-xs text-warn">⚠️ {text}</p>;
}
