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

/** Runtime sign-in state. Credentials must not be written to vault settings. */
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
  private generation = 0;
  private writes: Promise<unknown> = Promise.resolve();
  private cancelSignIn: (() => void) | undefined;

  private saveCurrent(state: AuthState, generation: number): Promise<boolean> {
    const operation = this.writes.then(async () => {
      if (generation !== this.generation) return false;
      await this.store.save(state);
      return generation === this.generation;
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }

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
    const generation = ++this.generation;
    this.refreshing = undefined;
    this.cancelSignIn?.();
    await this.saveCurrent(dropTokens(this.store.load()), generation);
  }

  async signIn(hooks: SignInHooks): Promise<AuthState> {
    const generation = ++this.generation;
    this.refreshing = undefined;
    this.cancelSignIn?.();
    const state = randomString(16);
    const verifier = randomString(48);
    const listener = await (hooks.listen ?? startLoopback)(state);
    if (generation !== this.generation) {
      listener.close();
      throw new OAuthError("cancelled");
    }
    const cancel = () => listener.close();
    this.cancelSignIn = cancel;
    try {
      let auth = this.store.load();
      const uris = LOOPBACK_PORTS.map(redirectUriFor);
      if (!auth.clientId || auth.redirectUris?.join(" ") !== uris.join(" ")) {
        auth = { clientId: await registerClient(this.http, uris), redirectUris: uris };
        if (!(await this.saveCurrent(auth, generation))) throw new OAuthError("cancelled");
      }
      const clientId = auth.clientId as string;
      const challenge = await pkceChallenge(verifier);
      if (generation !== this.generation) throw new OAuthError("cancelled");
      hooks.openBrowser(buildAuthorizeUrl({ clientId, redirectUri: listener.redirectUri, state, challenge }));

      const code = await listener.waitForCode();
      try {
        const tokens = await exchangeCode(this.http, { clientId, code, verifier, redirectUri: listener.redirectUri });
        const next = withTokens(auth, tokens);
        if (!(await this.saveCurrent(next, generation))) throw new OAuthError("cancelled");
        return next;
      } catch (error) {
        // If the server no longer knows the client, register again on the next sign-in.
        if (error instanceof OAuthError && error.code === "invalid_client") await this.saveCurrent({}, generation);
        throw error;
      }
    } finally {
      if (this.cancelSignIn === cancel) this.cancelSignIn = undefined;
      listener.close();
    }
  }

  /** A usable access token, refreshed when close to expiry. Null when signed out or refresh was refused. */
  getAccessToken(now = Date.now()): Promise<string | null> {
    const generation = this.generation;
    const auth = this.store.load();
    if (auth.accessToken && (!auth.expiresAt || auth.expiresAt - SKEW_MS > now)) return Promise.resolve(auth.accessToken);
    if (!auth.clientId || !auth.refreshToken) {
      return (async () => {
        if (auth.accessToken || auth.refreshToken) await this.saveCurrent(dropTokens(auth), generation);
        return null;
      })();
    }
    if (!this.refreshing) {
      const pending = this.refresh(auth, now, generation).finally(() => {
        if (this.refreshing === pending) this.refreshing = undefined;
      });
      this.refreshing = pending;
    }
    return this.refreshing;
  }

  private async refresh(auth: AuthState, now: number, generation: number): Promise<string | null> {
    try {
      const tokens = await refreshTokens(
        this.http,
        { clientId: auth.clientId as string, refreshToken: auth.refreshToken as string },
        now,
      );
      const next = withTokens(auth, tokens);
      if (!(await this.saveCurrent(next, generation))) return null;
      return next.accessToken ?? null;
    } catch (error) {
      // Only a refusal from the server signs the user out; a network failure keeps the sign-in.
      if (error instanceof OAuthError && error.code !== "network") {
        await this.saveCurrent(error.code === "invalid_client" ? {} : dropTokens(auth), generation);
      }
      return null;
    }
  }
}
