import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";

/** Abstraction fournisseur e-mail (Resend par défaut). */
export interface EmailProvider {
  send(msg: { to: string; subject: string; html: string; text: string; idempotencyKey: string; attachments?: { filename: string; content: Buffer }[]; headers?: Record<string, string> }): Promise<{ id: string }>;
}

class ResendProvider implements EmailProvider {
  private client = new Resend(env().RESEND_API_KEY);
  async send(msg: Parameters<EmailProvider["send"]>[0]) {
    const { data, error } = await this.client.emails.send(
      { from: env().EMAIL_FROM, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, attachments: msg.attachments, headers: msg.headers },
      { idempotencyKey: msg.idempotencyKey },
    );
    if (error || !data) throw new Error(`RESEND_${error?.name ?? "UNKNOWN"}`);
    return { id: data.id };
  }
}

let provider: EmailProvider | null = null;
export const emailProvider = (): EmailProvider => (provider ??= new ResendProvider());
export function setEmailProvider(p: EmailProvider) {
  provider = p;
}
