import 'dotenv/config';
import { remoteExecutor } from './src/lib/remoteExecutor.js';

async function harvest() {
  console.log('🛰️  INITIATING MICROMEMORY-DRIVEN FORENSIC HARVEST...');
  console.log('=====================================================');

  const res = await remoteExecutor.execute('infinity.daemon_strike', {
    daemon: 'GHOST-DRIVE-FORENSIC',
    domain: 'terabox',
    directive: 'exhibit_generation',
    fusion_mode: 'SHERLOCK-SUPERNOVA',
    multimodal: true,
    chunk_power: 100
  });

  if (res.success) {
      console.log('🟢 HARVEST STRIKE SUCCESSFUL');
      console.log(JSON.stringify(res.data, null, 2));
  } else {
      console.log('❌ HARVEST STRIKE FAILED');
      console.error(res.error);
  }
}

harvest().catch(console.error);
