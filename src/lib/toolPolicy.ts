const DEFAULT_READ_TOOLS = new Set([
  "gateway.discover",
  "notion.search",
  "notion.validate",
  "mem0.search",
  "github.list_repos",
  "github.get_file",
]);

export function isRemoteToolAllowed(toolName: string): boolean {
  const configured = (process.env.COLOSSUS_ALLOWED_REMOTE_TOOLS ?? "")
    .split(",").map(value => value.trim()).filter(Boolean);
  return DEFAULT_READ_TOOLS.has(toolName) || configured.includes("*") || configured.includes(toolName);
}
