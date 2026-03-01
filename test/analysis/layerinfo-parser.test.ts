import { describe, it, expect } from "vitest";
import { parseLayerInfoOutput } from "../../src/analysis/layerinfo-parser.js";

describe("layerinfo-parser", () => {
  it("parses provides and requires", () => {
    const output = `
HttpServerLive
  ./src/server.ts:15:1
  Layer<HttpServer, DatabaseService | Logger>

Provides (1):
  - HttpServer

Requires (2):
  - DatabaseService
  - Logger

Suggested Composition:
  ...
`;
    const result = parseLayerInfoOutput(output, "HttpServerLive");
    expect(result.name).toBe("HttpServerLive");
    expect(result.provides).toEqual(["HttpServer"]);
    expect(result.requires).toEqual(["DatabaseService", "Logger"]);
  });

  it("handles layer with no requirements", () => {
    const output = `
LoggerLive
  ./src/logger.ts:3:1
  Layer<Logger, never>

Provides (1):
  - Logger

Requires (0):

Suggested Composition:
  ...
`;
    const result = parseLayerInfoOutput(output, "LoggerLive");
    expect(result.provides).toEqual(["Logger"]);
    expect(result.requires).toEqual([]);
  });

  it("strips ANSI codes", () => {
    const output = `
\x1B[1mDbLayer\x1B[0m
  ./src/db.ts:10:1

\x1B[1mProvides (1):\x1B[0m
  - \x1B[36mDatabaseService\x1B[0m

\x1B[1mRequires (1):\x1B[0m
  - \x1B[33mLogger\x1B[0m
`;
    const result = parseLayerInfoOutput(output, "DbLayer");
    expect(result.provides).toEqual(["DatabaseService"]);
    expect(result.requires).toEqual(["Logger"]);
  });
});
