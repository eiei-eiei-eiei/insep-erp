"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  listSnapshotsAction,
  createSnapshotAction,
  previewRestoreAction,
  restoreSnapshotAction,
  deleteSnapshotAction,
  type Res,
} from "../actions";

type Snapshot = {
  id: number;
  name: string;
  created_at: string;
  created_by: string | null;
  is_auto: boolean;
  row_counts: Record<string, number>;
};
type Preview = {
  name: string;
  createdAt: string;
  diffs: { table: string; current: number; snapshot: number; delta: number }[];
};

const fmtTime = (iso: string) => new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
const totalRows = (rc: Record<string, number>) => Object.values(rc ?? {}).reduce((s, n) => s + n, 0);

export function DataManager() {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [snaps, setSnaps] = useState<Snapshot[]>([]);

  const [snapName, setSnapName] = useState("");
  // modal ยืนยันด้วยรหัสผ่าน (ใช้ทั้ง snapshot / restore / delete)
  const [confirm, setConfirm] = useState<null | {
    kind: "create" | "restore" | "delete";
    id?: number;
    label: string;
    preview?: Preview;
  }>(null);
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(true);

  // โหลดรายการ snapshot — ใช้ loading แยกจาก pending (ปุ่ม action) เพื่อไม่ให้ปุ่มเทาตอนโหลดรายการ
  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await listSnapshotsAction();
    if (res.ok) setSnaps((res.data as Snapshot[]) ?? []);
    else setMsg({ ok: false, text: res.error ?? "โหลดรายการไม่ได้" });
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function openCreate() {
    setPassword("");
    setConfirm({ kind: "create", label: `จับ snapshot "${snapName.trim() || "ไม่ระบุชื่อ"}"` });
  }
  function openDelete(s: Snapshot) {
    setPassword("");
    setConfirm({ kind: "delete", id: s.id, label: `ลบ snapshot "${s.name}"` });
  }
  function openRestore(s: Snapshot) {
    setPassword("");
    setMsg(null);
    startTransition(async () => {
      const res = await previewRestoreAction(s.id);
      if (!res.ok) { setMsg({ ok: false, text: res.error ?? "ดู preview ไม่ได้" }); return; }
      setConfirm({ kind: "restore", id: s.id, label: `ย้อนข้อมูลกลับไป "${s.name}"`, preview: res.data as Preview });
    });
  }

  function submitConfirm() {
    if (!confirm) return;
    const c = confirm;
    setMsg(null);
    startTransition(async () => {
      let res: Res;
      if (c.kind === "create") res = await createSnapshotAction(snapName, password);
      else if (c.kind === "restore") res = await restoreSnapshotAction(c.id!, password);
      else res = await deleteSnapshotAction(c.id!, password);
      if (res.ok) {
        setMsg({ ok: true, text:
          c.kind === "create" ? "จับ snapshot เรียบร้อย" :
          c.kind === "restore" ? "ย้อนข้อมูลกลับเรียบร้อย (ระบบเก็บ auto-snapshot ก่อนย้อนให้แล้ว)" :
          "ลบ snapshot เรียบร้อย" });
        if (c.kind === "create") setSnapName("");
        setConfirm(null);
        setPassword("");
        refresh();
      } else {
        setMsg({ ok: false, text: res.error ?? "ทำรายการไม่ได้" });
      }
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold text-slate-800">สำรอง/ย้อนข้อมูล (Snapshot)</h1>
      <p className="mb-6 text-sm text-slate-500">
        จับสภาพข้อมูลทั้งระบบไว้ตอนคลีน → ทดลองใช้เต็มที่ → ย้อนกลับได้ทุกเมื่อ · เฉพาะเจ้าของกิจการ (main) และต้องยืนยันด้วยรหัสผ่าน
      </p>

      {msg && (
        <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
          {msg.text}
        </div>
      )}

      {/* จับ snapshot ใหม่ */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 font-semibold text-slate-700">📸 จับ snapshot ตอนนี้</div>
        <div className="flex gap-2">
          <input
            value={snapName}
            onChange={(e) => setSnapName(e.target.value)}
            placeholder="ตั้งชื่อ เช่น ก่อนลองระบบ / ตั้งค่าเสร็จ"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-800 outline-none"
          />
          <button
            onClick={openCreate}
            disabled={pending}
            className="whitespace-nowrap rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            จับ snapshot
          </button>
        </div>
      </div>

      {/* รายการ snapshot */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 font-semibold text-slate-700">รายการ snapshot ({snaps.length})</div>
        {loading ? (
          <div className="py-6 text-center text-sm text-slate-400">กำลังโหลด…</div>
        ) : snaps.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-400">ยังไม่มี snapshot — จับอันแรกไว้ก่อนลองระบบ</div>
        ) : (
          <div className="space-y-2">
            {snaps.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-700">
                    {s.is_auto && <span className="mr-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">auto</span>}
                    {s.name}
                  </div>
                  <div className="text-xs text-slate-400">
                    {fmtTime(s.created_at)} · {s.created_by ?? "-"} · {totalRows(s.row_counts).toLocaleString("th-TH")} แถว
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => openRestore(s)}
                    disabled={pending}
                    className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-50"
                  >
                    ↩ ย้อนกลับ
                  </button>
                  <button
                    onClick={() => openDelete(s)}
                    disabled={pending}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-400 hover:bg-white hover:text-red-500 disabled:opacity-50"
                  >
                    ลบ
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* modal ยืนยันด้วยรหัสผ่าน */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !pending && setConfirm(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 text-lg font-bold text-slate-800">
              {confirm.kind === "restore" ? "⚠️ ยืนยันย้อนข้อมูลกลับ" : confirm.kind === "delete" ? "ยืนยันลบ snapshot" : "ยืนยันจับ snapshot"}
            </div>
            <p className="mb-3 text-sm text-slate-600">{confirm.label}</p>

            {confirm.kind === "restore" && confirm.preview && (
              <div className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                <div className="mb-1 font-medium">จะแทนที่ข้อมูลปัจจุบันด้วยสภาพ ณ {fmtTime(confirm.preview.createdAt)}</div>
                {confirm.preview.diffs.length === 0 ? (
                  <div>ข้อมูลปัจจุบันเท่ากับ snapshot อยู่แล้ว (ไม่มีอะไรเปลี่ยน)</div>
                ) : (
                  <ul className="space-y-0.5">
                    {confirm.preview.diffs.map((d) => (
                      <li key={d.table}>
                        {d.table}: ตอนนี้ {d.current} → จะเป็น {d.snapshot} ({d.delta > 0 ? `−${d.delta} แถวที่เพิ่มหลัง snapshot จะหาย` : `+${-d.delta} แถวกลับมา`})
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2">ระบบจะเก็บ auto-snapshot ของสภาพปัจจุบันก่อนย้อน (กดผิดก็ย้อนกลับมาได้)</div>
              </div>
            )}

            <label className="mb-1 block text-sm text-slate-600">กรอกรหัสผ่านของคุณเพื่อยืนยัน</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && password && submitConfirm()}
              className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirm(null)} disabled={pending} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 disabled:opacity-50">
                ยกเลิก
              </button>
              <button
                onClick={submitConfirm}
                disabled={pending || !password}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${confirm.kind === "restore" ? "bg-red-600 hover:bg-red-500" : "bg-slate-800 hover:bg-slate-700"}`}
              >
                {pending ? "กำลังทำ…" : "ยืนยัน"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
