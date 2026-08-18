import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { IconSettings } from "@/lib/shared/icons";
import { SettingsTabs } from "./_components/settings-tabs";

/**
 * หน้าตั้งค่ากลาง — ของทั้งระบบ **ไม่ผูกกับโมดูลใด** (D63)
 *
 * เดิมการ์ดแบรนด์/ข้อมูลกิจการ/LINE อยู่ในแท็บตั้งค่าของแอปบัญชี ซึ่งถูก
 * `requireModule("accounting")` กั้น → ลูกค้าที่ซื้อแค่โมดูลผลิตตั้งค่าพวกนี้ไม่ได้เลย
 * ทั้งที่แบรนด์ใช้ทั้งแอปและ LINE ใช้ฝั่งขาย
 *
 * ★ guard `role === "main"` อยู่ที่นี่ที่เดียว — ของเดิมซ้ำอยู่ในทุก page ของโฟลเดอร์นี้
 *   (แถบเมนูซ่อนให้แล้วชั้นหนึ่ง แต่พิมพ์ URL ตรงยังเข้าได้ จึงต้องกันฝั่ง server ด้วย)
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "main") redirect("/");

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <IconSettings size={24} className="text-brand" />
        <h1 className="text-2xl font-bold text-ink">ตั้งค่า</h1>
      </div>
      <SettingsTabs />
      {children}
    </div>
  );
}
