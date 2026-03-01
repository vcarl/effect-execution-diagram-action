import { describe, it, expect } from "vitest";
import { renderLayerDiagram } from "../../src/diagrams/layer-diagram.js";
import type { LayerAnalysisResult } from "../../src/analysis/layerinfo-parser.js";

describe("layer-diagram", () => {
  it("renders layer subgraphs with provides/requires", () => {
    const analysis: LayerAnalysisResult = {
      layers: [
        { name: "HttpServerLive", provides: ["HttpServer"], requires: ["DatabaseService"] },
        { name: "DatabaseLive", provides: ["DatabaseService"], requires: [] },
      ],
    };

    const result = renderLayerDiagram(analysis);
    expect(result.mermaid).toContain("flowchart TB");
    expect(result.mermaid).toContain('subgraph HttpServerLive');
    expect(result.mermaid).toContain('subgraph DatabaseLive');
    expect(result.mermaid).toContain("Provides:");
    expect(result.mermaid).toContain("Requires:");
  });

  it("draws dependency edges between layers", () => {
    const analysis: LayerAnalysisResult = {
      layers: [
        { name: "AppLayer", provides: ["App"], requires: ["DbService"] },
        { name: "DbLayer", provides: ["DbService"], requires: [] },
      ],
    };

    const result = renderLayerDiagram(analysis);
    // AppLayer requires DbService, which DbLayer provides
    expect(result.mermaid).toContain("AppLayer_r");
    expect(result.mermaid).toContain("DbLayer_p");
    expect(result.mermaid).toContain("-."); // dotted edge
  });
});
