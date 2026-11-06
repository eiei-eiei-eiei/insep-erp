/**
 * D162 — การ์ดออก 50ทวิ (แท็บเอกสารสรรพากร) · อ่านซอร์สมาตรวจ
 *
 * บั๊กทั้ง 3 ตัวนี้ build/lint/test เดิมผ่านหมด เพราะโค้ดถูกต้องทุกบรรทัด แค่ทำไม่ครบ:
 *  1. ปุ่ม "ออก + พิมพ์" พื้นเขียวอ่อน (`bg-ok-bg` = พื้นป้ายข้อความ) + ตัวหนังสือขาว ⇒ ดูเหมือนปุ่มถูกปิด
 *  2. ปุ่ม "ซ่อน" เรียกฟังก์ชันที่สั่งเปิดอย่างเดียว ⇒ กดแล้วไม่มีอะไรเกิดขึ้น
 *  3. สร้าง PDF ล้ม (เช่น ไม่มีไฟล์ฟอร์มใน Storage) ⇒ error ถูกทิ้งเงียบ แท็บเปล่าค้าง
 *     และรายการไม่โหลดใหม่ ทั้งที่ใบถูกบันทึกไปแล้ว
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("app/(app)/accounting/_components/TaxDocsTab.tsx", "utf8");
const start = src.indexOf("function IssueRow(");
const end = src.indexOf("function EditRow(");
const row = src.slice(start, end);
// ตรวจโค้ดจริง ไม่ใช่คำในคอมเมนต์ (D92/D95)
const code = row.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("D162 — การ์ดออก 50ทวิ", () => {
  it("หา IssueRow เจอ", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
  });

  it("ปุ่มออกไม่ใช้พื้นป้ายข้อความเป็นสีปุ่ม", () => {
    expect(code).not.toMatch(/bg-ok-bg/);
    expect(code).toMatch(/ออก \+ พิมพ์/);
  });

  it("ปุ่ม ซ่อน ปิดฟอร์มได้จริง", () => {
    expect(code).toMatch(/if \(open\) \{ setOpen\(false\)/);
    expect(code).not.toMatch(/onClick=\{openForm\}/);
  });

  it("โหลดรายการใหม่ก่อนสร้าง PDF และดัก error การสร้าง PDF", () => {
    const iIssued = code.indexOf("onIssued();");
    const iBuild = code.indexOf("await onBuild(");
    expect(iIssued).toBeGreaterThan(0);
    expect(iBuild).toBeGreaterThan(iIssued);
    expect(code).toMatch(/catch \(e\)[\s\S]*w\?\.close\(\)[\s\S]*warn: true/);
  });

  it("บันทึกไม่ผ่าน = ปิดแท็บเปล่า", () => {
    expect(code).toMatch(/if \(!r\.ok\) w\?\.close\(\)/);
  });
});
