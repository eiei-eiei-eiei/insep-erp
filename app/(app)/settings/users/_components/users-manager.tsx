"use client";

import { showToast } from "@/lib/shared/toast";
import { useState, useTransition } from "react";
import { ROLE_LABEL, ROLE_HINT, type Role } from "@/lib/shared/roles";
import { rolesFor } from "@/lib/shared/moduleScope";
import { PASSWORD_MIN } from "@/lib/shared/password";
import { SettingsCard, ListRow } from "@/lib/shared/settings";
import { IconTrash } from "@/lib/shared/icons";
import {
  IconBtn,
  Modal,
  ModalCancel,
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
  updateEntityScopeAction,
  type ActionResult,
} from "../actions";
import { entityScopeLabel, ENTITY_SCOPE_COVERS, ENTITY_SCOPE_NOT_COVERED } from "@/lib/shared/entityScope";

export type UserRow = {
  id: string;
  username: string;
  display_name: string | null;
  role: Role;
  created_at: string;
  /** D120 — null = เห็นทุกกิจการ */
  allowed_entity_ids: string[] | null;
};
export type EntityOpt = { entity_id: string; name: string };

/*
 * 🚨 รายชื่อบทบาทมาจาก `rolesFor()` (อ่าน ROLES/ROLE_CAPS ที่ lib/shared/roles) — **ห้ามก๊อปรายชื่อมาไว้ที่นี่**
 *    ลิสต์ที่ก๊อปไว้คือสาเหตุของ D84 (เพิ่มของใหม่แล้วหน้าจอไม่รู้จัก)
 * ★ D133 — กรองตามโมดูลที่ซื้อ (ไม่มีบาร์ = ไม่มี "พนักงานบาร์" ให้เลือก) · บทบาทเดิมของผู้ใช้คงไว้เสมอ
 */

/** ป๊อปอัพที่เปิดอยู่ — `null` = ไม่มี */
type Dialog = { kind: "reset" | "delete" | "scope"; user: UserRow } | null;

export function UsersManager({
  users,
  entities,
  currentUserId,
  modules,
}: {
  /** D133 — โมดูลที่ลูกค้าซื้อ (กรองบทบาทที่ให้เลือก) */
  modules: string[];
  users: UserRow[];
  entities: EntityOpt[];
  currentUserId: string;
}) {
  // D120 — กิจการเดียว = ไม่มีอะไรให้จำกัด → ไม่โชว์คอลัมน์ (D51: ไม่โชว์ทางเลือกที่ไม่มีจริง)
  const multiEntity = entities.length > 1;
  // ป๊อปอัพจำกัดกิจการ: null = ทุกกิจการ
  const [scope, setScope] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();
  // D134 — ผลการทำรายการขึ้นเป็นป้ายลอย (showToast) ไม่มีแถบในหน้าแล้ว
  const setMsg = (m: UiMsg | null) => { if (m) showToast(m); };

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
    <div className="space-y-4">
      {/* สร้างผู้ใช้ใหม่ */}
      <SettingsCard
        title="สร้างผู้ใช้ใหม่"
        help="สร้างบัญชีด้วย username (ไม่ต้องมีอีเมลจริง) · ให้สิทธิ์ — เฉพาะเจ้าของกิจการ (main)"
      >
        <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2 lg:grid-cols-5">
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
              {rolesFor(modules).map((r) => (
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
      </SettingsCard>

      {/* รายชื่อผู้ใช้ — 1 คน = 1 แถว (สิทธิ์ = ดร็อปดาวน์ในแถว เปลี่ยนแล้วบันทึกทันทีเหมือนเดิม) */}
      <SettingsCard
        title="ผู้ใช้ในระบบ"
        count={users.length}
        unit="คน"
        help="รีเซ็ตรหัสผ่าน · ลบผู้ใช้ · ให้สิทธิ์ — เฉพาะเจ้าของกิจการ (main)"
      >
        {users.map((u) => {
          const isSelf = u.id === currentUserId;
          return (
            <ListRow
              key={u.id}
              title={
                <span className="font-medium">
                  {u.username}
                  {isSelf && (
                    <span className="ml-2 rounded bg-raised px-1.5 py-0.5 text-xs font-normal text-faint">
                      คุณ
                    </span>
                  )}
                </span>
              }
              sub={
                <div className="space-y-1.5">
                  {u.display_name && <div>{u.display_name}</div>}
                  <div className="max-w-xs">
                    <Select
                      aria-label={`สิทธิ์ของ ${u.username}`}
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
                      {rolesFor(modules, u.role).map((r) => (
                        <option key={r} value={r} title={ROLE_HINT[r]}>
                          {ROLE_LABEL[r]} ({r})
                        </option>
                      ))}
                    </Select>
                  </div>
                  {multiEntity && (
                    <div>
                      <span className={u.allowed_entity_ids ? "text-warn" : "text-muted"}>
                        กิจการที่เห็นได้: {entityScopeLabel(u.allowed_entity_ids, entities)}
                      </span>
                      {u.role === "main" && <span className="ml-2 text-faint">main เห็นทุกกิจการเสมอ</span>}
                    </div>
                  )}
                  {isSelf && (
                    <div className="text-faint">ลบบัญชีที่กำลังใช้งานอยู่ไม่ได้ (ให้ผู้ใช้ main อีกคนลบให้)</div>
                  )}
                </div>
              }
              actions={
                <>
                  {multiEntity && u.role !== "main" && !isSelf && (
                    <RowBtn
                      disabled={pending}
                      onClick={() => { setScope(u.allowed_entity_ids); setDialog({ kind: "scope", user: u }); }}
                    >
                      จำกัดกิจการ
                    </RowBtn>
                  )}
                  <RowBtn
                    disabled={pending}
                    onClick={() => { setNewPw(""); setDialog({ kind: "reset", user: u }); }}
                  >
                    รีเซ็ตรหัส
                  </RowBtn>
                  <IconBtn
                    tone="red"
                    disabled={pending || isSelf}
                    aria-label={`ลบผู้ใช้ ${u.username}`}
                    title={isSelf ? "ลบบัญชีที่กำลังใช้งานอยู่ไม่ได้ (ให้ผู้ใช้ main อีกคนลบให้)" : `ลบผู้ใช้ ${u.username}`}
                    onClick={() => setDialog({ kind: "delete", user: u })}
                  >
                    <IconTrash size={16} />
                  </IconBtn>
                </>
              }
            />
          );
        })}
      </SettingsCard>

      {/*
        🚨 ป๊อปอัพในแอป ไม่ใช่ window.prompt/confirm
           · `prompt()` **throw ในเบราว์เซอร์ที่ฝังอยู่ในแอปอื่น** ("prompt() is not supported")
             → ปุ่มรีเซ็ตรหัสพังสนิท ไม่ใช่แค่หน้าตาไม่สวย
           · และรหัสผ่านใน prompt **ไม่ถูกปิดบัง** ใครยืนข้างหลังก็อ่านได้
           · `confirm()` ก็ถูกกลืนในบางบริบท → กดลบแล้วเหมือนปุ่มเสีย
        🪤 พื้นหลังปิดด้วย onMouseDown ไม่ใช่ onClick (D73 — ลากคลุมข้อความแล้วป๊อปอัพปิดเอง)
      */}
      {dialog?.kind === "scope" && (
        <ScopeDialog
          user={dialog.user}
          entities={entities}
          scope={scope}
          setScope={setScope}
          pending={pending}
          onCancel={closeDialog}
          onSave={() =>
            run(
              () => updateEntityScopeAction({ id: dialog.user.id, entityIds: scope }),
              `ตั้งกิจการที่ ${dialog.user.username} เห็นได้แล้ว`,
              () => setDialog(null),
            )
          }
        />
      )}
      {dialog?.kind === "reset" && (
        <Modal
          title="รีเซ็ตรหัสผ่าน"
          onClose={closeDialog}
          busy={pending}
          footer={
            <>
              <ModalCancel onClick={closeDialog} disabled={pending} />
              <SaveButton
                pending={pending}
                pendingText="กำลังตั้ง…"
                disabled={newPw.length < PASSWORD_MIN}
                onClick={() => doReset(dialog.user)}
              >
                ตั้งรหัสใหม่
              </SaveButton>
            </>
          }
        >
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
            onChange={(e) => setNewPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newPw.length >= PASSWORD_MIN) doReset(dialog.user);
            }}
          />
          <MissingHint
            checks={[
              { label: `รหัสผ่านอย่างน้อย ${PASSWORD_MIN} ตัว`, ok: newPw.length >= PASSWORD_MIN },
            ]}
          />
        </Modal>
      )}
      {dialog?.kind === "delete" && (
        <Modal
          title={<span className="text-crit">ลบผู้ใช้ถาวร</span>}
          onClose={closeDialog}
          busy={pending}
          footer={
            <>
              <ModalCancel onClick={closeDialog} disabled={pending} />
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
            </>
          }
        >
          <p className="mb-3 text-sm text-muted">
            จะลบบัญชี <b className="text-ink">{dialog.user.username}</b> ออกจากระบบ
          </p>
          <p className="rounded-lg border border-crit-line bg-crit-bg px-3 py-2 text-xs text-crit">
            ลบแล้วเข้าระบบด้วยบัญชีนี้ไม่ได้อีก · ส่วนข้อมูลที่เขาเคยบันทึกไว้ยังอยู่ครบ
            (ประวัติการแก้ไขยังเก็บชื่อผู้ใช้ไว้)
          </p>
        </Modal>
      )}
    </div>
  );
}

/**
 * D120 — เลือกกิจการที่ผู้ใช้เห็นได้
 * 🚨 บอกตรง ๆ ว่าครอบอะไร/ไม่ครอบอะไร — ข้อความมาจาก lib (ต้องตรงกับ migration 0087)
 *    เขียนว่า "เห็นแค่บริษัท" ทั้งที่งานผลิต/ขายยังเห็นทุกกิจการ = เจ้าของเข้าใจผิดว่าข้อมูลปลอดภัย
 */
function ScopeDialog({
  user, entities, scope, setScope, pending, onCancel, onSave,
}: {
  user: UserRow;
  entities: EntityOpt[];
  scope: string[] | null;
  setScope: (v: string[] | null) => void;
  pending: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const limited = scope !== null;
  const picked = scope ?? [];
  const checks = [{ label: "เลือกอย่างน้อย 1 กิจการ", ok: !limited || picked.length > 0 }];
  return (
    <Modal
      title="กิจการที่เห็นได้"
      onClose={onCancel}
      busy={pending}
      footer={
        <>
          <ModalCancel onClick={onCancel} disabled={pending} />
          <SaveButton pending={pending} pendingText="กำลังบันทึก…" disabled={!checks.every((c) => c.ok)} onClick={onSave}>
            บันทึก
          </SaveButton>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        ผู้ใช้ <b className="text-ink">{user.username}</b> ({ROLE_LABEL[user.role] ?? user.role})
      </p>
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="radio" checked={!limited} onChange={() => setScope(null)} /> ทุกกิจการ
      </label>
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="radio" checked={limited} onChange={() => setScope(picked)} /> เฉพาะกิจการที่เลือก
      </label>
      {limited && (
        <div className="mb-3 ml-6 space-y-1">
          {entities.map((e) => (
            <label key={e.entity_id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={picked.includes(e.entity_id)}
                onChange={(ev) =>
                  setScope(ev.target.checked ? [...picked, e.entity_id] : picked.filter((x) => x !== e.entity_id))
                }
              />
              {e.entity_id} — {e.name}
            </label>
          ))}
        </div>
      )}
      <div className="mb-4 rounded-lg bg-raised px-3 py-2 text-xs text-muted">
        <div>จำกัดได้: {ENTITY_SCOPE_COVERS}</div>
        <div className="mt-1 text-warn">ยังไม่ถูกจำกัด: {ENTITY_SCOPE_NOT_COVERED}</div>
        <div className="mt-1 text-faint">มีผลตั้งแต่ผู้ใช้เปิดหน้าถัดไป (ไม่ต้องออกจากระบบ)</div>
      </div>
      <MissingHint checks={checks} />
    </Modal>
  );
}
