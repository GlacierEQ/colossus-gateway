import { remoteExecutor } from "../src/lib/remoteExecutor.js";

export default async function handler(req: any, res: any) {
  // 1. Method Lock
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // 2. Authentication Lock (The "Locked Doorway")
  const authHeader = req.headers.authorization;
  const secret = process.env.GATEWAY_SECRET;
  
  if (secret && authHeader !== `Bearer ${secret}`) {
    console.warn(`[REST Gateway] Unauthorized access attempt blocked.`);
    return res.status(401).json({ error: 'Unauthorized: Gateway is locked.' });
  }

  const { toolName, payload } = req.body;

  if (!toolName) {
    return res.status(400).json({ error: 'Missing toolName in request body' });
  }

  try {
    console.log(`[REST Gateway] ${authHeader ? 'Authorized' : 'Public'} Entry -> Tool: ${toolName}`);
    const result = await remoteExecutor.execute(toolName, payload);
    
    if (result.success) {
      return res.status(200).json(result.data);
    } else {
      return res.status(500).json({ error: result.error });
    }
  } catch (error: any) {
    console.error(`[REST Gateway] Fatal: ${error.message}`);
    return res.status(500).json({ error: error.message });
  }
}

