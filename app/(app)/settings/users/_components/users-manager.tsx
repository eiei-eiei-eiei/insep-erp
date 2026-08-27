"use client";

import { useState, useTransition } from "react";
import { ROLES, ROLE_LABEL, ROLE_HINT, type Role } from "@/lib/shared/roles";
import { PASSWORD_MIN } from "@/lib/shared/password";
import {
  Card,
  EscToClose,
  Msg,
  MissingHint,
  RowBtn,
  SaveButton,
  Select,
  TextInput,
  type UiMsg,
} from "@/lib/shared/ui";
import {
  createUserAction,
  updateRoleAction,
  resetPasswordAction,
  deleteUserAction,
  type ActionResult,
} from "../actions";

export type UserRow = {
  id: string;
  username: string;
  display_name: string | null;
  role: Role;
  created_at: string;
};

/**
 * 🚨 อ่านจาก ROLES ที่ lib/shared/roles โดยตรง — **ห้ามก๊อปรายชื่อมาไว้ที่นี่**
 *    ลิสต์ที่ก๊อปไว้คือสาเหตุของ D84 (เพิ่มของใหม่แล้วหน้าจอไม่รู้จัก)
 *    ที่นี่พลาดแล้วหนักกว่า: เพิ่มบทบาทใหม่แล้ว **ตั้งให้ใครไม่ได้เลย**
 */
const ROLE_OPTIONS: readonly Role[] = ROLES;

/** ป๊อปอัพที่เปิดอยู่ — `null` = ไม่มี */
type Dialog = { kind: "reset" | "delete"; user: UserRow } | null;

export function UsersManager({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<UiMsg | null>(null);

  // ฟอร์มสร้างผู้ใช้
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("viewer");

  // ป๊อปอัพรีเซ็ตรหัส / ลบ
  const [dialog, setDialog] = useState<Dialog>(null);
  const [newPw, setNewPw] = useState("");

  function run(action: () => Promise<ActionResult>, successText: string, onOk?: () => void) {
    setMsg(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        setMsg({ ok: true, text: successText });
        onOk?.();
      } else {
        setMsg({ ok: false, text: res.error ?? "เกิดข้อผิดพลาด" });
      }
    });
  }

  function closeDialog() {
    if (pending) return;
    setDialog(null);
    setNewPw("");
  }

  function doReset(u: UserRow) {
    run(
      () => resetPasswordAction({ id: u.id, password: newPw }),
      `รีเซ็ตรหัสผ่าน ${u.username} แล้ว`,
      () => { setDialog(null); setNewPw(""); },
    );
  }

  const createChecks = [
    { label: "ชื่อผู้ใช้", ok: !!username.trim() },
    { label: `รหัสผ่าน (อย่างน้อย ${PASSWORD_MIN} ตัว)`, ok: password.length >= PASSWORD_MIN },
  ];
  const canCreate = createChecks.every((c) => c.ok);

  return (
    <div>
      <h2 className="mb-1 text-xl font-bold text-ink">จัดการผู้ใช้</h2>
      <p className="mb-6 text-sm text-faint">
        สร้างบัญชีด้วย username (ไม่ต้องมีอีเมลจริง) · ให้สิทธิ์ · รีเซ็ตรหัสผ่าน · ลบ —
        เฉพาะเจ้าของกิจการ (main)
      </p>

      <Msg msg={msg} />

      {/* สร้างผู้ใช้ใหม่ */}
      <Card className="mb-8">
        <h2 className="mb-3 font-semibold text-ink">+ สร้างผู้ใช้ใหม่</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm">
            <span className="mb-1 block text-muted">ชื่อผู้ใช้ (username)</span>
            <TextInput
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="เช่น sale1"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">ชื่อแสดงผล</span>
            <TextInput
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="เช่น สมชาย"
            />
          </label>
          <label className="text-sm">
            {/* ★ ตัวเลขมาจาก PASSWORD_MIN ตัวจริง — เขียนเลขตายตัวไว้แล้วเกณฑ์เปลี่ยน
                หน้าจอจะโกหกผู้ใช้เงียบ ๆ (ของเดิมเขียน "6 ตัว" ทั้งที่ระบบบังคับ 8) */}
            <span className="mb-1 block text-muted">รหัสผ่าน (อย่างน้อย {PASSWORD_MIN} ตัว)</span>
            <TextInput
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`อย่างน้อย ${PASSWORD_MIN} ตัว`}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">สิทธิ์ (role)</span>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]} ({r})
                </option>
              ))}
            </Select>
            {/* 9 บทบาทเยอะพอที่จะเดาผิด — บอกตรง ๆ ว่าตัวที่เลือกอยู่ได้/ไม่ได้อะไร */}
            <span className="mt-1 block text-xs text-faint">{ROLE_HINT[role]}</span>
          </label>
          <div className="flex flex-col justify-end">
            <SaveButton
              pending={pending}
              pendingText="กำลังสร้าง…"
              disabled={!canCreate}
              onClick={() =>
                run(
                  () => createUserAction({ username, displayName, password, role }),
                  `สร้างผู้ใช้ "${username}" แล้ว`,
                  () => {
                    setUsername("");
                    setDisplayName("");
                    setPassword("");
                    setRole("viewer");
                  },
                )
              }
            >
              สร้าง
            </SaveButton>
            <MissingHint checks={createChecks} />
          </div>
        </div>
      </Card>

      {/* รายชื่อผู้ใช้ */}
      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="tbl">
          <thead>
            <tr>
              <th className="px-4 py-3">username</th>
              <th className="px-4 py-3">ชื่อแสดงผล</th>
              <th className="px-4 py-3">สิทธิ์</th>
              <th className="px-4 py-3 num">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-medium text-ink">
                    {u.username}
                    {isSelf && (
                      <span className="ml-2 rounded bg-raised px-1.5 py-0.5 text-xs text-faint">
                        คุณ
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{u.display_name}</td>
                  <td className="px-4 py-3">
                    <Select
                      className="py-1"
                      defaultValue={u.role}
                      disabled={pending}
                      onChange={(e) =>
                        run(
                          () => updateRoleAction({ id: u.id, role: e.target.value }),
                          `เปลี่ยนสิทธิ์ ${u.username} แล้ว`,
                        )
                      }
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r} title={ROLE_HINT[r]}>
                          {ROLE_LABEL[r]} ({r})
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-4 py-3 num">
                    <RowBtn
                      className="mr-2"
                      disabled={pending}
                      onClick={() => { setNewPw(""); setDialog({ kind: "reset", user: u }); }}
                    >
                      รีเซ็ตรหัส
                    </RowBtn>
                    <RowBtn
                      tone="red"
                      disabled={pending || isSelf}
                      title={isSelf ? "ลบบัญชีที่กำลังใช้งานอยู่ไม่ได้ (ให้ผู้ใช้ main อีกคนลบให้)" : undefined}
                      onClick={() => setDialog({ kind: "delete", user: u })}
                    >
                      ลบ
                    </RowBtn>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/*
        🚨 ป๊อปอัพในแอป ไม่ใช่ window.prompt/confirm
           · `prompt()` **throw ในเบราว์เซอร์ที่ฝังอยู่ในแอปอื่น** ("prompt() is not supported")
             → ปุ่มรีเซ็ตรหัสพังสนิท ไม่ใช่แค่หน้าตาไม่สวย
           · และรหัสผ่านใน prompt **ไม่ถูกปิดบัง** ใครยืนข้างหลังก็อ่านได้
           · `confirm()` ก็ถูกกลืนในบางบริบท → กดลบแล้วเหมือนปุ่มเสีย
        🪤 พื้นหลังปิดด้วย onMouseDown ไม่ใช่ onClick (D73 — ลากคลุมข้อความแล้วป๊อปอัพปิดเอง)
      */}
      {dialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/40 p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeDialog(); }}
        >
          <EscToClose onClose={closeDialog} />
          <div className="w-full max-w-md rounded-lg bg-card p-5 shadow-xl">
            {dialog.kind === "reset" ? (
              <>
                <div className="mb-1 text-lg font-bold text-ink">รีเซ็ตรหัสผ่าน</div>
                <p className="mb-3 text-sm text-muted">
                  ตั้งรหัสผ่านใหม่ให้ <b className="text-ink">{dialog.user.username}</b>
                </p>
                <p className="mb-3 rounded-lg bg-raised px-3 py-2 text-xs text-faint">
                  ผู้ใช้จะเข้าระบบด้วยรหัสนี้ได้ทันที — บอกเขาให้เปลี่ยนเองหลังเข้าได้แล้ว
                </p>
                <label className="mb-1 block text-sm text-muted">
                  รหัสผ่านใหม่ (อย่างน้อย {PASSWORD_MIN} ตัว)
                </label>
                <TextInput
                  type="password"
                  value={newPw}
                  autoFocus
                  onChange={(e) => setNewPw(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newPw.length >= PASSWORD_MIN) doReset(dialog.user);
                  }}
                />
                <div className="mt-4 flex justify-end gap-2">
                  <RowBtn onClick={closeDialog} disabled={pending}>ยกเลิก</RowBtn>
                  <SaveButton
                    pending={pending}
                    pendingText="กำลังตั้ง…"
                    disabled={newPw.length < PASSWORD_MIN}
                    onClick={() => doReset(dialog.user)}
                  >
                    ตั้งรหัสใหม่
                  </SaveButton>
                </div>
                <MissingHint
                  checks={[
                    { label: `รหัสผ่านอย่างน้อย ${PASSWORD_MIN} ตัว`, ok: newPw.length >= PASSWORD_MIN },
                  ]}
                />
              </>
            ) : (
              <>
                <div className="mb-1 text-lg font-bold text-crit">ลบผู้ใช้ถาวร</div>
                <p className="mb-3 text-sm text-muted">
                  จะลบบัญชี <b className="text-ink">{dialog.user.username}</b> ออกจากระบบ
                </p>
                <p className="mb-4 rounded-lg border border-crit-line bg-crit-bg px-3 py-2 text-xs text-crit">
                  ลบแล้วเข้าระบบด้วยบัญชีนี้ไม่ได้อีก · ส่วนข้อมูลที่เขาเคยบันทึกไว้ยังอยู่ครบ
                  (ประวัติการแก้ไขยังเก็บชื่อผู้ใช้ไว้)
                </p>
                <div className="flex justify-end gap-2">
                  <RowBtn onClick={closeDialog} disabled={pending}>ยกเลิก</RowBtn>
                  <RowBtn
                    tone="red"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => deleteUserAction({ id: dialog.user.id }),
                        `ลบผู้ใช้ ${dialog.user.username} แล้ว`,
                        () => { setDialog(null); setNewPw(""); },
                      )
                    }
                  >
                    {pending ? "กำลังลบ…" : "ลบถาวร"}
                  </RowBtn>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
