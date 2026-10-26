"use client";

/**
 * ห้องทดลองบาร์ (D129) — ลองชงสูตรใหม่ · ใช้ทำคอนเทนต์ · สรุปทุน
 *
 * ── โฟลว์ที่ตกลงกับผู้ใช้ ────────────────────────────────────────────────────
 * · ลองชง 1 ครั้ง = บันทึกสูตร + ตัดสต็อก + แช่ทุน ในป๊อปอัพเดียว (ไม่แยกหน้า "สร้างดราฟต์")
 * · การ์ดสูตรมีหลายรอบ · โน้ตเขียนทีหลังได้ (ชงก่อน ชิมทีหลัง) · ส่งขึ้นเมนูขายจากรอบไหนก็ได้
 * · ใช้เมนูที่มี/สูตรทดลอง/วัตถุดิบเดี่ยว ทำคอนเทนต์ · หมวดตั้งเองได้ เพิ่มหมวดจากหน้านี้ได้เลย
 * · สรุปทุนเห็นเฉพาะคนที่มี bar.config (ตัวเลขทุนไม่ถูกส่งมาให้พนักงานบาร์ตั้งแต่ server)
 *
 * ★ ตรรกะ/ประโยคตัดสินใน lib/bar/lab.ts (golden B26) · ช่องกรอกสูตรใช้ RecipeEditor ชุดเดียวกับเมนู
 * ★ ส่งขึ้นเมนูใช้ MenuModal ตัวเดียวกับแท็บเมนู & สูตร (ห้ามก๊อปไปทำใหม่ · D42)
 * 🚨 ห้ามประกาศคอมโพเนนต์ซ้อนข้างในคอมโพเนนต์ (D71)
 */
import { useState } from "react";
import { moveAt } from "@/lib/bar/quickPick";
import { refsOf } from "@/lib/bar/houseSlot";
import type { BarBoot } from "../data";
import { cleanRecipe, blankRecipeRow, type RecipeDraftRow } from "@/lib/bar/recipe";
import { businessDate } from "@/lib/bar/businessDate";
import { presetRange, RANGE_LABEL, matchPreset, type RangeKey } from "@/lib/bar/dashDays";
import {
  roundsOf, recipeSpent, roundToDraft, roundLinesText, roundBlock, filterRecipes, deleteBlock, deleteConfirmText,
  planUse, previewUseCost, labSummary, labCategories,
  RECIPE_FILTERS, RECIPE_FILTER_LABEL, TRIAL_CATEGORY,
  type LabCategory, type LabRecipe, type LabUse, type LabStatus, type RecipeFilter, type UseDraft,
} from "@/lib/bar/lab";
import {
  Card, TextInput, NumBox, Select, Field, Badge, Empty, EscToClose, Combobox, SuggestInput, LoadError,
  fmt, useSaver, useRead, useConfirm,
} from "@/lib/shared/ui";
import {
  labDataAction, labRoundAction, labUseAction, labDeleteUseAction, labUpdateUseAction, labUpdateRecipeAction,
  labPromoteAction, labAddCategoryAction, labSaveCategoriesAction,
} from "../actions";
import { RecipeEditor } from "./RecipeEditor";
import { MenuModal } from "./MenuTab";

export type LabData = {
  me: string | null;
  canSeeCost: boolean;
  categories: LabCategory[];
  recipes: LabRecipe[];
  uses: LabUse[];
};

type View = "recipes" | "use" | "summary";
const VIEW_LABEL: Record<View, string> = { recipes: "สูตรที่กำลังลอง", use: "ใช้เมนูที่มี", summary: "สรุปต้นทุน" };

type Res = { ok: boolean; error?: string; data?: unknown };

async function loadLab(): Promise<LabData> {
  const r = await labDataAction();
  if (!r.ok) throw new Error(r.error ?? "อ่านข้อมูลห้องทดลองไม่สำเร็จ");
  return r.data as LabData;
}

export function LabTab({ boot, onReload }: { boot: BarBoot; onReload: () => Promise<void> }) {
  const lab = useRead(loadLab, [boot.entityId], { skip: !boot.entityId });
  const { setMsg } = useSaver();
  const { confirmNode, ask } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("recipes");

  if (!boot.entityId) return null;
  const data = lab.data;
  const views: View[] = boot.canSeeCost ? ["recipes", "use", "summary"] : ["recipes", "use"];

  /** ทำรายการแล้วโหลดใหม่ทั้งห้องทดลองและบาร์ (สต็อกขยับ · เมนูใหม่) */
  async function run(fn: () => Promise<Res>, okText: string | ((d: unknown) => string)): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? "บันทึกไม่สำเร็จ" });
        return false;
      }
      lab.reload();
      await onReload();
      setMsg({ ok: true, text: typeof okText === "function" ? okText(r.data) : okText });
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function removeUse(u: LabUse) {
    if (!data) return;
    const recipeName = u.recipeId ? (data.recipes.find((r) => r.recipeId === u.recipeId)?.name ?? null) : null;
    const ok = await ask({
      title: u.roundNo ? `ลบรอบที่ ${u.roundNo}?` : `ลบรายการ ${u.useId}?`,
      detail: deleteConfirmText(u, data.uses, recipeName),
      confirmText: "ลบรายการ",
      danger: true,
    });
    if (ok) await run(() => labDeleteUseAction(u.useId), "ลบแล้ว · คืนของเข้าสต็อกแล้ว");
  }

  return (
    <div className="space-y-4">
      {confirmNode}
      <p className="text-xs text-faint">
        ของที่ใช้ที่นี่<b>ตัดสต็อก</b>และ<b>จำทุน ณ ตอนนั้น</b>ไว้ — ไม่เป็นบิล ไม่เข้ายอดขาย ไม่ลงบัญชี
        (ตอนซื้อวัตถุดิบเข้าบาร์ลงค่าใช้จ่ายไปแล้ว)
      </p>

      <div
        className={`grid ${views.length === 3 ? "grid-cols-3" : "grid-cols-2"} overflow-hidden rounded-lg border border-line bg-card`}
        role="tablist"
      >
        {views.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`min-h-[44px] px-2 py-2 text-sm sm:min-h-0 ${
              view === v ? "bg-brand-soft font-semibold text-brand" : "text-muted hover:bg-raised"
            }`}
          >
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>

      <LoadError err={lab.err} onRetry={lab.reload} what="ข้อมูลห้องทดลอง" />
      {!data && !lab.err && <p className="text-sm text-muted">กำลังโหลด…</p>}

      {data && view === "recipes" && (
        <RecipesView boot={boot} data={data} busy={busy} run={run} onDelete={removeUse} />
      )}
      {/* ★ mount ค้างไว้ — สลับไปดูส่วนอื่นแล้วแถวที่กรอกไว้ต้องไม่หาย (บทเรียน D128) */}
      {data && (
        <div className={view === "use" ? "" : "hidden"}>
          <UseView boot={boot} data={data} busy={busy} run={run} onDelete={removeUse} />
        </div>
      )}
      {data && view === "summary" && boot.canSeeCost && (
        <SummaryView boot={boot} data={data} busy={busy} onDelete={removeUse} />
      )}
    </div>
  );
}

// ── ส่วนที่ 1: สูตรที่กำลังลอง ─────────────────────────────────────────────────

type RoundTarget = { recipeId: string | null; name: string; rows: RecipeDraftRow[] };

function RecipesView({
  boot, data, busy, run, onDelete,
}: {
  boot: BarBoot;
  data: LabData;
  busy: boolean;
  run: (fn: () => Promise<Res>, ok: string | ((d: unknown) => string)) => Promise<boolean>;
  onDelete: (u: LabUse) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RecipeFilter>("กำลังลอง");
  const [round, setRound] = useState<RoundTarget | null>(null);
  const [promote, setPromote] = useState<{ recipe: LabRecipe; rows: RecipeDraftRow[] } | null>(null);
  const shown = filterRecipes(data.recipes, query, filter);
  const now = Date.now();

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !boot.canWrite}
          onClick={() => setRound({ recipeId: null, name: "", rows: [blankRecipeRow(), blankRecipeRow(), blankRecipeRow()] })}
          className="min-h-[44px] rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50 sm:min-h-0"
        >
          ＋ ลองสูตรใหม่
        </button>
        <div className="min-w-48 flex-1">
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ค้นชื่อสูตร…" aria-label="ค้นชื่อสูตร" />
        </div>
        <div className="flex flex-wrap gap-1">
          {RECIPE_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`min-h-[44px] rounded-full border px-3 py-1 text-xs sm:min-h-0 ${
                filter === f ? "border-brand-line bg-brand-soft text-brand" : "border-line bg-card text-muted hover:bg-raised"
              }`}
            >
              {RECIPE_FILTER_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 && (
        <Empty>
          {data.recipes.length === 0
            ? "— ยังไม่มีสูตรที่ลอง · กด ＋ ลองสูตรใหม่ ตอนเริ่มชงได้เลย —"
            : "— ไม่พบสูตรที่ตรงกับคำค้น/ตัวกรอง —"}
        </Empty>
      )}

      {shown.map((r) => (
        <RecipeCard
          key={r.recipeId}
          boot={boot}
          data={data}
          recipe={r}
          busy={busy}
          now={now}
          run={run}
          onRetry={(rows) => setRound({ recipeId: r.recipeId, name: r.name, rows })}
          onStatusChanged={(st) => setFilter((f) => (f === "all" ? f : st))}
          onPromote={(rows) => setPromote({ recipe: r, rows })}
          onDelete={onDelete}
        />
      ))}

      {round && (
        <RoundModal
          key={round.recipeId ?? "new"}
          boot={boot}
          target={round}
          busy={busy}
          onClose={() => setRound(null)}
          onSubmit={async (input) => {
            const ok = await run(
              () => labRoundAction({ ...input, recipeId: round.recipeId, window: boot.settings.window }),
              (d) => {
                const x = d as { round_no?: number; cost?: number };
                return `บันทึกรอบที่ ${x.round_no ?? "?"} แล้ว · ตัดสต็อกแล้ว${
                  data.canSeeCost && x.cost !== undefined ? ` · ทุน ${fmt(x.cost)} บาท` : ""
                } — ชิมแล้วเขียนโน้ตที่การ์ดได้เลย`;
              },
            );
            if (ok) setRound(null);
          }}
        />
      )}

      {promote && (
        <MenuModal
          boot={boot}
          menuId={null}
          busy={busy}
          title={`ส่งขึ้นเมนูขาย — ${promote.recipe.name}`}
          prefill={{ name: promote.recipe.name, rows: promote.rows }}
          onClose={() => setPromote(null)}
          onSave={async (input) => {
            const ok = await run(
              () => labPromoteAction(promote.recipe.recipeId, input),
              "ขึ้นเมนูขายแล้ว — เมนูใหม่อยู่ในแท็บ เมนู & สูตร และหน้าขาย",
            );
            if (ok) {
              setPromote(null);
              // 🐛 เจอตอนเทสเบราว์เซอร์: ตัวกรองปริยาย "กำลังลอง" ⇒ การ์ดหายจากจอทันทีหลังกดส่ง (งงว่าไปไหน)
              setFilter((f) => (f === "all" ? f : "ขึ้นเมนูแล้ว"));
            }
          }}
        />
      )}
    </>
  );
}

const STATUS_TONE: Record<LabStatus, "neutral" | "ok" | "warn"> = {
  "กำลังลอง": "warn",
  "ขึ้นเมนูแล้ว": "ok",
  "เลิกลอง": "neutral",
};

function RecipeCard({
  boot, data, recipe, busy, now, run, onRetry, onPromote, onDelete, onStatusChanged,
}: {
  /** เปลี่ยนสถานะแล้วสลับตัวกรองตาม — ไม่งั้นการ์ดหายจากจอทันที */
  onStatusChanged: (status: LabStatus) => void;
  boot: BarBoot;
  data: LabData;
  recipe: LabRecipe;
  busy: boolean;
  now: number;
  run: (fn: () => Promise<Res>, ok: string) => Promise<boolean>;
  onRetry: (rows: RecipeDraftRow[]) => void;
  onPromote: (rows: RecipeDraftRow[]) => void;
  onDelete: (u: LabUse) => void;
}) {
  const rounds = roundsOf(recipe.recipeId, data.uses);
  const spent = recipeSpent(recipe.recipeId, data.uses);
  const latest = rounds[0];
  const block = roundBlock(recipe.status);
  const [renaming, setRenaming] = useState<string | null>(null);
  const menuName = recipe.menuId ? boot.menus.find((m) => m.menuId === recipe.menuId)?.name : null;
  const setStatus = async (status: LabStatus) => {
    if (await run(() => labUpdateRecipeAction({ recipeId: recipe.recipeId, name: recipe.name, status }), `ย้ายไปที่ "${status}" แล้ว`))
      onStatusChanged(status);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        {renaming !== null ? (
          <>
            <div className="w-56">
              <TextInput value={renaming} onChange={(e) => setRenaming(e.target.value)} aria-label="ชื่อสูตร" />
            </div>
            <button
              type="button"
              disabled={busy || !renaming.trim()}
              onClick={async () => {
                if (
                  await run(
                    () => labUpdateRecipeAction({ recipeId: recipe.recipeId, name: renaming, status: recipe.status }),
                    "เปลี่ยนชื่อแล้ว",
                  )
                )
                  setRenaming(null);
              }}
              className="rounded-lg bg-brand px-3 py-1 text-xs text-on-brand disabled:opacity-50"
            >
              บันทึกชื่อ
            </button>
            <button type="button" onClick={() => setRenaming(null)} className="text-xs text-muted underline">
              เลิกแก้
            </button>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold text-ink">{recipe.name}</h2>
            {boot.canWrite && (
              <button type="button" onClick={() => setRenaming(recipe.name)} className="text-xs text-muted underline">
                เปลี่ยนชื่อ
              </button>
            )}
          </>
        )}
        <Badge tone={STATUS_TONE[recipe.status]}>{recipe.status}</Badge>
        <span className="ml-auto text-xs text-muted">
          {spent.rounds} รอบ · {spent.glasses} แก้ว
          {data.canSeeCost && (
            <>
              {" "}
              · ทุนพัฒนา <b className="text-ink">{fmt(spent.cost)}</b> บาท
            </>
          )}
        </span>
      </div>
      {recipe.status === "ขึ้นเมนูแล้ว" && (
        <p className="mt-1 text-xs text-ok">
          ขึ้นเมนูขายแล้ว{menuName ? `: ${menuName}` : " (เมนูถูกลบไปแล้ว)"}
        </p>
      )}

      <div className="mt-3 space-y-2">
        {rounds.map((u) => (
          <RoundRow
            key={u.useId}
            use={u}
            data={data}
            boot={boot}
            busy={busy}
            now={now}
            run={run}
            onPromote={() => onPromote(roundToDraft(u, refsOf(boot)))}
            onDelete={() => onDelete(u)}
          />
        ))}
      </div>

      {boot.canWrite && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !!block || !latest}
            onClick={() => latest && onRetry(roundToDraft(latest, refsOf(boot)))}
            className="min-h-[44px] rounded-lg bg-brand px-3 py-1.5 text-sm text-on-brand disabled:opacity-50 sm:min-h-0"
          >
            ลองรอบใหม่
          </button>
          {latest && recipe.status !== "เลิกลอง" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onPromote(roundToDraft(latest, refsOf(boot)))}
              className="min-h-[44px] rounded-lg border border-line bg-card px-3 py-1.5 text-sm text-ink disabled:opacity-50 sm:min-h-0"
            >
              {recipe.status === "ขึ้นเมนูแล้ว" ? "ส่งขึ้นเมนูอีกตัว" : "ส่งขึ้นเมนูขาย (รอบล่าสุด)"}
            </button>
          )}
          {recipe.status === "เลิกลอง" ? (
            <button type="button" disabled={busy} onClick={() => setStatus("กำลังลอง")} className="text-sm text-muted underline">
              กลับมาลองต่อ
            </button>
          ) : (
            recipe.status === "กำลังลอง" && (
              <button type="button" disabled={busy} onClick={() => setStatus("เลิกลอง")} className="text-sm text-muted underline">
                เลิกลองสูตรนี้
              </button>
            )
          )}
          {block && <span className="text-xs text-faint">{block}</span>}
        </div>
      )}
    </Card>
  );
}

/** 1 รอบบนการ์ด — โน้ตแก้ได้ตลอด (ชิมแล้วค่อยเขียน) · ใช้สูตรรอบนี้ขึ้นเมนู · ลบรอบ */
function RoundRow({
  use, data, boot, busy, now, run, onPromote, onDelete,
}: {
  use: LabUse;
  data: LabData;
  boot: BarBoot;
  busy: boolean;
  now: number;
  run: (fn: () => Promise<Res>, ok: string) => Promise<boolean>;
  onPromote: () => void;
  onDelete: () => void;
}) {
  const [note, setNote] = useState(use.note ?? "");
  const dirty = note.trim() !== (use.note ?? "");
  const delBlock = deleteBlock(use, data.me, now, boot.canConfig);

  return (
    <div className="rounded-lg bg-raised p-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <b className="text-ink">รอบ {use.roundNo}</b>
        <span className="text-xs text-muted">
          {use.businessDate} · {use.glasses} แก้ว
          {data.canSeeCost && ` · ทุน ${fmt(use.costTotal)}`}
        </span>
        <span className="ml-auto flex gap-3">
          {boot.canWrite && (
            <button type="button" disabled={busy} onClick={onPromote} className="text-xs text-brand underline disabled:opacity-50">
              ใช้สูตรรอบนี้ขึ้นเมนู
            </button>
          )}
          {delBlock === null ? (
            <button type="button" disabled={busy} onClick={onDelete} className="text-xs text-crit underline disabled:opacity-50">
              ลบรอบ
            </button>
          ) : (
            <span className="text-xs text-faint" title={delBlock}>
              ลบไม่ได้
            </span>
          )}
        </span>
      </div>
      <div className="mt-1 text-xs text-ink">{roundLinesText(use)}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <div className="min-w-48 flex-1">
          <TextInput
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ชิมแล้วเป็นยังไง เช่น หวานไป ลดไซรัป"
            aria-label={`โน้ตรอบ ${use.roundNo}`}
          />
        </div>
        {dirty && (
          <button
            type="button"
            disabled={busy || !boot.canWrite}
            onClick={() => run(() => labUpdateUseAction({ useId: use.useId, note, eventName: use.eventName }), "บันทึกโน้ตแล้ว")}
            className="rounded-lg bg-brand px-3 py-1 text-xs text-on-brand disabled:opacity-50"
          >
            บันทึกโน้ต
          </button>
        )}
      </div>
    </div>
  );
}

/** ป๊อปอัพลองชง — ชื่อ (สูตรใหม่) · สูตร · จำนวนแก้ว · โน้ต → ชงแล้ว ตัดสต็อก */
function RoundModal({
  boot, target, busy, onClose, onSubmit,
}: {
  boot: BarBoot;
  target: RoundTarget;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; glasses: number; recipe: ReturnType<typeof cleanRecipe>; note: string }) => void;
}) {
  const [name, setName] = useState(target.name);
  const [rows, setRows] = useState<RecipeDraftRow[]>(target.rows);
  const [glasses, setGlasses] = useState<number | "">(1);
  const [note, setNote] = useState("");
  const recipe = cleanRecipe(rows);
  const isNew = target.recipeId === null;
  const missing = [
    ...(isNew && !name.trim() ? ["ชื่อสูตร"] : []),
    ...(recipe.length === 0 ? ["สูตรอย่างน้อย 1 บรรทัด"] : []),
    ...(glasses === "" || glasses <= 0 ? ["จำนวนแก้ว"] : []),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <EscToClose onClose={onClose} />
      <div className="w-full max-w-lg rounded-lg bg-card p-5">
        <h3 className="mb-3 text-lg font-bold text-ink">{isNew ? "ลองสูตรใหม่" : `ลองรอบใหม่ — ${target.name}`}</h3>
        {isNew && (
          <Field label="ชื่อสูตร (ชื่อชั่วคราวก็ได้)">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="ฟักทอง Negroni ตัวที่ 1" />
          </Field>
        )}
        {!isNew && <p className="text-xs text-faint">เติมสูตรรอบล่าสุดไว้ให้แล้ว — แก้เฉพาะที่จะลองเปลี่ยน</p>}
        <RecipeEditor
          mode="lab"
          items={boot.items}
          slots={boot.houseSlots}
          garnishes={boot.garnishes}
          rows={rows}
          setRows={setRows}
          canSeeCost={boot.canSeeCost}
          isVat={boot.seller?.isVat ?? false}
          price=""
          onUsePrice={() => undefined}
        />
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Field label="ชงกี่แก้ว">
            <NumBox value={glasses} onChange={setGlasses} blankZero />
          </Field>
          <div className="sm:col-span-2">
            <Field label="โน้ต (เขียนทีหลังได้)">
              <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="ลองลดไซรัป" />
            </Field>
          </div>
        </div>
        <p className="mt-2 text-xs text-faint">
          กดแล้ว<b>ตัดสต็อกทันที</b> (ทุกแก้ว) และจำสูตร+ทุนของรอบนี้ไว้ · ขวดไม่พอก็ตัดได้ (ติดลบ) เหมือนตอนขาย
        </p>
        {missing.length > 0 && <p className="mt-1 text-xs text-warn">ยังกรอกไม่ครบ: {missing.join(" · ")}</p>}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy || missing.length > 0}
            onClick={() => onSubmit({ name, glasses: glasses as number, recipe, note })}
            className="flex-1 rounded-lg bg-brand px-3 py-2 text-sm text-on-brand disabled:opacity-50"
          >
            {busy ? "กำลังบันทึก…" : "ชงแล้ว — ตัดสต็อก"}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg bg-raised px-3 py-2 text-sm text-ink">
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ส่วนที่ 2: ใช้เมนูที่มี ────────────────────────────────────────────────────

const KIND_LABEL: Record<UseDraft["kind"], string> = { menu: "เมนู", recipe: "สูตรทดลอง", item: "วัตถุดิบ" };
let seq = 0;
type KeyedDraft = UseDraft & { k: number };
const newRow = (kind: UseDraft["kind"] = "menu"): KeyedDraft => ({ kind, id: "", qty: "", k: ++seq });

function UseView({
  boot, data, busy, run, onDelete,
}: {
  boot: BarBoot;
  data: LabData;
  busy: boolean;
  run: (fn: () => Promise<Res>, ok: string | ((d: unknown) => string)) => Promise<boolean>;
  onDelete: (u: LabUse) => void;
}) {
  const cats = labCategories(data.categories);
  const [categoryId, setCategoryId] = useState<string>(cats.find((c) => c.categoryId === "content")?.categoryId ?? cats[0].categoryId);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [eventName, setEventName] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<KeyedDraft[]>([newRow("menu"), newRow("item")]);
  const plan = planUse(rows);
  const pending = plan.menus.length + plan.recipes.length + plan.items.length;
  const preview = previewUseCost(plan, boot.menus, boot.items, refsOf(boot), data.uses);
  const events = [...new Set(data.uses.map((u) => u.eventName?.trim()).filter((x): x is string => !!x))];
  const set = (i: number, patch: Partial<UseDraft>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const recent = data.uses.filter((u) => u.recipeId === null).sort((a, b) => (a.usedAt < b.usedAt ? 1 : -1)).slice(0, 10);
  const catName = new Map(cats.map((c) => [c.categoryId, c.name]));
  const now = Date.now();

  const options = (kind: UseDraft["kind"]) =>
    kind === "menu"
      ? boot.menus.filter((m) => m.active !== false).map((m) => ({ value: m.menuId, label: m.name }))
      : kind === "recipe"
        ? data.recipes
            .filter((r) => r.status !== "เลิกลอง" && roundsOf(r.recipeId, data.uses).length > 0)
            .map((r) => ({ value: r.recipeId, label: `${r.name} (สูตรรอบล่าสุด)` }))
        : boot.items.filter((i) => i.active !== false).map((i) => ({ value: i.itemId, label: `${i.name} (${i.unit})` }));

  return (
    <>
      <Card title="ใช้เมนูที่มี / วัตถุดิบ — ถ่ายคอนเทนต์ และอื่น ๆ">
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="หมวด">
            {newCat === null ? (
              <div className="flex gap-1">
                <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  {cats.map((c) => (
                    <option key={c.categoryId} value={c.categoryId}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  onClick={() => setNewCat("")}
                  className="shrink-0 rounded-lg border border-line bg-card px-2 text-xs text-muted"
                  title="เพิ่มหมวดใหม่"
                >
                  ＋ หมวดใหม่
                </button>
              </div>
            ) : (
              <div className="flex gap-1">
                <TextInput value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="ชิมให้ลูกค้า" aria-label="ชื่อหมวดใหม่" />
                <button
                  type="button"
                  disabled={busy || !newCat.trim()}
                  onClick={async () => {
                    const name = newCat.trim();
                    const r = await labAddCategoryAction(name);
                    if (r.ok) {
                      await run(async () => ({ ok: true }), `เพิ่มหมวด ${name} แล้ว`);
                      setCategoryId((r.data as { category_id: string }).category_id);
                      setNewCat(null);
                    } else {
                      await run(async () => r, "");
                    }
                  }}
                  className="shrink-0 rounded-lg bg-brand px-2 text-xs text-on-brand disabled:opacity-50"
                >
                  เพิ่ม
                </button>
                <button type="button" onClick={() => setNewCat(null)} className="shrink-0 text-xs text-muted underline">
                  ยกเลิก
                </button>
              </div>
            )}
          </Field>
          <Field label="ชื่องาน (ไม่บังคับ)">
            <SuggestInput value={eventName} onChange={setEventName} options={events} placeholder="ถ่ายรีลเมนูหน้าหนาว" listId="lab-events" />
          </Field>
          <Field label="โน้ต">
            <TextInput value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        {categoryId === TRIAL_CATEGORY && (
          <p className="mt-1 text-xs text-faint">
            ลองสูตรใหม่ใช้ส่วน <b>สูตรที่กำลังลอง</b> — ระบบจะจำเป็นรอบของสูตรนั้น (หมวดนี้ใช้กับการลองเมนูที่มีอยู่แล้ว)
          </p>
        )}

        <div className="mt-3 space-y-2">
          {rows.map((r, i) => {
            const unit = r.kind === "item" ? boot.items.find((x) => x.itemId === r.id)?.unit : "แก้ว";
            return (
              <div key={r.k} className="flex flex-wrap items-start gap-2 border-b border-line-soft pb-2">
                <span className="w-6 pt-2 text-sm text-faint">{i + 1}</span>
                <div className="w-32">
                  <Select value={r.kind} onChange={(e) => set(i, { kind: e.target.value as UseDraft["kind"], id: "" })}>
                    {(Object.keys(KIND_LABEL) as UseDraft["kind"][]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="min-w-48 flex-1">
                  <Combobox
                    value={r.id}
                    onChange={(v) => set(i, { id: v })}
                    options={options(r.kind)}
                    placeholder={`พิมพ์ค้น${KIND_LABEL[r.kind]} แล้วกดเลือก…`}
                  />
                </div>
                <div className="w-24">
                  <NumBox value={r.qty} onChange={(v) => set(i, { qty: v })} blankZero placeholder="จำนวน" />
                </div>
                <span className="w-10 pt-2 text-xs text-faint">{r.id ? unit : ""}</span>
                <button
                  type="button"
                  aria-label="ลบแถว"
                  onClick={() => setRows((p) => (p.length > 1 ? p.filter((_, j) => j !== i) : [newRow()]))}
                  className="grid h-8 w-8 place-items-center rounded text-muted hover:text-crit"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          {(Object.keys(KIND_LABEL) as UseDraft["kind"][]).map((k) => (
            <button key={k} type="button" onClick={() => setRows((p) => [...p, newRow(k)])} className="text-muted underline">
              ＋ {KIND_LABEL[k]}
            </button>
          ))}
        </div>

        {plan.errors.length > 0 && <p className="mt-2 text-xs text-warn">ยังตัดสต็อกไม่ได้ — {plan.errors.join(" · ")}</p>}
        {data.canSeeCost && pending > 0 && (
          <p className="mt-2 text-sm text-muted">
            ทุนโดยประมาณ <b className="text-ink">{fmt(preview)}</b> บาท (ตัวจริงคิดตอนกด จากต้นทุน ณ ตอนนั้น)
          </p>
        )}
        <button
          type="button"
          disabled={busy || pending === 0 || plan.errors.length > 0 || !boot.canWrite}
          onClick={async () => {
            const ok = await run(
              () =>
                labUseAction({
                  categoryId, eventName, note,
                  menus: plan.menus, recipes: plan.recipes, items: plan.items,
                  window: boot.settings.window,
                }),
              (d) => {
                const x = d as { use_id?: string; cost?: number };
                return `ตัดสต็อกแล้ว (${x.use_id ?? ""})${data.canSeeCost && x.cost !== undefined ? ` · ทุน ${fmt(x.cost)} บาท` : ""}`;
              },
            );
            if (ok) {
              setRows([newRow("menu"), newRow("item")]);
              setNote("");
            }
          }}
          className="mt-3 min-h-[44px] rounded-lg bg-brand px-4 py-2 text-sm text-on-brand disabled:opacity-50 sm:min-h-0"
        >
          {pending > 0 ? `ตัดสต็อก ${pending} รายการ` : "ตัดสต็อก"}
        </button>
      </Card>

      <Card title="รายการล่าสุด">
        {recent.length === 0 && <Empty>— ยังไม่มีรายการ —</Empty>}
        {recent.map((u) => (
          <UseRow key={u.useId} use={u} catName={catName.get(u.categoryId) ?? u.categoryId} data={data} boot={boot} busy={busy} now={now} onDelete={() => onDelete(u)} />
        ))}
      </Card>
    </>
  );
}

/** 1 รายการ (ไม่ใช่รอบทดลอง) — ใช้ทั้งรายการล่าสุดและหน้าสรุป */
function UseRow({
  use, catName, recipeName, data, boot, busy, now, onDelete,
}: {
  use: LabUse;
  catName: string;
  recipeName?: string | null;
  data: LabData;
  boot: BarBoot;
  busy: boolean;
  now: number;
  onDelete: () => void;
}) {
  const block = deleteBlock(use, data.me, now, boot.canConfig);
  const what = use.roundNo
    ? `${recipeName ?? "สูตรที่ถูกลบ"} รอบ ${use.roundNo} (${use.glasses} แก้ว)`
    : use.lines.map((l) => `${l.label} ${l.qty}${l.kind === "วัตถุดิบ" ? (l.unit ? ` ${l.unit}` : "") : " แก้ว"}`).join(" · ");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft py-2 text-sm last:border-0">
      <span className="text-xs text-faint">{use.businessDate}</span>
      <Badge tone="neutral">{catName}</Badge>
      {use.eventName && <span className="text-xs text-muted">{use.eventName}</span>}
      <span className="min-w-40 flex-1 text-ink">{what}</span>
      {data.canSeeCost && <span className="tnum text-ink">{fmt(use.costTotal)}</span>}
      {block === null ? (
        <button type="button" disabled={busy} onClick={onDelete} className="text-xs text-crit underline disabled:opacity-50">
          ลบ
        </button>
      ) : (
        <span className="text-xs text-faint" title={block}>
          ลบไม่ได้
        </span>
      )}
      {use.note && <div className="w-full text-xs text-muted">โน้ต: {use.note}</div>}
    </div>
  );
}

// ── ส่วนที่ 3: สรุปต้นทุน (bar.config) ─────────────────────────────────────────

function SummaryView({
  boot, data, busy, onDelete,
}: {
  boot: BarBoot;
  data: LabData;
  busy: boolean;
  onDelete: (u: LabUse) => void;
}) {
  const today = businessDate(new Date(), boot.settings.window);
  const [range, setRange] = useState(() => presetRange("thisMonth", today));
  const preset = matchPreset(range.from, range.to, today);
  const s = labSummary(data.uses, labCategories(data.categories), data.recipes, range.from, range.to);
  const list = data.uses
    .filter((u) => u.businessDate >= range.from && u.businessDate <= range.to)
    .sort((a, b) => (a.usedAt < b.usedAt ? 1 : -1));
  const catName = new Map(labCategories(data.categories).map((c) => [c.categoryId, c.name]));
  const recName = new Map(data.recipes.map((r) => [r.recipeId, r.name]));
  const now = Date.now();

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-1">
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setRange(presetRange(k, today))}
              className={`min-h-[44px] rounded-full border px-3 py-1 text-xs sm:min-h-0 ${
                preset === k ? "border-brand-line bg-brand-soft text-brand" : "border-line bg-card text-muted hover:bg-raised"
              }`}
            >
              {RANGE_LABEL[k]}
            </button>
          ))}
          <input
            type="date"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
            className="rounded-lg border border-line bg-input px-2 py-1 text-sm text-ink"
            aria-label="ตั้งแต่"
          />
          <span className="text-muted">–</span>
          <input
            type="date"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
            className="rounded-lg border border-line bg-input px-2 py-1 text-sm text-ink"
            aria-label="ถึง"
          />
        </div>
        <p className="mt-3 text-lg text-ink">
          ทุนที่ใช้ไป <b>{fmt(s.total)}</b> บาท <span className="text-sm text-muted">({s.count} รายการ)</span>
        </p>
        <p className="text-xs text-faint">ไม่ได้หักจากกำไรขั้นต้นในแดชบอร์ด · ไม่ได้ลงบัญชี</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <SumTable title="ตามหมวด" rows={s.byCategory.map((x) => ({ key: x.id, name: x.name, cost: x.cost, count: `${x.count} รายการ` }))} />
        <SumTable title="ตามสูตรที่ลอง" rows={s.byRecipe.map((x) => ({ key: x.id, name: x.name, cost: x.cost, count: `${x.count} รอบ` }))} />
        <SumTable title="ตามชื่องาน" rows={s.byEvent.map((x) => ({ key: x.name, name: x.name, cost: x.cost, count: `${x.count} รายการ` }))} />
      </div>

      <Card title="ทุกรายการในช่วงนี้">
        {list.length === 0 && <Empty>— ไม่มีรายการในช่วงนี้ —</Empty>}
        {list.map((u) => (
          <UseRow
            key={u.useId}
            use={u}
            catName={catName.get(u.categoryId) ?? u.categoryId}
            recipeName={u.recipeId ? (recName.get(u.recipeId) ?? null) : null}
            data={data}
            boot={boot}
            busy={busy}
            now={now}
            onDelete={() => onDelete(u)}
          />
        ))}
      </Card>
    </>
  );
}

function SumTable({ title, rows }: { title: string; rows: { key: string; name: string; cost: number; count: string }[] }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <Empty>—</Empty>
      ) : (
        <table className="tbl">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  {r.name}
                  <div className="text-xs text-faint">{r.count}</div>
                </td>
                <td className="num">{fmt(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── การ์ด "หมวดการใช้" ในแท็บตั้งค่าบาร์ (bar.config) ──────────────────────────

/**
 * แก้ชื่อ · จัดลำดับ ▲▼ · ลบหมวด — บันทึกทีเดียว (แพตเทิร์น D109)
 * 🚨 หมวด ทดลองสูตร เป็นของระบบ ลบไม่ได้ · หมวดที่มีรายการแล้วลบไม่ได้ (บอกจำนวน · ปุ่มเทาดีกว่าซ่อน D86)
 * ★ เพิ่มหมวดทำได้จากหน้าห้องทดลองเลย (กลางกองถ่าย) — การ์ดนี้ไว้จัดระเบียบทีหลัง
 */
export function LabCategoriesCard({ boot }: { boot: BarBoot }) {
  const lab = useRead(loadLab, [boot.entityId], { skip: !boot.entityId });
  const { setMsg } = useSaver();
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<LabCategory[] | null>(null);
  if (!lab.data) return null;
  const saved = labCategories(lab.data.categories);
  const cur = rows ?? saved;
  const used = (id: string) => lab.data!.uses.filter((u) => u.categoryId === id).length;
  const dirty = JSON.stringify(cur.map((c) => [c.categoryId, c.name])) !== JSON.stringify(saved.map((c) => [c.categoryId, c.name]));
  const blank = cur.some((c) => !c.name.trim());
  const set = (i: number, name: string) => setRows(cur.map((c, j) => (j === i ? { ...c, name } : c)));
  const ARROW = "grid h-8 w-8 place-items-center rounded text-muted hover:bg-raised hover:text-ink disabled:opacity-30";

  return (
    <Card title="หมวดการใช้ (ห้องทดลอง)">
      <p className="mb-2 text-xs text-muted">
        ใช้แยกทุนในหน้า <b>สรุปต้นทุน</b> · เพิ่มหมวดได้จากแท็บห้องทดลองเลย · การ์ดนี้ไว้เปลี่ยนชื่อ/จัดลำดับ/ลบ
      </p>
      {cur.map((c, i) => {
        const n = used(c.categoryId);
        return (
          <div key={c.categoryId} className="flex flex-wrap items-center gap-2 py-0.5 text-sm">
            <button type="button" aria-label="เลื่อนขึ้น" disabled={busy || i === 0} onClick={() => setRows(moveAt(cur, i, -1))} className={ARROW}>
              ▲
            </button>
            <button type="button" aria-label="เลื่อนลง" disabled={busy || i === cur.length - 1} onClick={() => setRows(moveAt(cur, i, 1))} className={ARROW}>
              ▼
            </button>
            <div className="w-48">
              <TextInput value={c.name} onChange={(e) => set(i, e.target.value)} aria-label={`ชื่อหมวด ${i + 1}`} />
            </div>
            <span className="text-xs text-muted">{n} รายการ</span>
            {c.isSystem ? (
              <span className="text-xs text-faint">หมวดของระบบ (รอบทดลองลงหมวดนี้) — เปลี่ยนชื่อได้ ลบไม่ได้</span>
            ) : n > 0 ? (
              <span className="text-xs text-faint">ลบไม่ได้ — มีรายการอยู่</span>
            ) : (
              <button type="button" disabled={busy} onClick={() => setRows(cur.filter((_, j) => j !== i))} className="text-xs text-crit underline">
                ลบ
              </button>
            )}
          </div>
        );
      })}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || !dirty || blank || !boot.canConfig}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const r = await labSaveCategoriesAction(cur.map((c) => ({ categoryId: c.categoryId, name: c.name })));
              if (!r.ok) return setMsg({ ok: false, text: r.error ?? "บันทึกไม่สำเร็จ" });
              setRows(null);
              lab.reload();
              setMsg({ ok: true, text: "บันทึกหมวดแล้ว" });
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm text-on-brand disabled:opacity-50"
        >
          บันทึก
        </button>
        {dirty && (
          <>
            <button type="button" onClick={() => setRows(null)} className="text-xs text-muted underline">
              เลิกแก้
            </button>
            <span className="text-xs text-warn">{blank ? "ชื่อหมวดว่างไม่ได้" : "ยังไม่ได้บันทึก"}</span>
          </>
        )}
      </div>
    </Card>
  );
}
