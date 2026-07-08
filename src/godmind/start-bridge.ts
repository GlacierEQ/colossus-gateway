// GODMIND Colossus Bridge — Entry point
// Run: npx ts-node src/godmind/start-bridge.ts
// Or:  node dist/godmind/start-bridge.js

import 'dotenv/config';
import { startBridge } from './bridge.js';

console.log('┌─────────────────────────────────────────┐');
console.log('│  GODMIND COLOSSUS BRIDGE  v1.0.0        │');
console.log('│  Layer 2: Execution Core                │');
console.log('│  GlacierEQ/colossus-gateway             │');
console.log('└─────────────────────────────────────────┘');

startBridge();
