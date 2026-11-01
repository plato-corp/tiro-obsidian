import { requestUrl } from "obsidian";

// Tiro sign-in: OAuth with PKCE as a public client (no client secret).
// Clients registered through the open registration endpoint may only request the MCP resource,
// so the authorize, token and refresh requests all carry `resource`.
export const OAUTH_BASE = "https://api.tiro.ooo/v1/oauth";
export const MCP_RESOURCE = "https://mcp.tiro.ooo/mcp";
export const OAUTH_SCOPE = "note:read note_summary:read";
export const CLIENT_NAME = "Tiro for Obsidian";

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message = code,
    readonly status = 0,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  idToken?: string;
}

export interface HttpRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface HttpResponse {
  status: number;
  text: string;
}

/** Sends a request without throwing on HTTP errors. Swapped out in tests. */
export type Http = (request: HttpRequest) => Promise<HttpResponse>;

export const obsidianHttp: Http = async (request) => {
  const response = await requestUrl({ ...request, throw: false });
  return { status: response.status, text: response.text ?? "" };
};

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomString(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function buildAuthorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(`${OAUTH_BASE}/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    scope: OAUTH_SCOPE,
    state: options.state,
    code_challenge: options.challenge,
    code_challenge_method: "S256",
    resource: MCP_RESOURCE,
  }).toString();
  return url.toString();
}

/** Reads the authorization code from the callback URL, checking `state` first. */
export function parseCallback(callbackUrl: string, expectedState: string): string {
  const params = new URL(callbackUrl, "http://127.0.0.1").searchParams;
  const error = params.get("error");
  if (error) {
    throw new OAuthError(error === "access_denied" ? "cancelled" : error, params.get("error_description") ?? error);
  }
  if (params.get("state") !== expectedState) throw new OAuthError("state_mismatch");
  const code = params.get("code");
  if (!code) throw new OAuthError("no_code");
  return code;
}

async function send(http: Http, request: HttpRequest): Promise<HttpResponse> {
  try {
    return await http(request);
  } catch (error) {
    throw new OAuthError("network", error instanceof Error ? error.message : String(error));
  }
}

export async function registerClient(http: Http, redirectUris: string[]): Promise<string> {
  const response = await send(http, {
    url: `${OAUTH_BASE}/register`,
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: OAUTH_SCOPE,
    }),
  });
  if (response.status < 200 || response.status >= 300) {
    throw new OAuthError("register_failed", response.text.slice(0, 300), response.status);
  }
  const id = (JSON.parse(response.text) as { client_id?: string }).client_id;
  if (!id) throw new OAuthError("register_failed", "No client id", response.status);
  return id;
}

async function requestTokens(http: Http, params: Record<string, string>, now: number): Promise<TokenSet> {
  const response = await send(http, {
    url: `${OAUTH_BASE}/token`,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...params, resource: MCP_RESOURCE }).toString(),
  });
  if (response.status < 200 || response.status >= 300) {
    let code = "token_failed";
    let message = response.text.slice(0, 300);
    try {
      const body = JSON.parse(response.text) as { error?: string; error_description?: string };
      code = body.error ?? code;
      message = body.error_description ?? message;
    } catch {
      // Not JSON; keep the raw text.
    }
    throw new OAuthError(code, message, response.status);
  }
  const body = JSON.parse(response.text) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
  };
  if (!body.access_token) throw new OAuthError("token_failed", "No access token", response.status);
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    idToken: body.id_token,
    expiresAt: now + (body.expires_in ?? 3600) * 1000,
  };
}

export function exchangeCode(
  http: Http,
  options: { clientId: string; code: string; verifier: string; redirectUri: string },
  now = Date.now(),
): Promise<TokenSet> {
  return requestTokens(
    http,
    {
      grant_type: "authorization_code",
      client_id: options.clientId,
      code: options.code,
      code_verifier: options.verifier,
      redirect_uri: options.redirectUri,
    },
    now,
  );
}

export async function refreshTokens(
  http: Http,
  options: { clientId: string; refreshToken: string },
  now = Date.now(),
): Promise<TokenSet> {
  const tokens = await requestTokens(
    http,
    { grant_type: "refresh_token", client_id: options.clientId, refresh_token: options.refreshToken },
    now,
  );
  return { ...tokens, refreshToken: tokens.refreshToken ?? options.refreshToken };
}

/** Reads `email` from a JWT payload for display. Opaque tokens give undefined. */
export function emailFromToken(...tokens: (string | undefined)[]): string | undefined {
  for (const token of tokens) {
    const part = token?.split(".")[1];
    if (!part) continue;
    try {
      const bytes = Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      const email = (JSON.parse(new TextDecoder().decode(bytes)) as { email?: unknown }).email;
      if (typeof email === "string" && email) return email;
    } catch {
      // Opaque token.
    }
  }
  return undefined;
}
