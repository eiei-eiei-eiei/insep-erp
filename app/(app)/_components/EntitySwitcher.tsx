"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { chartColor } from "@/lib/shared/chart";
import { showToast } from "@/lib/shared/toast";
import { WORKSPACES, type ModuleKey } from "@/lib/shared/workspaces";
import { entityColorIndex, type EntityOption } from "@/lib/shared/entityWorkspace";
import { switchEntityAction } from "../actions";

/**
 * ตัวสลับ "กิจการที่เลือกอยู่" บนแถบบน (D187 · ทาง Y)
 *
 * ★ สีประจำกิจการ (จุดหน้าชื่อ) — ความเสี่ยงหลักของทาง Y คือ "ลืมว่าอยู่โรงไหน" ⇒ ต้องเห็นตลอดเวลา
 * ★ ยังมีโมดูลที่ไม่ทำตาม ⇒ บอกบนจอว่ามีผลกับอะไรบ้าง (ไม่ซ่อนไว้ใน title — D83)
 * แสดงเมื่อ showEntitySwitcher() เป็นจริงเท่านั้น (ตัดสินใน layout)
 */
export function EntitySwitcher({
  entities,
  current,
  scoped,
}: {
  entities: EntityOption[];
  current: string | null;
  scoped: readonly ModuleKey[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const color = chartColor(entityColorIndex(entities, current));
  const allScoped = WORKSPACES.every((w) => scoped.includes(w.key));
  const scopedLabel = WORKSPACES.filter((w) => scoped.includes(w.key)).map((w) => w.label).join(" · ");

  function onChange(next: string) {
    if (!next || next === current) return;
    start(async () => {
      const r = await switchEntityAction(next);
      if (!r.ok) {
        showToast({ ok: false, text: r.error });
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <select
        aria-label="กิจการที่เลือกอยู่"
        value={current ?? ""}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 max-w-[11rem] truncate rounded-lg border border-line bg-input px-2 text-sm text-ink disabled:opacity-60"
      >
        {current === null && <option value="">— เลือกกิจการ —</option>}
        {entities.map((e) => (
          <option key={e.entity_id} value={e.entity_id}>
            {e.entity_id} · {e.name}
          </option>
        ))}
      </select>
      {!allScoped && scopedLabel && (
        <span className="hidden text-xs text-faint lg:inline">มีผลกับ: {scopedLabel}</span>
      )}
    </span>
  );
}
