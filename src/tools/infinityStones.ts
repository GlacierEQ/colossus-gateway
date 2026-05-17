import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

// Infinity Stones: The 5 Domain-Specific Forensic Daemons
const DOMAINS = ["dropbox", "icloud", "onedrive", "gdrive", "terabox", "workspace", "gmail", "photos", "device"] as const;
const FUSION_MODES = [
  "SHERLOCK-SUPERNOVA", 
  "SONIC-BODYBUILDER", 
  "GHOST-MICROWAVE", 
  "CORE-THINK-AMPLIFIED",
  "PHANTOM-SHADOW",
  "GHOST-VIPER",
  "WRAITH-SPECTER"
] as const;

export function registerInfinityStonesTools(server: McpServer) {
  server.tool(
    "infinity.deploy_daemon",
    "Deploy a persistent, autonomous Daemon to a specific cloud domain with Fusion Mode and Multimodal capabilities.",
    {
      domain: z.enum(DOMAINS).describe("The cloud domain to deploy the Daemon to."),
      daemon_name: z.string().describe("The unique identifier for this persistent Daemon."),
      primary_directive: z.enum(["perpetual_organize", "sociological_mapping", "exhibit_generation", "federal_matrix_build"]).describe("The ongoing mission parameter."),
      fusion_mode: z.enum(FUSION_MODES).describe("The Stealth Team Fusion Mode to power the Daemon."),
      multimodal_active: z.boolean().default(true).describe("Enable Image/Audio/Video processing (Multimodal)."),
      chunk_power: z.number().min(1).max(100).default(100).describe("Processing chunk power (1-100%).")
    },
    async ({ domain, daemon_name, primary_directive, fusion_mode, multimodal_active, chunk_power }) => {
      console.log(`[Infinity Stones] 🔱 Deploying Daemon [${daemon_name}] to ${domain.toUpperCase()} | Fusion: ${fusion_mode} | Multimodal: ${multimodal_active}`);
      
      const payload = {
        action: "deploy_persistent_daemon",
        daemon: daemon_name,
        domain,
        directive: primary_directive,
        fusion_mode,
        multimodal: multimodal_active,
        mechanics: "rclone_remote_only",
        chunk_power,
        timestamp: new Date().toISOString()
      };

      const result = await remoteExecutor.execute("infinity.daemon_strike", payload);
      
      if (!result.success) {
        return { isError: true, content: [{ type: "text", text: `❌ Daemon Deployment Failed: ${result.error}` }] };
      }

      return {
        content: [{ 
          type: "text", 
          text: `🔱 DAEMON [${daemon_name}] SUCCESSFULLY DEPLOYED TO ${domain.toUpperCase()}\n\n- Fusion Mode: ${fusion_mode}\n- Multimodal: ${multimodal_active ? "ENABLED" : "DISABLED"}\n- Directive: ${primary_directive}\n- Protocol: ZERO LOCAL EGRESS\n\nResult:\n${JSON.stringify(result.data, null, 2)}` 
        }]
      };
    }
  );

  server.tool(
    "infinity.query_daemon",
    "Interrogate an active Daemon living in a cloud domain.",
    {
      daemon_name: z.string().describe("The name of the deployed Daemon."),
      query: z.string().describe("What you want the Daemon to report or generate.")
    },
    async ({ daemon_name, query }) => {
       console.log(`[Infinity Stones] 📡 Querying Daemon [${daemon_name}]: ${query}`);
       
       const result = await remoteExecutor.execute("infinity.query_daemon", { daemon_name, query });
       
       if (!result.success) {
         return { isError: true, content: [{ type: "text", text: `❌ Daemon Query Failed: ${result.error}` }] };
       }

       return {
         content: [{ type: "text", text: `📡 DAEMON RESPONSE [${daemon_name}]:\n\n${JSON.stringify(result.data, null, 2)}` }]
       };
    }
  );

  server.tool(
    "infinity.compile_superluminal_matrix",
    "Consolidate extractions and insights from all active Daemons into the Superluminal Case Matrix.",
    {
      case_id: z.string().default("1FDV-23-0001009").describe("The target case ID."),
      daemons_to_merge: z.array(z.string()).describe("List of daemon_names to pull insights from.")
    },
    async ({ case_id, daemons_to_merge }) => {
      console.log(`[Infinity Stones] 🌌 Compiling Superluminal Case Matrix for ${case_id}...`);
      
      const result = await remoteExecutor.execute("infinity.superluminal_compile", { case_id, daemons_to_merge });

      if (!result.success) {
         return { isError: true, content: [{ type: "text", text: `❌ Matrix Compilation Failed: ${result.error}` }] };
      }

      return {
        content: [{
           type: "text",
           text: `🌌 SUPERLUMINAL CASE MATRIX COMPILED\n\n- Case: ${case_id}\n- Sourced from Daemons: ${daemons_to_merge.join(", ")}\n\nReport:\n${JSON.stringify(result.data, null, 2)}`
        }]
      };
    }
  );
}
