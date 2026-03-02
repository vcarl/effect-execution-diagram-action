import type { AnalysisResult, AnalysisNode, AnalysisEdge } from "../analysis/analyzer.js";
import { splitConnectedComponents } from "../analysis/graph-utils.js";
import { escapeLabel, sanitizeId } from "./mermaid.js";

export interface ErrorDiagramResult {
  label: string;
  mermaid: string;
  truncated?: boolean;
}

/**
 * Render one diagram per connected component that contains at least
 * one error-handling node, labelled with the enclosing scope + file name.
 */
export function renderErrorDiagrams(
  analysis: AnalysisResult,
): ErrorDiagramResult[] {
  const results: ErrorDiagramResult[] = [];
  const components = splitConnectedComponents(analysis);

  for (const comp of components) {
    // Only render components that have at least one error handler
    const hasHandler = comp.nodes.some((n) => n.errorHandler);
    if (!hasHandler) continue;
    if (comp.nodes.length < 2) continue;

    const firstNode = comp.nodes[0];
    const fileShort = firstNode
      ? (firstNode.file.split("/").pop() ?? firstNode.file)
      : "unknown";
    const label = firstNode?.scope
      ? `${firstNode.scope} · ${fileShort}`
      : fileShort;

    const lines: string[] = ["flowchart LR"];
    for (const node of comp.nodes) {
      const id = sanitizeId(node.id);
      const nodeLabel = escapeLabel(node.label);
      lines.push(`  ${id}${shapeFor(node, nodeLabel)}`);
    }
    for (const edge of comp.edges) {
      const from = sanitizeId(edge.from);
      const to = sanitizeId(edge.to);
      // Derive error label from source node's errorType
      const sourceNode = comp.nodes.find((n) => n.id === edge.from);
      const errorType = sourceNode?.errorType ?? "unknown";
      const errorLabel = escapeLabel(errorType);
      lines.push(`  ${from} -->|"E: ${errorLabel}"| ${to}`);
    }

    results.push({ label, mermaid: lines.join("\n") });
  }

  return results;
}

/** Convenience wrapper that returns the first diagram result (for single-diagram callers). */
export function renderErrorDiagram(
  analysis: AnalysisResult,
): ErrorDiagramResult {
  const results = renderErrorDiagrams(analysis);
  return results[0] ?? { label: "", mermaid: "flowchart LR" };
}

function shapeFor(node: AnalysisNode, label: string): string {
  if (node.errorHandler) {
    if (node.errorHandler === "mapError") {
      return `[/"${label}"/]`;
    }
    return `{"${label}"}`;
  }
  return `["${label}"]`;
}
