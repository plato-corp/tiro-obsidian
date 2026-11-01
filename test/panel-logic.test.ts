import { describe, expect, it } from "vitest";
import { buildSavedData, collectGuids, describeAge, parseLastSync, splitSavedData, summarizeSync } from "../src/panel-logic";

describe("describeAge", () => {
  const now = 1_000_000_000;
  it("handles each unit", () => {
    expect(describeAge(now, now - 10_000)).toEqual({ unit: "now", count: 0 });
    expect(describeAge(now, now - 3 * 60_000)).toEqual({ unit: "minutes", count: 3 });
    expect(describeAge(now, now - 5 * 3_600_000)).toEqual({ unit: "hours", count: 5 });
    expect(describeAge(now, now - 49 * 3_600_000)).toEqual({ unit: "days", count: 2 });
  });
  it("treats a future time as now", () => {
    expect(describeAge(now, now + 60_000).unit).toBe("now");
  });
});

describe("summarizeSync", () => {
  it("keeps created, updated and failed only", () => {
    expect(summarizeSync({ created: 2, updated: 1, failed: 3, skipped: 9 } as never)).toEqual({
      created: 2,
      updated: 1,
      failed: 3,
    });
  });
});

describe("collectGuids", () => {
  it("collects string tiro_guid values and skips the rest", () => {
    const set = collectGuids([{ tiro_guid: "a" }, { tiro_guid: "" }, { tiro_guid: 5 }, undefined, null, { x: 1 }, { tiro_guid: "a" }, { tiro_guid: "b" }]);
    expect([...set]).toEqual(["a", "b"]);
  });
});

describe("lastSync persistence", () => {
  const sync = { at: 5, created: 1, updated: 2, failed: 0 };
  it("round-trips and keeps other saved values", () => {
    const saved = buildSavedData({ apiKey: "k", auth: { a: 1 } }, sync);
    expect(saved).toEqual({ apiKey: "k", auth: { a: 1 }, lastSync: sync });
    const { settings, lastSync } = splitSavedData(saved);
    expect(settings).toEqual({ apiKey: "k", auth: { a: 1 } });
    expect(lastSync).toEqual(sync);
  });
  it("omits lastSync when none and drops malformed data", () => {
    expect(buildSavedData({ x: 1 }, null)).toEqual({ x: 1 });
    expect(parseLastSync({ lastSync: { at: "no" } })).toBeNull();
    expect(parseLastSync(null)).toBeNull();
    expect(parseLastSync({ lastSync: { ...sync, error: "boom" } })).toEqual({ ...sync, error: "boom" });
  });
});
