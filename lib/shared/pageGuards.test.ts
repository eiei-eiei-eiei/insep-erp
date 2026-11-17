import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { leaveGuard, pageTitle, unsavedDetail, type LeaveClick } from "./pageGuards";

/** D173 เฟส 5 — ชื่อแท็บเบราว์เซอร์ · เตือนยังไม่บันทึก · ล้อเมาส์ช่องตัวเลข · หัวตารางติดบน */

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("pageTitle", () => {
  it("แท็บขึ้นก่อน โมดูลตาม แล้วชื่อแอป", () => {
    expect(pageTitle(["ค้นบิล", "บัญชี"])).toBe("ค้นบิล · บัญชี · PROOF");
  });
  it("ตัด ＋ นำหน้าชื่อแท็บ · ข้ามค่าว่าง · ไม่ซ้ำ", () => {
    expect(pageTitle(["＋ สร้างใบเสนอราคา", "ขาย"])).toBe("สร้างใบเสนอราคา · ขาย · PROOF");
    expect(pageTitle([null, "", "ตั้งค่า"])).toBe("ตั้งค่า · PROOF");
    expect(pageTitle(["ตั้งค่า", "ตั้งค่า"])).toBe("ตั้งค่า · PROOF");
    expect(pageTitle([])).toBe("PROOF");
  });
});

describe("leaveGuard — กดลิงก์ตอนยังไม่บันทึก", () => {
  const base: LeaveClick = { href: "/sales?tab=orders", origin: "http://x", pathname: "/accounting" };
  it("ไปหน้าอื่นในแอป → ถาม และคืนปลายทางครบ query", () => {
    expect(leaveGuard(base, true)).toBe("/sales?tab=orders");
    expect(leaveGuard({ ...base, href: "http://x/settings/users" }, true)).toBe("/settings/users");
  });
  it("ไม่มีอะไรค้าง → ไม่ถาม", () => {
    expect(leaveGuard(base, false)).toBeNull();
  });
  it("🚨 pathname เดิม (สลับ ?tab= / ?sec= / #) → ไม่ถาม — แท็บ mount ค้าง ของไม่หาย", () => {
    expect(leaveGuard({ ...base, href: "/accounting?tab=bills" }, true)).toBeNull();
    expect(leaveGuard({ ...base, href: "?tab=bills" }, true)).toBeNull();
    expect(leaveGuard({ ...base, href: "#top" }, true)).toBeNull();
  });
  it("เปิดแท็บใหม่ / ดาวน์โหลด / ออกนอกเว็บ → ไม่ถามที่นี่", () => {
    expect(leaveGuard({ ...base, modified: true }, true)).toBeNull();
    expect(leaveGuard({ ...base, target: "_blank" }, true)).toBeNull();
    expect(leaveGuard({ ...base, download: true }, true)).toBeNull();
    expect(leaveGuard({ ...base, href: "https://example.com/a" }, true)).toBeNull();
    expect(leaveGuard({ ...base, href: null }, true)).toBeNull();
  });
});

describe("unsavedDetail", () => {
  it("บอกชื่อของที่ค้าง ซ้ำนับครั้งเดียว", () => {
    expect(unsavedDetail(["บิลที่กำลังกรอก", "บิลที่กำลังกรอก", "ตะกร้า"])).toContain("บิลที่กำลังกรอก · ตะกร้า");
    expect(unsavedDetail([])).toContain("จะหาย");
  });
});

describe("ของกลางถูกต่อจริง", () => {
  it("PageGuards mount ใน layout ของแอป", () => {
    expect(read("app/(app)/layout.tsx")).toContain("<PageGuards />");
  });
  it("useTabUrl ตั้งชื่อแท็บเบราว์เซอร์จากแท็บ + โมดูล", () => {
    const src = read("app/(app)/_components/useTabUrl.ts");
    expect(src).toContain("usePageTitle(");
  });
  it("🚨 dirty ไม่ถูกตั้ง true ค้าง — useUnsaved ต้องรับนิพจน์ ไม่ใช่ค่าคงที่", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".tsx") && /useUnsaved\(\s*true\s*,/.test(fs.readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    walk(path.join(process.cwd(), "app"));
    expect(hits).toEqual([]);
  });
  it("กันล้อเมาส์: ปล่อยโฟกัสช่อง type=number (ไม่ preventDefault — หน้าต้องเลื่อนได้)", () => {
    const src = read("lib/shared/pageGuardHost.tsx");
    const wheel = src.slice(src.indexOf("const onWheel"), src.indexOf("return <>{confirmNode}"));
    expect(wheel).toContain('el.type === "number"');
    expect(wheel).toContain("el.blur()");
    expect(wheel).not.toContain("preventDefault");
  });
  it("หัวตารางติดบน: เฉพาะจอกว้าง (จอมือถือไม่ซ้อนพื้นที่เลื่อน) และมีพื้นทึบ", () => {
    const css = read("app/globals.css");
    const i = css.indexOf("/* หัวตารางติดบน");
    expect(i).toBeGreaterThan(-1);
    const block = css.slice(i, i + 900);
    expect(block).toContain("min-width: 768px");
    expect(block).toContain("position: sticky");
    expect(block).toMatch(/background:\s*var\(--color-/);
  });
});
