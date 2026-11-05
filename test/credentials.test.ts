import { describe, expect, it } from "vitest";
import { publicPluginData } from "../src/credentials";


describe("vault settings security", () => {
  it("persists only approved public settings, never credentials or server error bodies", () => {
    const settings = { syncFolder: "Tiro", includeTranscript: false, fileNameFormat: "title", syncOnStartup: false, syncIntervalMinutes: 0, apiKey: "fixture-api-key", auth: {
      clientId: "public-client", accessToken: "fixture-access", refreshToken: "fixture-refresh", email: "fixture-private-email",
    } };
    const saved = publicPluginData(settings, { at: 1, created: 1, updated: 0, failed: 1, error: "fixture-server-body" });
    expect(JSON.stringify(saved)).not.toContain("fixture-");
    expect(saved).toMatchObject({ auth: { clientId: "public-client" }, syncFolder: "Tiro" });
    expect(settings.apiKey).toBe("fixture-api-key");
  });
});
