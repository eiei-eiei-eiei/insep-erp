"use client";

import { useState } from "react";
import {
  Card,
  Empty,
  Field,
  Msg,
  RowBtn,
  SaveButton,
  Select,
  TableWrap,
  TextInput,
  Badge,
  useSaver,
} from "@/lib/shared/ui";
import { IconAlert, IconCheck, IconPlus } from "@/lib/shared/icons";
import { formatDateThai } from "@/lib/shared/format";
import { BRAND_COLORS } from "@/lib/shared/branding";
import { MODULES, ROLE_LABEL, type Role } from "@/lib/shared/workspaces";
import type { TenantRow } from "@/lib/platform/provision";
import {
  addEntityAction,
  createTenantAction,
  resetPasswordAction,
  setModulesAction,
  setQuotaAction,
} from "../actions";

/** ป้ายชื่อโมดูลภาษาไทย — ต้องตรงกับที่ลูกค้าเห็นในแถบเมนู ไม่งั้นคุยกันคนละเรื่องตอนซัพพอร์ต */
const MODULE_LABEL: Record<string, string> = {
  production: "ผลิต (+ ฟอร์ม ภส.)",
  accounting: "บัญชี",
  sales: "ขาย",
  payroll: "เงินเดือน",
};

/** วันที่ไทยย่อ — ใช้ตัวเดียวกับทั้งระบบ (`lib/shared/format`) ไม่เขียนของตัวเอง */
const dateTH = (iso: string) => formatDateThai(iso);

/**
 * แผงแสดง "รหัสชั่วคราว" — ★ หัวใจของเฟส 1
 *
 * บทเรียนจาก 2026-08-12: รหัสถูกพิมพ์ลง terminal แล้วหายไปกับหน้าต่างที่ปิดไป
 * → ที่นี่ต้อง (1) เด่นจนมองข้ามไม่ได้ (2) ก๊อปได้ในคลิกเดียว (3) ไม่หายเองจนกว่าจะกดปิด
 * 🚨 ค่านี้ไม่ได้ถูกเก็บที่ไหนทั้งสิ้น — ปิดแล้วต้องรีเซ็ตใหม่เท่านั้น
 */
function SecretPanel({
  secret,
  onClose,
}: {
  secret: { title: string; username: string; password: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const text = `ชื่อผู้ใช้: ${secret.username}\nรหัสผ่านชั่วคราว: ${secret.password}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied("fail"); // เบราว์เซอร์ไม่อนุญาต (เช่นเปิดผ่าน http) → ให้ลากเลือกเอง
    }
  }

  return (
    <div className="rounded-lg border border-warn-line bg-warn-bg p-4">
      <div className="flex items-start gap-2">
        <IconAlert size={18} className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-warn">{secret.title}</div>
          <p className="mt-1 text-xs text-warn">
            รหัสนี้แสดง <strong>ครั้งเดียว</strong> — ไม่ได้ถูกเก็บไว้ที่ไหนเลย
            ปิดแผงนี้แล้วเรียกดูซ้ำไม่ได้ ต้องรีเซ็ตรหัสใหม่อย่างเดียว
            <br />
            ระบบจะบังคับให้ลูกค้าตั้งรหัสของตัวเองตอนล็อกอินครั้งแรก
          </p>

          <div className="mt-3 space-y-1 rounded border border-line bg-card p-3 font-mono text-sm text-ink">
            <div className="break-all">
              <span className="text-faint">ชื่อผู้ใช้ </span>
              {secret.username}
            </div>
            <div className="break-all">
              <span className="text-faint">รหัสผ่าน </span>
              <strong>{secret.password}</strong>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <RowBtn type="button" tone="brand" onClick={copy}>
              คัดลอกทั้งชุด
            </RowBtn>
            <RowBtn type="button" onClick={onClose}>
              ปิด (ก๊อปเก็บแล้ว)
            </RowBtn>
            {copied === "ok" && (
              <span className="flex items-center gap-1 text-xs text-ok">
                <IconCheck size={14} />
                คัดลอกแล้ว
              </span>
            )}
            {copied === "fail" && (
              <span className="text-xs text-crit">คัดลอกอัตโนมัติไม่ได้ — ลากเลือกข้อความด้านบนแทน</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** ติ๊กโมดูลที่ลูกค้าซื้อ — ใช้ทั้งตอนสร้างใหม่และตอนแก้แพ็กเกจ */
function ModulePicker({
  value,
  onChange,
  idPrefix,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {MODULES.map((m) => (
        <label key={m} htmlFor={`${idPrefix}-${m}`} className="flex items-center gap-2 text-sm text-ink">
          <input
            id={`${idPrefix}-${m}`}
            type="checkbox"
            checked={value.includes(m)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, m] : value.filter((x) => x !== m))
            }
          />
          {MODULE_LABEL[m] ?? m}
        </label>
      ))}
    </div>
  );
}

// ── ฟอร์มรับลูกค้าใหม่ ────────────────────────────────────────────────────────

function NewTenantForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (input: {
    slug: string;
    name: string;
    color: string;
    entityId: string;
    maxEntities: number;
    modules: string[];
  }) => void;
}) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("steel");
  const [entityId, setEntityId] = useState("EID01");
  const [maxEntities, setMaxEntities] = useState(1);
  const [modules, setModules] = useState<string[]>([...MODULES]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ slug, name, color, entityId, maxEntities, modules });
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="ชื่อย่อลูกค้า (slug) — ใช้เป็น subdomain + ชื่อผู้ใช้">
          <TextInput
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="rongsomchai"
            autoCapitalize="off"
            spellCheck={false}
            required
          />
        </Field>
        <Field label="ชื่อกิจการที่จะแสดงในแอป">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="โรงกลั่นสมชาย"
            required
          />
        </Field>
        <Field label="ชุดสีแบรนด์">
          <Select value={color} onChange={(e) => setColor(e.target.value)}>
            {BRAND_COLORS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="รหัสกิจการแรก">
            <TextInput
              value={entityId}
              onChange={(e) => setEntityId(e.target.value.toUpperCase())}
              spellCheck={false}
            />
          </Field>
          <Field label="โควตากิจการ">
            <TextInput
              type="number"
              min={1}
              value={maxEntities}
              onChange={(e) => setMaxEntities(Number(e.target.value))}
              className="tnum text-right"
            />
          </Field>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium tracking-wide text-muted">โมดูลที่ลูกค้าซื้อ</div>
        <ModulePicker value={modules} onChange={setModules} idPrefix="new" />
        <p className="mt-1 text-xs text-faint">
          ต้องเลือกอย่างน้อย 1 โมดูล — ไม่เลือกเลยระบบจะถือว่าเปิดทุกโมดูล (ค่า fail-open ตาม D53)
        </p>
      </div>

      <div className="flex items-center gap-3">
        <SaveButton pending={pending} pendingText="กำลังสร้าง…">
          สร้างลูกค้าใหม่
        </SaveButton>
        <span className="text-xs text-faint">
          ได้ระบบเปล่า ไม่มีข้อมูลตัวอย่าง · ผู้ใช้ที่สร้างให้คือ <code>owner-{slug || "slug"}</code>
        </span>
      </div>
    </form>
  );
}

// ── แผงจัดการลูกค้า 1 ราย ─────────────────────────────────────────────────────

function TenantPanel({
  t,
  pending,
  onModules,
  onQuota,
  onAddEntity,
  onReset,
}: {
  t: TenantRow;
  pending: boolean;
  onModules: (modules: string[]) => void;
  onQuota: (n: number) => void;
  onAddEntity: (e: { entityId: string; name: string; isVat: boolean }) => void;
  onReset: (userId: string, username: string) => void;
}) {
  const [modules, setModules] = useState<string[]>(t.modules.length ? t.modules : [...MODULES]);
  const [quota, setQuota] = useState(t.maxEntities);
  const [entityId, setEntityId] = useState("");
  const [entityName, setEntityName] = useState("");
  const [isVat, setIsVat] = useState(true);

  const quotaFull = t.entities.length >= t.maxEntities;

  return (
    <Card className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-soft pb-3">
        <div>
          <h2 className="text-base font-bold text-ink">{t.name}</h2>
          <div className="text-xs text-faint">
            {t.slug} · เปิดใช้เมื่อ {dateTH(t.createdAt)}
          </div>
        </div>
        {!t.isActive && <Badge tone="crit">ปิดใช้งาน</Badge>}
      </div>

      {/* ── โมดูลตามแพ็กเกจ ── */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">โมดูลที่เปิดใช้</h3>
        <ModulePicker value={modules} onChange={setModules} idPrefix={`m-${t.id}`} />
        <div className="mt-3">
          <SaveButton pending={pending} onClick={() => onModules(modules)} type="button">
            บันทึกโมดูล
          </SaveButton>
        </div>
        <p className="mt-2 text-xs text-faint">
          ลูกค้าเห็นเมนูใหม่ทันทีที่รีเฟรช · ลูกค้าเปลี่ยนค่านี้เองไม่ได้ (ตาราง tenants ไม่มี policy update)
        </p>
      </div>

      {/* ── โควตากิจการ (แยกจากปุ่มเพิ่มกิจการโดยตั้งใจ — D53) ── */}
      <div className="border-t border-line-soft pt-4">
        <h3 className="mb-1 text-sm font-semibold text-ink">โควตากิจการ (add-on)</h3>
        <p className="mb-2 text-xs text-faint">
          ใช้ไป {t.entities.length} จาก {t.maxEntities} · ขยายโควตา = ยืนยันว่าลูกค้าจ่ายค่า add-on แล้ว
          จึงแยกจากปุ่ม “เพิ่มกิจการ” คนละขั้น
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-28">
            <TextInput
              type="number"
              min={1}
              value={quota}
              onChange={(e) => setQuota(Number(e.target.value))}
              className="tnum text-right"
            />
          </div>
          <SaveButton pending={pending} onClick={() => onQuota(quota)} type="button">
            บันทึกโควตา
          </SaveButton>
        </div>
      </div>

      {/* ── กิจการ ── */}
      <div className="border-t border-line-soft pt-4">
        <h3 className="mb-2 text-sm font-semibold text-ink">กิจการ</h3>
        <TableWrap minWidth={420}>
          <table className="tbl">
            <thead>
              <tr>
                <th>รหัส</th>
                <th>ชื่อ</th>
                <th>VAT</th>
                <th>ค่าเริ่มต้น</th>
              </tr>
            </thead>
            <tbody>
              {t.entities.map((e) => (
                <tr key={e.entityId}>
                  <td className="font-medium text-ink">{e.entityId}</td>
                  <td>{e.name}</td>
                  <td>{e.isVat ? "จด VAT" : <span className="text-warn">ไม่จด VAT</span>}</td>
                  <td>{e.isDefault ? "✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAddEntity({ entityId, name: entityName, isVat });
            setEntityId("");
            setEntityName("");
          }}
          className="mt-3 flex flex-wrap items-end gap-3"
        >
          <div className="w-28">
            <Field label="รหัสใหม่">
              <TextInput
                value={entityId}
                onChange={(ev) => setEntityId(ev.target.value.toUpperCase())}
                placeholder="EID02"
                spellCheck={false}
                required
              />
            </Field>
          </div>
          <div className="min-w-[12rem] flex-1">
            <Field label="ชื่อกิจการ">
              <TextInput
                value={entityName}
                onChange={(ev) => setEntityName(ev.target.value)}
                placeholder="สมชาย (บุคคลธรรมดา)"
                required
              />
            </Field>
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={isVat}
              onChange={(ev) => setIsVat(ev.target.checked)}
            />
            จด VAT
          </label>
          <SaveButton pending={pending} disabled={quotaFull} pendingText="กำลังเพิ่ม…">
            เพิ่มกิจการ
          </SaveButton>
        </form>

        {quotaFull && (
          <p className="mt-2 text-xs text-warn">
            โควตาเต็มแล้ว ({t.entities.length}/{t.maxEntities}) — ขยายโควตาด้านบนก่อน
          </p>
        )}
        {!isVat && (
          <p className="mt-2 text-xs text-crit">
            ⚠️ ระบบยังไม่แยกสูตร VAT ตามกิจการ (งาน 4.3) — กิจการที่ไม่จด VAT ยังถูกคิด VAT 7%
            และยังออกใบกำกับภาษีได้ ซึ่งผิดกฎหมาย · อย่าเพิ่งใช้กับลูกค้าจริงที่ไม่จด VAT
          </p>
        )}
      </div>

      {/* ── ผู้ใช้ + รีเซ็ตรหัส ── */}
      <div className="border-t border-line-soft pt-4">
        <h3 className="mb-2 text-sm font-semibold text-ink">ผู้ใช้ของลูกค้ารายนี้</h3>
        <TableWrap minWidth={520}>
          <table className="tbl">
            <thead>
              <tr>
                <th>ชื่อผู้ใช้</th>
                <th>ชื่อที่แสดง</th>
                <th>สิทธิ์</th>
                <th>สถานะรหัส</th>
                <th className="act"></th>
              </tr>
            </thead>
            <tbody>
              {t.users.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium text-ink">{u.username ?? "—"}</td>
                  <td>{u.displayName ?? "—"}</td>
                  <td>{ROLE_LABEL[u.role as Role] ?? u.role}</td>
                  <td>
                    {u.mustChangePassword ? (
                      <Badge tone="warn">รอเจ้าตัวตั้งรหัสเอง</Badge>
                    ) : (
                      <Badge tone="ok">ตั้งเองแล้ว</Badge>
                    )}
                  </td>
                  <td className="act">
                    <RowBtn
                      type="button"
                      tone="red"
                      disabled={pending}
                      onClick={() => onReset(u.id, u.username ?? "")}
                    >
                      รีเซ็ตรหัส
                    </RowBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {t.users.length === 0 && <Empty>— ยังไม่มีผู้ใช้ —</Empty>}
      </div>
    </Card>
  );
}

// ── หน้าหลัก ─────────────────────────────────────────────────────────────────

export function PlatformManager({ tenants }: { tenants: TenantRow[] }) {
  const { pending, msg, run, setMsg } = useSaver();
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ title: string; username: string; password: string } | null>(
    null,
  );

  const open = tenants.find((t) => t.id === openId) ?? null;

  /** แสดงรหัสชั่วคราวที่ action คืนมา — ค่านี้ไม่ได้ถูกเก็บที่ไหน ต้องขึ้นจอเดี๋ยวนั้น */
  function showSecret(title: string) {
    return (data?: unknown) => {
      const d = data as { username?: string; password?: string } | undefined;
      if (d?.password) setSecret({ title, username: d.username ?? "", password: d.password });
    };
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">ลูกค้าทั้งหมด</h1>
          <p className="text-sm text-faint">
            {tenants.length} ราย · รับลูกค้าใหม่ · เปลี่ยนแพ็กเกจ · รีเซ็ตรหัส — ไม่ต้องเปิด terminal
          </p>
        </div>
        <RowBtn type="button" tone="brand" onClick={() => setShowNew((v) => !v)}>
          <span className="inline-flex items-center gap-1">
            <IconPlus size={14} />
            {showNew ? "ปิดฟอร์ม" : "รับลูกค้าใหม่"}
          </span>
        </RowBtn>
      </div>

      {secret && <SecretPanel secret={secret} onClose={() => setSecret(null)} />}
      <Msg msg={msg} />

      {showNew && (
        <Card title="รับลูกค้าใหม่">
          <NewTenantForm
            pending={pending}
            onSubmit={(input) =>
              run(() => createTenantAction(input), "สร้างลูกค้าใหม่แล้ว", showSecret("รหัสผ่านชั่วคราวของลูกค้าใหม่"))
            }
          />
        </Card>
      )}

      <Card>
        <TableWrap minWidth={760}>
          <table className="tbl">
            <thead>
              <tr>
                <th>ชื่อย่อ</th>
                <th>ชื่อกิจการ</th>
                <th>โมดูล</th>
                <th className="num">กิจการ</th>
                <th className="num">ผู้ใช้</th>
                <th>เปิดใช้เมื่อ</th>
                <th className="act"></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className={t.id === openId ? "editing" : undefined}>
                  <td className="font-medium text-ink">{t.slug}</td>
                  <td>{t.name}</td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      {MODULES.filter((m) => t.modules.includes(m)).map((m) => (
                        <Badge key={m} tone="brand">
                          {m === "production" ? "ผลิต" : m === "accounting" ? "บัญชี" : "ขาย"}
                        </Badge>
                      ))}
                      {t.modules.length === 0 && <Badge tone="warn">ไม่ได้ตั้ง = เปิดหมด</Badge>}
                    </span>
                  </td>
                  <td className="num">
                    {t.entities.length}/{t.maxEntities}
                  </td>
                  <td className="num">{t.users.length}</td>
                  <td>{dateTH(t.createdAt)}</td>
                  <td className="act">
                    <RowBtn type="button" onClick={() => setOpenId(t.id === openId ? null : t.id)}>
                      {t.id === openId ? "ปิด" : "จัดการ"}
                    </RowBtn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {tenants.length === 0 && <Empty>— ยังไม่มีลูกค้า กด “รับลูกค้าใหม่” เพื่อเริ่ม —</Empty>}
      </Card>

      {open && (
        <TenantPanel
          key={open.id}
          t={open}
          pending={pending}
          onModules={(modules) =>
            run(
              () => setModulesAction({ tenantId: open.id, slug: open.slug, modules }),
              "บันทึกโมดูลแล้ว",
            )
          }
          onQuota={(maxEntities) =>
            run(
              () => setQuotaAction({ tenantId: open.id, slug: open.slug, maxEntities }),
              "บันทึกโควตาแล้ว",
            )
          }
          onAddEntity={(e) =>
            run(
              () => addEntityAction({ tenantId: open.id, slug: open.slug, ...e }),
              `เพิ่มกิจการ ${e.entityId} แล้ว`,
            )
          }
          onReset={(userId, username) => {
            setMsg(null);
            if (
              !window.confirm(
                `รีเซ็ตรหัสผ่านของ "${username}"?\n` +
                  "รหัสเดิมจะใช้ไม่ได้ทันที และเจ้าตัวต้องตั้งรหัสใหม่ตอนล็อกอินครั้งถัดไป",
              )
            )
              return;
            run(
              () => resetPasswordAction({ tenantId: open.id, slug: open.slug, userId }),
              "ตั้งรหัสชั่วคราวใหม่แล้ว",
              showSecret(`รหัสผ่านชั่วคราวของ ${username}`),
            );
          }}
        />
      )}
    </div>
  );
}
