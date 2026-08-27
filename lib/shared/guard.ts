import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, toRole, type Cap, type Role } from "./roles";

/**
 * ด่านสิทธิ์ระดับหน้า — คู่กับ `requireModule()` แต่คนละเรื่องกัน
 *
 *   `requireModule()` = **ลูกค้าซื้อโมดูลนี้ไว้ไหม** (เรื่องแพ็กเกจ · fail-open)
 *   `requireCap()`    = **ผู้ใช้คนนี้มีสิทธิ์ไหม**   (เรื่องความปลอดภัย · fail-closed)
 *
 * 🚨 นี่เป็นแค่ชั้นหน้าจอ — ตัวจริงที่บังคับคือ RLS/RPC ฝั่ง DB (migration 0051)
 *    มีไว้เพื่อไม่ให้ผู้ใช้เจอหน้าเปล่า ๆ ที่ข้อมูลถูก RLS กรองออกจนหมดโดยไม่มีคำอธิบาย
 *    (RLS กรองแถวออกเงียบ ๆ ไม่ throw — หน้าจะว่างเปล่าแทนที่จะบอกว่าไม่มีสิทธิ์)
 *
 * เด้งกลับหน้าแรกเหมือน `requireModule()` ไม่ใช่ 404 — ผู้ใช้ในกิจการเดียวกัน
 * ไม่ใช่คนแปลกหน้าที่ต้องปิดบังว่ามีหน้านี้อยู่ (ต่างจาก `/platform` ที่ตอบ 404)
 */
export async function currentRole(): Promise<Role> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  // อ่านไม่ได้/ค่าแปลก → viewer (สิทธิ์ต่ำสุด) ตามกติกา fail-closed ใน roles.ts
  return toRole(data?.role as string | null);
}

/** เรียกที่หัว page.tsx ของแต่ละโดเมน · คืน role มาให้ใช้ต่อจะได้ไม่ต้อง query ซ้ำ */
export async function requireCap(cap: Cap): Promise<Role> {
  const role = await currentRole();
  if (!can(role, cap)) redirect("/");
  return role;
}
