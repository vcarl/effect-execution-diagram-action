import { describe, it, expect } from "vitest";
import { parseOverviewOutput, parseTypeParams } from "../../src/analysis/overview-parser.js";

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
    expect(result.services[0].typeParams).toEqual(["DatabaseService"]);
    expect(result.services[1].name).toBe("HttpServer");
    expect(result.services[1].typeParams).toEqual(["HttpServer"]);
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
    expect(result.layers[0].typeParams).toEqual(["HttpServer", "never"]);
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
    expect(result.errors[0].typeParams).toEqual(["HttpError"]);
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

  it("parses nested generic type parameters", () => {
    const output = `
Layers (1)
  ComposedLayer
    ./src/app.ts:5:1
    Layer<HttpServer | Logger, DatabaseService>
`;
    const result = parseOverviewOutput(output, "test.ts");
    expect(result.layers[0].typeParams).toEqual([
      "HttpServer | Logger",
      "DatabaseService",
    ]);
  });

  it("omits typeParams when type has no angle brackets", () => {
    const output = `
Yieldable Errors (1)
  SimpleError
    ./src/errors.ts:1:1
    SimpleError
`;
    const result = parseOverviewOutput(output, "test.ts");
    expect(result.errors[0].typeParams).toBeUndefined();
  });
});

describe("parseTypeParams", () => {
  it("parses single type parameter", () => {
    expect(parseTypeParams("Context.Tag<DatabaseService>")).toEqual([
      "DatabaseService",
    ]);
  });

  it("parses multiple type parameters", () => {
    expect(parseTypeParams("Layer<HttpServer, never>")).toEqual([
      "HttpServer",
      "never",
    ]);
  });

  it("handles nested angle brackets", () => {
    expect(parseTypeParams("Layer<Effect<string, Error>, never>")).toEqual([
      "Effect<string, Error>",
      "never",
    ]);
  });

  it("handles union types in parameters", () => {
    expect(
      parseTypeParams("Layer<HttpServer | Logger, DatabaseService>")
    ).toEqual(["HttpServer | Logger", "DatabaseService"]);
  });

  it("returns empty array for no angle brackets", () => {
    expect(parseTypeParams("SimpleType")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseTypeParams("")).toEqual([]);
  });
});
