/**
 * dsh-memorix-tools / tools — turn advertised MCP tools into registry entries.
 *
 * Two conversions happen here, and only these two:
 *
 * - A server tool name becomes the model-facing `mcp__<serverName>__<rawName>`
 *   name, unchanged from what the stock MCP client produces. Keeping the names
 *   identical is deliberate: existing instructions that tell the agent to call
 *   `mcp__memorix__memorix_store` keep working when this plugin replaces that
 *   connection.
 * - A protocol result becomes the canonical value the registry validates plus
 *   the text the model reads. The value keeps `content` lossless so a
 *   programmatic caller still sees every block; the text joins the blocks a
 *   model can read.
 *
 * @module dsh-memorix-tools/tools
 */

import { createHash } from 'node:crypto';

/**
 * DeepSeek function-name contract: at most 64 characters. A wire-protocol
 * constant, not configuration.
 */
const MAX_PUBLIC_NAME_LENGTH = 64;

/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/gu;

/** Hex characters of the identity hash appended when normalization is lossy. */
const HASH_LENGTH = 12;

/**
 * Derive the model-facing name for one server tool.
 *
 * The clean case is `mcp__<serverName>__<rawName>` verbatim. When character
 * replacement or truncation changes the name, a 12-hex-character hash of the
 * identity is appended so two distinct tools can never collapse into one name.
 *
 * @param serverName - stable local namespace from plugin config.
 * @param rawName - the server's own tool name.
 * @returns the unique model-facing tool name.
 */
export function publicToolName(serverName, rawName) {
  const joined = `mcp__${serverName}__${rawName}`;
  const normalized = joined.replaceAll(INVALID_NAME_CHARS, '_');
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized;
  const hash = createHash('sha256').update(`${serverName}\u0000${rawName}`).digest('hex').slice(0, HASH_LENGTH);
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`;
}

/**
 * Render one MCP content array as the text a model reads.
 *
 * Text blocks are the normal case. Anything else is described rather than
 * dropped: a caller that receives an empty result cannot tell "the server had
 * nothing to say" from "this client discarded it".
 *
 * @param content - MCP content blocks.
 * @param toolName - server tool name, used in the description of skipped blocks.
 * @returns the joined text; empty when the array had no blocks.
 */
export function textOfContent(content, toolName) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block?.type === 'image') {
      parts.push(`[image block from "${toolName}" omitted: this client renders text only]`);
    } else if (block?.type === 'resource' || block?.type === 'resource_link') {
      const uri = block.resource?.uri ?? block.uri;
      parts.push(`[resource block from "${toolName}"${typeof uri === 'string' ? `: ${uri}` : ''}]`);
    } else {
      parts.push(`[unsupported ${String(block?.type ?? 'unknown')} block from "${toolName}"]`);
    }
  }
  return parts.join('\n');
}

/**
 * The canonical value one tool call produces, before the text projection.
 *
 * `content` is required and `structuredContent` is optional, matching what the
 * server returns today: memorix advertises no output schemas and answers with
 * content blocks only, and a future tool that adds structured output must not
 * be rejected by this schema.
 */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    content: { type: 'array', items: {} },
    structuredContent: {},
  },
  required: ['content'],
  additionalProperties: false,
};

/**
 * Build the registry definition for one server tool.
 *
 * @param options - the tool and how to run it.
 * @param options.publicName - model-facing name from {@link publicToolName}.
 * @param options.rawName - server tool name, sent on the wire only.
 * @param options.description - model-facing description from the server.
 * @param options.inputSchema - the server's JSON Schema for the arguments.
 * @param options.callTool - `(name, args, { projectRoot, signal }) => Promise<result>`.
 * @param options.projectRootOf - `(exec) => string`, resolving the calling
 *   session's project root; throws when it cannot.
 * @returns an unregistered tool definition.
 */
export function createToolDefinition({ publicName, rawName, description, inputSchema, callTool, projectRootOf }) {
  return {
    name: publicName,
    description,
    parameters: inputSchema,
    output: {
      schema: OUTPUT_SCHEMA,
      render(_args, value) {
        return [{ type: 'text', text: textOfContent(value?.content, rawName) }];
      },
    },
    async execute(args, exec) {
      const projectRoot = projectRootOf(exec);
      const result = await callTool(rawName, args, { projectRoot, signal: exec?.signal });
      const content = Array.isArray(result?.content) ? result.content : [];
      if (result?.isError === true) {
        const text = textOfContent(content, rawName);
        throw new Error(text === '' ? `${rawName} reported a failure without a message` : text);
      }
      const value = { content };
      if (result?.structuredContent !== undefined) value.structuredContent = result.structuredContent;
      return value;
    },
  };
}
