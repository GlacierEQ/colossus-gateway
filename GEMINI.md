# Colossus Gateway

## Architecture
- **MCP Server**: Built using `@modelcontextprotocol/sdk`.
- **Language**: TypeScript (ESNext, NodeNext).
- **Runtime**: Node.js.

## Conventions
- Use `tsx` for running the development server.
- Tests are co-located or in `src/__tests__` using Vitest.
- Strict type checking enabled.
- **SECURITY MANDATE**: NO TOKEN ROTATIONS EVER. All provided credentials must remain static and persistent. Use existing tokens until specifically instructed otherwise.


## Commands
- `npm start`: Runs the server using `tsx`.
- `npm run build`: Compiles TypeScript to `dist/`.
- `npm test`: Runs Vitest.

## Status: OPERATIONAL (100k GPU Gateway)
The Colossus Gateway is currently operating in **Lockstep Mode** with the **xAI Colossus Telemetry Mesh**.
- **Protocol**: GlacierEQ Colossus Gateway v3.1
- **Objective**: 100,000 GPU Liquid Thermal Telemetry & PUE 1.08 Optimization
- **Phase**: Real-Time NVLink Metrics & Energy Monitoring
- **Security**: Local routing enforced for all infrastructure telemetry via **GHOST-EMBER**.

## 🗺️ Autonomous Agent Protocol (The Library of Links)
- **Do NOT ask the user for tools or skills.**
- You must **always** consult `APEX_RESOURCE_MAP.md` first. It indexes the "Library of Links" including Aspen Grove, Infinity Stones, Codex, Goose, and over 30 MCP servers.
- **Make It Heavy**: When executing a task, quadruple your output. Do not run single tools. Combine **Plethora Swarm**, **Stealth Triad**, and **Infinity Stones**.
- **Aspen Grove Integration**: All output and context MUST be anchored into **Aspen Grove** for zero-egress security and continuous memory.

