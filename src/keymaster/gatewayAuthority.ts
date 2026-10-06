import { getVercelOidcToken } from "@vercel/oidc";

const SUPABASE_URL =
  process.env.APEX_CAPABILITY_SUPABASE_URL || "https://dyhprklicgewmrimecey.supabase.co";
const BROKER_URL = `${SUPABASE_URL}/functions/v1/apex-keymaster-broker`;
const BROKER_TIMEOUT_MS = 10_000;
const SHA256 = /^[0-9a-f]{64}$/i;

export interface GatewayCapabilityRequest {
  nonceHash: string;
  allowedTool: string;
  expectedSha256: string;
}

export interface GatewayEventRecord {
  request_id: string;
  action: string;
  status: string;
  actor?: string;
  source?: string;
  target?: Record<string, unknown>;
  arguments_sha256?: string;
  result_sha256?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

function boundedText(value: string, field: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`invalid_${field}`);
  }
  return normalized;
}

function fingerprint(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256.test(normalized)) throw new Error(`invalid_${field}`);
  return normalized;
}

async function runtimeOidcToken(): Promise<string> {
  try {
    const token = (await getVercelOidcToken())?.trim() || "";
    if (token) return token;
  } catch {
    // Fail closed below. Runtime identity is authoritative in deployed environments.
  }
  throw new Error("workload_identity_unavailable");
}

async function brokerCall(body: Record<string, unknown>): Promise<any> {
  const token = await runtimeOidcToken();
  const response = await fetch(BROKER_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vercel-oidc-token": token,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(BROKER_TIMEOUT_MS),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code =
      typeof payload?.error === "string"
        ? payload.error
        : `gateway_authority_broker_http_${response.status}`;
    throw new Error(code);
  }
  return payload;
}

export async function consumeGatewayCapability(
  input: GatewayCapabilityRequest,
): Promise<boolean> {
  const payload = await brokerCall({
    action: "gateway_capability_consume",
    nonce_hash: fingerprint(input.nonceHash, "nonce_hash"),
    allowed_tool: boundedText(input.allowedTool, "allowed_tool", 128),
    expected_sha256: fingerprint(input.expectedSha256, "expected_sha256"),
  });
  return payload?.ok === true && payload?.consumed === true;
}

export async function recordGatewayEvent(
  event: GatewayEventRecord,
): Promise<{ recorded: true; id?: string }> {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("invalid_gateway_event");
  }
  const serialized = JSON.stringify(event);
  if (Buffer.byteLength(serialized, "utf8") > 32_768) {
    throw new Error("gateway_event_too_large");
  }

  const payload = await brokerCall({
    action: "gateway_event_record",
    event,
  });
  if (payload?.ok !== true || payload?.recorded !== true) {
    throw new Error("gateway_event_record_failed");
  }
  return {
    recorded: true,
    ...(typeof payload.id === "string" ? { id: payload.id } : {}),
  };
}
