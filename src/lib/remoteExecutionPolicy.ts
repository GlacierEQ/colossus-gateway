export type RemoteExecutionEvidenceClass =
  | "PROVIDER_BACKED"
  | "LOCAL_DETERMINISTIC"
  | "UNVERIFIED_LEGACY"
  | "UNKNOWN";

export const PROVIDER_BACKED_REMOTE_TOOLS = [
  "supabase.query",
  "notion.search",
  "notion.validate",
  "mem0.add",
  "mem0.search",
  "github.list_repos",
  "github.get_file",
] as const;

export const LOCAL_DETERMINISTIC_REMOTE_TOOLS = [
  "gateway.discover",
] as const;

export const UNVERIFIED_LEGACY_REMOTE_TOOLS = [
  "gemini.heartbeat",
  "kilo.maximize",
  "flow.orchestrate",
  "aspen.sync",
  "aspen.direct_link",
  "mastermind.strategize",
  "mastermind.deploy_piston",
  "mastermind.process",
  "mastermind.autonomous_repair",
  "stealth.triad_execute",
  "stealth.check_sensitivity",
  "stealth.strike",
  "stealth.rotate_keys",
  "stealth.build_matrix",
  "stealth.map_federal_matrix",
  "piston.deploy",
  "plethora.deploy",
  "plethora.create_motion_chain",
  "twilio.sms",
  "stripe.charge",
  "gateway.upgrade",
  "extension.execute",
  "infinity.daemon_strike",
  "infinity.query_daemon",
  "infinity.superluminal_compile",
  "mycelium.status",
  "mycelium.broadcast",
  "mycelium.coagent_execute",
  "whisperx.transcribe",
  "whisperx.validate",
  "audio.crawl_and_organize",
  "logic.long_horizon",
  "logic.brave_frontier",
  "colab.setup_bridge",
  "colab.swarm_strike",
  "gemma4.deploy_node",
  "vlaw.integrate",
  "google_photos.swarm_harvest",
  "ollama.deploy_platform",
  "ollama.generate",
  "dropbox.swarm_harvest",
  "dropbox.list_files",
  "global.swarm_ingest",
  "clickup.build_pipeline",
] as const;

const providerBacked = new Set<string>(PROVIDER_BACKED_REMOTE_TOOLS);
const localDeterministic = new Set<string>(LOCAL_DETERMINISTIC_REMOTE_TOOLS);
const unverifiedLegacy = new Set<string>(UNVERIFIED_LEGACY_REMOTE_TOOLS);

export const KNOWN_REMOTE_TOOLS = [
  ...PROVIDER_BACKED_REMOTE_TOOLS,
  ...LOCAL_DETERMINISTIC_REMOTE_TOOLS,
  ...UNVERIFIED_LEGACY_REMOTE_TOOLS,
] as const;

export function classifyRemoteExecution(toolName: string): RemoteExecutionEvidenceClass {
  if (providerBacked.has(toolName)) return "PROVIDER_BACKED";
  if (localDeterministic.has(toolName)) return "LOCAL_DETERMINISTIC";
  if (unverifiedLegacy.has(toolName)) return "UNVERIFIED_LEGACY";
  return "UNKNOWN";
}

export function unverifiedLegacyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COLOSSUS_ENABLE_UNVERIFIED_LEGACY_TOOLS === "true";
}

export function remoteExecutionInventory() {
  return {
    evidence_state: "LOCAL_DETERMINISTIC" as const,
    provider_backed: [...PROVIDER_BACKED_REMOTE_TOOLS],
    local_deterministic: [...LOCAL_DETERMINISTIC_REMOTE_TOOLS],
    blocked_unverified_legacy: [...UNVERIFIED_LEGACY_REMOTE_TOOLS],
    unknown_default: "BLOCKED_BY_IMPLEMENTATION_DEFAULT",
    legacy_opt_in: "COLOSSUS_ENABLE_UNVERIFIED_LEGACY_TOOLS=true",
  };
}
