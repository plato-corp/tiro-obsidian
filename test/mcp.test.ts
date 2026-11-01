import { describe, expect, it } from "vitest";
import { header, parseRpcBody } from "../src/mcp";

describe("parseRpcBody", () => {
  it("parses plain JSON", () => {
    expect(parseRpcBody('{"jsonrpc":"2.0","id":3,"result":{"a":1}}', "application/json", 3).result).toEqual({ a: 1 });
  });
  it("takes the matching message from an SSE stream, with CRLF line ends too", () => {
    const sse =
      'event: message\r\ndata: {"jsonrpc":"2.0","method":"ping"}\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\r\n\r\n';
    expect(parseRpcBody(sse, "text/event-stream; charset=utf-8", 7).result).toEqual({ ok: true });
  });
  it("throws when the stream has no reply for the id", () => {
    expect(() => parseRpcBody('data: {"id":1}\n\n', "text/event-stream", 2)).toThrow();
  });
  it("looks up headers case-insensitively", () => {
    expect(header({ "Mcp-Session-Id": "x" }, "mcp-session-id")).toBe("x");
    expect(header(undefined, "a")).toBeUndefined();
  });
});
