import { requestUrl } from "obsidian";
import { MCP_PROTOCOL_VERSION, MCP_URL, header, parseRpcBody } from "./mcp";
import type { RpcMessage } from "./mcp";

export type Person = { name?: string | null; email?: string | null };

export interface Note {
  guid: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourceType: string;
  recordingDurationSeconds: number;
  webUrl: string;
  participants: Person[];
  collaborators: (Person & { role?: string })[];
  matchedSnippets?: string[] | null;
}

export type ApiErrorKind = "noKey" | "unauthorized" | "forbidden" | "rateLimited" | "other";

export class TiroApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: ApiErrorKind,
  ) {
    super(message);
    this.name = "TiroApiError";
  }
}

/** Translation hook so error text follows the interface language. */
export type ErrorText = (kind: ApiErrorKind, status: number, serverMessage?: string) => string;

export const defaultErrorText: ErrorText = (kind, status, serverMessage) => {
  switch (kind) {
    case "noKey":
      return "Sign in to Tiro or add an API key in the plugin options.";
    case "unauthorized":
      return "Tiro rejected your sign-in or API key. Sign in again in the plugin options.";
    case "forbidden":
      return "This account can't read these notes.";
    case "rateLimited":
      return "Too many requests. Try again in a minute.";
    default:
      return serverMessage || `Tiro returned an error (${status}).`;
  }
};

function kindOf(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "rateLimited";
  return "other";
}

interface RawNote extends Partial<Omit<Note, "guid">> {
  guid?: string;
  noteGuid?: string;
}

function toNote(raw: RawNote): Note {
  return {
    guid: raw.guid ?? raw.noteGuid ?? "",
    title: raw.title ?? "",
    createdAt: raw.createdAt ?? "",
    updatedAt: raw.updatedAt ?? raw.createdAt ?? "",
    sourceType: raw.sourceType ?? "",
    recordingDurationSeconds: raw.recordingDurationSeconds ?? 0,
    webUrl: raw.webUrl ?? "",
    participants: raw.participants ?? [],
    collaborators: raw.collaborators ?? [],
    matchedSnippets: raw.matchedSnippets ?? null,
  };
}

interface TranscriptSegment {
  content: string;
  speaker?: { label?: string; name?: string | null } | null;
}

interface TranscriptParagraph {
  locked?: boolean;
  segments?: TranscriptSegment[] | null;
}

/**
 * Reads notes through Tiro's MCP server. The bearer token is either a sign-in access token or an
 * account API key; the server accepts both. Returns null when the user is not signed in.
 */
export class TiroClient {
  private sessionId: string | undefined;
  private initialized: Promise<void> | undefined;
  private nextId = 1;

  constructor(
    private readonly getToken: () => Promise<string | null>,
    private readonly errorText: ErrorText = defaultErrorText,
  ) {}

  private fail(kind: ApiErrorKind, status: number, serverMessage?: string): TiroApiError {
    return new TiroApiError(this.errorText(kind, status, serverMessage), status, kind);
  }

  private async post(body: object): Promise<{ text: string; contentType: string }> {
    const token = await this.getToken();
    if (!token) throw this.fail("noKey", 401);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;

    const response = await requestUrl({ url: MCP_URL, method: "POST", headers, body: JSON.stringify(body), throw: false });
    if (response.status < 200 || response.status >= 300) throw this.fail(kindOf(response.status), response.status);
    this.sessionId = header(response.headers, "mcp-session-id") ?? this.sessionId;
    return { text: response.text ?? "", contentType: header(response.headers, "content-type") ?? "" };
  }

  private async rpc(method: string, params: object): Promise<RpcMessage> {
    const id = this.nextId++;
    const { text, contentType } = await this.post({ jsonrpc: "2.0", id, method, params });
    const message = parseRpcBody(text, contentType, id);
    if (message.error) throw this.fail("other", 500, message.error.message);
    return message;
  }

  private initialize(): Promise<void> {
    this.initialized ??= (async () => {
      await this.rpc("initialize", {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "tiro-obsidian", version: "0.2.0" },
      });
      await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    })().catch((error: unknown) => {
      this.initialized = undefined;
      throw error;
    });
    return this.initialized;
  }

  private async callTool<T>(name: string, args: object, retry = true): Promise<T> {
    try {
      await this.initialize();
      const { result } = await this.rpc("tools/call", { name, arguments: args });
      const text = result?.content?.find((item) => item.type === "text")?.text ?? "";
      if (result?.isError) {
        throw this.fail("other", /not found/i.test(text) ? 404 : 500, text || undefined);
      }
      return (result?.structuredContent ?? JSON.parse(text)) as T;
    } catch (error) {
      // An expired MCP session answers 404 to the call itself; start a new one once.
      if (retry && error instanceof TiroApiError && error.status === 404 && error.kind === "other") {
        this.sessionId = undefined;
        this.initialized = undefined;
        return this.callTool<T>(name, args, false);
      }
      throw error;
    }
  }

  /** Recent notes, following the cursor pages until `limit` notes are collected. */
  async listRecentNotes(limit = 30, pageSize = 50): Promise<Note[]> {
    const notes: Note[] = [];
    let cursor: string | null = null;
    do {
      const pagination: { size: number; cursor?: string } = { size: Math.min(pageSize, 100, limit - notes.length) };
      if (cursor) pagination.cursor = cursor;
      const page: { notes?: RawNote[]; nextCursor?: string | null } = await this.callTool("list_notes", { pagination });
      notes.push(...(page.notes ?? []).map(toNote));
      cursor = page.nextCursor ?? null;
    } while (cursor && notes.length < limit);
    return notes.slice(0, limit);
  }

  async searchNotes(keyword: string, size = 30): Promise<Note[]> {
    const result = await this.callTool<{ notes?: RawNote[] }>("list_notes", {
      query: { keyword },
      pagination: { size: Math.min(size, 100) },
    });
    return (result.notes ?? []).map(toNote);
  }

  async getNote(guid: string): Promise<Note> {
    return toNote(await this.callTool<RawNote>("get_note", { note: guid }));
  }

  /** The note's latest summary as markdown, or null when none exists yet. */
  async getSummaryMarkdown(guid: string): Promise<string | null> {
    const note = await this.callTool<{ summary?: { content?: string } | null }>("get_note", {
      note: guid,
      include: ["summary"],
    });
    return note.summary?.content?.trim() || null;
  }

  /** The transcript as "Speaker: text" blocks. */
  async getTranscript(guid: string): Promise<string> {
    const result = await this.callTool<{ paragraphs?: TranscriptParagraph[] }>("get_note_transcript", { note: guid });
    const lines: string[] = [];
    for (const paragraph of result.paragraphs ?? []) {
      if (paragraph.locked) continue;
      for (const segment of paragraph.segments ?? []) {
        const speaker = segment.speaker?.name || segment.speaker?.label;
        lines.push(speaker ? `${speaker}: ${segment.content}` : segment.content);
      }
    }
    return lines.join("\n\n");
  }

  /** The note's existing share link, or null when it hasn't been shared. */
  async getShareUrl(guid: string): Promise<string | null> {
    try {
      const result = await this.callTool<{ shareUrl?: string | null; url?: string | null }>("get_share_link", { note: guid });
      return result.shareUrl ?? result.url ?? null;
    } catch (error) {
      if (error instanceof TiroApiError && error.status === 404) return null;
      throw error;
    }
  }
}
