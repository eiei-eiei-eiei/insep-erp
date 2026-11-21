/**
 * lib/accounting/whtCancel — ยกเลิกใบ 50ทวิ ที่ออกไปแล้ว (D180 · migration 0113)
 *
 * ★ ยกเลิก = เปลี่ยน status เป็น "ยกเลิก" **ไม่ลบแถว** — เลขยังอยู่ในทะเบียน (fn_doc_nos) ⇒ ไม่ถูกนำกลับมาใช้ (D100)
 * ★ ใบที่ยกเลิกไม่นับว่า "ออกแล้ว" ⇒ บิลกลับเข้าคิวรอออก 50ทวิ เอง
 * ★ ไม่แก้ยอดบนใบตรง ๆ — ยอดมาจากบิล (ภงด.3/53 อ่านจากบิล · D179) ⇒ ยกเลิก → แก้บิล → ออกใหม่
 * 🚨 ด่านตัวจริงอยู่ใน `fn_cancel_wht` (0113) — ที่นี่คือคำอธิบายบนจอ (D84/D91)
 *    กติกา "ยื่นแล้ว" ต้องตรงกับ SQL (whtCancel.test.ts อ่าน SQL มาเทียบ)
 * ไฟล์นี้บริสุทธิ์ (ไม่แตะ DB/React)
 */

export const WHT_CANCELLED = "ยกเลิก" as const;

/** ใบที่ยังมีผล — null/ไม่มีค่า = ปกติ (ข้อมูลก่อน 0113 ได้ default 'ปกติ' อยู่แล้ว กันไว้อีกชั้น) */
export function isActiveCert(c: { status?: string | null }): boolean {
  return (c.status ?? "") !== WHT_CANCELLED;
}

/** tx_id ของบิลที่ "ออก 50ทวิ แล้ว" — นับเฉพาะใบที่ยังไม่ยกเลิก (คิวรอออกใช้ตัวนี้) */
export function issuedTxIdsOf(certs: { tx_ids?: string[] | null; status?: string | null }[]): Set<string> {
  const out = new Set<string>();
  for (const c of certs) {
    if (!isActiveCert(c)) continue;
    for (const id of c.tx_ids ?? []) if (id) out.add(id);
  }
  return out;
}

export type FilingRowLite = { kind: string; period: string; reopened_at?: string | null };
export type TxDateLite = { tx_id: string; transaction_date?: string | null; settled_on?: string | null };

const PND_LABEL: Record<string, string> = { pnd3: "ภ.ง.ด.3", pnd53: "ภ.ง.ด.53" };

/**
 * ภงด. ที่ "ยื่นแล้ว" ซึ่งอาจมีบิลของใบนี้อยู่ — ว่าง = ยังไม่ยื่น
 * 🚨 กติกาเดียวกับ `fn_cancel_wht`:
 *    เดือนของบิล = settled_on → transaction_date (cashDateOf · เดือนที่ ภงด. นับบิลนี้ · D123)
 *    นับทั้ง ภงด.3 และ 53 (ภงด. แยกแบบด้วยชื่อคู่ค้า ไม่ใช่ pnd_type บนใบ) · แถวที่ถอนแล้วไม่นับ
 * @param filings tax_filings ของกิจการของใบนี้
 * @param monthLabel จัดรูปงวด ("2026-10") — หน้าจอส่ง useDateFmt().month · ปริยาย = คงเดิม
 */
export function whtCertFiledPeriods(
  txIds: string[],
  txs: TxDateLite[],
  filings: FilingRowLite[],
  monthLabel: (period: string) => string = (p) => p,
): string[] {
  const ids = new Set(txIds);
  const months = new Set<string>();
  for (const t of txs) {
    if (!ids.has(t.tx_id)) continue;
    const d = t.settled_on || t.transaction_date;
    if (d) months.add(String(d).substring(0, 7));
  }
  const hits: { label: string; period: string }[] = [];
  for (const f of filings) {
    if (f.reopened_at) continue;
    const label = PND_LABEL[f.kind];
    if (!label || !months.has(f.period)) continue;
    hits.push({ label, period: f.period });
  }
  hits.sort((a, b) => a.period.localeCompare(b.period) || a.label.localeCompare(b.label));
  return [...new Set(hits.map((h) => `${h.label} งวด ${monthLabel(h.period)}`))];
}

/**
 * ข้อความ "ยื่นแล้ว" ที่ fn_cancel_wht ตอบกลับ (`ภ.ง.ด.3 งวด 2026-11, …`) → รายการเดียวกับ whtCertFiledPeriods
 * ★ ใช้เมื่อหน้าจอไม่รู้มาก่อน (มีคนติ๊กยื่นที่อื่นระหว่างป๊อปอัพเปิด) · งวดจัดรูปตามหน้าจอ
 */
export function filedFromServer(s: string | null | undefined, monthLabel: (period: string) => string = (p) => p): string[] {
  if (!s) return [];
  return s.split(",").map((x) => x.trim().replace(/\d{4}-\d{2}/g, (p) => monthLabel(p))).filter(Boolean);
}

/** เหตุผลที่ปุ่ม "ยกเลิกใบนี้" ยังกดไม่ได้ (แสดงบนจอ · D83) — null = กดได้ */
export function cancelWhtBlock(input: { reason: string; filed: string[]; ackFiled: boolean }): string | null {
  if (!input.reason.trim()) return "กรอกเหตุผลที่ยกเลิกก่อน";
  if (input.filed.length > 0 && !input.ackFiled) return "ติ๊กรับทราบเรื่องแบบที่ยื่นไปแล้วก่อน";
  return null;
}

/** สิ่งที่จะเกิดเมื่อยกเลิก — บอกก่อนกด */
export function cancelWhtEffects(input: { docNo: string; billCount: number }): string[] {
  return [
    `ใบเลขที่ ${input.docNo} จะขึ้นว่า "ยกเลิก" และยังเก็บไว้ — ใบใหม่ได้เลขถัดไป ไม่ใช้เลขนี้ซ้ำ`,
    input.billCount > 0
      ? `บิล ${input.billCount} ใบของใบนี้กลับเข้าคิว "รอออก 50ทวิ" ของเดือนที่จ่ายเงิน`
      : "ใบนี้ไม่ได้ผูกกับบิล — ไม่มีบิลกลับเข้าคิว",
    "ยอดบนใบใหม่มาจากบิล — ถ้ายอดผิด ให้แก้ \"ยอดที่ใช้คิดหัก ณ ที่จ่าย\" ที่บิลก่อน (บัญชี → ค้นบิล → แก้ไข) แล้วค่อยออกใหม่",
    "ถ้าให้ใบนี้กับผู้รับเงินไปแล้ว ให้แจ้งว่ายกเลิกและส่งใบใหม่แทน",
  ];
}

/** คำเตือนเมื่อ ภงด. ของเดือนนั้นยื่นไปแล้ว — null = ยังไม่ยื่น */
export function cancelWhtFiledWarn(filed: string[]): string | null {
  if (filed.length === 0) return null;
  return (
    `ยื่น ${filed.join(", ")} ไปแล้ว — การยกเลิกในแอปไม่ได้แก้แบบที่ยื่นไป ` +
    "ถ้ายอดที่ยื่นผิด ต้องยื่นแบบเพิ่มเติมเองที่สรรพากร"
  );
}

/**
 * หน้าแก้บิล: บิลนี้มีใบ 50ทวิ ที่ยังมีผลอยู่ — แก้ยอดหัก ณ ที่จ่ายที่บิลแล้วใบไม่เปลี่ยนตาม
 * null = ไม่มีใบ (ไม่ต้องเตือน)
 */
export function whtIssuedEditNote(docNos: string[]): string | null {
  if (docNos.length === 0) return null;
  return (
    `บิลนี้ออกใบ 50ทวิ ไปแล้ว (เลขที่ ${docNos.join(", ")}) — แก้ยอดหัก ณ ที่จ่ายที่นี่ ใบที่ออกไปแล้วไม่เปลี่ยนตาม · ` +
    "ให้ยกเลิกใบที่ บัญชี → เอกสารสรรพากร แล้วออกใหม่"
  );
}
