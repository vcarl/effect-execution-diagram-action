import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { analyzeAst, parseOverviewOutput, parseLayerInfoOutput, parseTypeParams } from "../../src/analysis/analyzer.js";

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");
const TSCONFIG = path.join(FIXTURES_DIR, "tsconfig.json");

describe("analyzeAst", () => {
  it("detects pipe chains", () => {
    const result = analyzeAst(TSCONFIG, [
      path.join(FIXTURES_DIR, "infrastructure.ts"),
    ]);

    // retryPolicy is a pipe chain: Schedule.jittered → Schedule.intersect
    const pipeSteps = result.nodes.filter(
      (n) => n.scope === "retryPolicy" && n.kind === "pipe-step",
    );
    expect(pipeSteps.length).toBeGreaterThanOrEqual(1);

    const entryNode = result.nodes.find(
      (n) => n.scope === "retryPolicy" && n.kind === "effect",
    );
    expect(entryNode).toBeDefined();
  });

  it("detects Effect.gen with yields", () => {
    const result = analyzeAst(TSCONFIG, [
      path.join(FIXTURES_DIR, "state-service.ts"),
    ]);

    // processEvent is an Effect.gen with yield steps
    const genStart = result.nodes.find(
      (n) => n.scope === "processEvent" && n.kind === "gen-start",
    );
    const genEnd = result.nodes.find(
      (n) => n.scope === "processEvent" && n.kind === "gen-end",
    );
    const yields = result.nodes.filter(
      (n) => n.scope === "processEvent" && n.kind === "yield",
    );

    expect(genStart).toBeDefined();
    expect(genEnd).toBeDefined();
    // yields: Database, db.query, db.execute
    expect(yields.length).toBe(3);
  });

  it("detects error handlers (catchTag) on pipe steps", () => {
    const result = analyzeAst(TSCONFIG, [
      path.join(FIXTURES_DIR, "handler.ts"),
    ]);

    const handlers = result.nodes.filter(
      (n) => n.scope === "handleRequest" && n.errorHandler,
    );
    expect(handlers.length).toBeGreaterThan(0);

    const catchTagNode = handlers.find((n) => n.errorHandler === "catchTag");
    expect(catchTagNode).toBeDefined();
  });

  it("does not set errorHandler on pipes without error handlers", () => {
    const result = analyzeAst(TSCONFIG, [
      path.join(FIXTURES_DIR, "handler.ts"),
    ]);

    const healthCheckNodes = result.nodes.filter(
      (n) => n.scope === "healthCheck",
    );
    expect(healthCheckNodes.length).toBeGreaterThan(0);

    const handlers = healthCheckNodes.filter((n) => n.errorHandler);
    expect(handlers.length).toBe(0);
  });

  it("extracts JSDoc descriptions on entry nodes", () => {
    const result = analyzeAst(TSCONFIG, [
      path.join(FIXTURES_DIR, "infrastructure.ts"),
    ]);

    const dbLiveEntry = result.nodes.find(
      (n) => n.scope === "DatabaseLive" && n.kind === "gen-start",
    );
    expect(dbLiveEntry).toBeDefined();
    expect(dbLiveEntry!.description).toBe(
      "Provides query and execute methods backed by a Postgres connection",
    );
  });

  it("populates type parameters on nodes", () => {
    const result = analyzeAst(TSCONFIG, [
      path.join(FIXTURES_DIR, "state-service.ts"),
    ]);

    // processEvent gen-start should have successType
    const genStart = result.nodes.find(
      (n) => n.scope === "processEvent" && n.kind === "gen-start",
    );
    expect(genStart).toBeDefined();
    expect(genStart!.successType).toBeDefined();
  });

  it("populates scope field from enclosing declaration", () => {
    const result = analyzeAst(TSCONFIG, [
      path.join(FIXTURES_DIR, "infrastructure.ts"),
    ]);

    const scopedNodes = result.nodes.filter((n) => n.scope);
    expect(scopedNodes.length).toBeGreaterThan(0);

    const scopes = new Set(scopedNodes.map((n) => n.scope));
    expect(scopes.has("retryPolicy")).toBe(true);
    expect(scopes.has("DatabaseLive")).toBe(true);
  });

  it("populates errorType on nodes with error channels", () => {
    const result = analyzeAst(TSCONFIG, [
      path.join(FIXTURES_DIR, "handler.ts"),
    ]);

    // handleRequest pipe entry has errorType DbError (before catchTag)
    const handleRequestEntry = result.nodes.find(
      (n) => n.scope === "handleRequest" && n.kind === "effect",
    );
    expect(handleRequestEntry).toBeDefined();
    expect(handleRequestEntry!.errorType).toBe("DbError");
  });

  describe("cross-file ref expansion", () => {
    const CROSS_FILE_A = path.join(FIXTURES_DIR, "cross-file-a.ts");
    const CROSS_FILE_B = path.join(FIXTURES_DIR, "cross-file-b.ts");

    it("expands refs into other files when only file A is passed", () => {
      const result = analyzeAst(TSCONFIG, [CROSS_FILE_A]);

      // File A's program should have a yield node with ref=fetchUser that has a refFile
      const refNode = result.nodes.find(
        (n) => n.ref === "fetchUser" && n.file === CROSS_FILE_A,
      );
      expect(refNode).toBeDefined();
      expect(refNode!.refFile).toBeDefined();
      expect(refNode!.refFile).toContain("cross-file-b");

      // File B's fetchUser scope should be present via expansion
      const fileBNodes = result.nodes.filter((n) =>
        n.file.includes("cross-file-b"),
      );
      expect(fileBNodes.length).toBeGreaterThan(0);

      // fetchUser gen-start should be there
      const fetchUserStart = fileBNodes.find(
        (n) => n.scope === "fetchUser" && n.kind === "gen-start",
      );
      expect(fetchUserStart).toBeDefined();
    });

    it("does not expand refs when maxDepth is 0", () => {
      const result = analyzeAst(TSCONFIG, [CROSS_FILE_A], { maxDepth: 0 });

      // File A nodes should be present
      const fileANodes = result.nodes.filter((n) =>
        n.file.includes("cross-file-a"),
      );
      expect(fileANodes.length).toBeGreaterThan(0);

      // File B nodes should NOT be present
      const fileBNodes = result.nodes.filter((n) =>
        n.file.includes("cross-file-b"),
      );
      expect(fileBNodes.length).toBe(0);
    });

    it("does not produce duplicate nodes when both files are passed", () => {
      const result = analyzeAst(TSCONFIG, [CROSS_FILE_A, CROSS_FILE_B]);

      // fetchUser scope should appear exactly once (from file B)
      const fetchUserStarts = result.nodes.filter(
        (n) => n.scope === "fetchUser" && n.kind === "gen-start",
      );
      expect(fetchUserStarts.length).toBe(1);

      // All node IDs should be unique
      const ids = result.nodes.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
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
