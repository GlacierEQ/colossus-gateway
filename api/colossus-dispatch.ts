import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isToolCallAuthorized } from "../src/lib/requestAuth.js";
import { remoteExecutionInventory } from "../src/lib/remoteExecutionPolicy.js";

type JsonRecord = Record<string, unknown>;
const MAX_REQUEST_BYTES = 64 * 1024;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const SECRET_FIELD = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|private[_-]?url|cookie|authorization)/i;
const ENVELOPE_FIELDS = new Set([
  "protocolVersion", "schemaVersion", "requestId", "traceId", "jobId",
  "componentRef", "resolvedAdapterId", "method", "capability", "idempotencyKey",
  "planFingerprint", "policyVersion", "scopedHandles", "payload",
  "authorization", "createdAt", "envelopeFingerprint",
]);

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 1024;
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (record(value)) {
    return "{" + Object.keys(value).sort().map(key => {
      const item = value[key];
      if (item === undefined) throw new Error("undefined_value");
      return JSON.stringify(key) + ":" + canonical(item);
    }).join(",") + "}";
  }
  throw new Error("unsupported_json_value");
}

function noSecrets(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(noSecrets);
  if (record(value)) {
    return Object.entries(value).every(([key, child]) => !SECRET_FIELD.test(key) && noSecrets(child));
  }
  return true;
}

function firstHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function reply(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("request_too_large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validEnvelope(input: unknown, req: IncomingMessage): input is JsonRecord {
  if (!record(input)) return false;
  if (Object.keys(input).some(key => !ENVELOPE_FIELDS.has(key))) return false;
  if (input.protocolVersion !== "sigma-federation/v1" ||
      input.schemaVersion !== "colossus-dispatch/v1") return false;

  for (const key of [
    "requestId", "traceId", "jobId", "componentRef", "resolvedAdapterId",
    "method", "capability", "idempotencyKey", "planFingerprint", "policyVersion",
    "createdAt",
  ]) {
    if (!requiredText(input[key])) return false;
  }
  if (!SHA256.test(String(input.envelopeFingerprint))) return false;
  if (!Array.isArray(input.scopedHandles)) return false;
  if (!Object.hasOwn(input, "payload")) return false;

  const authority = input.authorization;
  if (!record(authority) ||
      Object.keys(authority).sort().join(",") !== "expiresAt,permitFingerprint,permitId" ||
      !requiredText(authority.permitId) || !requiredText(authority.permitFingerprint) ||
      !requiredText(authority.expiresAt)) return false;

  const created = Date.parse(String(input.createdAt));
  const expires = Date.parse(String(authority.expiresAt));
  const now = Date.now();
  if (!Number.isFinite(created) || !Number.isFinite(expires) ||
      created > now + 60_000 || expires <= now || expires <= created) return false;

  if (!noSecrets(input.payload) || !noSecrets(input.scopedHandles)) return false;
  if (firstHeader(req, "x-sigma-request-id") !== input.requestId ||
      firstHeader(req, "x-sigma-trace-id") !== input.traceId ||
      firstHeader(req, "x-sigma-envelope-fingerprint") !== input.envelopeFingerprint) return false;

  const core: JsonRecord = { ...input };
  delete core.envelopeFingerprint;
  const calculated = "sha256:" + createHash("sha256").update(canonical(core)).digest("hex");
  return calculated === input.envelopeFingerprint;
}

function receipt(input: JsonRecord, status: "dispatched" | "blocked", reason?: string) {
  const authority = input.authorization as JsonRecord;
  return {
    receiptId: randomUUID(),
    requestId: input.requestId,
    envelopeFingerprint: input.envelopeFingerprint,
    permitFingerprint: authority.permitFingerprint,
    componentRef: input.componentRef,
    method: input.method,
    idempotencyKey: input.idempotencyKey,
    resolvedAdapterId: input.resolvedAdapterId,
    capability: input.capability,
    status,
    ...(status === "blocked" ? { reasonCode: reason ?? "CAPABILITY_NOT_ENABLED" } : {}),
    receivedAt: new Date().toISOString(),
    redactedDiagnostics: [] as string[],
  };
}

/**
 * Fail-closed Sigma receiver. No mutation capability is exposed until a
 * separately authorized, durable permit/replay fence and provider integration
 * are implemented and verified. A dispatched receipt is transport acceptance
 * of the local deterministic read, NOT provider confirmation.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    reply(res, 405, { error: "method_not_allowed" });
    return;
  }
  if (!isToolCallAuthorized(req.headers as Record<string, string | string[] | undefined>)) {
    reply(res, 401, { error: "unauthorized" });
    return;
  }
  if (!/^application\/json(?:\s*;|$)/i.test(firstHeader(req, "content-type") ?? "")) {
    reply(res, 415, { error: "unsupported_media_type" });
    return;
  }

  let input: unknown;
  try {
    input = await readJson(req);
    if (!validEnvelope(input, req)) {
      reply(res, 400, { error: "invalid_sigma_envelope" });
      return;
    }
  } catch {
    reply(res, 400, { error: "invalid_sigma_envelope" });
    return;
  }
  if (!record(input)) {
    reply(res, 400, { error: "invalid_sigma_envelope" });
    return;
  }

  const acceptedRead =
    input.componentRef === "colossus-gateway@v1" &&
    input.resolvedAdapterId === "colossus-gateway" &&
    input.method === "read" &&
    input.capability === "gateway.capabilities" &&
    Array.isArray(input.scopedHandles) && input.scopedHandles.length === 0 &&
    record(input.payload) && Object.keys(input.payload).length === 0;

  if (!acceptedRead) {
    reply(res, 200, receipt(input, "blocked", "CAPABILITY_NOT_ENABLED"));
    return;
  }

  // Execute an existing deterministic read without provider mutations.
  const inventory = remoteExecutionInventory();
  if (inventory.evidence_state !== "LOCAL_DETERMINISTIC") {
    reply(res, 200, receipt(input, "blocked", "EVIDENCE_NOT_AVAILABLE"));
    return;
  }
  reply(res, 200, receipt(input, "dispatched"));
}
