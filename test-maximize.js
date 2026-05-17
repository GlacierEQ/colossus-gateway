import 'dotenv/config';
import { remoteExecutor } from './dist/lib/remoteExecutor.js';

remoteExecutor.execute('kilo.maximize', {}).then(r => console.log(JSON.stringify(r, null, 2)));
