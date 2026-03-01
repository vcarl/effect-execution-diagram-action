import type { FlowGraph, FlowNode } from "../analysis/flow-analyzer.js";
import { escapeLabel, sanitizeId, truncateIfNeeded } from "./mermaid.js";

export interface FlowDiagramResult {
  mermaid: string;
  truncated?: boolean;
  shownNodes?: number;
  totalNodes?: number;
}

export function renderFlowDiagram(graph: FlowGraph): FlowDiagramResult {
  const { items: nodes, info } = truncateIfNeeded(graph.nodes);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter(
    (e) => nodeIds.has(e.from) && nodeIds.has(e.to)
  );

  const lines: string[] = ["flowchart TD"];

  for (const node of nodes) {
    const id = sanitizeId(node.id);
    const label = escapeLabel(node.label);
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

  return {
    mermaid: lines.join("\n"),
    ...(info.truncated
      ? {
          truncated: true,
          shownNodes: info.shownNodes,
          totalNodes: info.totalNodes,
        }
      : {}),
  };
}

function shapeFor(node: FlowNode): string {
  const label = escapeLabel(node.label);
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
