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
      <h1 className="mb-1 text-2xl font-bold text-slate-800">จัดการผู้ใช้</h1>
      <p className="mb-6 text-sm text-slate-500">
        สร้างบัญชีด้วย username (ไม่ต้องมีอีเมลจริง) · ให้สิทธิ์ · รีเซ็ตรหัสผ่าน · ลบ —
        เฉพาะเจ้าของกิจการ (main)
      </p>

      {msg && (
        <div
          className={`mb-4 rounded-lg px-3 py-2 text-sm ${
            msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* สร้างผู้ใช้ใหม่ */}
      <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 font-semibold text-slate-800">+ สร้างผู้ใช้ใหม่</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">ชื่อผู้ใช้ (username)</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="เช่น sale1"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">ชื่อแสดงผล</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="เช่น สมชาย"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">รหัสผ่าน</span>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="อย่างน้อย 6 ตัว"
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">สิทธิ์ (role)</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
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
              className="w-full rounded-lg bg-slate-800 py-2 font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              สร้าง
            </button>
          </div>
        </div>
      </div>

      {/* รายชื่อผู้ใช้ */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
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
                <tr key={u.id} className="border-b border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {u.username}
                    {isSelf && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                        คุณ
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{u.display_name}</td>
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
                      className="rounded-lg border border-slate-300 px-2 py-1"
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
                      className="mr-2 rounded-lg border border-slate-300 px-2.5 py-1 text-slate-600 hover:bg-slate-100"
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
                      className="rounded-lg border border-red-200 px-2.5 py-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
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
