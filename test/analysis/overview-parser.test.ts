import { describe, it, expect } from "vitest";
import { parseOverviewOutput } from "../../src/analysis/overview-parser.js";

describe("overview-parser", () => {
  it("parses services section", () => {
    const output = `
Services (2)
  DatabaseService
    ./src/db.ts:5:1
    Context.Tag<DatabaseService>
  HttpServer
    ./src/server.ts:10:1
    Context.Tag<HttpServer>
`;
    const result = parseOverviewOutput(output, "test.ts");
    expect(result.services).toHaveLength(2);
    expect(result.services[0].name).toBe("DatabaseService");
    expect(result.services[1].name).toBe("HttpServer");
  });

  it("parses layers section", () => {
    const output = `
Layers (1)
  AppLayer
    ./src/app.ts:20:1
    Layer<HttpServer, never>
`;
    const result = parseOverviewOutput(output, "test.ts");
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0].name).toBe("AppLayer");
    expect(result.layers[0].type).toBe("Layer<HttpServer, never>");
  });

  it("parses errors section", () => {
    const output = `
Yieldable Errors (1)
  HttpError
    ./src/errors.ts:3:1
    Data.TaggedError<HttpError>
`;
    const result = parseOverviewOutput(output, "test.ts");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].name).toBe("HttpError");
  });

  it("handles combined output with all sections", () => {
    const output = `
Yieldable Errors (1)
  HttpError
    ./src/errors.ts:3:1
    Data.TaggedError<HttpError>

Services (1)
  DatabaseService
    ./src/db.ts:5:1
    Context.Tag<DatabaseService>

Layers (1)
  DbLayer
    ./src/db.ts:10:1
    Layer<DatabaseService, never>
`;
    const result = parseOverviewOutput(output, "test.ts");
    expect(result.errors).toHaveLength(1);
    expect(result.services).toHaveLength(1);
    expect(result.layers).toHaveLength(1);
  });

  it("strips ANSI codes", () => {
    const output = `
\x1B[1mServices (1)\x1B[0m
  \x1B[36mDatabaseService\x1B[0m
    ./src/db.ts:5:1
    Context.Tag<DatabaseService>
`;
    const result = parseOverviewOutput(output, "test.ts");
    expect(result.services).toHaveLength(1);
    expect(result.services[0].name).toBe("DatabaseService");
  });
});
