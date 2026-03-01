import type { FlowGraph, FlowNode } from "../analysis/flow-analyzer.js";
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

/** Split a graph into connected components via BFS. */
function splitConnectedComponents(graph: FlowGraph): FlowGraph[] {
  const adjMap = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    adjMap.set(node.id, new Set());
  }
  for (const edge of graph.edges) {
    adjMap.get(edge.from)?.add(edge.to);
    adjMap.get(edge.to)?.add(edge.from);
  }

  const visited = new Set<string>();
  const components: FlowGraph[] = [];

  for (const node of graph.nodes) {
    if (visited.has(node.id)) continue;
    const componentIds = new Set<string>();
    const queue = [node.id];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      componentIds.add(id);
      for (const neighbor of adjMap.get(id) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    components.push({
      nodes: graph.nodes.filter((n) => componentIds.has(n.id)),
      edges: graph.edges.filter((e) => componentIds.has(e.from)),
    });
  }

  return components;
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
