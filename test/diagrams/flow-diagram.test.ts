import { describe, it, expect } from "vitest";
import { renderFlowDiagram } from "../../src/diagrams/flow-diagram.js";
import type { FlowGraph } from "../../src/analysis/flow-analyzer.js";

describe("flow-diagram", () => {
  it("renders a pipe chain as a flowchart", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "n0", label: "Effect.succeed(42)", line: 1, file: "test.ts", kind: "effect" },
        { id: "n1", label: "Effect.map", line: 2, file: "test.ts", kind: "pipe-step" },
        { id: "n2", label: "Effect.flatMap", line: 3, file: "test.ts", kind: "pipe-step" },
      ],
      edges: [
        { from: "n0", to: "n1" },
        { from: "n1", to: "n2" },
      ],
    };

    const result = renderFlowDiagram(graph);
    expect(result.mermaid).toContain("flowchart TD");
    expect(result.mermaid).toContain("n0");
    expect(result.mermaid).toContain("n1");
    expect(result.mermaid).toContain("n0 --> n1");
    expect(result.mermaid).toContain("n1 --> n2");
    expect(result.truncated).toBeUndefined();
  });

  it("renders Effect.gen with stadium-shaped start/end", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "n0", label: "Effect.gen", line: 1, file: "test.ts", kind: "gen-start" },
        { id: "n1", label: "yield* getConfig", line: 2, file: "test.ts", kind: "yield" },
        { id: "n2", label: "return", line: 3, file: "test.ts", kind: "gen-end" },
      ],
      edges: [
        { from: "n0", to: "n1" },
        { from: "n1", to: "n2" },
      ],
    };

    const result = renderFlowDiagram(graph);
    // gen-start/end use stadium shape ([" ... "])
    expect(result.mermaid).toContain('(["Effect.gen"])');
    expect(result.mermaid).toContain('(["return"])');
  });
});
