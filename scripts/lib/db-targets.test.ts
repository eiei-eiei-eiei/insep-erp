/**
 * เทสตัวช่วยของ db-push-all
 *
 * เทสที่สำคัญที่สุดคือกลุ่ม "ref ข้ามก้อน" — จุดที่พังแล้วเสียหายที่สุดของงาน fleet
 * คือ migration ของลูกค้าไปลงใน DB ธุรกิจตัวเอง
 */
import { describe, expect, it } from "vitest";
import {
  checkTarget,
  maskDbUrl,
  parseTargets,
  refFromDbUrl,
  refFromSupabaseUrl,
} from "./db-targets";

const REF_OWNER = "vmhiwlxdyhatucioalzp";
const REF_CUST = "tnuxrufpzeyuvwdmkojv";

const pooler = (ref: string, pwd = "s3cret") =>
  `postgresql://postgres.${ref}:${pwd}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
const direct = (ref: string, pwd = "s3cret") =>
  `postgresql://postgres:${pwd}@db.${ref}.supabase.co:5432/postgres`;

describe("refFromSupabaseUrl", () => {
  it("แกะ ref จาก URL ของ API ได้", () => {
    expect(refFromSupabaseUrl(`https://${REF_CUST}.supabase.co`)).toBe(REF_CUST);
  });

  it("ทนช่องว่างหัวท้าย (ค่าที่อ่านมาจากไฟล์ env)", () => {
    expect(refFromSupabaseUrl(`  https://${REF_OWNER}.supabase.co  `)).toBe(REF_OWNER);
  });

  it("คืน null เมื่อไม่ใช่ URL ของ Supabase", () => {
    expect(refFromSupabaseUrl("https://example.com")).toBeNull();
    expect(refFromSupabaseUrl("")).toBeNull();
  });
});

describe("refFromDbUrl", () => {
  it("แกะได้ทั้งแบบ pooler และ direct", () => {
    expect(refFromDbUrl(pooler(REF_CUST))).toBe(REF_CUST);
    expect(refFromDbUrl(direct(REF_CUST))).toBe(REF_CUST);
  });

  it("รหัสผ่านมีอักขระพิเศษก็ยังแกะถูก (เหตุผลที่ไม่ใช้ new URL)", () => {
    expect(refFromDbUrl(pooler(REF_OWNER, "p%40ss:w%2Frd!#"))).toBe(REF_OWNER);
    expect(refFromDbUrl(direct(REF_OWNER, "p%40ss:w%2Frd!#"))).toBe(REF_OWNER);
  });

  it("คืน null เมื่อ connection string ไม่ใช่ของ Supabase", () => {
    expect(refFromDbUrl("postgresql://postgres:x@localhost:5432/postgres")).toBeNull();
    expect(refFromDbUrl("")).toBeNull();
  });
});

describe("checkTarget", () => {
  const ok = { name: "ลูกค้า", env: ".env.customer", dbUrl: pooler(REF_CUST) };
  const envUrl = (ref: string) => `https://${ref}.supabase.co`;

  it("ผ่านเมื่อ ref จาก env กับจาก dbUrl ตรงกัน", () => {
    expect(checkTarget(ok, envUrl(REF_CUST))).toEqual([]);
  });

  it("🚨 จับได้เมื่อ env กับ dbUrl ชี้คนละ project", () => {
    const problems = checkTarget(ok, envUrl(REF_OWNER));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("ref ไม่ตรงกัน");
    expect(problems[0]).toContain(REF_OWNER);
    expect(problems[0]).toContain(REF_CUST);
  });

  it("จับได้เมื่อยังไม่ได้แทนรหัสผ่านตัวอย่าง", () => {
    const t = { ...ok, dbUrl: pooler(REF_CUST, "[YOUR-PASSWORD]") };
    expect(checkTarget(t, envUrl(REF_CUST)).join(" ")).toContain("ยังเป็นตัวอย่าง");
  });

  it("จับได้เมื่ออ่าน ref จากไฟล์ env ไม่ได้ (ไฟล์หาย/ไม่มีตัวแปร)", () => {
    expect(checkTarget(ok, null).join(" ")).toContain(".env.customer");
  });

  it("จับได้เมื่อ dbUrl ไม่ใช่ postgres", () => {
    const t = { ...ok, dbUrl: "https://tnuxrufpzeyuvwdmkojv.supabase.co" };
    expect(checkTarget(t, envUrl(REF_CUST)).join(" ")).toContain("postgresql://");
  });

  it("ฟ้องช่องที่ขาดก่อน ไม่ไปตรวจอย่างอื่นต่อ", () => {
    expect(checkTarget({ name: "x" }, null)).toEqual(["ไม่มีช่อง env", "ไม่มีช่อง dbUrl"]);
  });
});

describe("parseTargets", () => {
  it("รับ array ปกติ", () => {
    expect(parseTargets([{ name: "a", env: "b", dbUrl: "c" }])).toHaveLength(1);
  });

  it("ฟ้องเมื่อไม่ใช่ array / ว่างเปล่า", () => {
    expect(() => parseTargets({})).toThrow(/array/);
    expect(() => parseTargets([])).toThrow(/ว่างเปล่า/);
  });
});

describe("maskDbUrl", () => {
  it("ซ่อนรหัสผ่านแต่คง ref ให้เห็น", () => {
    const masked = maskDbUrl(pooler(REF_CUST, "SuperSecret123"));
    expect(masked).not.toContain("SuperSecret123");
    expect(masked).toContain(REF_CUST);
  });
});
