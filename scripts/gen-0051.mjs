/**
 * สร้างส่วน "RPC" ของ migration 0051 — **ดึงตัวฟังก์ชันเดิมมาคำต่อคำ** แล้วสลับเฉพาะบรรทัดเช็คสิทธิ์
 *
 * ทำไมต้องมีสคริปต์: ฟังก์ชัน security definer 8 ตัวรวมกัน ~473 บรรทัด
 * ถ้าก๊อปด้วยมือ = ความเสี่ยงแบบเดียวกับ D79 (บั๊กใน fn_save_transaction ถูกก๊อปต่อจาก 0011 ไป 0017
 * แล้วอยู่ในระบบข้ามปีโดยไม่มีใครเห็น)
 *
 *   node scripts/gen-0051.mjs > <ไฟล์ชั่วคราว>
 *
 * ★ รันครั้งเดียวตอนสร้าง migration — ผลลัพธ์ถูกคอมมิตเป็น SQL จริงในไฟล์ 0051
 *   ไม่ใช่สคริปต์ที่รันตอน deploy (migration ต้องอ่านแล้วรู้เรื่องด้วยตาเปล่า)
 */
import fs from "fs";

/** ฟังก์ชัน → [ไฟล์ที่นิยามล่าสุด, บรรทัดเช็คเดิม, บรรทัดเช็คใหม่] */
const TARGETS = [
  [
    "fn_receive_material",
    "supabase/migrations/20260824000046_fix_forward_material.sql",
    "if my_role() <> 'main' then",
    "if not has_cap('acct.write') then",
  ],
  [
    "fn_sell_product",
    "supabase/migrations/20260811000029_tenant_rpc.sql",
    "if my_role() not in ('main','sale') then",
    "if not has_cap('sales.write') then",
  ],
  [
    "fn_apply_order_action",
    "supabase/migrations/20260811000029_tenant_rpc.sql",
    "if my_role() not in ('main','sale') then raise exception 'ไม่มีสิทธิ์บันทึกการขาย'; end if;",
    "if not has_cap('sales.write') then raise exception 'ไม่มีสิทธิ์บันทึกการขาย'; end if;",
  ],
  [
    "fn_cancel_order",
    "supabase/migrations/20260811000029_tenant_rpc.sql",
    "if my_role() <> 'main' then raise exception 'เฉพาะ main ยกเลิกออเดอร์ได้'; end if;",
    "if not has_cap('sales.config') then raise exception 'ไม่มีสิทธิ์ยกเลิกออเดอร์ (เฉพาะหัวหน้าฝ่ายขาย)'; end if;",
  ],
  [
    "fn_confirm_fulfillment",
    "supabase/migrations/20260811000029_tenant_rpc.sql",
    "if my_role() not in ('main','warehouse') then raise exception 'ไม่มีสิทธิ์จัดส่ง'; end if;",
    "if not has_cap('sales.write') then raise exception 'ไม่มีสิทธิ์จัดส่ง'; end if;",
  ],
  [
    "fn_void_deposit_invoice",
    "supabase/migrations/20260811000029_tenant_rpc.sql",
    "if my_role() <> 'main' then raise exception 'ไม่มีสิทธิ์ยกเลิกใบแจ้งหนี้มัดจำ (เฉพาะ main)'; end if;",
    "if not has_cap('sales.config') then raise exception 'ไม่มีสิทธิ์ยกเลิกใบแจ้งหนี้มัดจำ (เฉพาะหัวหน้าฝ่ายขาย)'; end if;",
  ],
  [
    "fn_post_payroll",
    "supabase/migrations/20260819000042_pay_variables_legs.sql",
    "if my_role() <> 'main' then raise exception 'ไม่มีสิทธิ์ลงบัญชีเงินเดือน'; end if;",
    "if not has_cap('pay.write') then raise exception 'ไม่มีสิทธิ์ลงบัญชีเงินเดือน'; end if;",
  ],
  [
    "fn_unpost_payroll",
    "supabase/migrations/20260819000042_pay_variables_legs.sql",
    "if my_role() <> 'main' then raise exception 'ไม่มีสิทธิ์ถอนการลงบัญชีเงินเดือน'; end if;",
    "if not has_cap('pay.write') then raise exception 'ไม่มีสิทธิ์ถอนการลงบัญชีเงินเดือน'; end if;",
  ],
];

const out = [];
for (const [fn, file, oldChk, newChk] of TARGETS) {
  const src = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const start = src.indexOf(`create or replace function ${fn}`);
  if (start < 0) throw new Error(`ไม่พบ ${fn} ใน ${file}`);
  const end = src.indexOf("$$;", start + 80);
  if (end < 0) throw new Error(`หาจุดจบของ ${fn} ไม่เจอ`);
  let body = src.slice(start, end + 3);

  if (!body.includes(oldChk)) throw new Error(`บรรทัดเช็คของ ${fn} ไม่ตรงกับที่คาดไว้ — หยุดก่อน`);
  const n = body.split(oldChk).length - 1;
  if (n !== 1) throw new Error(`${fn}: เจอบรรทัดเช็ค ${n} ครั้ง (ต้องเจอ 1 ครั้งเท่านั้น)`);
  body = body.replace(oldChk, newChk);

  out.push(`-- ${fn} — ยกมาจาก ${file.split("/").pop()} ทั้งดุ้น เปลี่ยนเฉพาะบรรทัดเช็คสิทธิ์`);
  out.push(body);
  out.push("");
}
process.stdout.write(out.join("\n"));
