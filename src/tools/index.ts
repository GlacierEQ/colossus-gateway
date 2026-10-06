import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerUniversalExecute } from "./universalExecute.js";
import { registerPing } from "./ping.js";
import { registerHeartbeat } from "./heartbeat.js";
import { registerKiloTools } from "./kiloFlow.js";
import { registerAspenTools } from "./aspen.js";
import { registerMastermindTools } from "./mastermind.js";
import { registerMastermindTeamTools } from "./mastermindTeam.js";
import { registerStealthTriadTools } from "./stealthTriad.js";
import { registerPlethoraTools } from "./plethora.js";
import { registerPistonTools } from "./pistons.js";
import { registerKnowledgeTools } from "./knowledge.js";
import { registerDataTools } from "./data.js";
import { registerInfinityStonesTools } from "./infinityStones.js";
import { registerWhisperXTools } from "./whisperx.js";
import { registerUpgradeTools } from "./upgrade.js";
import { registerColabTools } from "./colab.js";
import { registerExpansionTools } from "./expansion.js";
import { registerPhotoTools } from "./photos.js";
import { registerDropboxTools } from "./dropbox.js";
import { registerClickUpTools } from "./clickup.js";
import { registerEnergyTools } from "./energy.js";
import { registerSecurityTools } from "./security.js";
import { registerLongHorizon, registerBraveFrontier } from "../logic/index.js";
import { registerMyceliumTools } from "../mycelium/index.js";
import { registerShadowCompanion } from "../mycelium/shadowCompanion.js";
import { registerGitHubTools } from "./github.js";
import { registerOllamaTools } from "./ollama.js";
import { registerMemoryTools } from "./memory.js";
import { registerComposioTools } from "./composio.js";
import { registerBoxBridgeTools } from "./boxBridge.js";
import { registerNotionDirectTools } from "./notionDirect.js";
import { registerComputerUserTools } from "./computerUser.js";
import { unverifiedLegacyEnabled } from "../lib/remoteExecutionPolicy.js";

export function registerTools(server: McpServer) {
  // Default surface: deterministic diagnostics and provider-backed execution only.
  registerUniversalExecute(server);
  registerMemoryTools(server);
  registerComposioTools(server);
  registerPing(server);
  registerKnowledgeTools(server);
  registerDataTools(server);
  registerGitHubTools(server);
  registerBoxBridgeTools(server);
  registerNotionDirectTools(server);
  registerComputerUserTools(server);

  // Historical/synthetic capability remains preserved for non-production review,
  // but is never advertised by the normal production MCP registry.
  if (unverifiedLegacyEnabled()) {
    registerHeartbeat(server);
    registerKiloTools(server);
    registerAspenTools(server);
    registerMastermindTools(server);
    registerMastermindTeamTools(server);
    registerStealthTriadTools(server);
    registerPlethoraTools(server);
    registerPistonTools(server);
    registerInfinityStonesTools(server);
    registerWhisperXTools(server);
    registerUpgradeTools(server);
    registerColabTools(server);
    registerExpansionTools(server);
    registerPhotoTools(server);
    registerDropboxTools(server);
    registerClickUpTools(server);
    registerEnergyTools(server);
    registerSecurityTools(server);
    registerLongHorizon(server);
    registerBraveFrontier(server);
    registerMyceliumTools(server);
    registerShadowCompanion(server);
    registerOllamaTools(server);
  }
}
