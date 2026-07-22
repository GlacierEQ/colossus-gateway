const DEFAULT_READ_TOOLS = new Set([
  "gateway.discover",
  "notion.search",
  "notion.validate",
  "mem0.search",
  "github.list_repos",
  "github.get_file",
]);

export function isReadOnlyTool(toolName: string): boolean {
  return DEFAULT_READ_TOOLS.has(toolName);
}

export function isRemoteToolAllowed(toolName: string): boolean {
  const configured = (process.env.COLOSSUS_ALLOWED_REMOTE_TOOLS ?? "")
    .split(",").map(value => value.trim()).filter(Boolean);
  // Never accept a wildcard: every remote action must be explicitly named.
  return isReadOnlyTool(toolName) || configured.includes(toolName);
}
