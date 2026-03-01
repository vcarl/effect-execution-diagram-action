import type { FlowGraph, FlowNode } from "../analysis/flow-analyzer.js";
import { splitConnectedComponents } from "../analysis/graph-utils.js";
import { escapeLabel, sanitizeId, truncateIfNeeded } from "./mermaid.js";

export interface FlowDiagramResult {
  label: string;
  mermaid: string;
  truncated?: boolean;
}

/**
 * Render one small diagram per connected component (i.e. per pipe chain
 * or Effect.gen block), labelled with the enclosing scope + file name.
 */
export function renderFlowDiagrams(graph: FlowGraph): FlowDiagramResult[] {
  const components = splitConnectedComponents(graph);
  const results: FlowDiagramResult[] = [];

  for (const comp of components.filter((c) => c.nodes.length > 2)) {
    const { items: nodes, info } = truncateIfNeeded(comp.nodes);
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = comp.edges.filter(
      (e) => nodeIds.has(e.from) && nodeIds.has(e.to)
    );

    const first = nodes[0];
    const fileShort = first
      ? (first.file.split("/").pop() ?? first.file)
      : "unknown";
    const label = first?.scope ? `${first.scope} · ${fileShort}` : fileShort;

    const lines: string[] = ["flowchart TD"];
    for (const node of nodes) {
      const id = sanitizeId(node.id);
      lines.push(`  ${id}${shapeFor(node)}`);
    }
    for (const edge of edges) {
      const from = sanitizeId(edge.from);
      const to = sanitizeId(edge.to);
      if (edge.label) {
        lines.push(`  ${from} -->|"${escapeLabel(edge.label)}"| ${to}`);
      } else {
        lines.push(`  ${from} --> ${to}`);
      }
    }

    results.push({
      label,
      mermaid: lines.join("\n"),
      ...(info.truncated ? { truncated: true } : {}),
    });
  }

  return results;
}

/** Convenience wrapper that returns the first diagram result (for single-diagram callers). */
export function renderFlowDiagram(graph: FlowGraph): FlowDiagramResult {
  const results = renderFlowDiagrams(graph);
  return results[0] ?? { label: "", mermaid: "flowchart TD" };
}

function buildLabel(node: FlowNode): string {
  const main = escapeLabel(node.label);
  const annotations: string[] = [];
  if (node.errorType) annotations.push(`E: ${escapeLabel(node.errorType)}`);
  if (node.requirements)
    annotations.push(`R: ${escapeLabel(node.requirements)}`);
  if (annotations.length === 0) return main;
  // Use <br/> for line break — added AFTER escaping so it stays as HTML
  return `${main}<br/><i>${annotations.join(" · ")}</i>`;
}

function shapeFor(node: FlowNode): string {
  const label = buildLabel(node);
  switch (node.kind) {
    case "gen-start":
    case "gen-end":
      return `(["${label}"])`;
    case "yield":
      return `["${label}"]`;
    case "effect":
      return `["${label}"]`;
    case "pipe-step":
      return `["${label}"]`;
    default:
      return `["${label}"]`;
  }
}
