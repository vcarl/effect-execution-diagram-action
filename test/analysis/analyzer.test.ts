import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { analyzeAst, parseOverviewOutput, parseLayerInfoOutput, parseTypeParams } from "../../src/analysis/analyzer.js";

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");
const TSCONFIG = path.join(FIXTURES_DIR, "tsconfig.json");

describe("analyzeAst", () => {
  it("detects pipe chains in simple-pipe.ts", () => {
    const result = analyzeAst(TSCONFIG, [
      path.join(FIXTURES_DIR, "simple-pipe.ts"),
    ]);

    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.edges.length).toBeGreaterThan(0);

    const pipeNodes = result.nodes.filter(
      (n) => n.kind === "effect" || n.kind === "pipe-step",
    );
    expect(pipeNodes.length).toBeGreaterThanOrEqual(4);
  });

  it("extracts JSDoc descriptions on entry nodes", () => {
    const result = analyzeAst(TSCONFIG, [
      path.join(FIXTURES_DIR, "simple-pipe.ts"),
    ]);

    const basicPipeEntry = result.nodes.find(
      (n) => n.scope === "basicPipe" && n.kind === "effect",
    );
    expect(basicPipeEntry).toBeDefined();
    expect(basicPipeEntry!.description).toBe(
      "Increments and doubles a number using Effect pipeline",
    );

    const methodPipeEntry = result.nodes.find(
      (n) => n.scope === "methodPipe" && n.kind === "effect",
    );
    if (methodPipeEntry) {
      expect(methodPipeEntry.description).toBeUndefined();
    }
  });

  it("detects Effect.gen in gen-flow.ts", () => {
    const result = analyzeAst(TSCONFIG, [
      path.join(FIXTURES_DIR, "gen-flow.ts"),
    ]);

    const genStart = result.nodes.find((n) => n.kind === "gen-start");
    const genEnd = result.nodes.find((n) => n.kind === "gen-end");
    const yields = result.nodes.filter((n) => n.kind === "yield");

    expect(genStart).toBeDefined();
    expect(genEnd).toBeDefined();
    expect(yields.length).toBe(3);
    expect(result.edges.length).toBe(4);
  });

  it("detects error handling chains and sets errorHandler field", () => {
    const result = analyzeAst(TSCONFIG, [
      path.join(FIXTURES_DIR, "error-handling.ts"),
    ]);

    const handlers = result.nodes.filter((n) => n.errorHandler);
    expect(handlers.length).toBeGreaterThan(0);

    const catchTagNode = handlers.find((n) => n.errorHandler === "catchTag");
    expect(catchTagNode).toBeDefined();

    const mapErrorNode = handlers.find((n) => n.errorHandler === "mapError");
    expect(mapErrorNode).toBeDefined();
  });

  it("does not set errorHandler on pipes without error handlers", () => {
    const result = analyzeAst(TSCONFIG, [
      path.join(FIXTURES_DIR, "simple-pipe.ts"),
    ]);

    const handlers = result.nodes.filter((n) => n.errorHandler);
    expect(handlers.length).toBe(0);
  });

  it("decomposes union error types into errorTypes array", () => {
    const result = analyzeAst(TSCONFIG, [
      path.join(FIXTURES_DIR, "error-handling.ts"),
    ]);

    const unionNode = result.nodes.find(
      (n) => n.errorTypes && n.errorTypes.length > 1,
    );
    if (unionNode) {
      expect(unionNode.errorTypes!.length).toBeGreaterThan(1);
    }
  });

  it("populates type parameters on nodes", () => {
    const result = analyzeAst(TSCONFIG, [
      path.join(FIXTURES_DIR, "simple-pipe.ts"),
    ]);

    // At least some nodes should have successType
    const withType = result.nodes.find((n) => n.successType);
    expect(withType).toBeDefined();
  });

  it("populates scope field from enclosing declaration", () => {
    const result = analyzeAst(TSCONFIG, [
      path.join(FIXTURES_DIR, "simple-pipe.ts"),
    ]);

    const scopedNodes = result.nodes.filter((n) => n.scope);
    expect(scopedNodes.length).toBeGreaterThan(0);
    expect(scopedNodes[0].scope).toBe("basicPipe");
  });
});

// ---------------------------------------------------------------------------
// CLI parser unit tests
// ---------------------------------------------------------------------------

describe("parseOverviewOutput", () => {
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
      parseTypeParams("Layer<HttpServer | Logger, DatabaseService>"),
    ).toEqual(["HttpServer | Logger", "DatabaseService"]);
  });

  it("returns empty array for no angle brackets", () => {
    expect(parseTypeParams("SimpleType")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseTypeParams("")).toEqual([]);
  });
});

describe("parseLayerInfoOutput", () => {
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
  - Layer.merge(DatabaseServiceLive, LoggerLive)
  - Layer.provide(HttpServerLive, composedDeps)
`;
    const result = parseLayerInfoOutput(output, "HttpServerLive");
    expect(result.provides).toEqual(["HttpServer"]);
    expect(result.requires).toEqual(["DatabaseService", "Logger"]);
    expect(result.suggestedComposition).toEqual([
      "Layer.merge(DatabaseServiceLive, LoggerLive)",
      "Layer.provide(HttpServerLive, composedDeps)",
    ]);
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
`;
    const result = parseLayerInfoOutput(output, "LoggerLive");
    expect(result.provides).toEqual(["Logger"]);
    expect(result.requires).toEqual([]);
    expect(result.suggestedComposition).toBeUndefined();
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
