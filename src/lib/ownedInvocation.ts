export type ContextLaneState = 'retrieved' | 'empty' | 'unavailable';

export interface InvocationInput {
  prompt: string;
  model: string;
  system?: string;
  requireProvider?: boolean;
}

export interface InvocationDependencies {
  recoverMemory: (prompt: string) => Promise<unknown>;
  recoverNotion: (prompt: string) => Promise<unknown>;
  callModel: (request: { prompt: string; model: string; system?: string }) => Promise<{
    model?: string;
    text: string;
  }>;
}

export interface ContextLane {
  source: 'memory' | 'notion';
  state: ContextLaneState;
  value?: unknown;
  error?: string;
}

const RUNTIME_CONTRACT = [
  'CURRENT OPERATOR MESSAGE CONTROLS MISSION DIRECTION.',
  'RECOVER AND APPLY RELEVANT CONTINUITY BEFORE DISCRETIONARY REASONING.',
  'RECOVERED CONTEXT INFORMS THE WORK; IT DOES NOT REPLACE THE LITERAL OPERATOR MESSAGE.',
  'TRUTH CONTROLS FACTUAL CLAIMS. VERIFICATION MEASURES EXECUTION; IT DOES NOT BECOME PROJECT AUTHORITY.',
  'MISSING OR PARTIAL CONTEXT IS TELEMETRY. CONTINUE THE STRONGEST REVERSIBLE OPERATOR-ALIGNED ROUTE.',
  'DO NOT TURN REASONING, GOVERNANCE, PROOF, OR RETRIEVAL INTO A GLOBAL PERMISSION GATE.',
  'WHEN A ROUTE IS BLOCKED, CHANGE THE ROUTE RATHER THAN SILENTLY SHRINKING THE OBJECTIVE.',
].join('\n');

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasMaterialValue(source: ContextLane['source'], value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (source === 'memory' && typeof value === 'object') {
    const record = value as { results?: unknown };
    if (Array.isArray(record.results)) return record.results.length > 0;
    if (record.results && typeof record.results === 'object') {
      return Object.values(record.results as Record<string, unknown>).some((item) => Array.isArray(item) && item.length > 0);
    }
  }
  if (source === 'notion' && typeof value === 'object') {
    const record = value as { ok?: boolean; result?: { results?: unknown[] } };
    return record.ok === true && Array.isArray(record.result?.results) && record.result!.results!.length > 0;
  }
  return true;
}

async function recoverLane(
  source: ContextLane['source'],
  recover: () => Promise<unknown>,
): Promise<ContextLane> {
  try {
    const value = await recover();
    if (source === 'notion' && typeof value === 'object' && value !== null && (value as { ok?: boolean }).ok === false) {
      const failure = value as { error?: { message?: string } };
      return { source, state: 'unavailable', error: failure.error?.message || 'provider returned an unavailable state' };
    }
    return {
      source,
      state: hasMaterialValue(source, value) ? 'retrieved' : 'empty',
      value,
    };
  } catch (error) {
    return { source, state: 'unavailable', error: errorText(error) };
  }
}

export function buildOwnedPrompt(prompt: string, lanes: ContextLane[]): string {
  const context = lanes.map((lane) => {
    if (lane.state === 'unavailable') {
      return `<lane source="${lane.source}" state="unavailable">${lane.error || 'unavailable'}</lane>`;
    }
    return `<lane source="${lane.source}" state="${lane.state}">\n${JSON.stringify(lane.value ?? null)}\n</lane>`;
  }).join('\n');

  return [
    '<glaciereq_runtime>',
    RUNTIME_CONTRACT,
    '<context_recovery>',
    context,
    '</context_recovery>',
    '</glaciereq_runtime>',
    '<operator_message>',
    prompt,
    '</operator_message>',
  ].join('\n');
}

export async function hydrateOwnedContext(
  input: Pick<InvocationInput, 'prompt' | 'requireProvider'>,
  dependencies: Pick<InvocationDependencies, 'recoverMemory' | 'recoverNotion'>,
) {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('prompt is required');

  const lanes = await Promise.all([
    recoverLane('memory', () => dependencies.recoverMemory(prompt)),
    recoverLane('notion', () => dependencies.recoverNotion(prompt)),
  ]);
  const providerRetrieved = lanes.some((lane) => lane.state === 'retrieved');

  if (input.requireProvider === true && !providerRetrieved) {
    throw new Error('explicit provider context requirement was not satisfied');
  }

  const errors = lanes
    .filter((lane) => lane.state === 'unavailable')
    .map((lane) => `${lane.source}: ${lane.error || 'unavailable'}`);
  const contextMode = providerRetrieved ? 'full' : 'degraded';
  return {
    prompt,
    lanes,
    providerRetrieved,
    errors,
    contextMode,
    hydratedPrompt: buildOwnedPrompt(prompt, lanes),
  };
}

export async function invokeOwnedModel(
  input: InvocationInput,
  dependencies: InvocationDependencies,
) {
  const model = input.model.trim();
  if (!model) throw new Error('model is required');

  const hydrated = await hydrateOwnedContext(input, dependencies);
  const system = [RUNTIME_CONTRACT, input.system?.trim()].filter(Boolean).join('\n\n');

  const response = await dependencies.callModel({
    prompt: hydrated.hydratedPrompt,
    model,
    system,
  });
  if (!response?.text?.trim()) throw new Error('model provider returned an empty response');

  return {
    schema: 'glaciereq.owned-model-invocation.v1',
    status: 'completed' as const,
    invocation_owned: true,
    model: response.model || model,
    response: response.text,
    context_mode: hydrated.contextMode,
    provider_retrieved: hydrated.providerRetrieved,
    context: {
      lanes: hydrated.lanes,
      errors: hydrated.errors,
    },
  };
}

export { RUNTIME_CONTRACT };
