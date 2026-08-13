import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ALL_MODULES, hasModule, type ModuleKey } from "@/lib/shared/workspaces";

/**
 * แพ็กเกจของลูกค้า (แถว `tenants`) — โมดูลที่ซื้อ + โควตากิจการ
 *
 * อ่านผ่าน client ปกติได้เลย: policy `tenants_sel` (0025:193) เปิดให้อ่าน **แถวของตัวเอง**
 * และไม่มี policy for update → ลูกค้าเลื่อนโควตา/เปิดโมดูลให้ตัวเองไม่ได้ (บังคับที่ DB ไม่ใช่ UI)
 *
 * ★ fail-open โดยตั้งใจ: อ่านไม่ได้ = ถือว่าเปิดหมด
 *   เพราะนี่คือ "สิทธิ์ตามแพ็กเกจที่ซื้อ" ไม่ใช่ขอบเขตความปลอดภัย —
 *   อ่านพลาดแล้วล็อกลูกค้าที่จ่ายเงินแล้วออกจากระบบ แย่กว่าปล่อยให้เห็นเมนูเกิน
 *   (ต่างจากโทเคน LINE ใน D51 ที่เป็นความลับจริง จึงต้อง fail-closed ที่ RLS)
 */
export type TenantPlan = {
  modules: string[];
  maxEntities: number;
};

export async function getTenantPlan(): Promise<TenantPlan> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenants")
    .select("modules_enabled, max_entities")
    .maybeSingle(); // RLS กรองเหลือแถวเดียวอยู่แล้ว ไม่ต้องส่ง id

  return {
    modules: (data?.modules_enabled as string[] | null) ?? ALL_MODULES,
    maxEntities: (data?.max_entities as number | null) ?? 1,
  };
}

/**
 * กันเข้าโดเมนที่ลูกค้าไม่ได้ซื้อผ่าน URL ตรง ๆ — เรียกที่หัว page.tsx ของแต่ละโดเมน
 *
 * เด้งกลับหน้าแรก ไม่ใช่ 404: ลูกค้าไม่ได้ทำอะไรผิด แค่ยังไม่ได้ซื้อโมดูลนั้น
 */
export async function requireModule(key: ModuleKey): Promise<void> {
  const { modules } = await getTenantPlan();
  if (!hasModule(modules, key)) redirect("/");
}
