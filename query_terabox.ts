import 'dotenv/config';
import { remoteExecutor } from './src/lib/remoteExecutor.js';

async function queryTeraBox() {
  console.log('🛰️  QUERYING TERABOX DAEMON (GHOST-DRIVE-FORENSIC)...');
  console.log('=====================================================');

  const res = await remoteExecutor.execute('infinity.query_daemon', {
    daemon_id: 'DN-YK5C7EI',
    query: 'Identify high-value recordings linked to Scot Brower and CSEA financial strikes'
  });

  if (res.success) {
      console.log('🟢 QUERY SUCCESSFUL');
      console.log(JSON.stringify(res.data, null, 2));
  } else {
      console.log('❌ QUERY FAILED');
      console.error(res.error);
  }
}

queryTeraBox().catch(console.error);
