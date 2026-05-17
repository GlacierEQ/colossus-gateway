import 'dotenv/config';
import { remoteExecutor } from './src/lib/remoteExecutor.js';

async function generateMotionChain() {
  console.log('⛓️  INITIATING PLETHORA MOTION CHAIN GENERATION...');
  console.log('==================================================');

  const res = await remoteExecutor.execute('plethora.create_motion_chain', {
    caseId: '1FDV-23-0001009',
    motions: [
      'Federal RICO Complaint',
      'Consolidated Motion to Vacate',
      'Motion to Strike Contempt',
      'Administrative Complaint (CSEA/HPD)'
    ]
  });

  if (res.success) {
      console.log('🟢 MOTION CHAIN CREATED SUCCESSFULY');
      console.log(JSON.stringify(res.data, null, 2));
  } else {
      console.log('❌ MOTION CHAIN GENERATION FAILED');
      console.error(res.error);
  }
}

generateMotionChain().catch(console.error);
