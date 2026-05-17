import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { remoteExecutor } from "../lib/remoteExecutor.js";

export function registerWhisperXTools(server: McpServer) {
  server.tool(
    "whisperx.transcribe",
    "Transcribe audio evidence using CHUNK POWER for Case 1FDV federal escalation",
    {
      audioFiles: z.array(z.string()).optional().describe("List of audio files to transcribe"),
      audioFile: z.string().optional().describe("Single audio file to transcribe"),
      batchSize: z.number().default(3).describe("Number of files to process per chunk")
    },
    async (args) => {
      const result = await remoteExecutor.execute("whisperx.transcribe", args);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ WhisperX Transcription Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🌊 WHISPERX CHUNK POWER TRANSCRIPTION COMPLETE\n\n` +
                `Status: ${result.data.status}\n` +
                `Total Processed: ${result.data.total_processed}\n` +
                `Chunks: ${result.data.chunks}\n` +
                `Protocol: ${result.data.protocol}\n\n` +
                `📋 Summary:\n${result.data.results.map((r: any) => `- ${r.file}: ${r.status} [${r.forensic_hash}]`).join('\n')}`
        }]
      };
    }
  );

  server.tool(
    "whisperx.validate",
    "Validate WhisperX evidence integrity and FRE compliance",
    {
      evidenceId: z.string().describe("The evidence ID to validate")
    },
    async (args) => {
      const result = await remoteExecutor.execute("whisperx.validate", args);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ WhisperX Validation Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🟢 WHISPERX EVIDENCE VALIDATED\n\n` +
                `Evidence ID: ${result.data.evidenceId}\n` +
                `Status: ${result.data.status}\n` +
                `Chain of Custody: ${result.data.chain_of_custody}\n` +
                `Admissibility: ${result.data.admissibility}\n` +
                `Piston Seal: ${result.data.piston_seal}`
        }]
      };
    }
  );

  server.tool(
    "audio.crawl_and_organize",
    "Crawl multiple planes for audio evidence and organize them with forensic naming",
    {
      rootDirs: z.array(z.string()).describe("List of root directories (planes) to scan"),
      outputDir: z.string().optional().describe("Directory to store organized exhibits")
    },
    async (args) => {
      const result = await remoteExecutor.execute("audio.crawl_and_organize", args);
      if (!result.success) return { isError: true, content: [{ type: "text", text: `❌ Audio Crawler Failed: ${result.error}` }] };

      return {
        content: [{ 
          type: "text", 
          text: `🔍 MULTI-PLANE AUDIO CRAWL COMPLETE\n\n` +
                `Planes Scanned: ${result.data.planes_scanned}\n` +
                `Files Found: ${result.data.files_found}\n` +
                `Output Directory: ${result.data.output_directory}\n\n` +
                `📋 Organized Inventory:\n${result.data.results.map((r: any) => `- ${r.newName} (Orig: ${r.original}) [${r.forensic_hash}]`).join('\n')}`
        }]
      };
    }
  );
}
