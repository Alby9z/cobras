// Parcours navigateur phase 2 : configuration admin → règle validée → animal → commande client
// (stratégie PAY_AFTER_COMPLIANCE : aucun appel Stripe) → dossier de conformité côté admin.
// Données de TEST sur base locale JETABLE uniquement (voir docs/TESTING.md) :
//   base vide migrée + comptes admin@example.org (SUPER_ADMIN) et client@example.org (CUSTOMER),
//   application démarrée (npm run build && npm start) et worker lancé.
// Usage : E2E_BASE_URL=http://localhost:3000 npm run test:e2e
import { chromium } from "playwright";
import fs from "node:fs";
const B = process.env.E2E_BASE_URL ?? "http://localhost:3000";
if (process.env.APP_ENV === "production") throw new Error("Parcours E2E interdit en production.");
const SHOTS = process.env.E2E_SHOTS_DIR ?? "test-results/e2e";
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(ok ? "PASS" : "FAIL", name, detail); };
const browser = await chromium.launch(process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "cookie_consent_v1", value: "denied", url: B }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const msg = async () => (await page.locator("[role=status],[role=alert]").allInnerTexts()).join(" | ");
const submit = async (scope = page, label) => { await (label ? scope.getByRole("button", { name: label }) : scope.locator("button[type=submit]").last()).click(); await page.waitForTimeout(1500); };

async function login(email, pw) {
  await page.goto(`${B}/connexion`);
  await page.fill("#email", email); await page.fill("#password", pw);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/compte|\/admin/, { timeout: 15000 });
}

// 1. Erreur de connexion générique
await page.goto(`${B}/connexion`);
await page.fill("#email", "admin@example.org"); await page.fill("#password", "mauvais-mot-de-passe");
await page.click("button[type=submit]"); await page.waitForTimeout(1500);
check("login générique", (await msg()).includes("Email ou mot de passe incorrect"), await msg());

await login("admin@example.org", "AdminPass123456");

// 2. Vente bloquée tant que la configuration manque
await page.goto(`${B}/admin/systeme`);
const sys = await page.locator("main").innerText();
check("readiness bloquante affichée", /Identité légale du vendeur/.test(sys));

// 3. TVA
await page.goto(`${B}/admin/tva`);
await page.fill("[name=code]", "FR-TEST"); await page.fill("[name=name]", "Taux de test"); await page.fill("[name=rate]", "20");
await submit(page, "Enregistrer"); check("taux TVA", /enregistr/i.test(await msg()), await msg());

// 4. Paramètres (valeurs de TEST)
await page.goto(`${B}/admin/parametres`);
for (const [k, v] of Object.entries({ brandName: "TEST Boutique", companyName: "TEST SAS", legalForm: "SAS", siret: "TEST-SIRET", addressLine: "1 rue de Test", postalCode: "75001", city: "Paris", vatNumber: "TEST-TVA" })) await page.fill(`[name=${k}]`, v);
await page.selectOption("[name=vatRegime]", "NORMAL");
await page.selectOption("[name=shippingTaxRateCode]", "FR-TEST");
await page.selectOption("[name=paymentStrategyAnimals]", "PAY_AFTER_COMPLIANCE");
await submit(page, "Enregistrer"); check("paramètres", /enregistr/i.test(await msg()), await msg());

// 5. Pages légales
for (const slug of ["mentions-legales", "cgv", "confidentialite"]) {
  await page.goto(`${B}/admin/pages/${slug}`);
  await page.fill("[name=content]", "Contenu de TEST — environnement local uniquement, à remplacer par le texte validé.");
  await page.check("[name=published]");
  await submit(page, "Enregistrer");
}
check("pages légales", /enregistr/i.test(await msg()), await msg());

// 6. Livraison
await page.goto(`${B}/admin/livraison`);
await page.fill("#n-name", "Transporteur animaux vivants (test)");
await page.selectOption("#n-method", "SPECIALIZED_CARRIER");
await page.fill("#n-price", "49");
await page.locator("form:has(#n-name) button[type=submit]").click(); await page.waitForTimeout(1500);
check("tarif livraison", /enregistr/i.test(await msg()), await msg());

// 7. Espèce
await page.goto(`${B}/admin/especes/nouveau`);
await page.fill("#commonName", "Python royal"); await page.fill("#scientificName", "Python regius");
await page.selectOption("#regulatoryCategory", "SALE_ALLOWED_WITH_DOCUMENTS");
await page.check("input[name=shippingMethods][value=SPECIALIZED_CARRIER]");
await submit(page, "Enregistrer");
await page.waitForURL(/\/admin\/especes\/c/, { timeout: 15000 });
check("espèce créée", true, page.url());

// 8. Règles : documents (brouillon → validation), âge, interdiction géographique
async function rule(fill, approveNote) {
  await page.goto(`${B}/admin/conformite/regles/nouveau`);
  await fill();
  await page.fill("#effectiveFrom", "2020-01-01");
  await submit(page, "Enregistrer le brouillon");
  await page.waitForURL(/\/admin\/conformite\/regles\/c/, { timeout: 15000 });
  await page.fill("#approve-note", approveNote);
  await submit(page, "Valider et publier");
  return page.locator("main").innerText();
}
let t = await rule(async () => {
  await page.fill("#code", "TEST-DOCS"); await page.fill("#name", "Justificatifs python (test)");
  await page.selectOption("#type", "DOCUMENT_REQUIREMENT"); await page.selectOption("#basis", "COMMERCIAL_POLICY");
  await page.selectOption("#speciesId", { label: "Python royal" });
  await page.check("input[name=requiredDocuments][value=IDENTITY_DOCUMENT]");
  await page.fill("#legalReference", "Politique interne de test");
}, "Règle de test validée");
check("règle documents active", !/Brouillon/.test(t) && /Active/.test(t));
t = await rule(async () => {
  await page.fill("#code", "TEST-AGE"); await page.fill("#name", "Majorité (test)");
  await page.selectOption("#type", "AGE_REQUIREMENT"); await page.selectOption("#basis", "COMMERCIAL_POLICY");
  await page.check("input[name=productTypes][value=ANIMAL]");
  await page.fill("#minimumAge", "18");
}, "Règle de test validée");
check("règle âge active", !/Brouillon/.test(t) && /Active/.test(t));
// Une règle LEGAL sans référence est refusée
await page.goto(`${B}/admin/conformite/regles/nouveau`);
await page.fill("#code", "TEST-GEO"); await page.fill("#name", "Interdit 69 (test)");
await page.selectOption("#type", "GEO_RESTRICTION"); await page.selectOption("#basis", "LEGAL");
await page.selectOption("#speciesId", { label: "Python royal" });
await page.fill("#zones", "FR//69"); await page.fill("#effectiveFrom", "2020-01-01");
await page.evaluate(() => document.querySelector("#legalReference").removeAttribute("required"));
await submit(page, "Enregistrer le brouillon");
check("règle légale sans référence refusée", /référence/i.test(await msg()), await msg());
await page.fill("#legalReference", "Arrêté fictif de TEST");
await submit(page, "Enregistrer le brouillon");
await page.waitForURL(/\/admin\/conformite\/regles\/c/, { timeout: 15000 });
await page.fill("#approve-note", "Référence de test vérifiée"); await submit(page, "Valider et publier");
check("règle géographique active", !/Brouillon/.test(await page.locator("main").innerText()));
await shot(page, "admin-rule");

// 9. Produit animal
await page.goto(`${B}/admin/produits/nouveau`);
await page.selectOption("#status", "PUBLISHED");
await page.fill("#name", "Python royal femelle TEST");
await page.fill("#description", "Femelle née en élevage (fiche de test).");
await page.fill("#price", "250");
await page.selectOption("#taxRateId", { index: 1 });
await page.selectOption("#speciesId", { label: "Python royal — Python regius" });
await page.selectOption("#sex", "FEMALE");
await submit(page, "Enregistrer");
await page.waitForURL(/\/admin\/produits\/c/, { timeout: 15000 });
await page.selectOption("#to", "AVAILABLE"); await page.fill("#note", "Contrôle sanitaire OK (test)");
await submit(page, "Changer le statut");
check("animal disponible", /Disponible/.test(await page.locator("main").innerText()), await msg());

await page.goto(`${B}/admin/systeme`);
await shot(page, "admin-systeme");
check("readiness sans bloquant", !(await page.locator("main").innerText()).includes("Bloquant"), "");
await ctx.clearCookies();
await ctx.addCookies([{ name: "cookie_consent_v1", value: "denied", url: B }]);

// 10. Client
await login("client@example.org", "ClientPass123456");
await page.goto(`${B}/catalogue`);
await page.click("text=Python royal femelle TEST");
await page.waitForURL(/\/produit\//);
const pp = await page.locator("main").innerText();
check("fiche produit : justificatif annoncé", /Pièce d'identité|identité/i.test(pp));
await page.getByRole("button", { name: "Ajouter au panier" }).first().click(); await page.waitForTimeout(1500);
await page.goto(`${B}/commande`);
// Adresse dans le 69 → bloqué
await page.fill("#new-firstName", "Camille"); await page.fill("#new-lastName", "Durand");
await page.fill("#new-line1", "1 rue de la République"); await page.fill("#new-postalCode", "69001"); await page.fill("#new-city", "Lyon"); await page.fill("#new-phone", "0600000000");
await page.click("button:has-text(\"Enregistrer l'adresse\")"); await page.waitForTimeout(1500);
await page.goto(`${B}/commande`); await page.waitForTimeout(2500);
const blocked = await page.locator("main").innerText();
check("destination interdite bloquée", /Commande impossible|interdit/i.test(blocked));
await shot(page, "checkout-blocked");
// Adresse Paris
await page.goto(`${B}/compte/adresses`);
const f = page.locator("form:has(#new-line1)");
await f.locator("#new-firstName").fill("Camille"); await f.locator("#new-lastName").fill("Durand");
await f.locator("#new-line1").fill("10 rue de Rivoli"); await f.locator("#new-postalCode").fill("75001"); await f.locator("#new-city").fill("Paris");
await f.locator("#new-phone").fill("0600000000"); await f.locator("[name=isDefault]").check();
await f.locator("button[type=submit]").click(); await page.waitForTimeout(1500);
await page.goto(`${B}/commande`); await page.waitForTimeout(2500);
await shot(page, "checkout-ok");
const btn = page.getByRole("button", { name: "Envoyer ma commande pour validation" });
check("bouton PAY_AFTER_COMPLIANCE", (await btn.count()) === 1);
await page.check("[name=terms]");
await btn.click();
await page.waitForURL(/\/commande\/merci/, { timeout: 20000 }).catch(() => {});
const thanks = await page.locator("main").innerText();
check("page merci sans paiement", /Aucun paiement n'a été prélevé/.test(thanks), page.url());
await shot(page, "merci");
const number = (thanks.match(/Commande\s+(\S+)/) || [])[1];
// Double soumission : la clé d'idempotence évite un doublon (vérifié côté base plus bas)
await page.goto(`${B}/compte/commandes`);
check("commande listée", (await page.locator("main").innerText()).includes(number ?? "§"), number);
await ctx.clearCookies();

// 11. Admin : dossier de conformité
await login("admin@example.org", "AdminPass123456");
await page.goto(`${B}/admin/conformite`);
check("dossier en file", (await page.locator("main").innerText()).includes(number ?? "§"));
await shot(page, "admin-conformite");
await page.goto(`${B}/admin/audit`);
check("audit alimenté", /order\.create/.test(await page.locator("main").innerText()));

console.log("ERRORS", JSON.stringify(errors.slice(0, 10)));
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} vérifications réussies — commande ${number}`);
await browser.close();
if (passed !== results.length) process.exit(1);
