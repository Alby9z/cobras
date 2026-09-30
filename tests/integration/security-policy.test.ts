import { describe, expect, it, afterEach } from "vitest";
import { staffMustEnable2fa } from "@/server/session";

describe("double authentification du personnel", () => {
  const saved = { APP_ENV: process.env.APP_ENV, STAFF_REQUIRE_2FA: process.env.STAFF_REQUIRE_2FA };
  afterEach(() => Object.assign(process.env, saved));

  it("est exigée par défaut hors développement pour le personnel sans 2FA", () => {
    process.env.APP_ENV = "production"; delete process.env.STAFF_REQUIRE_2FA;
    expect(staffMustEnable2fa({ role: "ADMIN", twoFactorEnabled: false })).toBe(true);
    expect(staffMustEnable2fa({ role: "WAREHOUSE_OPERATOR", twoFactorEnabled: null })).toBe(true);
    expect(staffMustEnable2fa({ role: "ADMIN", twoFactorEnabled: true })).toBe(false);
    expect(staffMustEnable2fa({ role: "CUSTOMER", twoFactorEnabled: false })).toBe(false);
  });
  it("peut être désactivée explicitement (environnement de test)", () => {
    process.env.APP_ENV = "production"; process.env.STAFF_REQUIRE_2FA = "false";
    expect(staffMustEnable2fa({ role: "ADMIN", twoFactorEnabled: false })).toBe(false);
  });
  it("n'est pas exigée en développement sauf demande", () => {
    process.env.APP_ENV = "development"; delete process.env.STAFF_REQUIRE_2FA;
    expect(staffMustEnable2fa({ role: "ADMIN", twoFactorEnabled: false })).toBe(false);
    process.env.STAFF_REQUIRE_2FA = "true";
    expect(staffMustEnable2fa({ role: "ADMIN", twoFactorEnabled: false })).toBe(true);
  });
});
