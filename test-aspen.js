import 'dotenv/config';
import { remoteExecutor } from './dist/lib/remoteExecutor.js';

async function testAspen() {
  console.log("--- Testing Aspen Grove Global Sync ---");
  const syncResult = await remoteExecutor.execute("aspen.sync", {});
  console.log(JSON.stringify(syncResult, null, 2));

  console.log("\n--- Testing Aspen Grove Direct Link ---");
  const linkResult = await remoteExecutor.execute("aspen.direct_link", { payload: "Test Signal" });
  console.log(JSON.stringify(linkResult, null, 2));
}

testAspen();
