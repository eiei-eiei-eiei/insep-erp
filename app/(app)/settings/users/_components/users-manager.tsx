"use client";

import { useState, useTransition } from "react";
import { ROLE_LABEL, type Role } from "@/lib/shared/workspaces";
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

const ROLE_OPTIONS: Role[] = ["main", "viewer", "sale", "warehouse"];

export function UsersManager({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ฟอร์มสร้างผู้ใช้
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("viewer");

  function run(action: () => Promise<ActionResult>, successText: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await action();
      if (res.ok) setMsg({ ok: true, text: successText });
      else setMsg({ ok: false, text: res.error ?? "เกิดข้อผิดพลาด" });
    });
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-ink">จัดการผู้ใช้</h1>
      <p className="mb-6 text-sm text-faint">
        สร้างบัญชีด้วย username (ไม่ต้องมีอีเมลจริง) · ให้สิทธิ์ · รีเซ็ตรหัสผ่าน · ลบ —
        เฉพาะเจ้าของกิจการ (main)
      </p>

      {msg && (
        <div
          className={`mb-4 rounded-lg px-3 py-2 text-sm ${
            msg.ok ? "bg-ok-bg text-ok" : "bg-crit-bg text-crit"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* สร้างผู้ใช้ใหม่ */}
      <div className="mb-8 rounded-2xl border border-line bg-card p-5">
        <h2 className="mb-3 font-semibold text-ink">+ สร้างผู้ใช้ใหม่</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm">
            <span className="mb-1 block text-muted">ชื่อผู้ใช้ (username)</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="เช่น sale1"
              className="w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">ชื่อแสดงผล</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="เช่น สมชาย"
              className="w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">รหัสผ่าน</span>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="อย่างน้อย 6 ตัว"
              className="w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">สิทธิ์ (role)</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full rounded-lg border border-line px-3 py-2"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]} ({r})
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const res = await createUserAction({
                    username,
                    displayName,
                    password,
                    role,
                  });
                  if (res.ok) {
                    setUsername("");
                    setDisplayName("");
                    setPassword("");
                    setRole("viewer");
                  }
                  return res;
                }, `สร้างผู้ใช้ "${username}" แล้ว`)
              }
              className="w-full rounded-lg bg-brand py-2 font-medium text-on-brand hover:opacity-90 disabled:opacity-50"
            >
              สร้าง
            </button>
          </div>
        </div>
      </div>

      {/* รายชื่อผู้ใช้ */}
      <div className="overflow-x-auto rounded-2xl border border-line bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-raised text-left text-muted">
            <tr>
              <th className="px-4 py-3">username</th>
              <th className="px-4 py-3">ชื่อแสดงผล</th>
              <th className="px-4 py-3">สิทธิ์</th>
              <th className="px-4 py-3 text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <tr key={u.id} className="border-b border-line-soft">
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
                    <select
                      defaultValue={u.role}
                      disabled={pending}
                      onChange={(e) =>
                        run(
                          () =>
                            updateRoleAction({ id: u.id, role: e.target.value }),
                          `เปลี่ยนสิทธิ์ ${u.username} แล้ว`,
                        )
                      }
                      className="rounded-lg border border-line px-2 py-1"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]} ({r})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      disabled={pending}
                      onClick={() => {
                        const pw = window.prompt(
                          `ตั้งรหัสผ่านใหม่ให้ "${u.username}" (อย่างน้อย 6 ตัว)`,
                        );
                        if (pw)
                          run(
                            () => resetPasswordAction({ id: u.id, password: pw }),
                            `รีเซ็ตรหัสผ่าน ${u.username} แล้ว`,
                          );
                      }}
                      className="mr-2 rounded-lg border border-line px-2.5 py-1 text-muted hover:bg-raised"
                    >
                      รีเซ็ตรหัส
                    </button>
                    <button
                      disabled={pending || isSelf}
                      onClick={() => {
                        if (
                          window.confirm(`ลบผู้ใช้ "${u.username}" ถาวร?`)
                        )
                          run(
                            () => deleteUserAction({ id: u.id }),
                            `ลบผู้ใช้ ${u.username} แล้ว`,
                          );
                      }}
                      className="rounded-lg border border-crit-line px-2.5 py-1 text-crit hover:bg-crit-bg disabled:opacity-40"
                    >
                      ลบ
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
