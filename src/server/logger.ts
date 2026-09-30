import "server-only";

/** Journalisation structurée JSON (stdout), sans secrets. */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;
const REDACT = /pass(word)?|secret|token|authorization|cookie|card|iban|api[_-]?key/i;

function redact(v: unknown, depth = 0): unknown {
  if (depth > 4 || v == null || typeof v !== "object") return v;
  if (v instanceof Error) return { name: v.name, message: v.message };
  if (Array.isArray(v)) return v.map((x) => redact(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, REDACT.test(k) ? "[REDACTED]" : redact(x, depth + 1)]));
}

function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (ORDER[level] < MIN) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, service: process.env.SERVICE_NAME ?? "web", ...(redact(fields) as object) });
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => write("debug", m, f),
  info: (m: string, f?: Record<string, unknown>) => write("info", m, f),
  warn: (m: string, f?: Record<string, unknown>) => write("warn", m, f),
  error: (m: string, f?: Record<string, unknown>) => write("error", m, f),
};
