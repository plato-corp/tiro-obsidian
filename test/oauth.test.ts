import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  emailFromToken,
  exchangeCode,
  MCP_RESOURCE,
  parseCallback,
  pkceChallenge,
  randomString,
  refreshTokens,
  registerClient,
} from "../src/oauth";
import type { Http, HttpRequest } from "../src/oauth";

function reply(status: number, body: unknown, seen?: HttpRequest[]): Http {
  return (request) => {
    seen?.push(request);
    return Promise.resolve({ status, text: JSON.stringify(body) });
  };
}

describe("PKCE", () => {
  it("matches the RFC 7636 example challenge", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
  it("makes url-safe random strings of the expected length", () => {
    expect(randomString(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomString(32)).not.toBe(randomString(32));
  });
});

describe("authorize URL", () => {
  it("carries PKCE, scope and resource", () => {
    const url = new URL(
      buildAuthorizeUrl({ clientId: "c", redirectUri: "http://127.0.0.1:27193/callback", state: "s", challenge: "ch" }),
    );
    expect(url.origin + url.pathname).toBe("https://api.tiro.ooo/v1/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "c",
      redirect_uri: "http://127.0.0.1:27193/callback",
      scope: "note:read note_summary:read",
      state: "s",
      code_challenge: "ch",
      code_challenge_method: "S256",
      resource: MCP_RESOURCE,
    });
  });
});

describe("parseCallback", () => {
  it("returns the code when state matches", () => {
    expect(parseCallback("/callback?code=abc&state=s", "s")).toBe("abc");
    expect(parseCallback("http://127.0.0.1:27193/callback?code=abc&state=s", "s")).toBe("abc");
  });
  it("rejects a wrong or missing state", () => {
    expect(() => parseCallback("/callback?code=abc&state=evil", "s")).toThrowError(expect.objectContaining({ code: "state_mismatch" }));
    expect(() => parseCallback("/callback?code=abc", "s")).toThrowError(expect.objectContaining({ code: "state_mismatch" }));
  });
  it("maps access_denied to cancelled and reports other errors", () => {
    expect(() => parseCallback("/callback?error=access_denied&state=s", "s")).toThrowError(expect.objectContaining({ code: "cancelled" }));
    expect(() => parseCallback("/callback?error=server_error&state=s", "s")).toThrowError(expect.objectContaining({ code: "server_error" }));
    expect(() => parseCallback("/callback?state=s", "s")).toThrowError(expect.objectContaining({ code: "no_code" }));
  });
});

describe("registration and tokens", () => {
  it("registers a public client with every redirect URI", async () => {
    const seen: HttpRequest[] = [];
    const uris = ["http://127.0.0.1:27193/callback", "http://127.0.0.1:27194/callback"];
    expect(await registerClient(reply(201, { client_id: "new" }, seen), uris)).toBe("new");
    expect(seen[0].url).toBe("https://api.tiro.ooo/v1/oauth/register");
    expect(JSON.parse(seen[0].body)).toMatchObject({
      client_name: "Tiro for Obsidian",
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      scope: "note:read note_summary:read",
    });
    await expect(registerClient(reply(400, { error: "invalid_redirect_uri" }), uris)).rejects.toMatchObject({ code: "register_failed" });
  });

  it("exchanges the code with verifier and resource, form-encoded", async () => {
    const seen: HttpRequest[] = [];
    const tokens = await exchangeCode(
      reply(200, { access_token: "a", refresh_token: "r", expires_in: 100 }, seen),
      { clientId: "c", code: "k", verifier: "v", redirectUri: "http://127.0.0.1:27193/callback" },
      1000,
    );
    expect(tokens).toMatchObject({ accessToken: "a", refreshToken: "r", expiresAt: 101_000 });
    expect(seen[0].headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(seen[0].body))).toEqual({
      grant_type: "authorization_code",
      client_id: "c",
      code: "k",
      code_verifier: "v",
      redirect_uri: "http://127.0.0.1:27193/callback",
      resource: MCP_RESOURCE,
    });
  });

  it("refreshes, keeping the old refresh token when the server sends none", async () => {
    const seen: HttpRequest[] = [];
    const tokens = await refreshTokens(reply(200, { access_token: "a2" }, seen), { clientId: "c", refreshToken: "old" }, 0);
    expect(tokens).toMatchObject({ accessToken: "a2", refreshToken: "old", expiresAt: 3_600_000 });
    expect(Object.fromEntries(new URLSearchParams(seen[0].body))).toMatchObject({ grant_type: "refresh_token", refresh_token: "old", resource: MCP_RESOURCE });
  });

  it("surfaces the OAuth error code, and network failures as network", async () => {
    await expect(refreshTokens(reply(400, { error: "invalid_grant" }), { clientId: "c", refreshToken: "x" })).rejects.toMatchObject({ code: "invalid_grant", status: 400 });
    const down: Http = () => Promise.reject(new Error("offline"));
    await expect(refreshTokens(down, { clientId: "c", refreshToken: "x" })).rejects.toMatchObject({ code: "network" });
  });
});

describe("emailFromToken", () => {
  it("reads email from a JWT payload and ignores opaque tokens", () => {
    const jwt = `h.${btoa(JSON.stringify({ email: "a@b.com" })).replace(/=/g, "")}.s`;
    expect(emailFromToken("opaque", jwt)).toBe("a@b.com");
    expect(emailFromToken("opaque", undefined)).toBeUndefined();
  });
});
