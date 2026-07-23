export interface ComposioExecuteInput {
  toolSlug: string;
  arguments?: Record<string, unknown>;
  connectedAccountId?: string;
  userId?: string;
  version?: string;
}

const BASE_URL = process.env.COMPOSIO_BASE_URL ?? "https://backend.composio.dev/api/v3";

function allowed(slug: string): boolean {
  const configured = (process.env.COMPOSIO_ALLOWED_TOOLS ?? "")
    .split(",").map(value => value.trim()).filter(Boolean);
  return configured.includes("*") || configured.includes(slug);
}

export async function composioExecute(input: ComposioExecuteInput) {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new Error("COMPOSIO_API_KEY not configured");
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(input.toolSlug)) throw new Error("Invalid Composio tool slug");
  if (!allowed(input.toolSlug)) throw new Error(`Composio tool is not allowlisted: ${input.toolSlug}`);

  const body = {
    arguments: input.arguments ?? {},
    connected_account_id: input.connectedAccountId || process.env.COMPOSIO_CONNECTED_ACCOUNT_ID,
    user_id: input.userId || process.env.COMPOSIO_USER_ID,
    version: input.version,
  };
  const response = await fetch(`${BASE_URL}/tools/execute/${encodeURIComponent(input.toolSlug)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Composio ${response.status}: ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}
