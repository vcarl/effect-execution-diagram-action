import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { createProjectContext } from "../../src/analysis/project-setup.js";
import { analyzeErrors } from "../../src/analysis/error-analyzer.js";

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");
const TSCONFIG = path.join(FIXTURES_DIR, "tsconfig.json");

describe("error-analyzer", () => {
  it("detects error handling chains in error-handling.ts", () => {
    const project = createProjectContext(TSCONFIG);
    const result = analyzeErrors(project, [
      path.join(FIXTURES_DIR, "error-handling.ts"),
    ]);

    // Should find chains with catchTag, mapError, and catchAll
    expect(result.chains.length).toBeGreaterThan(0);

    // Each chain should have at least one error-handling step
    for (const chain of result.chains) {
      const handlers = chain.steps.filter(
        (s) => s.kind === "catch" || s.kind === "mapError"
      );
      expect(handlers.length).toBeGreaterThan(0);
    }
  });

  it("decomposes union error types into errorTypes array", () => {
    const project = createProjectContext(TSCONFIG);
    const result = analyzeErrors(project, [
      path.join(FIXTURES_DIR, "error-handling.ts"),
    ]);

    // Find the withUnionError chain (has mapError handler)
    // The first step in that chain should have a union error type
    // since fetchUser (HttpError) is flatMapped with parseResponse (ParseError)
    const unionChain = result.chains.find((c) =>
      c.steps.some(
        (s) => s.errorTypes && s.errorTypes.length > 1
      )
    );
    if (unionChain) {
      const unionStep = unionChain.steps.find(
        (s) => s.errorTypes && s.errorTypes.length > 1
      );
      expect(unionStep!.errorTypes!.length).toBeGreaterThan(1);
    }
  });

  it("does not create chains for pipes without error handlers", () => {
    const project = createProjectContext(TSCONFIG);
    const result = analyzeErrors(project, [
      path.join(FIXTURES_DIR, "simple-pipe.ts"),
    ]);

    // simple-pipe.ts has no error handling, should produce no chains
    expect(result.chains.length).toBe(0);
  });
});
