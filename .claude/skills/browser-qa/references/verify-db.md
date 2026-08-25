# ยืนยันผลข้างเคียงใน Supabase + เก็บกวาดข้อมูลเทส

หน้าจอบอกได้แค่ว่า "แอปคิดว่ามันสำเร็จ" — ของที่ยืนยันได้จริงคือแถวใน DB
โดยเฉพาะเมื่อบั๊กชั้น DB (D79) หลอกให้หน้าจอขึ้นเขียวได้

## รู้ก่อนว่ากำลังยิงก้อนไหน

```bash
grep '^NEXT_PUBLIC_SUPABASE_URL' .env.local
```

| ไฟล์ env | ก้อน |
|---|---|
| `.env.local` | ที่ `npm run dev` ใช้ |
| `.env.local.production-backup` | ของเจ้าของกิจการ (ข้อมูลที่ใช้ยื่นภาษีจริง) |
| `.env.local.testing-backup` | ของลูกค้า/ทดสอบ |

รายชื่อครบอยู่ที่ `supabase/fleet.json` และ `supabase/targets.json`

🚨 **อ่านได้เสมอ · เขียนต้องคิดก่อน** — ถ้า `.env.local` ชี้ DB ที่ใช้งานจริง
ให้บอกผู้ใช้ตั้งแต่ตอนเสนอแผน และถามก่อนสร้างข้อมูลใด ๆ

## สคริปต์อ่านข้อมูล

ต้องวางไฟล์ **ในโปรเจกต์** (ไม่ใช่ scratchpad) ไม่งั้นหา `@supabase/supabase-js` ไม่เจอ
ตั้งชื่อ `_something.tmp.ts` แล้วลบทิ้งเมื่อเสร็จ

```ts
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env: Record<string, string> = {};
for (const line of readFileSync("D:/insep-erp/.env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  // 🪤 ต้องตัดคอมเมนต์ท้ายบรรทัด — ไฟล์ env มี `KEY=ค่า   # หมายเหตุ` อยู่จริง
  //    ไม่ตัด = header มีอักษรไทยปน แล้วได้ error ByteString ที่อ่านไม่ออกเลยว่าเกิดอะไร
  if (m) env[m[1]] = m[2].split("#")[0].trim().replace(/^"|"$/g, "");
}

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  const { data, error } = await sb.from("log_material").select("*")
    .order("id", { ascending: false }).limit(5);
  console.log(JSON.stringify(error ?? data, null, 1));
}
main();
```

รันด้วย `npx tsx _something.tmp.ts`

🪤 top-level `await` ใช้ไม่ได้ (tsx compile เป็น cjs) — ห่อใน `async function main()` เสมอ
🪤 service role **bypass RLS** — ต้องใส่ `.eq("tenant_id", …)` เองทุก query ไม่งั้นเห็นข้ามลูกค้า

## ตารางที่มักต้องดู

| เทสอะไร | ดูที่ |
|---|---|
| บิลบัญชี | `transactions` · `transaction_items` |
| สะพานข้ามโดเมน | `integration_log` (`RECEIVE_MATERIAL` / `RECEIVE_REVENUE` / `SELL_PRODUCT`) |
| ผลิต | `log_material` · `log_ferment` · `log_distill` · `log_distill_run` · `log_ferment_draw` · `log_product` |
| สต็อก | `stock_product` (มี trigger — ต้องขยับเองเมื่อ `log_product` เปลี่ยน) |
| ขาย | `sales_orders` · `sales_order_items` |
| เงินเดือน | `payroll_periods` · `payroll_items` (ดู `computed` ที่แช่ไว้) |
| ใครแก้อะไร | `edit_log` — หรือดูจากในแอปที่ **ตั้งค่า → ประวัติการแก้ไข** |
| ค่าตั้งของ tenant | `app_settings` (kind/value) · `entities` |

**ก่อนสรุปว่าไม่มีข้อมูล** ให้เช็คด้วยว่ากรอง `tenant_id` ถูกก้อนไหม — tenant ทดสอบกับ tenant จริง
อยู่ใน DB เดียวกันได้

## ตรรกะที่อยู่ใน DB

RPC/trigger/CHECK constraint ไม่มีทางเห็นจาก TypeScript — ถ้าสงสัยว่าปัญหาอยู่ชั้นนั้น:

- ไล่อ่าน `supabase/migrations/*.sql` (ตัวที่นิยามล่าสุดชนะ — เรียงตามชื่อไฟล์)
- `npm run test:tenant` คือชั้นเดียวที่ยิง Supabase จริง — ใช้ยืนยัน/ทำซ้ำได้
- ทำซ้ำแบบควบคุมได้ด้วย `tests/tenant/harness.ts` (`seedTenant` + `signIn`) โดยไม่แตะข้อมูลของใคร

ตัวอย่าง error ที่เจอบ่อยและความหมาย:

| ข้อความ | แปลว่า |
|---|---|
| `42702 column reference "x" is ambiguous` | ชื่อ alias ใน SQL ชนกับตัวแปร plpgsql |
| `ค่าที่กรอกไม่ถูกต้องตามที่ระบบกำหนด` | ติด CHECK constraint (เช่น `app_settings.kind` เป็น whitelist) |
| `violates foreign key constraint` | มีของอ้างอยู่ — บางทีถูกแล้ว (กันลบ master ที่ใช้งานอยู่) |
| `new row violates row-level security` | สิทธิ์/tenant ไม่ตรง ไม่ใช่บั๊กของฟอร์ม |

## เก็บกวาด

จบเทสแล้วต้องเลือกอย่างใดอย่างหนึ่ง แล้ว**บอกผู้ใช้ให้ชัด**:

- **ลบข้อมูลที่สร้างไว้** — ลบลูกก่อนแม่ (`log_distill_run` ก่อน `log_ferment`) ไม่งั้นติด FK
- **หรือทิ้งไว้แล้วรายงานว่าทิ้งอะไรไว้บ้าง** — บาง batch/ออเดอร์มีค่าไว้ใช้เทสรอบต่อไป

ลบไฟล์ `_*.tmp.ts` ทุกตัวก่อนจบ (`git status` ต้องไม่มีของแปลกปลอม)

ถ้าเทสในระบบเป็นชุด ๆ (seed → เทส → ล้าง) มีของพร้อมใช้อยู่แล้ว:
`supabase/seed/seed_test.sql` · `seed_accounting.sql` · `seed_sales.sql` · `seed_fermented.sql`
· ล้างทีเดียวด้วย `cleanup_test.sql` (marker: entity `EID99` · รหัสขึ้นต้น `T-` · ชื่อมีคำว่า "ทดสอบ")
