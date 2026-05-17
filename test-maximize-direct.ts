import 'dotenv/config';
import { remoteExecutor } from './src/lib/remoteExecutor.js';

async function run() {
  console.log("🚀 TRIGGERING REAL MAXIMIZATION...");
  try {
    const result = await remoteExecutor.execute('kilo.maximize', { reason: 'Direct Implementation Verification' });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("❌ Test Failed:", error);
  }
}

run();
