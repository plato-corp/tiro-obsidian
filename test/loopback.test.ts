import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { LOOPBACK_PORTS, redirectUriFor, startLoopback } from "../src/loopback";

const get = (url: string) => fetch(url).then(async (r) => ({ status: r.status, body: await r.text() }));
const PORTS = [38651, 38652];

describe("loopback listener", () => {
  it("uses fixed redirect URIs on 127.0.0.1", () => {
    expect(redirectUriFor(LOOPBACK_PORTS[0])).toBe(`http://127.0.0.1:${LOOPBACK_PORTS[0]}/callback`);
    expect(LOOPBACK_PORTS.length).toBeGreaterThan(1);
  });

  it("receives the code once, answers with a return page and closes the server", async () => {
    const listener = await startLoopback("st", { ports: PORTS });
    expect(listener.port).toBe(PORTS[0]);
    const reply = await get(`${listener.redirectUri}?code=abc&state=st`);
    expect(reply.status).toBe(200);
    expect(reply.body).toContain("Return to Obsidian");
    expect(await listener.waitForCode()).toBe("abc");
    await expect(get(`${listener.redirectUri}?code=again&state=st`)).rejects.toThrow();
  });

  it("rejects a callback with the wrong state", async () => {
    const listener = await startLoopback("st", { ports: PORTS });
    const pending = listener.waitForCode();
    const reply = await get(`${listener.redirectUri}?code=abc&state=evil`);
    expect(reply.status).toBe(400);
    await expect(pending).rejects.toMatchObject({ code: "state_mismatch" });
  });

  it("falls back to the next port when the first is taken", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(PORTS[0], "127.0.0.1", resolve));
    try {
      const listener = await startLoopback("st", { ports: PORTS });
      expect(listener.port).toBe(PORTS[1]);
      listener.close();
      await expect(listener.waitForCode()).rejects.toMatchObject({ code: "cancelled" });
    } finally {
      blocker.close();
    }
  });

  it("fails when every port is taken", async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(PORTS[0], "127.0.0.1", resolve));
    try {
      await expect(startLoopback("st", { ports: [PORTS[0]] })).rejects.toMatchObject({ code: "no_port" });
    } finally {
      blocker.close();
    }
  });

  it("times out", async () => {
    const listener = await startLoopback("st", { ports: PORTS, timeoutMs: 30 });
    await expect(listener.waitForCode()).rejects.toMatchObject({ code: "timeout" });
  });
});
