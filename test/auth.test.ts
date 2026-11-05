import { describe, expect, it } from "vitest";
import { TiroAuth, isSignedIn } from "../src/auth";
import type { AuthState } from "../src/auth";
import { LOOPBACK_PORTS, redirectUriFor } from "../src/loopback";
import type { LoopbackListener } from "../src/loopback";
import type { Http } from "../src/oauth";

function makeStore(initial: AuthState = {}) {
  let state = initial;
  return { load: () => state, save: (next: AuthState) => ((state = next), Promise.resolve()), get: () => state };
}

function server(routes: Record<string, (body: URLSearchParams | Record<string, unknown>) => { status: number; body: unknown }>) {
  const log: string[] = [];
  const http: Http = (request) => {
    const path = new URL(request.url).pathname;
    log.push(path);
    const form = request.headers["Content-Type"].includes("json") ? (JSON.parse(request.body) as Record<string, unknown>) : new URLSearchParams(request.body);
    const { status, body } = routes[path](form);
    return Promise.resolve({ status, text: JSON.stringify(body) });
  };
  return { http, log };
}

function fakeListener(port: number, code: () => Promise<string>): LoopbackListener {
  return { port, redirectUri: redirectUriFor(port), waitForCode: code, close: () => undefined };
}

describe("sign in", () => {
  it("registers once with all loopback URIs, signs in, and reuses the registration", async () => {
    const store = makeStore();
    const { http, log } = server({
      "/v1/oauth/register": () => ({ status: 201, body: { client_id: "cid" } }),
      "/v1/oauth/token": () => ({ status: 200, body: { access_token: "a", refresh_token: "r", expires_in: 3600 } }),
    });
    const auth = new TiroAuth(store, http);
    let opened = "";
    const hooks = {
      openBrowser: (url: string) => (opened = url),
      listen: () => Promise.resolve(fakeListener(LOOPBACK_PORTS[1], () => Promise.resolve("the-code"))),
    };
    const result = await auth.signIn(hooks);
    expect(result).toMatchObject({ clientId: "cid", accessToken: "a", refreshToken: "r" });
    expect(store.get().redirectUris).toEqual(LOOPBACK_PORTS.map(redirectUriFor));
    expect(new URL(opened).searchParams.get("redirect_uri")).toBe(redirectUriFor(LOOPBACK_PORTS[1]));
    expect(isSignedIn(store.get())).toBe(true);

    await auth.signOut();
    expect(isSignedIn(store.get())).toBe(false);
    expect(store.get().clientId).toBe("cid");
    await auth.signIn(hooks);
    expect(log.filter((p) => p.endsWith("/register"))).toHaveLength(1);
  });

  it("re-registers when the stored redirect URIs differ", async () => {
    const store = makeStore({ clientId: "old", redirectUris: ["http://127.0.0.1:1/callback"] });
    const { http } = server({
      "/v1/oauth/register": () => ({ status: 201, body: { client_id: "fresh" } }),
      "/v1/oauth/token": () => ({ status: 200, body: { access_token: "a" } }),
    });
    await new TiroAuth(store, http).signIn({
      openBrowser: () => undefined,
      listen: () => Promise.resolve(fakeListener(LOOPBACK_PORTS[0], () => Promise.resolve("c"))),
    });
    expect(store.get().clientId).toBe("fresh");
  });

  it("passes the code verifier that matches the challenge in the authorize URL", async () => {
    const store = makeStore({ clientId: "cid", redirectUris: LOOPBACK_PORTS.map(redirectUriFor) });
    let verifier = "";
    const { http } = server({
      "/v1/oauth/token": (body) => {
        verifier = (body as URLSearchParams).get("code_verifier") ?? "";
        return { status: 200, body: { access_token: "a" } };
      },
    });
    let opened = "";
    await new TiroAuth(store, http).signIn({
      openBrowser: (url) => (opened = url),
      listen: () => Promise.resolve(fakeListener(LOOPBACK_PORTS[0], () => Promise.resolve("c"))),
    });
    const { pkceChallenge } = await import("../src/oauth");
    expect(new URL(opened).searchParams.get("code_challenge")).toBe(await pkceChallenge(verifier));
  });

  it("propagates a cancelled sign-in and leaves the user signed out", async () => {
    const store = makeStore({ clientId: "cid", redirectUris: LOOPBACK_PORTS.map(redirectUriFor) });
    const { http } = server({});
    const rejects = new TiroAuth(store, http).signIn({
      openBrowser: () => undefined,
      listen: () => Promise.resolve(fakeListener(LOOPBACK_PORTS[0], () => Promise.reject(Object.assign(new Error("x"), { code: "cancelled" })))),
    });
    await expect(rejects).rejects.toThrow();
    expect(isSignedIn(store.get())).toBe(false);
  });
});

describe("access token refresh", () => {
  const signedIn = (expiresAt: number): AuthState => ({ clientId: "c", accessToken: "old", refreshToken: "r", expiresAt });

  it("returns a fresh token without any request", async () => {
    const auth = new TiroAuth(makeStore(signedIn(10_000_000)), () => Promise.reject(new Error("no network")));
    expect(await auth.getAccessToken(0)).toBe("old");
  });

  it("refreshes an expiring token once for concurrent callers", async () => {
    const store = makeStore(signedIn(1000));
    let calls = 0;
    const { http } = server({ "/v1/oauth/token": () => (calls++, { status: 200, body: { access_token: "new", expires_in: 3600 } }) });
    const auth = new TiroAuth(store, http);
    expect(await Promise.all([auth.getAccessToken(5000), auth.getAccessToken(5000)])).toEqual(["new", "new"]);
    expect(calls).toBe(1);
    expect(store.get()).toMatchObject({ accessToken: "new", refreshToken: "r" });
  });

  it("signs out when the server refuses the refresh token", async () => {
    const store = makeStore(signedIn(1));
    const { http } = server({ "/v1/oauth/token": () => ({ status: 400, body: { error: "invalid_grant" } }) });
    expect(await new TiroAuth(store, http).getAccessToken(5000)).toBeNull();
    expect(isSignedIn(store.get())).toBe(false);
    expect(store.get().clientId).toBe("c");
  });

  it("forgets an unknown client on invalid_client", async () => {
    const store = makeStore(signedIn(1));
    const { http } = server({ "/v1/oauth/token": () => ({ status: 401, body: { error: "invalid_client" } }) });
    await new TiroAuth(store, http).getAccessToken(5000);
    expect(store.get()).toEqual({});
  });

  it("keeps the sign-in when the network is down", async () => {
    const store = makeStore(signedIn(1));
    expect(await new TiroAuth(store, () => Promise.reject(new Error("offline"))).getAccessToken(5000)).toBeNull();
    expect(isSignedIn(store.get())).toBe(true);
  });
});


describe("authentication session isolation", () => {
  for (const fails of [false, true]) {
    it(`ignores a late ${fails ? "failure" : "success"} after logout`, async () => {
      const store = makeStore({ clientId: "c", accessToken: "expired", refreshToken: "fixture-refresh", expiresAt: 1 });
      let release!: () => void; let entered!: () => void;
      const gate = new Promise<void>(r => { release = r; });
      const started = new Promise<void>(r => { entered = r; });
      const http: Http = async () => {
        entered(); await gate;
        return fails ? { status: 401, text: JSON.stringify({ error: "invalid_client" }) }
          : { status: 200, text: JSON.stringify({ access_token: "fixture-new", expires_in: 3600 }) };
      };
      const auth = new TiroAuth(store, http);
      const pending = auth.getAccessToken(5000);
      await started; await auth.signOut();
      if (fails) await store.save({ clientId: "new-account", accessToken: "fixture-current" });
      release(); expect(await pending).toBeNull();
      if (fails) expect(store.get().accessToken).toBe("fixture-current");
      else expect(isSignedIn(store.get())).toBe(false);
    });
  }

  it("serializes a delayed store write before the final logout write", async () => {
    let state: AuthState = { clientId: "c", refreshToken: "fixture-refresh", expiresAt: 1 };
    let release!: () => void; let entered!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const started = new Promise<void>(r => { entered = r; });
    const auth = new TiroAuth({ load: () => state, save: async next => {
      if (next.accessToken) { entered(); await gate; }
      state = next;
    } }, async () => ({ status: 200, text: JSON.stringify({ access_token: "fixture-new" }) }));
    const pending = auth.getAccessToken(5000); await started;
    const logout = auth.signOut(); release();
    expect(await pending).toBeNull(); await logout;
    expect(isSignedIn(state)).toBe(false);
  });
});
