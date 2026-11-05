import { Platform } from "obsidian";
import { OAuthError, parseCallback } from "./oauth";


/** Ports tried in order. Every one is registered as a redirect URI, so the first free port works. */
export const LOOPBACK_PORTS = [27193, 27194, 27195, 27196];
export const LOOPBACK_HOST = "127.0.0.1";
export const LOOPBACK_TIMEOUT_MS = 5 * 60 * 1000;

export const redirectUriFor = (port: number): string => `http://${LOOPBACK_HOST}:${port}/callback`;

export interface LoopbackListener {
  port: number;
  redirectUri: string;
  /** Resolves with the authorization code once the browser comes back; always closes the server. */
  waitForCode(): Promise<string>;
  close(): void;
}

const PAGE_OK =
  "<!doctype html><meta charset=utf-8><title>Tiro</title><body style=\"font-family:system-ui;text-align:center;margin-top:20vh\"><h1>Return to Obsidian</h1><p>You can close this tab.</p>";
const PAGE_ERROR =
  "<!doctype html><meta charset=utf-8><title>Tiro</title><body style=\"font-family:system-ui;text-align:center;margin-top:20vh\"><h1>Sign-in failed</h1><p>Return to Obsidian and try again.</p>";

/**
 * Starts a one-shot HTTP server on the loopback interface for the OAuth redirect. Node's `http` is
 * loaded lazily so the plugin still loads on mobile, where this is never called.
 */
export async function startLoopback(
  expectedState: string,
  options: { ports?: number[]; timeoutMs?: number } = {},
): Promise<LoopbackListener> {
  if (!Platform.isDesktop) throw new OAuthError("desktop_only");
  // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef -- Obsidian runs plugins as CommonJS; import("http") can't resolve there
  const { createServer } = require("http") as typeof import("http");
  const ports = options.ports ?? LOOPBACK_PORTS;
  const timeoutMs = options.timeoutMs ?? LOOPBACK_TIMEOUT_MS;

  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // Avoids an unhandled rejection if the listener is closed before anyone awaits it.
  codePromise.catch(() => undefined);

  let settled = false;
  let timer: number | undefined;
  const server = createServer((request, response) => {
    const address = server.address();
    const host = typeof address === "object" && address ? `${LOOPBACK_HOST}:${address.port}` : "";
    if (request.method !== "GET") { response.writeHead(405).end(); return; }
    if (request.headers.host !== host) { response.writeHead(403).end(); return; }
    let url: URL;
    try { url = new URL(request.url ?? "/", `http://${host}`); }
    catch { response.writeHead(400).end(); return; }
    if (url.origin !== `http://${host}` || url.pathname !== "/callback" || settled) {
      response.writeHead(404).end();
      return;
    }
    if (url.searchParams.get("state") !== expectedState) {
      response.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(PAGE_ERROR);
      return;
    }
    settled = true;
    let code: string | undefined;
    let failure: Error | undefined;
    try {
      code = parseCallback(url.toString(), expectedState);
    } catch (error) {
      failure = error instanceof Error ? error : new OAuthError("callback_failed");
    }
    response.writeHead(failure ? 400 : 200, { "Content-Type": "text/html; charset=utf-8", Connection: "close", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    response.end(failure ? PAGE_ERROR : PAGE_OK);
    if (code) resolveCode(code);
    else rejectCode(failure ?? new OAuthError("callback_failed"));
    close();
  });

  function close(): void {
    if (timer) window.clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  }

  let port: number | undefined;
  for (const candidate of ports) {
    const bound = await new Promise<boolean>((resolve) => {
      const onError = () => resolve(false);
      server.once("error", onError);
      server.listen(candidate, LOOPBACK_HOST, () => {
        server.off("error", onError);
        resolve(true);
      });
    });
    if (bound) {
      port = candidate;
      break;
    }
  }
  if (port === undefined) throw new OAuthError("no_port");

  timer = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectCode(new OAuthError("timeout"));
    close();
  }, timeoutMs);

  return {
    port,
    redirectUri: redirectUriFor(port),
    waitForCode: () => codePromise,
    close: () => {
      if (!settled) {
        settled = true;
        rejectCode(new OAuthError("cancelled"));
      }
      close();
    },
  };
}
