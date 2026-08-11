import { describe, it, expect } from "vitest";
import { validatePassword, generateInitialPassword, PASSWORD_MIN } from "./password";

describe("validatePassword", () => {
  it("รหัสปกติผ่าน", () => {
    expect(validatePassword("suraKlan2569")).toBeNull();
    expect(validatePassword("โรงกลั่นของฉัน")).toBeNull(); // ภาษาไทยใช้ได้
  });

  it("สั้นเกินไม่ผ่าน", () => {
    expect(validatePassword("abc123")).toContain(String(PASSWORD_MIN));
    expect(validatePassword("")).not.toBeNull();
  });

  it("รหัสยอดฮิตไม่ผ่าน (ไม่สนตัวพิมพ์)", () => {
    for (const p of ["password", "PASSWORD", "12345678", "changeme", "admin123"]) {
      expect(validatePassword(p), `${p} ควรถูกปฏิเสธ`).not.toBeNull();
    }
  });

  it("ตัวเดิมซ้ำทั้งหมด / ตัวเลขล้วน ไม่ผ่าน", () => {
    expect(validatePassword("aaaaaaaa")).not.toBeNull();
    expect(validatePassword("29385017")).not.toBeNull();
  });

  it("มีช่องว่างหัวท้ายไม่ผ่าน (พิมพ์ผิดแล้วหาสาเหตุยาก)", () => {
    expect(validatePassword(" suraKlan2569")).not.toBeNull();
    expect(validatePassword("suraKlan2569 ")).not.toBeNull();
    expect(validatePassword("sura Klan 2569")).toBeNull(); // ช่องว่างกลางได้
  });

  it("มีชื่อผู้ใช้อยู่ในรหัสไม่ผ่าน", () => {
    expect(validatePassword("rongkor12345", "rongkor")).not.toBeNull();
    expect(validatePassword("RongKor12345", "rongkor")).not.toBeNull();
    expect(validatePassword("suraKlan2569", "rongkor")).toBeNull();
  });

  it("ชื่อผู้ใช้สั้นมาก (< 3) ไม่เอามาตัดสิน กันปฏิเสธมั่ว", () => {
    expect(validatePassword("abXYZ123", "ab")).toBeNull();
  });
});

describe("generateInitialPassword", () => {
  it("ผ่านเกณฑ์ของตัวเองเสมอ", () => {
    for (let i = 0; i < 50; i++) {
      const pw = generateInitialPassword();
      expect(validatePassword(pw), `รหัสที่สุ่มได้ตกเกณฑ์: ${pw}`).toBeNull();
    }
  });

  it("★ ไม่ซ้ำกันเลย — รหัสตั้งต้นซ้ำข้ามลูกค้า = ทุกเจ้าเข้าระบบกันเองได้", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateInitialPassword()));
    expect(seen.size).toBe(200);
  });

  it("ไม่มีอักขระที่อ่านสับสน (ต้องบอกทางโทรศัพท์/LINE ได้)", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateInitialPassword()).not.toMatch(/[0O1lI]/);
    }
  });
});
