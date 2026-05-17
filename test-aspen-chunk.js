import 'dotenv/config';
import { remoteExecutor } from './dist/lib/remoteExecutor.js';

async function testAspenChunkPower() {
  const nodeIds = Array.from({ length: 26 }, (_, i) => (i + 1).toString());
  const chunkSize = 5;
  
  console.log(`[Gateway] Initiating CHUNK POWER Sync for Aspen Grove (26 Nodes)...`);
  
  // Use the Shadow Companion logic (simulated here for execution)
  await remoteExecutor.execute('mycelium.coagent_execute', { 
    task: 'Aspen Grove Node Calibration', 
    total_items: nodeIds.length, 
    chunk_size: chunkSize, 
    directive: 'Individual Node Forensic Sync', 
    fusion_mode: 'GHOST-MICROWAVE' 
  });

  for (let i = 0; i < nodeIds.length; i += chunkSize) {
    const chunk = nodeIds.slice(i, i + chunkSize);
    console.log(`\n⚡ Firing Chunk [${Math.floor(i/chunkSize) + 1}]: Syncing Nodes ${chunk.join(', ')}...`);
    
    const results = await Promise.all(chunk.map(id => 
      remoteExecutor.execute("aspen.sync", { nodeId: parseInt(id) })
    ));
    
    results.forEach((r, idx) => {
      if (r.success) {
        console.log(`  🟢 Node ${chunk[idx]} Sync: OK`);
      } else {
        console.log(`  🔴 Node ${chunk[idx]} Sync: FAILED (${r.error})`);
      }
    });
  }

  console.log("\n[Gateway] 🌲 Full Aspen Grove Calibration Complete. System Stabilized.");
}

testAspenChunkPower();
