import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerOllamaTools(server: McpServer) {
  server.tool(
    "ollama.deploy_platform",
    "Deploy the strongest possible Ollama platform using parallel neural nodes",
    {
      nodeCount: z.number().default(4).describe("Number of parallel neural nodes to engage"),
      model: z.string().default("deepseek-r1:32b").describe("The primary reasoning model")
    },
    async (args) => {
      const result = await remoteExecutor.execute("ollama.deploy_platform", args);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Ollama Platform Deployment Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🔥 OLLAMA SUPREME PLATFORM ONLINE\n\n` +
                `Active Nodes: ${result.data.active_nodes}\n` +
                `Primary Model: ${result.data.model}\n` +
                `Aggregate VRAM: ${result.data.total_vram}\n` +
                `Throughput: ${result.data.tokens_per_sec} t/s\n` +
                `Status: NEURAL_SATURATION_ACHIEVED`
        }]
      };
    }
  );

  server.tool(
    "ollama.generate_reasoning",
    "High-fidelity reasoning for forensics and legal strategy via APEX_ULTIMA_REASONER",
    {
      prompt: z.string().describe("The forensic or legal query"),
      contextNodes: z.array(z.string()).optional().describe("IDs of evidence nodes to include in context")
    },
    async (args) => {
      const result = await remoteExecutor.execute("ollama.generate", args);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Reasoning Generation Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🧠 NEURAL REASONING OUTPUT [${result.data.model}]\n\n` +
                `${result.data.response}\n\n` +
                `--- Forensic Metadata ---\n` +
                `Confidence: ${result.data.confidence}\n` +
                `Context Nodes: ${result.data.nodes_processed}\n` +
                `Latency: ${result.data.latency}ms`
        }]
      };
    }
  );
}
