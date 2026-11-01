import { Platform } from "obsidian";
import { LOOPBACK_PORTS, redirectUriFor, startLoopback } from "./loopback";
import type { LoopbackListener } from "./loopback";
import {
  buildAuthorizeUrl,
  emailFromToken,
  exchangeCode,
  obsidianHttp,
  OAuthError,
  pkceChallenge,
  randomString,
  refreshTokens,
  registerClient,
} from "./oauth";
import type { Http, TokenSet } from "./oauth";

/** Sign-in state kept in the plugin's data file. */
export interface AuthState {
  // Result of the dynamic client registration; kept across sign-outs.
  clientId?: string;
  redirectUris?: string[];
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
}

export interface AuthStore {
  load(): AuthState;
  save(state: AuthState): Promise<void>;
}

const SKEW_MS = 60_000;

export function isSignedIn(auth: AuthState): boolean {
  return Boolean(auth.clientId && (auth.refreshToken || auth.accessToken));
}

function dropTokens(auth: AuthState): AuthState {
  return { clientId: auth.clientId, redirectUris: auth.redirectUris };
}

function withTokens(auth: AuthState, tokens: TokenSet): AuthState {
  return {
    ...auth,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    email: emailFromToken(tokens.idToken, tokens.accessToken) ?? auth.email,
  };
}

export interface SignInHooks {
  /** Opens the authorize URL in the browser. */
  openBrowser(url: string): void;
  /** Test seam for the loopback server. */
  listen?: (state: string) => Promise<LoopbackListener>;
}

export class TiroAuth {
  private refreshing: Promise<string | null> | undefined;

  constructor(
    private readonly store: AuthStore,
    private readonly http: Http = obsidianHttp,
  ) {}

  get state(): AuthState {
    return this.store.load();
  }

  /** The desktop sign-in uses a loopback server, which mobile apps can't run. */
  get canSignIn(): boolean {
    return Platform.isDesktopApp;
  }

  async signOut(): Promise<void> {
    await this.store.save(dropTokens(this.store.load()));
  }

  async signIn(hooks: SignInHooks): Promise<AuthState> {
    const state = randomString(16);
    const verifier = randomString(48);
    const listener = await (hooks.listen ?? startLoopback)(state);
    try {
      let auth = this.store.load();
      const uris = LOOPBACK_PORTS.map(redirectUriFor);
      if (!auth.clientId || auth.redirectUris?.join(" ") !== uris.join(" ")) {
        auth = { clientId: await registerClient(this.http, uris), redirectUris: uris };
        await this.store.save(auth);
      }
      const clientId = auth.clientId as string;
      const challenge = await pkceChallenge(verifier);
      hooks.openBrowser(buildAuthorizeUrl({ clientId, redirectUri: listener.redirectUri, state, challenge }));

      const code = await listener.waitForCode();
      try {
        const tokens = await exchangeCode(this.http, { clientId, code, verifier, redirectUri: listener.redirectUri });
        const next = withTokens(auth, tokens);
        await this.store.save(next);
        return next;
      } catch (error) {
        // If the server no longer knows the client, register again on the next sign-in.
        if (error instanceof OAuthError && error.code === "invalid_client") await this.store.save({});
        throw error;
      }
    } finally {
      listener.close();
    }
  }

  /** A usable access token, refreshed when close to expiry. Null when signed out or refresh was refused. */
  getAccessToken(now = Date.now()): Promise<string | null> {
    const auth = this.store.load();
    if (auth.accessToken && (!auth.expiresAt || auth.expiresAt - SKEW_MS > now)) return Promise.resolve(auth.accessToken);
    if (!auth.clientId || !auth.refreshToken) {
      return (async () => {
        if (auth.accessToken || auth.refreshToken) await this.store.save(dropTokens(auth));
        return null;
      })();
    }
    this.refreshing ??= this.refresh(auth, now).finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async refresh(auth: AuthState, now: number): Promise<string | null> {
    try {
      const tokens = await refreshTokens(
        this.http,
        { clientId: auth.clientId as string, refreshToken: auth.refreshToken as string },
        now,
      );
      const next = withTokens(auth, tokens);
      await this.store.save(next);
      return next.accessToken ?? null;
    } catch (error) {
      // Only a refusal from the server signs the user out; a network failure keeps the sign-in.
      if (error instanceof OAuthError && error.code !== "network") {
        await this.store.save(error.code === "invalid_client" ? {} : dropTokens(auth));
      }
      return null;
    }
  }
}
