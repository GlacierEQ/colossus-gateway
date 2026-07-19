import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getBridgeContext } from '../bridge/context.js';
import { executeTool } from '../bridge/toolBridge.js';

const nullableString = z.string().nullable().optional();
const connectorHandoff = {
  connector_content_base64: nullableString,
  connector_file_name: nullableString,
  connector_content_type: nullableString,
  connector_sha256: nullableString,
  connector_source: nullableString,
};
const response = async (name: string, args: Record<string, unknown>) => {
  const result = await executeTool(name, args, { ...getBridgeContext(), source: 'mcp' });
  return {
    isError: !result.ok,
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  };
};

export function registerBoxBridgeTools(server: McpServer) {
  server.tool('box_search', 'Search Box files and folders by keyword.', {
    query: z.string().min(1),
    type: z.enum(['file', 'folder', 'web_link']).nullable().optional(),
    ancestor_folder_id: nullableString,
    limit: z.number().int().min(1).max(200).nullable().optional(),
    file_extensions: z.array(z.string()).nullable().optional(),
  }, (args) => response('box_search', args));

  server.tool('box_get', 'Get Box metadata and optionally content through direct Box access, a delegated Box URL, or an approved connector handoff.', {
    item_id: z.string().min(1),
    item_type: z.enum(['file', 'folder']).nullable().optional(),
    include_content: z.boolean().default(false),
    max_bytes: z.number().int().min(1).max(20 * 1024 * 1024).nullable().optional(),
    delegated_download_url: nullableString,
    delegated_file_name: nullableString,
    ...connectorHandoff,
  }, (args) => response('box_get', args));

  server.tool('box_download', 'Download a Box file as bounded base64 with SHA-256 through direct Box access, a delegated Box URL, or an approved connector handoff.', {
    file_id: z.string().min(1),
    max_bytes: z.number().int().min(1).max(20 * 1024 * 1024).nullable().optional(),
    delegated_download_url: nullableString,
    delegated_file_name: nullableString,
    ...connectorHandoff,
  }, (args) => response('box_download', args));

  server.tool('box_create_folder', 'Create a Box folder.', {
    name: z.string().min(1).max(255),
    parent_folder_id: z.string().default('0'),
  }, (args) => response('box_create_folder', args));

  server.tool('box_create_document', 'Create a text document in Box.', {
    file_name: z.string().min(1), content: z.string(), parent_folder_id: z.string().default('0'), content_type: nullableString,
  }, (args) => response('box_create_document', args));

  server.tool('box_rename', 'Rename a Box file or folder.', {
    item_id: z.string(), item_type: z.enum(['file', 'folder']), new_name: z.string().min(1).max(255),
  }, (args) => response('box_rename', args));

  server.tool('box_move', 'Move a Box file or folder.', {
    item_id: z.string(), item_type: z.enum(['file', 'folder']), parent_folder_id: z.string(), new_name: nullableString,
  }, (args) => response('box_move', args));

  server.tool('box_upload', 'Upload text or base64 binary content to Box.', {
    file_name: z.string(), parent_folder_id: z.string().default('0'), text_content: nullableString, content_base64: nullableString, content_type: nullableString,
  }, (args) => response('box_upload', args));

  server.tool('box_spreadsheet_update', 'Update CSV, TSV, or XLSX cells and create a new Box file version.', {
    file_id: z.string(),
    sheet: z.union([z.string(), z.number().int()]).nullable().optional(),
    updates: z.array(z.object({
      cell: nullableString,
      row: z.number().int().min(1).nullable().optional(),
      column: z.number().int().min(1).nullable().optional(),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      sheet: z.union([z.string(), z.number().int()]).nullable().optional(),
    })).min(1),
  }, (args) => response('box_spreadsheet_update', args));

  server.tool('knowledge_retrieve', 'Retrieve matching Box and Notion records.', {
    query: z.string().min(1), limit: z.number().int().min(1).max(50).default(10), include_box: z.boolean().default(true), include_notion: z.boolean().default(true),
  }, (args) => response('knowledge_retrieve', args));

  server.tool('action_record', 'Record an action in Supabase and optional Notion.', {
    action: z.string().min(1), status: z.enum(['started', 'succeeded', 'failed', 'blocked']), target: z.record(z.string(), z.unknown()).nullable().optional(), metadata: z.record(z.string(), z.unknown()).nullable().optional(), error: nullableString,
  }, (args) => response('action_record', args));

  server.tool('audit_log', 'Write a structured audit event.', {
    event_type: z.string(), message: z.string(), status: z.enum(['started', 'succeeded', 'failed', 'blocked']), metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  }, (args) => response('audit_log', args));
}
