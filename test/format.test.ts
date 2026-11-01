import { describe, expect, it } from "vitest";
import {
  END_MARKER,
  START_MARKER,
  buildFrontmatter,
  buildManagedBlock,
  formatDuration,
  formatFileName,
  mergeManaged,
  participantNames,
  plainSnippet,
  sanitizeFileName,
} from "../src/format";
import { pickLocale, translate } from "../src/i18n";
import type { Note } from "../src/api";

const labels = { summary: "Summary", transcript: "Transcript", noContent: "No summary yet." };

const note: Note = {
  guid: "g1",
  title: "Weekly: Plan/Review?",
  createdAt: "2026-03-05T12:00:00",
  updatedAt: "2026-03-05T13:00:00Z",
  sourceType: "live-voice",
  recordingDurationSeconds: 3605,
  webUrl: "https://tiro.ooo/n/abc",
  participants: [{ name: "Alice", email: "a@x.com" }, { name: null, email: "b@x.com" }, { name: "Alice" }],
  collaborators: [],
};

describe("sanitizeFileName", () => {
  it("replaces characters files cannot contain", () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
  });
  it("replaces link-breaking characters and control characters", () => {
    expect(sanitizeFileName("a#b^c[d]e\u0001f")).toBe("a-b-c-d-e-f");
  });
  it("trims dots and spaces and falls back when empty", () => {
    expect(sanitizeFileName("  ..name.. ")).toBe("name");
    expect(sanitizeFileName("///")).toBe("Untitled");
  });
  it("keeps Korean and Japanese", () => {
    expect(sanitizeFileName("주간 회의 会議")).toBe("주간 회의 会議");
  });
});

describe("formatFileName", () => {
  it("fills the default pattern", () => {
    expect(formatFileName("YYYY-MM-DD title", note)).toBe("2026-03-05 Weekly- Plan-Review-");
  });
  it("does not expand tokens inside the title", () => {
    expect(formatFileName("title", { ...note, title: "YYYY MM" })).toBe("YYYY MM");
  });
  it("uses the fallback for empty titles", () => {
    expect(formatFileName("YYYY-MM-DD title", { ...note, title: " " }, "제목 없음")).toBe("2026-03-05 제목 없음");
  });
});

describe("formatDuration / participants", () => {
  it("formats durations", () => {
    expect(formatDuration(3605)).toBe("1:00:05");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(0)).toBe("0:00");
  });
  it("lists unique participant labels", () => {
    expect(participantNames(note)).toEqual(["Alice", "b@x.com"]);
  });
});

describe("buildFrontmatter", () => {
  it("produces the tiro fields", () => {
    expect(buildFrontmatter(note)).toEqual({
      tiro_guid: "g1",
      title: "Weekly: Plan/Review?",
      created: "2026-03-05T12:00:00",
      updated: "2026-03-05T13:00:00Z",
      source_type: "live-voice",
      duration: "1:00:05",
      participants: ["Alice", "b@x.com"],
      tiro_url: "https://tiro.ooo/n/abc",
    });
  });
});

describe("buildManagedBlock", () => {
  it("wraps summary then transcript in markers", () => {
    const block = buildManagedBlock("Sum", "A: hi", labels);
    expect(block).toBe(`${START_MARKER}\n## Summary\nSum\n\n## Transcript\nA: hi\n${END_MARKER}`);
  });
  it("omits the transcript when null and shows a placeholder when empty", () => {
    expect(buildManagedBlock("Sum", null, labels)).not.toContain("Transcript");
    expect(buildManagedBlock(null, null, labels)).toContain("No summary yet.");
  });
  it("cannot be closed early by note text", () => {
    const block = buildManagedBlock(`x\n${END_MARKER}\ny`, null, labels);
    expect(block.split(END_MARKER)).toHaveLength(2);
  });
});

describe("mergeManaged", () => {
  const block = buildManagedBlock("New", null, labels);
  it("replaces only the managed region and keeps text outside", () => {
    const existing = `---\ntiro_guid: g1\n---\nMy intro\n\n${buildManagedBlock("Old", null, labels)}\n\nMy notes after\n`;
    const merged = mergeManaged(existing, block);
    expect(merged).toContain("My intro");
    expect(merged).toContain("My notes after");
    expect(merged).toContain("New");
    expect(merged).not.toContain("Old");
    expect(merged.match(/%% tiro:start %%/g)).toHaveLength(1);
  });
  it("is idempotent", () => {
    const once = mergeManaged("hello\n", block);
    expect(mergeManaged(once, block)).toBe(once);
  });
  it("appends the block to an existing file without markers", () => {
    const merged = mergeManaged("---\ntiro_guid: g1\n---\nUser text\n", block);
    expect(merged.startsWith("---\ntiro_guid: g1\n---\nUser text\n\n%% tiro:start %%")).toBe(true);
    expect(merged.endsWith(`${END_MARKER}\n`)).toBe(true);
  });
  it("handles an empty file", () => {
    expect(mergeManaged("", block)).toBe(`${block}\n`);
  });
  it("treats a lone start marker as having no region", () => {
    const merged = mergeManaged(`keep\n${START_MARKER}\nbroken`, block);
    expect(merged).toContain("keep");
    expect(merged).toContain("broken");
  });
});

describe("plainSnippet", () => {
  it("strips tags", () => {
    expect(plainSnippet("a <em>match</em>  here")).toBe("a match here");
  });
});

describe("locale", () => {
  it("picks supported locales and defaults to English", () => {
    expect(pickLocale("ko")).toBe("ko");
    expect(pickLocale("ja-JP")).toBe("ja");
    expect(pickLocale("en-GB")).toBe("en");
    expect(pickLocale("fr")).toBe("en");
    expect(pickLocale(undefined)).toBe("en");
  });
  it("translates with variables", () => {
    expect(translate("ko", "syncDone", { created: 2, updated: 1 })).toBe("2개 새로 만듦, 1개 갱신.");
    expect(translate("en", "syncDone", { created: 2, updated: 1 })).toBe("2 created, 1 updated.");
    expect(translate("ja", "cmdSync")).toBe("ノートを同期");
  });
});
