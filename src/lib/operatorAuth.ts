import { createHash, timingSafeEqual } from "node:crypto";

export interface OperatorAuthResult {
  authorized: boolean;
  operatorId?: string;
  tier?: string;
  message: string;
  timestamp: string;
}

export interface OperatorSession {
  operatorId: string;
  code: string;
  tier: string;
  authorizedAt: string;
  expiresAt: string | null;
  permissions: string[];
}

type HeaderValue = string | string[] | undefined;
type RequestHeaders = Record<string, HeaderValue>;

const activeSessions: Map<string, OperatorSession> = new Map();

function normalized(value: string): string {
  return value.replace(/\|/g, "").replace(/^OPERATOR_LINK\s+/i, "").trim();
}

function equalsSecret(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

export function parseOperatorCode(raw: string): { valid: boolean; operatorId: string; guid: string } {
  const cleaned = normalized(raw);
  const fullMatch = cleaned.match(/(OPR-[\w-]+-GUID:([\w-]+))/i);
  if (fullMatch) return { valid: true, operatorId: fullMatch[1], guid: fullMatch[2] };

  const guidMatch = cleaned.match(/([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{1,4}-[0-9A-F]{4}-[0-9A-F]{12})/i);
  if (guidMatch) return { valid: true, operatorId: `OPR-DIRECT-GUID:${guidMatch[1]}`, guid: guidMatch[1] };

  return { valid: false, operatorId: "", guid: "" };
}

export function validateOperatorCode(inboundCode: string): OperatorAuthResult {
  const timestamp = new Date().toISOString();
  const inbound = normalized(inboundCode);
  const configuredCode = process.env.COLOSSUS_OPERATOR_CODE || process.env.COLOSSUS_TOOL_KEY;
  const configuredGuid = process.env.COLOSSUS_OPERATOR_GUID;

  if (!inbound) return { authorized: false, message: "OPERATOR_AUTH_REQUIRED", timestamp };

  const parsed = parseOperatorCode(inbound);
  const directMatch = Boolean(configuredCode) && equalsSecret(inbound, normalized(configuredCode!));
  const guidMatch = Boolean(configuredGuid && parsed.valid) && parsed.guid.toUpperCase() === configuredGuid!.toUpperCase();

  if (!directMatch && !guidMatch) {
    return {
      authorized: false,
      message: "OPERATOR_REJECTED: configure COLOSSUS_OPERATOR_CODE or COLOSSUS_OPERATOR_GUID",
      timestamp,
    };
  }

  const operatorId = parsed.valid ? parsed.operatorId : "OPR-CONFIGURED";
  if (parsed.valid) {
    activeSessions.set(parsed.guid.toUpperCase(), {
      operatorId,
      code: inboundCode,
      tier: "APEX_OPERATOR",
      authorizedAt: timestamp,
      expiresAt: null,
      permissions: ["gateway.read", "gateway.write", "memory.read", "memory.write", "composio.execute"],
    });
  }

  return { authorized: true, operatorId, tier: "APEX_OPERATOR", message: "OPERATOR_AUTHORIZED", timestamp };
}

export function extractOperatorCode(headers: RequestHeaders): string | null {
  const auth = headers.authorization;
  const bearer = Array.isArray(auth) ? auth[0] : auth;
  if (bearer?.toLowerCase().startsWith("bearer ")) return bearer.slice(7).trim();

  const header = headers["x-colossus-operator"];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || null;
}

export function authorizeRequest(headers: RequestHeaders): OperatorAuthResult {
  const credential = extractOperatorCode(headers);
  return credential ? validateOperatorCode(credential) : {
    authorized: false,
    message: "OPERATOR_AUTH_REQUIRED: use Authorization: Bearer <operator-code>",
    timestamp: new Date().toISOString(),
  };
}

export function isSessionActive(guid: string): boolean {
  const session = activeSessions.get(guid.toUpperCase());
  if (!session) return false;
  if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
    activeSessions.delete(guid.toUpperCase());
    return false;
  }
  return true;
}

export function getActiveSessions(): OperatorSession[] {
  return Array.from(activeSessions.values());
}

export function getKeyRotationPolicy() {
  return {
    policy: "OWNER_EXCLUSIVE",
    authority: "Casey Barton — sole credential authority",
    aiSuggestionAllowed: false,
    autoRotationAllowed: false,
    message: "Credential lifecycle changes require explicit owner action outside the gateway.",
  };
}
