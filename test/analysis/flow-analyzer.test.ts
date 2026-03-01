import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { createProjectContext } from "../../src/analysis/project-setup.js";
import { analyzeFlows } from "../../src/analysis/flow-analyzer.js";

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");
const TSCONFIG = path.join(FIXTURES_DIR, "tsconfig.json");

describe("flow-analyzer", () => {
  it("detects pipe chains in simple-pipe.ts", () => {
    const project = createProjectContext(TSCONFIG);
    const result = analyzeFlows(project, [
      path.join(FIXTURES_DIR, "simple-pipe.ts"),
    ]);

    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.edges.length).toBeGreaterThan(0);

    // The basic pipe has 4 steps: succeed, map, flatMap, tap
    const pipeNodes = result.nodes.filter(
      (n) => n.kind === "effect" || n.kind === "pipe-step"
    );
    expect(pipeNodes.length).toBeGreaterThanOrEqual(4);
  });

  it("extracts JSDoc descriptions on entry nodes", () => {
    const project = createProjectContext(TSCONFIG);
    const result = analyzeFlows(project, [
      path.join(FIXTURES_DIR, "simple-pipe.ts"),
    ]);

    // basicPipe has a JSDoc comment, should appear on first node
    const basicPipeEntry = result.nodes.find(
      (n) => n.scope === "basicPipe" && n.kind === "effect"
    );
    expect(basicPipeEntry).toBeDefined();
    expect(basicPipeEntry!.description).toBe(
      "Increments and doubles a number using Effect pipeline"
    );

    // methodPipe has no JSDoc, should not have description
    const methodPipeEntry = result.nodes.find(
      (n) => n.scope === "methodPipe" && n.kind === "effect"
    );
    // methodPipe may or may not be detected (it uses method-style pipe)
    // but if it is, it should not have a description
    if (methodPipeEntry) {
      expect(methodPipeEntry.description).toBeUndefined();
    }
  });

  it("detects Effect.gen in gen-flow.ts", () => {
    const project = createProjectContext(TSCONFIG);
    const result = analyzeFlows(project, [
      path.join(FIXTURES_DIR, "gen-flow.ts"),
    ]);

    const genStart = result.nodes.find((n) => n.kind === "gen-start");
    const genEnd = result.nodes.find((n) => n.kind === "gen-end");
    const yields = result.nodes.filter((n) => n.kind === "yield");

    expect(genStart).toBeDefined();
    expect(genEnd).toBeDefined();
    // 3 yield* expressions: getConfig, connectDb, startServer
    expect(yields.length).toBe(3);

    // Verify edges form a chain
    expect(result.edges.length).toBe(4); // start->y1, y1->y2, y2->y3, y3->end
  });
});
