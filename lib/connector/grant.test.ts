import { describe, it, expect } from "vitest";
import { grantBlock, grantWarn } from "./grant";
import { ROLES, can } from "../shared/roles";

describe("C3 — ให้สิทธิ์ Claude connector (D141)", () => {
  it("ทุกบทบาท: ให้ได้ ⇔ มี acct.write (ตรงกับด่านของ endpoint)", () => {
    for (const r of ROLES) {
      expect(grantBlock({ role: r }, true) === null, r).toBe(can(r, "acct.write"));
    }
  });

  it("บล็อกพร้อมบอกเหตุผลเป็นชื่อไทย", () => {
    expect(grantBlock({ role: "viewer" }, true)).toMatch(/บันทึกบิลบัญชีไม่ได้/);
    expect(grantBlock({ role: "accounting" }, false)).toMatch(/ถูกระงับ/);
    expect(grantBlock({ role: "อะไรก็ไม่รู้" }, true)).not.toBeNull(); // toRole → viewer (fail-closed)
  });

  it("เตือน (ไม่บล็อก): เจ้าของ · รหัสชั่วคราว", () => {
    expect(grantWarn({ role: "main" })).toMatch(/พนักงานบัญชี/);
    expect(grantWarn({ role: "accounting", must_change_password: true })).toMatch(/รหัสชั่วคราว/);
    expect(grantWarn({ role: "accounting" })).toBeNull();
  });
});
