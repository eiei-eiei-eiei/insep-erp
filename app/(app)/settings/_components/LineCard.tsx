"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveLineAction, clearLineAction } from "../actions";
import { Card, Field, Msg, SaveButton, TextInput, useSaver } from "@/lib/shared/ui";

/**
 * แจ้งเตือน LINE ของกิจการนี้ (0033)
 *
 * ★ ของเดิมค่าอยู่ใน env ของ Vercel = ทุกกิจการใน deployment เดียวกันยิงเข้ากลุ่มเดียวกัน
 *   → ย้ายมาเก็บต่อกิจการใน app_settings · อ่านได้เฉพาะ main (policy app_settings_sel)
 *
 * ★ โทเคนไม่เคยถูกส่งเต็มมาที่หน้าจอ — เห็นแค่ 4 ตัวท้ายไว้ยืนยันด้วยตาว่าใส่ตัวไหนไว้
 *   จะเปลี่ยนต้องพิมพ์ใหม่ทั้งตัว (ปล่อยว่าง = ใช้ของเดิมต่อ)
 */
export function LineCard({
  current,
}: {
  current: { hasToken: boolean; tokenTail: string; groupId: string };
}) {
  const router = useRouter();
  const { pending, msg, run } = useSaver();
  const [groupId, setGroupId] = useState(current.groupId);
  const [token, setToken] = useState("");
  const [editingToken, setEditingToken] = useState(!current.hasToken);

  function save() {
    run(
      () => saveLineAction({ token: editingToken ? token.trim() : null, groupId: groupId.trim() }),
      "บันทึกการแจ้งเตือน LINE แล้ว",
      () => {
        setToken("");
        setEditingToken(false);
        router.refresh();
      },
    );
  }

  function clear() {
    run(() => clearLineAction(), "ปิดแจ้งเตือน LINE แล้ว", () => {
      setGroupId("");
      setToken("");
      setEditingToken(true);
      router.refresh();
    });
  }

  const configured = current.hasToken && !!current.groupId;

  return (
    <Card title="แจ้งเตือน LINE">
      <Msg msg={msg} />

      <p className="mb-3 text-xs text-faint">
        เมื่อมีออเดอร์ใหม่ · แก้ไขออเดอร์ · รับเงิน · จัดส่ง ระบบจะส่งข้อความเข้ากลุ่ม LINE ที่ตั้งไว้
        {configured ? null : " — ยังไม่ได้ตั้งค่า ตอนนี้ระบบจะไม่ส่งอะไรเลย (ไม่ถือว่าผิดพลาด)"}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Channel access token">
          {editingToken ? (
            <TextInput
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="วางโทเคนจาก LINE Developers Console"
            />
          ) : (
            <div className="flex items-center gap-2">
              <span className="rounded bg-raised px-3 py-2 text-sm text-muted">
                ตั้งค่าแล้ว · ลงท้ายด้วย {current.tokenTail || "…"}
              </span>
              <button
                type="button"
                onClick={() => setEditingToken(true)}
                className="rounded border border-line px-3 py-2 text-sm text-muted transition hover:bg-raised"
              >
                เปลี่ยนโทเคน
              </button>
            </div>
          )}
        </Field>

        <Field label="Group ID (ปลายทางที่จะส่งเข้า)">
          <TextInput
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            placeholder="เช่น Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <SaveButton pending={pending} onClick={save}>
          บันทึกการแจ้งเตือน
        </SaveButton>
        {configured && (
          <button
            type="button"
            onClick={clear}
            disabled={pending}
            className="rounded-lg border border-crit-line px-4 py-2 text-sm text-crit transition hover:bg-crit-bg disabled:opacity-50"
          >
            ปิดแจ้งเตือน
          </button>
        )}
      </div>

      <p className="mt-3 text-xs text-faint">
        ค่าชุดนี้เป็นของกิจการนี้เท่านั้น — กิจการอื่นที่ใช้ระบบเดียวกันมีกลุ่มของตัวเองแยกกัน
        และพนักงานที่ไม่ใช่เจ้าของกิจการอ่านโทเคนนี้ไม่ได้
      </p>
    </Card>
  );
}
