// Minimal stand-in for the "obsidian" module so pure logic can run under vitest.
export interface StubRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface StubResponse {
  status: number;
  json: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export const stub = {
  handler: (_req: StubRequest): StubResponse => ({ status: 404, json: {} }),
  calls: [] as StubRequest[],
};

export function requestUrl(req: StubRequest): Promise<StubResponse> {
  stub.calls.push(req);
  return Promise.resolve(stub.handler(req));
}

export function normalizePath(path: string): string {
  return path.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export const Platform = { isDesktopApp: true, isDesktop: true, isMobile: false };
