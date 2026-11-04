import { describe, expect, it } from "vitest";
import { RECORDING_ACTIONS, recordingUrl } from "../src/recording-links";
const expected = {
  "start-live": "tiro://notes/create/live-voice?background=true",
  "start-offline": "tiro://notes/create/offline-mode?background=true",
  "pause-live": "tiro://notes/pause/live-voice?background=true",
  "end-live": "tiro://notes/end/live-voice?background=true",
  "end-offline": "tiro://notes/end/offline-mode?background=true",
};
describe("2026-11-04 desktop 4.12.1 contract", () => {
  it("covers all five distinct operations", () => {
    expect([...RECORDING_ACTIONS].sort()).toEqual(Object.keys(expected).sort());
  });
  for (const action of RECORDING_ACTIONS) {
    it(action + " uses its own canonical route without legacy target or guid", () => {
      expect(recordingUrl(action)).toBe(expected[action]);
      const url = new URL(recordingUrl(action));
      expect([...url.searchParams.keys()]).toEqual(["background"]);
    });
  }
});
