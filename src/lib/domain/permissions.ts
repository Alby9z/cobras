import type { Role } from "@/generated/prisma/enums";

/** Permissions granulaires. Toute vérification se fait côté serveur (requirePermission / assertCan). */
export const PERMISSIONS = [
  "dashboard.view",
  "users.read", "users.write", "users.delete",
  "products.read", "products.write",
  "animals.write", "inventory.write",
  "orders.read", "orders.update", "orders.fulfil", "orders.refund",
  "payments.read", "invoices.read",
  "documents.read_sensitive", "documents.review",
  "compliance.read", "compliance.review", "compliance.override", "compliance.rules.write", "compliance.rules.approve",
  "crm.read", "crm.write",
  "content.write", "seo.write", "marketing.write", "shipping.write",
  "analytics.read", "settings.write", "audit.read", "system.read",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const STAFF_BASE: Permission[] = ["dashboard.view"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  // Séparation des pouvoirs : l'ADMIN ne valide pas les règles de conformité et ne contourne pas les décisions.
  ADMIN: PERMISSIONS.filter((p) => p !== "compliance.override" && p !== "compliance.rules.approve"),
  COMPLIANCE_MANAGER: [...STAFF_BASE, "orders.read", "products.read", "documents.read_sensitive", "documents.review", "compliance.read", "compliance.review", "compliance.override", "compliance.rules.write", "compliance.rules.approve", "audit.read"],
  SALES_MANAGER: [...STAFF_BASE, "orders.read", "products.read", "crm.read", "crm.write", "analytics.read", "marketing.write"],
  SALES_AGENT: [...STAFF_BASE, "orders.read", "products.read", "crm.read", "crm.write"],
  FULFILLMENT_MANAGER: [...STAFF_BASE, "orders.read", "orders.fulfil", "products.read", "animals.write", "inventory.write", "shipping.write", "compliance.read"],
  WAREHOUSE_OPERATOR: [...STAFF_BASE, "orders.read", "orders.fulfil", "products.read", "inventory.write"],
  CONTENT_MANAGER: [...STAFF_BASE, "products.read", "products.write", "content.write", "seo.write"],
  SUPPORT_AGENT: [...STAFF_BASE, "orders.read", "users.read", "crm.read", "crm.write"],
  ACCOUNTANT: [...STAFF_BASE, "orders.read", "payments.read", "invoices.read", "orders.refund", "analytics.read"],
  VIEWER: [...STAFF_BASE, "orders.read", "products.read", "crm.read", "analytics.read"],
  CUSTOMER: [],
};

export function can(role: Role, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm);
}

export const isStaff = (role: Role) => role !== "CUSTOMER";

/** Rôles qu'un acteur peut attribuer (jamais un rôle supérieur ou égal au sien, sauf SUPER_ADMIN). */
export function assignableRoles(actor: Role): Role[] {
  const all = Object.keys(ROLE_PERMISSIONS) as Role[];
  if (actor === "SUPER_ADMIN") return all;
  if (actor === "ADMIN") return all.filter((r) => r !== "SUPER_ADMIN" && r !== "ADMIN");
  return [];
}
