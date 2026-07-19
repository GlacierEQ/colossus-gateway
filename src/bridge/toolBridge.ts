import { randomUUID } from 'node:crypto';
import { auditLedger } from './audit.js';
import { BoxApiError, BoxClient } from './boxClient.js';
import type { BridgeRequestContext } from './context.js';

export interface ToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
}

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function', name: 'box_search', strict: true,
    description: 'Search Box files and folders by keyword with optional type, folder, extension, and limit filters.',
    parameters: object({
      query: { type: 'string', minLength: 1 },
      type: { type: ['string', 'null'], enum: ['file', 'folder', 'web_link', null] },
      ancestor_folder_id: { type: ['string', 'null'] },
      limit: { type: ['integer', 'null'], minimum: 1, maximum: 200 },
      file_extensions: { type: ['array', 'null'], items: { type: 'string' } },
    }, ['query', 'type', 'ancestor_folder_id', 'limit', 'file_extensions']),
  },
  {
    type: 'function', name: 'box_get', strict: true,
    description: 'Get Box file or folder metadata. A delegated one-use Box download URL can provide bounded content retrieval.',
    parameters: object({
      item_id: { type: 'string', minLength: 1 },
      item_type: { type: ['string', 'null'], enum: ['file', 'folder', null] },
      include_content: { type: 'boolean' },
      max_bytes: { type: ['integer', 'null'], minimum: 1, maximum: 20971520 },
      delegated_download_url: { type: ['string', 'null'] },
      delegated_file_name: { type: ['string', 'null'] },
    }, ['item_id', 'item_type', 'include_content', 'max_bytes', 'delegated_download_url', 'delegated_file_name']),
  },
  {
    type: 'function', name: 'box_download', strict: true,
    description: 'Download a Box file and return base64 bytes, content type, size, file name, and SHA-256. Limited to 20 MB.',
    parameters: object({
      file_id: { type: 'string', minLength: 1 },
      max_bytes: { type: ['integer', 'null'], minimum: 1, maximum: 20971520 },
      delegated_download_url: { type: ['string', 'null'] },
      delegated_file_name: { type: ['string', 'null'] },
    }, ['file_id', 'max_bytes', 'delegated_download_url', 'delegated_file_name']),
  },
  {
    type: 'function', name: 'box_create_folder', strict: true,
    description: 'Create a folder in Box.',
    parameters: object({ name: { type: 'string', minLength: 1, maxLength: 255 }, parent_folder_id: { type: 'string' } }, ['name', 'parent_folder_id']),
  },
  {
    type: 'function', name: 'box_create_document', strict: true,
    description: 'Create a text, Markdown, CSV, JSON, HTML, XML, SVG, JavaScript, TypeScript, Python, or shell document in Box.',
    parameters: object({
      file_name: { type: 'string', minLength: 1 }, content: { type: 'string' }, parent_folder_id: { type: 'string' }, content_type: { type: ['string', 'null'] },
    }, ['file_name', 'content', 'parent_folder_id', 'content_type']),
  },
  {
    type: 'function', name: 'box_rename', strict: true,
    description: 'Rename a Box file or folder without changing its item ID.',
    parameters: object({ item_id: { type: 'string' }, item_type: { type: 'string', enum: ['file', 'folder'] }, new_name: { type: 'string', minLength: 1, maxLength: 255 } }, ['item_id', 'item_type', 'new_name']),
  },
  {
    type: 'function', name: 'box_move', strict: true,
    description: 'Move a Box file or folder to another parent folder, optionally renaming it.',
    parameters: object({ item_id: { type: 'string' }, item_type: { type: 'string', enum: ['file', 'folder'] }, parent_folder_id: { type: 'string' }, new_name: { type: ['string', 'null'] } }, ['item_id', 'item_type', 'parent_folder_id', 'new_name']),
  },
  {
    type: 'function', name: 'box_upload', strict: true,
    description: 'Upload a new text or base64-encoded binary file to Box.',
    parameters: object({
      file_name: { type: 'string' }, parent_folder_id: { type: 'string' }, text_content: { type: ['string', 'null'] }, content_base64: { type: ['string', 'null'] }, content_type: { type: ['string', 'null'] },
    }, ['file_name', 'parent_folder_id', 'text_content', 'content_base64', 'content_type']),
  },
  {
    type: 'function', name: 'box_spreadsheet_update', strict: true,
    description: 'Update cells in an existing Box CSV, TSV, or XLSX file and upload a new file version.',
    parameters: object({
      file_id: { type: 'string' },
      sheet: { type: ['string', 'integer', 'null'] },
      updates: {
        type: 'array', minItems: 1,
        items: object({
          cell: { type: ['string', 'null'] }, row: { type: ['integer', 'null'], minimum: 1 }, column: { type: ['integer', 'null'], minimum: 1 }, value: { type: ['string', 'number', 'boolean', 'null'] }, sheet: { type: ['string', 'integer', 'null'] },
        }, ['cell', 'row', 'column', 'value', 'sheet']),
      },
    }, ['file_id', 'sheet', 'updates']),
  },
  {
    type: 'function', name: 'knowledge_retrieve', strict: true,
    description: 'Retrieve matching records from Box and Notion in one governed call.',
    parameters: object({ query: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 50 }, include_box: { type: 'boolean' }, include_notion: { type: 'boolean' } }, ['query', 'limit', 'include_box', 'include_notion']),
  },
  {
    type: 'function', name: 'action_record', strict: true,
    description: 'Record an action, target, status, and bounded metadata in Supabase and optional Notion.',
    parameters: object({ action: { type: 'string', minLength: 1 }, status: { type: 'string', enum: ['started', 'succeeded', 'failed', 'blocked'] }, target: { type: ['object', 'null'], additionalProperties: true }, metadata: { type: ['object', 'null'], additionalProperties: true }, error: { type: ['string', 'null'] } }, ['action', 'status', 'target', 'metadata', 'error']),
  },
  {
    type: 'function', name: 'audit_log', strict: true,
    description: 'Write a structured audit event without executing an external file operation.',
    parameters: object({ event_type: { type: 'string' }, message: { type: 'string' }, status: { type: 'string', enum: ['started', 'succeeded', 'failed', 'blocked'] }, metadata: { type: ['object', 'null'], additionalProperties: true } }, ['event_type', 'message', 'status', 'metadata']),
  },
];

function targetFromArgs(name: string, args: Record<string, any>) {
  return {
    provider: name.startsWith('box_') ? 'box' : name.startsWith('knowledge_') ? 'multi' : 'ledger',
    item_id: args.item_id || args.file_id,
    parent_folder_id: args.parent_folder_id,
    query: args.query,
  };
}

function boxToken(context: BridgeRequestContext): string | undefined {
  return context.boxAccessToken || process.env.BOX_ACCESS_TOKEN;
}

async function capabilityResult(args: Record<string, any>) {
  if (!args.delegated_download_url) return null;
  const result = await BoxClient.downloadCapability(
    args.delegated_download_url,
    args.delegated_file_name || `box-${args.item_id || args.file_id}`,
    args.max_bytes || 20 * 1024 * 1024,
  );
  return {
    file_name: result.fileName,
    content_type: result.contentType,
    size: result.bytes.length,
    sha256: result.sha256,
    base64: result.bytes.toString('base64'),
    text: /^text\//.test(result.contentType) || /\.(md|txt|csv|tsv|json|xml|html|js|ts|py|sh)$/i.test(result.fileName)
      ? result.bytes.toString('utf8')
      : undefined,
    delegated_capability: true,
  };
}

export async function executeTool(name: string, args: Record<string, any>, context: BridgeRequestContext = {}) {
  const requestId = context.requestId || randomUUID();
  const startedAt = new Date().toISOString();
  if (!TOOL_DEFINITIONS.some((tool) => tool.name === name)) throw new Error(`Unknown tool: ${name}`);

  if (name !== 'audit_log' && name !== 'action_record') {
    await auditLedger.record({ requestId, action: name, status: 'started', actor: context.actor, source: context.source, target: targetFromArgs(name, args), arguments: args, startedAt });
  }

  try {
    let result: unknown;
    switch (name) {
      case 'box_search': result = await new BoxClient(boxToken(context)).search(args as any); break;
      case 'box_get': {
        const delegated = await capabilityResult(args);
        if (delegated) result = { item_id: args.item_id, content: delegated };
        else {
          const client = new BoxClient(boxToken(context));
          const metadata = await client.get(args as any);
          const content = args.include_content && args.item_type !== 'folder'
            ? await client.downloadRaw(args.item_id, args.max_bytes || 20 * 1024 * 1024).then((download) => ({
                file_name: download.fileName,
                content_type: download.contentType,
                size: download.bytes.length,
                sha256: download.sha256,
                base64: download.bytes.toString('base64'),
                text: /^text\//.test(download.contentType) ? download.bytes.toString('utf8') : undefined,
              }))
            : undefined;
          result = { metadata, content };
        }
        break;
      }
      case 'box_download': {
        const delegated = await capabilityResult(args);
        if (delegated) result = delegated;
        else {
          const download = await new BoxClient(boxToken(context)).downloadRaw(args.file_id, args.max_bytes || 20 * 1024 * 1024);
          result = { file_id: args.file_id, file_name: download.fileName, content_type: download.contentType, size: download.bytes.length, sha256: download.sha256, base64: download.bytes.toString('base64') };
        }
        break;
      }
      case 'box_create_folder': result = await new BoxClient(boxToken(context)).createFolder(args.name, args.parent_folder_id); break;
      case 'box_create_document': result = await new BoxClient(boxToken(context)).createDocument(args as any); break;
      case 'box_rename': result = await new BoxClient(boxToken(context)).rename(args as any); break;
      case 'box_move': result = await new BoxClient(boxToken(context)).move(args as any); break;
      case 'box_upload': result = await new BoxClient(boxToken(context)).upload(args as any); break;
      case 'box_spreadsheet_update': result = await new BoxClient(boxToken(context)).updateSpreadsheet(args as any); break;
      case 'knowledge_retrieve': {
        const limit = Math.min(Math.max(args.limit || 10, 1), 50);
        const [box, notion] = await Promise.all([
          args.include_box ? new BoxClient(boxToken(context)).search({ query: args.query, limit }).catch((error) => ({ error: error instanceof Error ? error.message : String(error) })) : Promise.resolve(null),
          args.include_notion ? auditLedger.retrieveNotion(args.query, limit) : Promise.resolve(null),
        ]);
        result = { query: args.query, box, notion };
        break;
      }
      case 'action_record':
        result = await auditLedger.record({ requestId, action: args.action, status: args.status, actor: context.actor, source: context.source, target: args.target, arguments: args.metadata, error: args.error || undefined, startedAt, completedAt: new Date().toISOString() });
        break;
      case 'audit_log':
        result = await auditLedger.record({ requestId, action: args.event_type, status: args.status, actor: context.actor, source: context.source, arguments: { message: args.message, metadata: args.metadata }, startedAt, completedAt: new Date().toISOString() });
        break;
      default: throw new Error(`Tool is not implemented: ${name}`);
    }

    if (name !== 'audit_log' && name !== 'action_record') {
      const audit = await auditLedger.record({ requestId, action: name, status: 'succeeded', actor: context.actor, source: context.source, target: targetFromArgs(name, args), arguments: args, result, startedAt, completedAt: new Date().toISOString() });
      return { ok: true as const, request_id: requestId, tool: name, result, audit };
    }
    return { ok: true as const, request_id: requestId, tool: name, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof BoxApiError && [401, 403, 409, 412, 413, 415, 503].includes(error.status) ? 'blocked' : 'failed';
    const audit = await auditLedger.record({ requestId, action: name, status, actor: context.actor, source: context.source, target: targetFromArgs(name, args), arguments: args, error: message, startedAt, completedAt: new Date().toISOString() });
    return {
      ok: false as const,
      request_id: requestId,
      tool: name,
      error: { message, status: error instanceof BoxApiError ? error.status : 500, payload: error instanceof BoxApiError ? error.payload : undefined },
      audit,
    };
  }
}
