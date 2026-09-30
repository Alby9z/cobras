import "server-only";
import { NextResponse } from "next/server";
import { errorBody, isAppError } from "@/lib/domain/errors";
import { getContext } from "@/server/context";
import { log } from "@/server/logger";

/** Enveloppe de route API : erreurs standardisées {code, message, details, request_id}, jamais de trace interne. */
export function apiRoute<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      const { requestId } = await getContext();
      if (!isAppError(e)) log.error("api.unhandled", { requestId, error: e });
      const status = isAppError(e) ? e.status : 500;
      return NextResponse.json(errorBody(e, requestId), { status, headers: { "x-request-id": requestId, "Cache-Control": "no-store" } });
    }
  };
}
