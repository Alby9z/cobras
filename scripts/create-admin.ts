/**
 * Crée (ou promeut) le premier compte administrateur.
 * Usage : npm run db:seed-admin -- admin@exemple.fr "Prénom" "Nom" 1985-04-12
 * Le mot de passe est demandé de façon interactive (jamais passé en argument).
 */
import "dotenv/config";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { hash } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const [email, firstName, lastName, birth] = process.argv.slice(2);
if (!email || !firstName || !lastName || !/^\d{4}-\d{2}-\d{2}$/.test(birth ?? "")) {
  console.error('Usage : npm run db:seed-admin -- email "Prénom" "Nom" AAAA-MM-JJ');
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    await db.user.update({ where: { id: existing.id }, data: { role: "SUPER_ADMIN", emailVerified: true } });
    console.log(`Compte existant promu super-administrateur : ${email}`);
    return;
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const password = await rl.question("Mot de passe (12 caractères min.) : ");
  rl.close();
  if (password.length < 12) throw new Error("Mot de passe trop court.");
  const id = randomUUID();
  await db.user.create({
    data: {
      id, email: email.toLowerCase(), name: `${firstName} ${lastName}`, firstName, lastName, birthDate: new Date(birth), emailVerified: true, role: "SUPER_ADMIN",
      accounts: { create: { id: randomUUID(), accountId: id, providerId: "credential", password: await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32, algorithm: 2 }) } },
    },
  });
  console.log(`Administrateur créé : ${email}. Activez la double authentification dès la première connexion.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => db.$disconnect());
