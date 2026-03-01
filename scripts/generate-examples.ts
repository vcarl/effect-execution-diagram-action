/**
 * Generate example Mermaid diagrams from test fixtures.
 * Used to produce real output for the README.
 *
 * Usage: npx tsx scripts/generate-examples.ts
 */
import * as path from "node:path";
import { createProjectContext } from "../src/analysis/project-setup.js";
import { analyzeFlows } from "../src/analysis/flow-analyzer.js";
import { analyzeErrors } from "../src/analysis/error-analyzer.js";
import { renderFlowDiagram } from "../src/diagrams/flow-diagram.js";
import { renderErrorDiagram } from "../src/diagrams/error-diagram.js";
import { renderLayerDiagram } from "../src/diagrams/layer-diagram.js";
import type { LayerAnalysisResult } from "../src/analysis/layerinfo-parser.js";

const FIXTURES_DIR = path.resolve(__dirname, "../test/fixtures");
const TSCONFIG = path.join(FIXTURES_DIR, "tsconfig.json");

const project = createProjectContext(TSCONFIG);

function mermaidBlock(title: string, mermaid: string): void {
  console.log(`### ${title}\n`);
  console.log("```mermaid");
  console.log(mermaid);
  console.log("```\n");
}

// --- Execution Flow: gen-flow.ts ---
const genFlow = analyzeFlows(project, [path.join(FIXTURES_DIR, "gen-flow.ts")]);
const genDiagram = renderFlowDiagram(genFlow);
mermaidBlock("Execution Flow (gen-flow.ts)", genDiagram.mermaid);

// --- Execution Flow: simple-pipe.ts ---
const pipeFlow = analyzeFlows(project, [path.join(FIXTURES_DIR, "simple-pipe.ts")]);
const pipeDiagram = renderFlowDiagram(pipeFlow);
mermaidBlock("Execution Flow (simple-pipe.ts)", pipeDiagram.mermaid);

// --- Error Channels: error-handling.ts ---
const errors = analyzeErrors(project, [path.join(FIXTURES_DIR, "error-handling.ts")]);
const errorDiagram = renderErrorDiagram(errors);
mermaidBlock("Error Channels (error-handling.ts)", errorDiagram.mermaid);

// --- Layer Dependencies: from layer-composition.ts fixture data ---
// The CLI-based layer analysis requires `effect-language-service` to run against
// the fixtures, so we use the structured data that the CLI would produce.
const layerData: LayerAnalysisResult = {
  layers: [
    { name: "HttpServerLive", provides: ["HttpServer"], requires: ["DatabaseService", "Logger"] },
    { name: "DatabaseLive", provides: ["DatabaseService"], requires: ["Logger"] },
    { name: "LoggerLive", provides: ["Logger"], requires: [] },
  ],
};
const layerDiagram = renderLayerDiagram(layerData);
mermaidBlock("Layer Dependencies (layer-composition.ts)", layerDiagram.mermaid);
