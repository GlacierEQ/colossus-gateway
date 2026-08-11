import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const readme = read("README.md");
const index = read("src/index.ts");
const server = read("src/server.ts");
const ping = read("src/tools/ping.ts");

const token = "LOCAL_MCP_STDIO_SERVER_NOT_EXTERNAL_COLOSSUS_RUNTIME";

assert.match(readme, new RegExp(token));
assert.match(readme, /not affiliated with, endorsed by, or based on private systems or data from xAI/i);
assert.match(readme, /does \*\*not\*\* establish:/);
assert.match(index, /StdioServerTransport/);
assert.match(index, /server\.connect\(transport\)/);
assert.match(server, /new McpServer/);
assert.match(server, /registerTools\(server\)/);
assert.match(ping, /server\.tool\("ping"/);
assert.doesNotMatch(readme, /100k\+ concurrent WebSocket connections/);
assert.doesNotMatch(readme, /Sub-millisecond routing latency/);
assert.doesNotMatch(readme, /Fully wired into APEX Highway mesh/);

console.log(token);
