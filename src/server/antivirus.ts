import "server-only";
import net from "node:net";
import { env } from "@/lib/env";

export type ScanResult = { clean: true } | { clean: false; signature: string };

/**
 * Analyse un fichier avec ClamAV (clamd) via le protocole INSTREAM.
 * En cas d'indisponibilité du service, lève une erreur : aucun fichier n'est accepté sans analyse.
 */
export function scanBuffer(buffer: Buffer, timeoutMs = 30_000): Promise<ScanResult> {
  const { CLAMAV_HOST, CLAMAV_PORT } = env();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: CLAMAV_HOST, port: CLAMAV_PORT });
    let response = "";
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error("ANTIVIRUS_TIMEOUT"));
    });
    socket.on("error", () => reject(new Error("ANTIVIRUS_UNAVAILABLE")));
    socket.on("data", (d) => (response += d.toString()));
    socket.on("end", () => {
      const r = response.replace(/\0/g, "").trim();
      if (r.endsWith("OK")) resolve({ clean: true });
      else if (r.endsWith("FOUND")) resolve({ clean: false, signature: r.replace(/^stream:\s*/, "").replace(/\s*FOUND$/, "") });
      else reject(new Error("ANTIVIRUS_ERROR"));
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const CHUNK = 64 * 1024;
      for (let i = 0; i < buffer.length; i += CHUNK) {
        const chunk = buffer.subarray(i, i + CHUNK);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length, 0);
        socket.write(size);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4)); // fin de flux
    });
  });
}
