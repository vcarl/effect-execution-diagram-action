import type { FlowGraph, FlowNode, FlowEdge } from "../analysis/flow-analyzer.js";
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
 *
 * When a node has a `ref` that matches another component's scope name,
 * that sub-program is inlined as a mermaid subgraph (max depth: 1).
 */
export function renderFlowDiagrams(graph: FlowGraph): FlowDiagramResult[] {
  const components = splitConnectedComponents(graph);
  const results: FlowDiagramResult[] = [];

  // Build scope name → component map for sub-program lookup
  const scopeMap = new Map<string, { nodes: FlowNode[]; edges: FlowEdge[] }>();
  for (const comp of components) {
    if (comp.nodes.length <= 1) continue;
    const scope = comp.nodes[0]?.scope;
    if (scope && !scopeMap.has(scope)) {
      scopeMap.set(scope, comp);
    }
  }

  for (const comp of components.filter((c) => c.nodes.length > 1)) {
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
    const parentScope = first?.scope ?? "";

    // For gen flows, the gen-start node becomes a wrapping subgraph
    const isGenFlow = first?.kind === "gen-start";
    const genStartId = isGenFlow ? first.id : undefined;

    // Nodes to render (skip gen-start for gen flows)
    const renderNodes = isGenFlow ? nodes.slice(1) : nodes;
    // Edges to render (skip edge from gen-start for gen flows)
    const renderEdges = isGenFlow
      ? edges.filter((e) => e.from !== genStartId)
      : edges;

    // Track which nodes get replaced by subgraphs, and occurrence counts
    const refOccurrences = new Map<string, number>();
    const inlinedNodeIds = new Set<string>();

    // Base indent: 2 spaces normally, 4 spaces inside a wrapper subgraph
    const indent = isGenFlow ? "    " : "  ";
    const subIndent = isGenFlow ? "      " : "    ";

    const lines: string[] = ["flowchart TD"];

    // Open wrapper subgraph for gen flows
    if (isGenFlow) {
      const wrapperAnnotation = buildEffectAnnotation(first);
      const wrapperLabel = wrapperAnnotation ?? "Effect.gen";
      const wrapperId = sanitizeId(`wrapper_${parentScope}`);
      lines.push(`  subgraph ${wrapperId} ["${wrapperLabel}"]`);
    }

    for (const node of renderNodes) {
      const refComp = node.ref ? scopeMap.get(node.ref) : undefined;
      // Don't inline a component into itself
      if (refComp && node.ref !== parentScope) {
        const count = refOccurrences.get(node.ref!) ?? 0;
        refOccurrences.set(node.ref!, count + 1);
        const suffix = count > 0 ? `_${count}` : "";
        const sgId = sanitizeId(`sg_${parentScope}_${node.ref}${suffix}`);
        inlinedNodeIds.add(node.id);

        lines.push(`${indent}subgraph ${sgId} ["${escapeLabel(node.ref!)}"]`);
        for (const subNode of refComp.nodes) {
          const subId = sanitizeId(`${parentScope}_${node.ref}${suffix}_${subNode.id}`);
          lines.push(`${subIndent}${subId}${shapeFor(subNode)}`);
        }
        for (const subEdge of refComp.edges) {
          const subFrom = sanitizeId(`${parentScope}_${node.ref}${suffix}_${subEdge.from}`);
          const subTo = sanitizeId(`${parentScope}_${node.ref}${suffix}_${subEdge.to}`);
          if (subEdge.label) {
            lines.push(`${subIndent}${subFrom} -->|"${escapeLabel(subEdge.label)}"| ${subTo}`);
          } else {
            lines.push(`${subIndent}${subFrom} --> ${subTo}`);
          }
        }
        lines.push(`${indent}end`);
      } else {
        const id = sanitizeId(node.id);
        lines.push(`${indent}${id}${shapeFor(node)}`);
      }
    }

    for (const edge of renderEdges) {
      const fromInlined = inlinedNodeIds.has(edge.from);
      const toInlined = inlinedNodeIds.has(edge.to);
      const fromNode = fromInlined ? renderNodes.find((n) => n.id === edge.from) : undefined;
      const toNode = toInlined ? renderNodes.find((n) => n.id === edge.to) : undefined;

      const fromId = fromInlined
        ? resolveSubgraphId(parentScope, fromNode!, refOccurrences, renderNodes, edge.from)
        : sanitizeId(edge.from);
      const toId = toInlined
        ? resolveSubgraphId(parentScope, toNode!, refOccurrences, renderNodes, edge.to)
        : sanitizeId(edge.to);

      if (edge.label) {
        lines.push(`${indent}${fromId} -->|"${escapeLabel(edge.label)}"| ${toId}`);
      } else {
        lines.push(`${indent}${fromId} --> ${toId}`);
      }
    }

    // Close wrapper subgraph for gen flows
    if (isGenFlow) {
      lines.push("  end");
    }

    results.push({
      label,
      mermaid: lines.join("\n"),
      ...(info.truncated ? { truncated: true } : {}),
    });
  }

  return results;
}

/**
 * Resolve the subgraph ID for an inlined node, so edges can target
 * the subgraph container rather than the replaced node.
 */
function resolveSubgraphId(
  parentScope: string,
  node: FlowNode,
  refOccurrences: Map<string, number>,
  nodes: FlowNode[],
  nodeId: string
): string {
  const ref = node.ref!;
  // Count how many times this ref appeared before this node
  let occurrence = 0;
  for (const n of nodes) {
    if (n.id === nodeId) break;
    if (n.ref === ref) occurrence++;
  }
  const suffix = occurrence > 0 ? `_${occurrence}` : "";
  return sanitizeId(`sg_${parentScope}_${ref}${suffix}`);
}

/** Convenience wrapper that returns the first diagram result (for single-diagram callers). */
export function renderFlowDiagram(graph: FlowGraph): FlowDiagramResult {
  const results = renderFlowDiagrams(graph);
  return results[0] ?? { label: "", mermaid: "flowchart TD" };
}

/**
 * Build `Effect<A, E, R>` annotation string, omitting trailing trivial params:
 * - All trivial → no annotation
 * - Only A non-trivial → `Effect<A>`
 * - A and E non-trivial, R trivial → `Effect<A, E>`
 * - E or R non-trivial but A trivial → show A as `_`, e.g. `Effect<_, HttpError, UserRepo>`
 * - All non-trivial → `Effect<A, E, R>`
 */
function buildEffectAnnotation(node: FlowNode): string | undefined {
  const a = node.successType;
  const e = node.errorType;
  const r = node.requirements;

  if (!a && !e && !r) return undefined;

  if (a && !e && !r) return `Effect&lt;${escapeLabel(a)}&gt;`;
  if (a && e && !r) return `Effect&lt;${escapeLabel(a)}, ${escapeLabel(e)}&gt;`;
  if (!a && e && !r) return `Effect&lt;_, ${escapeLabel(e)}&gt;`;
  if (!a && !e && r) return `Effect&lt;_, _, ${escapeLabel(r)}&gt;`;
  if (!a && e && r) return `Effect&lt;_, ${escapeLabel(e)}, ${escapeLabel(r)}&gt;`;
  if (a && !e && r) return `Effect&lt;${escapeLabel(a)}, _, ${escapeLabel(r)}&gt;`;
  // All three present
  return `Effect&lt;${escapeLabel(a!)}, ${escapeLabel(e!)}, ${escapeLabel(r!)}&gt;`;
}

function buildLabel(node: FlowNode): string {
  const main = escapeLabel(node.label);
  const annotation = buildEffectAnnotation(node);
  if (!annotation) return main;
  return `${main}<br/><i>${annotation}</i>`;
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
