import 'dotenv/config';
import { remoteExecutor } from './dist/lib/remoteExecutor.js';

remoteExecutor.execute('stealth.strike', { target: 'THE_CATACLYSM' }).then(r => console.log(JSON.stringify(r, null, 2)));
