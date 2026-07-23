#!/usr/bin/env node

const requiredAny = (names, label) => {
  if (!names.some((name) => process.env[name]?.trim())) {
    throw new Error(`${label}: set one of ${names.join(", ")}`);
  }
};

requiredAny(["COLOSSUS_OPERATOR_CODE", "COLOSSUS_OPERATOR_GUID", "COLOSSUS_TOOL_KEY"], "Gateway authentication");

const composioKey = process.env.COMPOSIO_API_KEY?.trim();
const composioTools = (process.env.COMPOSIO_ALLOWED_TOOLS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
if (composioKey && (composioTools.length === 0 || composioTools.includes("*"))) {
  throw new Error("Composio is enabled but COMPOSIO_ALLOWED_TOOLS is empty or contains '*'; use exact tool slugs.");
}

const remoteTools = (process.env.COLOSSUS_ALLOWED_REMOTE_TOOLS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
if (remoteTools.includes("*")) throw new Error("COLOSSUS_ALLOWED_REMOTE_TOOLS must not contain '*'.");

if (!process.env.MEM0_API_KEY?.trim() && !process.env.SUPERMEMORY_API_KEY?.trim()) {
  console.warn("Warning: no memory provider key configured; memory tools will be unavailable.");
}

console.log("Colossus configuration preflight passed.");
