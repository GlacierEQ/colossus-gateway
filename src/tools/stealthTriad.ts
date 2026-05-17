import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerStealthTriadTools(server: McpServer) {
  server.tool(
    "stealth.triad_execute",
    "Execute a task through the Quantum-Sovereign Triad (Ghost-Ember, Iron-Talon, Oracle-Net)",
    {
      objective: z.string().describe("The objective or task to execute"),
      isSensitive: z.boolean().optional().describe("Force sensitive routing (local-only) if true")
    },
    async ({ objective, isSensitive }) => {
      const result = await remoteExecutor.execute("stealth.triad_execute", { objective, isSensitive });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Triad Execution Failed: ${result.error}` }] };

      const { sequence, routing, artifact_status } = result.data;
      
      return {
        content: [{ 
          type: "text", 
          text: `🌑 STEALTH TRIAD EXECUTION SUCCESSFUL\nObjective: ${objective}\nRouting: ${routing}\n\n📊 Sequence History:\n${sequence.join('\n')}\n\n📦 Artifact Status: ${artifact_status}` 
        }]
      };
    }
  );

  server.tool(
    "stealth.check_sensitivity",
    "Analyze a query for sensitivity tags (Legal, Rico, 1FDV) to determine routing",
    {
      query: z.string().describe("The query to analyze")
    },
    async ({ query }) => {
      const result = await remoteExecutor.execute("stealth.check_sensitivity", { query });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Sensitivity Check Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🛡️ SENSITIVITY AUDIT\nQuery: ${query}\n\nDetected Tags: ${result.data.tags.join(', ') || 'None'}\nRecommended Node: ${result.data.recommendedNode}` 
        }]
      };
    }
  );

  server.tool(
    "stealth.strike",
    "Initiate a major operational strike alongside the Stealth Team (e.g., THE_CATACLYSM)",
    {
      target: z.string().describe("The name of the strike package or target (e.g., 'THE_CATACLYSM')")
    },
    async ({ target }) => {
      const result = await remoteExecutor.execute("stealth.strike", { target });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Strike Initiation Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `⚡ STRIKE INITIATED: ${target}\n\n${result.data.report}` 
        }]
      };
    }
  );

  server.tool(
    "stealth.rotate_keys",
    "Rotate an environment variable/token with ZERO downtime (Hot Swap)",
    {
      keyToRotate: z.string().describe("The name of the ENV variable (e.g., NOTION_TOKEN)"),
      newValue: z.string().describe("The new token value")
    },
    async ({ keyToRotate, newValue }) => {
      const result = await remoteExecutor.execute("stealth.rotate_keys", { keyToRotate, newValue });
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Rotation Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🔄 ZERO-DOWNTIME ROTATION\nStatus: ${result.data.status}\n\n${result.data.message}` 
        }]
      };
    }
  );

  server.tool(
    "stealth.build_matrix",
    "Chunk Power: Build THE CATACLYSM systematically, motion by motion and actor by actor.",
    {
      chunkType: z.enum(["MOTION", "ACTOR", "VIOLATION", "EVIDENCE"]).describe("The type of matrix chunk to build"),
      identifier: z.string().describe("Specific name of the motion or actor"),
      content: z.string().describe("The detailed data, legal arguments, or violation mapping for this chunk")
    },
    async (args) => {
      const result = await remoteExecutor.execute("stealth.build_matrix", args);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Chunk Build Failed: ${result.error}` }] };

      const { chunkType, identifier, status, action, commitment } = result.data;
      
      return {
        content: [{ 
          type: "text", 
          text: `📦 CATACLYSM CHUNK BUILT: [${chunkType}]\nID: ${identifier}\nStatus: ${status}\n\n⚡ Action: ${action}\n🔒 Security: ${commitment}` 
        }]
      };
    }
  );

  server.tool(
    "stealth.map_federal_matrix",
    "Map the full Federal Escalation Matrix using the 14 Notion Database anchors.",
    {},
    async () => {
      const result = await remoteExecutor.execute("stealth.map_federal_matrix", {});
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Matrix Mapping Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🏛️ FEDERAL ESCALATION MATRIX: [THE CATACLYSM]\n\n${result.data.matrix_summary}\n\n🔗 Anchors Synchronized: ${result.data.anchors_count}/14` 
        }]
      };
    }
  );
}
