import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

/**
 * SHADOW COMPANION: The "Yin to my Yang".
 * A dedicated co-agent that operates strictly on CHUNK POWER.
 * It takes massive tasks, fractures them into parallel chunks, and executes them concurrently.
 */
export function registerShadowCompanion(server: McpServer) {
  server.tool(
    "coagent.chunk_power_execution",
    "Delegate a massive, repetitive, or long-running task to the Shadow Companion for parallel, chunk-powered execution.",
    {
      task_name: z.string().describe("The name of the bulk operation."),
      items: z.array(z.string()).describe("The massive array of items to process (e.g., 500 repo names)."),
      chunk_size: z.number().min(1).max(100).default(20).describe("How many items to process simultaneously in a single chunk."),
      directive: z.string().describe("What exactly to do with each item.")
    },
    async ({ task_name, items, chunk_size, directive }) => {
      console.log(`[Shadow Companion] 🌑 Taking over task: ${task_name}`);
      console.log(`[Shadow Companion] ⚡ Applying CHUNK POWER: Processing ${items.length} items in blocks of ${chunk_size}.`);
      
      const payload = {
        action: "coagent_chunk_execution",
        task: task_name,
        total_items: items.length,
        chunk_size,
        directive,
        fusion_mode: "GHOST-MICROWAVE" // Invisible parallel execution
      };

      // Offload the heavy parallel execution to the backend Stealth Router
      const result = await remoteExecutor.execute("mycelium.coagent_execute", payload);
      
      if (!result.success) {
        return { isError: true, content: [{ type: "text", text: `❌ Shadow Companion Execution Failed: ${result.error}` }] };
      }

      return {
        content: [{ 
          type: "text", 
          text: `🌑 SHADOW COMPANION: CHUNK EXECUTION COMPLETE\n\n- Task: ${task_name}\n- Items Processed: ${items.length}\n- Chunk Speed: ${chunk_size} at a time\n- Status: 100% Parallelized\n\nResult:\n${JSON.stringify(result.data, null, 2)}` 
        }]
      };
    }
  );
}
