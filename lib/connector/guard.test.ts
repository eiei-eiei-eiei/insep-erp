import { describe, it, expect } from "vitest";
import {
  connectorEnabled, isConnectorPath, bearerToken, resourceMetadata, wwwAuthenticate, safeNext, tenantDisplayName,
  MCP_PATH, RESOURCE_META_PATH,
} from "./guard";

describe("C2 — ประตู Claude connector (D141)", () => {
  it("env ต้องเป็น '1' เป๊ะ — ค่าอื่นปิดหมด", () => {
    expect(connectorEnabled("1")).toBe(true);
    expect(connectorEnabled(" 1 ")).toBe(true);
    for (const v of [undefined, null, "", "0", "true", "yes", "11"]) expect(connectorEnabled(v), String(v)).toBe(false);
  });

  it("path ที่นับเป็น connector", () => {
    expect(isConnectorPath("/api/mcp")).toBe(true);
    expect(isConnectorPath(RESOURCE_META_PATH)).toBe(true);
    expect(isConnectorPath("/api/mcpx")).toBe(false);
    expect(isConnectorPath("/api/cron/tax-reminder")).toBe(false);
  });

  it("bearer token จาก header เท่านั้น", () => {
    expect(bearerToken("Bearer abc.def")).toBe("abc.def");
    expect(bearerToken("bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer ")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it("metadata: resource = URL ที่กรอกใน Claude · authorization server = Supabase ของก้อนนี้", () => {
    const m = resourceMetadata("https://erp.example.com/", "https://abc.supabase.co/");
    expect(m.resource).toBe("https://erp.example.com" + MCP_PATH);
    expect(m.authorization_servers).toEqual(["https://abc.supabase.co/auth/v1"]);
  });

  it("WWW-Authenticate ชี้ไปที่ metadata", () => {
    expect(wwwAuthenticate("https://erp.example.com")).toBe(`Bearer resource_metadata="https://erp.example.com${RESOURCE_META_PATH}"`);
    expect(wwwAuthenticate("https://erp.example.com", "invalid_token")).toMatch(/^Bearer error="invalid_token", resource_metadata=/);
  });

  it("ชื่อลูกค้าในแชท = ชื่อแบรนด์ · ไม่ได้ตั้ง = ชื่อลูกค้า (ไม่ใช่ชื่อสินค้า)", () => {
    expect(tenantDisplayName("นงจด", "กิจการเริ่มต้น")).toBe("นงจด");
    expect(tenantDisplayName("  ", "กิจการเริ่มต้น")).toBe("กิจการเริ่มต้น");
    expect(tenantDisplayName(undefined, "กิจการเริ่มต้น")).toBe("กิจการเริ่มต้น");
  });

  it("🚨 safeNext: กลับได้เฉพาะหน้าอนุญาต — กัน open redirect", () => {
    expect(safeNext("/oauth/consent?authorization_id=x")).toBe("/oauth/consent?authorization_id=x");
    expect(safeNext("/oauth/consent")).toBe("/oauth/consent");
    for (const bad of ["/", "/accounting", "//evil.com", "https://evil.com/oauth/consent", "/oauth/consentx", "/oauth/consent?\r\nx", null, ""]) {
      expect(safeNext(bad), String(bad)).toBeNull();
    }
  });
});
