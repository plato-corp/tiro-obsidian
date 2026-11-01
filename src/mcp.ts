// Helpers for Tiro's MCP server (https://mcp.tiro.ooo/mcp), which speaks JSON-RPC over HTTP.
export const MCP_URL = "https://mcp.tiro.ooo/mcp";
export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface ToolResult {
  content?: { type: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface RpcMessage {
  id?: number;
  result?: ToolResult;
  error?: { code: number; message: string };
}

/** Reads a JSON-RPC reply that arrives either as plain JSON or as a server-sent event stream. */
export function parseRpcBody(text: string, contentType: string, id: number): RpcMessage {
  if (!contentType.includes("text/event-stream")) return JSON.parse(text) as RpcMessage;
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data) continue;
    const message = JSON.parse(data) as RpcMessage;
    if (message.id === id) return message;
  }
  throw new Error("Unexpected MCP response");
}

/** Case-insensitive header lookup (Obsidian's requestUrl returns headers as a plain object). */
export function header(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}
