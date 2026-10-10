"use client";

/**
 * docViewer — แถบปุ่มในหน้าต่างเอกสารขาย: พิมพ์ · คัดลอกเป็นภาพ · แชร์ (D105)
 *
 * เดิมหน้าต่างเอกสารเปิดหน้าพิมพ์ให้ทันที — ตอนนี้แสดงเอกสารพร้อมแถบปุ่มให้เลือกเอง
 * (คนที่จะส่ง LINE อย่างเดียวไม่ต้องกดปิดหน้าพิมพ์ทุกครั้ง)
 *
 * 🚨 ภาพถ่ายจาก DOM ชุดเดียวกับที่พิมพ์ (`.a4-container` ที่ print.ts เขียน) — ห้ามมีเอกสารเวอร์ชันภาพแยก
 * 🚨 แถบปุ่มทุกชิ้นมีคลาส `no-print` — ห้ามติดไปบนกระดาษ
 *
 * 🪤 โค้ดนี้รันอยู่ใน "หน้าต่างแอป" แต่จับ DOM ของ "หน้าต่างเอกสาร" (popup) — ทุก API ที่ผูกกับ
 *    การกดปุ่ม/โฟกัส (clipboard · share · File · URL) ต้องเรียกผ่าน `w` ของหน้าต่างเอกสาร
 *    ใช้ของหน้าต่างแอป = "Document is not focused" / ไม่นับว่าผู้ใช้กดเอง
 * 🪤 แชร์ต้องกดแล้วเรียก share ทันที (มือถือหมดสิทธิ์ถ้ารอนาน) → แปลงภาพเตรียมไว้ตั้งแต่เปิดหน้าต่าง
 *    ไม่ใช่แปลงตอนกด
 * 🪤 เมนูแชร์ของมือถือเอารูปออกทีหลังไม่ได้ → เลือกรูปด้วยช่องติ๊กในหน้านี้ก่อนกดแชร์
 */
import {
  docImageFileName,
  docPageLabel,
  shareAllLabel,
  shareDisabledReason,
  IMAGE_FAILED_TEXT,
  type ImageState,
  type ShareSupport,
} from "@/lib/sales/docImage";

/** CSS ของหน้าต่างเอกสาร (จอเท่านั้น) — กระดาษพิมพ์ยังเป็น A4_HEAD เดิมทุกอย่าง */
export const VIEWER_HEAD = `<meta name="viewport" content="width=860">
<style>
@media screen {
  body { background: #e2e8f0 !important; padding: 0 0 32px; }
  /* สัดส่วน A4 เท่ากระดาษ (210×297mm · ขอบ 10mm เท่า @page) → ภาพที่คัดลอกเป็นหน้า A4 ไม่ใช่สั้นเท่าเนื้อหา
     เนื้อหาเกินหน้าเดียวนิดเดียว = ย่อแบบเดียวกับตอนพิมพ์ (print.ts applyPrintScale) · เกินมาก = ภาพยาวลงตามเนื้อหา */
  .dv-sheet { width: 210mm; min-height: 297mm; box-sizing: border-box; padding: 10mm; margin: 0 auto; background: #fff; box-shadow: 0 1px 4px rgba(15,23,42,.25); }
  .dv-sheet .a4-container { max-width: none; margin-top: 0 !important; }
}
@media print {
  .no-print { display: none !important; }
  .dv-sheet { width: auto; padding: 0; margin: 0; box-shadow: none; }
}
.dv-bar { position: sticky; top: 0; z-index: 10; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 16px; background: #0f172a; color: #f8fafc; font: 15px 'Kanit', sans-serif; }
.dv-page { width: 210mm; margin: 20px auto 6px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font: 14px 'Kanit', sans-serif; color: #0f172a; }
.dv-page label { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; cursor: pointer; font-weight: 500; }
.dv-page input { width: 20px; height: 20px; }
.dv-btn { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid #94a3b8; background: #fff; color: #0f172a; cursor: pointer; }
.dv-btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.dv-bar .dv-btn { border-color: #475569; }
.dv-btn:disabled { opacity: .45; cursor: not-allowed; }
.dv-status { flex-basis: 100%; font-size: 14px; min-height: 1.2em; }
.dv-status.ok { color: #86efac; } .dv-status.warn { color: #fde047; } .dv-status.err { color: #fca5a5; }
.dv-hint { font-size: 13px; color: #cbd5e1; }
</style>`;

type Page = {
  sheet: HTMLElement;
  label: string;
  fileName: string;
  check: HTMLInputElement;
  blob: Promise<Blob>;
  resolve: (b: Blob) => void;
  reject: (e: unknown) => void;
};

// popup ใช้ global ของตัวเอง (ClipboardItem/File/URL) — ประกาศแบบหลวม เพราะ lib.dom ไม่รู้จักหน้าต่างอื่น
type PopupWin = Window & {
  ClipboardItem?: typeof ClipboardItem;
  File: typeof File;
  URL: typeof URL;
};

function el<K extends keyof HTMLElementTagNameMap>(d: Document, tag: K, attrs: Record<string, string> = {}, text = "") {
  const e = d.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
}

function detectShare(w: PopupWin): ShareSupport {
  const nav = w.navigator;
  if (typeof nav.share !== "function") return "no-api";
  try {
    const probe = new w.File([new Uint8Array([0])], "x.png", { type: "image/png" });
    if (typeof nav.canShare === "function" && !nav.canShare({ files: [probe] })) return "no-files";
  } catch {
    return "no-files";
  }
  return "ok";
}

/** Safari วาดภาพจาก foreignObject ครั้งแรกมักขาดฟอนต์/รูป — ต้องวาดทิ้งหนึ่งรอบก่อน */
function isSafari(w: Window): boolean {
  const ua = w.navigator.userAgent;
  return /safari/i.test(ua) && !/chrome|chromium|crios|android/i.test(ua);
}

/**
 * ติดตั้งแถบปุ่มลงหน้าต่างเอกสาร — เรียกหลังเขียน HTML + ฟอนต์โหลดเสร็จ
 * `print` = ฟังก์ชันพิมพ์ (คำนวณย่อหน้าให้พอดี A4 ก่อน) ของ print.ts
 */
export function mountDocViewer(win: Window, print: () => void) {
  const w = win as PopupWin;
  const d = w.document;
  const containers = Array.from(d.querySelectorAll<HTMLElement>(".a4-container"));

  // ── แถบบนสุด ────────────────────────────────────────────
  const bar = el(d, "div", { class: "dv-bar no-print" });
  const btnPrint = el(d, "button", { class: "dv-btn primary", type: "button" }, "พิมพ์");
  const btnShare = el(d, "button", { class: "dv-btn", type: "button" });
  const hint = el(d, "span", { class: "dv-hint" }, "คัดลอกเป็นภาพได้ทีละหน้าที่ปุ่มเหนือแต่ละหน้า");
  const status = el(d, "div", { class: "dv-status", role: "status", "aria-live": "polite" });
  bar.append(btnPrint, btnShare, hint, status);
  d.body.insertBefore(bar, d.body.firstChild);

  const say = (text: string, tone: "" | "ok" | "warn" | "err" = "") => {
    status.textContent = text;
    status.className = `dv-status ${tone}`;
  };

  const support = detectShare(w);
  let state: ImageState = "loading";
  const pages: Page[] = [];

  const refresh = () => {
    const selected = pages.filter((p) => p.check.checked).length;
    btnShare.textContent = shareAllLabel(selected, pages.length);
    const why = shareDisabledReason(support, selected, state);
    btnShare.disabled = why !== "";
    btnShare.title = why;
    for (const p of pages) {
      const share = p.sheet.previousElementSibling?.querySelector<HTMLButtonElement>("[data-act=share]");
      const copy = p.sheet.previousElementSibling?.querySelector<HTMLButtonElement>("[data-act=copy]");
      const one = shareDisabledReason(support, 1, state);
      if (share) {
        share.disabled = one !== "";
        share.title = one;
      }
      if (copy) {
        copy.disabled = state === "failed";
        copy.title = state === "failed" ? IMAGE_FAILED_TEXT : "";
      }
    }
  };

  // ── ห่อแต่ละหน้าเป็นแผ่นกระดาษ + แถบของหน้านั้น ───────────
  containers.forEach((c, i) => {
    const sheet = el(d, "div", { class: "dv-sheet" });
    c.parentNode!.insertBefore(sheet, c);
    sheet.appendChild(c);

    const label = docPageLabel(c.dataset.docTitle || "", c.dataset.docCopy || "");
    const head = el(d, "div", { class: "dv-page no-print" });
    const lab = el(d, "label");
    const check = el(d, "input", { type: "checkbox" });
    check.checked = true;
    check.addEventListener("change", refresh);
    lab.append(check, d.createTextNode(`${i + 1}. ${label}`));
    const copy = el(d, "button", { class: "dv-btn", type: "button", "data-act": "copy" }, "คัดลอกเป็นภาพ");
    const share = el(d, "button", { class: "dv-btn", type: "button", "data-act": "share" }, "แชร์หน้านี้");
    head.append(lab, copy, share);
    sheet.parentNode!.insertBefore(head, sheet);

    let resolve!: (b: Blob) => void;
    let reject!: (e: unknown) => void;
    const blob = new Promise<Blob>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    blob.catch(() => {}); // กัน unhandled rejection — ความผิดพลาดแสดงผ่าน state
    const page: Page = { sheet, label, fileName: docImageFileName(label, c.dataset.docNo, i), check, blob, resolve, reject };
    pages.push(page);

    copy.addEventListener("click", () => void copyPage(page));
    share.addEventListener("click", () => void sharePages([page]));
  });

  btnPrint.addEventListener("click", print);
  btnShare.addEventListener("click", () => void sharePages(pages.filter((p) => p.check.checked)));
  refresh();

  // ── คัดลอก ──────────────────────────────────────────────
  async function copyPage(p: Page) {
    const CI = w.ClipboardItem;
    if (CI && w.navigator.clipboard?.write) {
      try {
        // ส่ง Promise เข้า ClipboardItem ตรง ๆ — Safari ยอมเฉพาะแบบนี้ (ต้องอยู่ในจังหวะที่ผู้ใช้กด)
        await w.navigator.clipboard.write([new CI({ "image/png": p.blob })]);
        say(`คัดลอก "${p.label}" แล้ว — ไปกดวาง (Ctrl+V หรือกดค้างแล้วเลือกวาง) ในแชทได้เลย`, "ok");
        return;
      } catch {
        // ตกไปดาวน์โหลดแทน
      }
    }
    try {
      download(await p.blob, p.fileName);
      say(`เบราว์เซอร์นี้คัดลอกภาพไม่ได้ — ดาวน์โหลด "${p.fileName}" ให้แทนแล้ว`, "warn");
    } catch {
      say(IMAGE_FAILED_TEXT, "err");
    }
  }

  function download(b: Blob, name: string) {
    const url = w.URL.createObjectURL(b);
    const a = el(d, "a", { href: url, download: name });
    d.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => w.URL.revokeObjectURL(url), 10_000);
  }

  // ── แชร์ ────────────────────────────────────────────────
  async function sharePages(list: Page[]) {
    if (list.length === 0) return;
    // ภาพเตรียมเสร็จแล้ว (ปุ่มเปิดเมื่อ state=ready) → await ตรงนี้คืนค่าทันที ไม่กินเวลาของจังหวะกด
    const blobs = await Promise.all(list.map((p) => p.blob));
    const files = blobs.map((b, i) => new w.File([b], list[i].fileName, { type: "image/png" }));
    // ส่งเฉพาะไฟล์ — ใส่ title/text คู่กันแล้วบางแอปบน Android ทิ้งรูปไปส่งแต่ข้อความ
    if (typeof w.navigator.canShare === "function" && !w.navigator.canShare({ files })) {
      say("เบราว์เซอร์นี้แชร์ภาพชุดนี้ไม่ได้ — ใช้ปุ่มคัดลอกเป็นภาพทีละหน้าแทน", "warn");
      return;
    }
    try {
      await w.navigator.share({ files });
      say(`ส่งเข้าเมนูแชร์แล้ว ${files.length} รูป`, "ok");
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return; // ผู้ใช้กดยกเลิกเอง
      say("แชร์ไม่สำเร็จ — ลองกดอีกครั้ง หรือใช้ปุ่มคัดลอกเป็นภาพแทน", "warn");
    }
  }

  // ── แปลงภาพเตรียมไว้ (ทีละหน้า) ─────────────────────────
  void (async () => {
    try {
      const { toBlob, getFontEmbedCSS } = await import("html-to-image");
      const fontEmbedCSS = pages.length ? await getFontEmbedCSS(pages[0].sheet) : "";
      const opts = {
        pixelRatio: 2, // ตัวหนังสือคมเมื่อซูมดูในแชท
        backgroundColor: "#ffffff",
        fontEmbedCSS,
        style: { margin: "0", boxShadow: "none" },
      };
      const warm = isSafari(w);
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        say(`กำลังเตรียมภาพ ${i + 1}/${pages.length}…`);
        if (warm) await toBlob(p.sheet, opts);
        const b = await toBlob(p.sheet, opts);
        if (!b) throw new Error("empty image");
        p.resolve(b);
      }
      state = "ready";
      say("");
    } catch {
      state = "failed";
      for (const p of pages) p.reject(new Error("render failed"));
      say(IMAGE_FAILED_TEXT, "err");
    }
    refresh();
  })();
}
