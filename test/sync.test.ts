import { beforeEach, describe, expect, it } from "vitest";
import { stub } from "./obsidian-stub";
import type { StubRequest, StubResponse } from "./obsidian-stub";
import { TiroApiError, TiroClient } from "../src/api";
import { NoteSyncer } from "../src/sync";
import type { SyncHost, SyncOptions } from "../src/sync";
import { mergeManaged } from "../src/format";
import type { TFile } from "obsidian";

type Fm = Record<string, unknown>;
interface FakeFile {
  path: string;
  data: string;
  fm: Fm;
}

class FakeVault {
  files = new Map<string, FakeFile>();
  folders = new Set<string>();
  asTFile(f: FakeFile): TFile {
    return f as unknown as TFile;
  }
  host(): SyncHost {
    return {
      vault: {
        getMarkdownFiles: () => [...this.files.values()].map((f) => this.asTFile(f)),
        getAbstractFileByPath: (p: string) => this.files.get(p) ?? (this.folders.has(p) ? {} : null),
        create: (p: string, data: string) => {
          const f = { path: p, data, fm: {} };
          this.files.set(p, f);
          return Promise.resolve(this.asTFile(f));
        },
        createFolder: (p: string) => {
          this.folders.add(p);
          return Promise.resolve({});
        },
        process: (file: TFile, fn: (d: string) => string) => {
          const f = file as unknown as FakeFile;
          f.data = fn(f.data);
          return Promise.resolve(f.data);
        },
      },
      metadataCache: { getFileCache: (file: TFile) => ({ frontmatter: (file as unknown as FakeFile).fm }) },
      fileManager: {
        processFrontMatter: (file: TFile, fn: (fm: Fm) => void) => {
          fn((file as unknown as FakeFile).fm);
          return Promise.resolve();
        },
      },
    };
  }
}

const options: SyncOptions = {
  folder: "Tiro",
  fileNameFormat: "YYYY-MM-DD title",
  includeTranscript: false,
  untitled: "Untitled",
  labels: { summary: "Summary", transcript: "Transcript", noContent: "None" },
};

function mkNote(guid: string, title: string, updatedAt: string) {
  return {
    guid,
    title,
    createdAt: "2026-03-05T12:00:00",
    updatedAt,
    sourceType: "live-voice",
    recordingDurationSeconds: 60,
    webUrl: `https://tiro.ooo/n/${guid}`,
    participants: [],
    collaborators: [],
  };
}

let notes = [mkNote("a", "Alpha", "u1"), mkNote("b", "Beta", "u1")];

function ok(json: unknown) {
  return { status: 200, json };
}

interface ToolCall {
  name: string;
  args: Record<string, any>;
}

function toolCalls(): ToolCall[] {
  return stub.calls
    .map((c) => JSON.parse(c.body ?? "{}") as { method?: string; params?: { name: string; arguments: Record<string, any> } })
    .filter((b) => b.method === "tools/call")
    .map((b) => ({ name: b.params!.name, args: b.params!.arguments }));
}

function toolText(id: number, structured: unknown) {
  const message = { jsonrpc: "2.0", id, result: { structuredContent: structured } };
  return { status: 200, json: message, text: JSON.stringify(message), headers: { "Content-Type": "application/json" } };
}

function toolError(id: number, text: string) {
  const message = { jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text }] } };
  return { status: 200, json: message, text: JSON.stringify(message), headers: { "Content-Type": "application/json" } };
}

function wire(note: ReturnType<typeof mkNote>) {
  const { guid, ...rest } = note;
  return { noteGuid: guid, ...rest };
}

function handler(req: StubRequest) {
  const body = JSON.parse(req.body ?? "{}") as {
    id?: number;
    method?: string;
    params?: { name: string; arguments: Record<string, any> };
  };
  if (body.method === "initialize") {
    const message = { jsonrpc: "2.0", id: body.id, result: {} };
    return { status: 200, json: message, text: JSON.stringify(message), headers: { "mcp-session-id": "S1" } };
  }
  if (body.method === "notifications/initialized") return { status: 202, json: null, text: "" };
  const id = body.id as number;
  const { name, arguments: args } = body.params!;
  if (name === "list_notes") {
    return args.pagination?.cursor
      ? toolText(id, { notes: [wire(notes[1])], nextCursor: null })
      : toolText(id, { notes: [wire(notes[0])], nextCursor: "c2" });
  }
  if (name === "get_note") {
    const note = notes.find((n) => n.guid === args.note);
    if (!note) return toolError(id, "Note not found");
    return toolText(id, args.include ? { ...wire(note), summary: { content: `Summary of ${note.guid}`, format: "markdown" } } : wire(note));
  }
  if (name === "get_note_transcript") {
    return toolText(id, {
      paragraphs: [
        { locked: true, segments: [{ content: "secret" }] },
        { segments: [{ content: "hello", speaker: { label: "S1", name: "Kim" } }] },
      ],
    });
  }
  if (name === "get_share_link") return toolError(id, "Share link not found");
  return { status: 404, json: {} };
}

let vault: FakeVault;
let syncer: NoteSyncer;
let opts: SyncOptions;

beforeEach(() => {
  notes = [mkNote("a", "Alpha", "u1"), mkNote("b", "Beta", "u1")];
  stub.calls = [];
  stub.handler = handler;
  vault = new FakeVault();
  opts = { ...options };
  syncer = new NoteSyncer(vault.host(), new TiroClient(() => Promise.resolve("key123")), () => opts);
});

describe("syncRecent", () => {
  it("creates new notes, follows cursor pages and sends the bearer key", async () => {
    const result = await syncer.syncRecent();
    expect(result).toMatchObject({ created: 2, updated: 0, skipped: 0, failed: 0 });
    const file = vault.files.get("Tiro/2026-03-05 Alpha.md")!;
    expect(file.data).toContain("Summary of a");
    expect(file.fm).toMatchObject({ tiro_guid: "a", updated: "u1", tiro_url: "https://tiro.ooo/n/a" });
    expect(stub.calls[0].headers?.Authorization).toBe("Bearer key123");
    expect(stub.calls.some((c) => c.headers?.["Mcp-Session-Id"] === "S1")).toBe(true);
    expect(vault.folders.has("Tiro")).toBe(true);
  });

  it("skips unchanged notes and updates changed ones, keeping user text", async () => {
    await syncer.syncRecent();
    const alpha = vault.files.get("Tiro/2026-03-05 Alpha.md")!;
    alpha.data = `My own intro\n\n${alpha.data}\nMy own outro\n`;
    notes[0] = mkNote("a", "Alpha", "u2");
    stub.calls = [];
    const result = await syncer.syncRecent();
    expect(result).toMatchObject({ created: 0, updated: 1, skipped: 1 });
    expect(alpha.fm.updated).toBe("u2");
    expect(alpha.data).toContain("My own intro");
    expect(alpha.data).toContain("My own outro");
    expect(alpha.data.match(/tiro:start/g)).toHaveLength(1);
    // The unchanged note triggered no summary request.
    expect(toolCalls().some((c) => c.name === "get_note" && c.args.note === "b")).toBe(false);
  });

  it("includes the transcript when enabled and skips locked paragraphs", async () => {
    opts.includeTranscript = true;
    await syncer.syncRecent();
    const data = vault.files.get("Tiro/2026-03-05 Alpha.md")!.data;
    expect(data).toContain("## Transcript\nKim: hello");
    expect(data).not.toContain("secret");
  });

  it("finds an existing file by tiro_guid wherever it lives", async () => {
    const moved: FakeFile = { path: "Elsewhere/renamed.md", data: "mine\n", fm: { tiro_guid: "a", updated: "old" } };
    vault.files.set(moved.path, moved);
    const result = await syncer.syncRecent();
    expect(result).toMatchObject({ created: 1, updated: 1 });
    expect(moved.data).toContain("mine");
    expect(moved.data).toContain("Summary of a");
  });

  it("avoids file name collisions", async () => {
    vault.files.set("Tiro/2026-03-05 Alpha.md", { path: "Tiro/2026-03-05 Alpha.md", data: "x", fm: {} });
    vault.folders.add("Tiro");
    await syncer.syncRecent();
    expect(vault.files.has("Tiro/2026-03-05 Alpha (2).md")).toBe(true);
  });

  it("refuses to run twice at once", async () => {
    const first = syncer.syncRecent();
    expect(syncer.busy).toBe(true);
    expect(await syncer.syncRecent()).toBeNull();
    await first;
    expect(syncer.busy).toBe(false);
  });

  it("stops on a rejected key", async () => {
    stub.handler = () => ({ status: 401, json: {} });
    const result = await syncer.syncRecent().catch((e: unknown) => e);
    expect(result).toBeInstanceOf(TiroApiError);
    expect((result as TiroApiError).message).toContain("rejected");
  });

  it("counts per-note server errors as failures and continues", async () => {
    stub.handler = (req) => {
      const body = JSON.parse(req.body ?? "{}") as { id?: number; params?: { name: string; arguments: { note?: string } } };
      return body.params?.name === "get_note" && body.params.arguments.note === "a" ? toolError(body.id as number, "boom") : handler(req);
    };
    const result = await syncer.syncRecent();
    expect(result).toMatchObject({ created: 1, failed: 1 });
  });

  it("stops early on rate limiting", async () => {
    stub.handler = (req) => {
      const body = JSON.parse(req.body ?? "{}") as { params?: { name: string; arguments: { include?: string[] } } };
      return body.params?.name === "get_note" && body.params.arguments.include ? { status: 429, json: {} } : handler(req);
    };
    const result = await syncer.syncRecent();
    expect(result?.fatal?.kind).toBe("rateLimited");
    expect(result?.fatal?.message).toContain("Too many requests");
  });
});

describe("syncOne", () => {
  it("refreshes a note even when it looks unchanged", async () => {
    await syncer.syncRecent();
    const first = await syncer.syncOne("a");
    expect(first?.outcome).toBe("updated");
    expect(first?.file.path).toBe("Tiro/2026-03-05 Alpha.md");
  });
});

describe("client", () => {
  it("reports a missing token without calling the network", async () => {
    const client = new TiroClient(() => Promise.resolve(null));
    await expect(client.getNote("a")).rejects.toMatchObject({ kind: "noKey" });
    expect(stub.calls).toHaveLength(0);
  });
  it("returns null for an unshared note", async () => {
    const client = new TiroClient(() => Promise.resolve("k"));
    expect(await client.getShareUrl("a")).toBeNull();
  });
  it("searches with a keyword and a capped page size", async () => {
    stub.handler = (req) => {
      const body = JSON.parse(req.body ?? "{}") as { id?: number; method?: string };
      return body.method === "tools/call" ? toolText(body.id as number, { notes: [] }) : handler(req);
    };
    await new TiroClient(() => Promise.resolve("k")).searchNotes("hi", 999);
    expect(toolCalls()[0]).toEqual({ name: "list_notes", args: { query: { keyword: "hi" }, pagination: { size: 100 } } });
  });
  it("reads SSE replies and starts a new session after an expired one", async () => {
    let sessions = 0;
    let first = true;
    stub.handler = (req): StubResponse => {
      const body = JSON.parse(req.body ?? "{}") as { id?: number; method?: string };
      if (body.method === "initialize") {
        sessions += 1;
        const message = { jsonrpc: "2.0", id: body.id, result: {} };
        return { status: 200, json: message, text: `event: message\ndata: ${JSON.stringify(message)}\n\n`, headers: { "Content-Type": "text/event-stream", "Mcp-Session-Id": `S${sessions}` } };
      }
      if (body.method === "notifications/initialized") return { status: 202, json: null, text: "" };
      if (first) {
        first = false;
        return { status: 404, json: {}, text: "" };
      }
      const message = { jsonrpc: "2.0", id: body.id, result: { structuredContent: { notes: [wire(notes[0])] } } };
      return { status: 200, json: message, text: `event: message\ndata: ${JSON.stringify(message)}\n\n`, headers: { "content-type": "text/event-stream; charset=utf-8" } };
    };
    const found = await new TiroClient(() => Promise.resolve("k")).searchNotes("x");
    expect(found.map((n) => n.guid)).toEqual(["a"]);
    expect(sessions).toBe(2);
  });
});

describe("merge helper sanity", () => {
  it("is used by the syncer", () => {
    expect(mergeManaged("", "%% tiro:start %%\nx\n%% tiro:end %%")).toContain("x");
  });
});
