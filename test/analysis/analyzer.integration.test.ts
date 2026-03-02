/**
 * Integration tests for the full analyze() pipeline (AST + CLI).
 *
 * These run the real effect-language-service CLI against test fixtures.
 * Some tests document known bugs and will fail until the bugs are fixed.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as path from "node:path";
import { analyze, type AnalysisResult } from "../../src/analysis/analyzer.js";

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");
const TSCONFIG = path.join(FIXTURES_DIR, "tsconfig.json");

const fixture = (name: string) => path.join(FIXTURES_DIR, name);

// All fixture files that the "combined" group analyzes
const ALL_FIXTURES = [
  "layer-composition.ts",
  "tagged-errors.ts",
  "error-handling.ts",
  "simple-pipe.ts",
  "gen-flow.ts",
  "concurrent-effects.ts",
  "resource-workflow.ts",
  "http-api.ts",
  "error-recovery.ts",
].map(fixture);

// ---------------------------------------------------------------------------
// layer-composition.ts — richest fixture for CLI integration
// ---------------------------------------------------------------------------

describe("analyze() — layer-composition.ts", { timeout: 120_000 }, () => {
  let result: AnalysisResult;

  beforeAll(async () => {
    result = await analyze(TSCONFIG, [fixture("layer-composition.ts")]);
  });

  it("finds exactly 4 layers with no duplicates", () => {
    const names = result.layers.map((l) => l.name);
    expect(names).toHaveLength(4);
    expect(new Set(names).size).toBe(4);
    expect(names).toContain("LoggerLive");
    expect(names).toContain("DatabaseLive");
    expect(names).toContain("HttpServerLive");
    expect(names).toContain("AppLayer");
  });

  it("does not include 'Tip:' as a phantom layer or service", () => {
    const allNames = [
      ...result.layers.map((l) => l.name),
      ...result.services.map((s) => s.name),
      ...result.discoveredErrors.map((e) => e.name),
    ];
    for (const name of allNames) {
      expect(name).not.toMatch(/^Tip:/);
    }
  });

  it("DatabaseLive provides DatabaseService and requires Logger", () => {
    const db = result.layers.find((l) => l.name === "DatabaseLive");
    expect(db).toBeDefined();
    expect(db!.provides).toContain("DatabaseService");
    expect(db!.requires).toContain("Logger");
  });

  it("HttpServerLive provides HttpServer and requires DatabaseService + Logger", () => {
    const http = result.layers.find((l) => l.name === "HttpServerLive");
    expect(http).toBeDefined();
    expect(http!.provides).toContain("HttpServer");
    expect(http!.requires).toContain("DatabaseService");
    expect(http!.requires).toContain("Logger");
  });

  it("LoggerLive provides Logger and requires nothing", () => {
    const logger = result.layers.find((l) => l.name === "LoggerLive");
    expect(logger).toBeDefined();
    expect(logger!.provides).toContain("Logger");
    expect(logger!.requires).toHaveLength(0);
  });

  it("AppLayer provides HttpServer and requires nothing (fully composed)", () => {
    const app = result.layers.find((l) => l.name === "AppLayer");
    expect(app).toBeDefined();
    expect(app!.provides).toContain("HttpServer");
    expect(app!.requires).toHaveLength(0);
  });

  it("has gen-start nodes for Layer.effect bodies", () => {
    const genStarts = result.nodes.filter((n) => n.kind === "gen-start");
    expect(genStarts.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// tagged-errors.ts — validates yieldable error discovery
// ---------------------------------------------------------------------------

describe("analyze() — tagged-errors.ts", { timeout: 120_000 }, () => {
  let result: AnalysisResult;

  beforeAll(async () => {
    result = await analyze(TSCONFIG, [fixture("tagged-errors.ts")]);
  });

  it("discovers Data.TaggedError classes as yieldable errors", () => {
    const errorNames = result.discoveredErrors.map((e) => e.name);
    expect(errorNames).toContain("NotFoundError");
    expect(errorNames).toContain("ValidationError");
  });

  it("each discovered error has correct name, file, and type", () => {
    for (const err of result.discoveredErrors) {
      expect(err.name).toBeTruthy();
      expect(err.file).toBeTruthy();
      expect(err.type).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// error-handling.ts — documents limitation: plain classes aren't yieldable
// ---------------------------------------------------------------------------

describe("analyze() — error-handling.ts", { timeout: 120_000 }, () => {
  let result: AnalysisResult;

  beforeAll(async () => {
    result = await analyze(TSCONFIG, [fixture("error-handling.ts")]);
  });

  it("has no yieldable errors (plain classes, not Data.TaggedError)", () => {
    expect(result.discoveredErrors).toHaveLength(0);
  });

  it("AST nodes with errorHandler field are present", () => {
    const handlers = result.nodes.filter((n) => n.errorHandler);
    expect(handlers.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// All fixtures combined — deduplication & hygiene
// ---------------------------------------------------------------------------

describe("analyze() — all fixtures combined", { timeout: 120_000 }, () => {
  let result: AnalysisResult;

  beforeAll(async () => {
    result = await analyze(TSCONFIG, ALL_FIXTURES);
  });

  it("has no duplicate layers", () => {
    const names = result.layers.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("does not include 'Tip:' phantom entries", () => {
    const allNames = [
      ...result.layers.map((l) => l.name),
      ...result.services.map((s) => s.name),
      ...result.discoveredErrors.map((e) => e.name),
    ];
    for (const name of allNames) {
      expect(name).not.toMatch(/^Tip:/);
    }
  });

  it("includes nodes from multiple fixture files", () => {
    const files = new Set(result.nodes.map((n) => path.basename(n.file)));
    expect(files.size).toBeGreaterThanOrEqual(3);
  });
});
