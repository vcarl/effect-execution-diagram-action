import type { FlowGraph, FlowNode, FlowEdge } from "../analysis/flow-analyzer.js";
import type { LayerAnalysisResult } from "../analysis/layerinfo-parser.js";
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
 * that sub-program is inlined as a mermaid subgraph, recursively expanding
 * nested references (with cycle prevention).
 */
export function renderFlowDiagrams(
  graph: FlowGraph,
  layers?: LayerAnalysisResult,
): FlowDiagramResult[] {
  const components = splitConnectedComponents(graph);
  const results: FlowDiagramResult[] = [];

  // Build scope name → component map for sub-program lookup
  // Include single-node components so simple Effect declarations can be inlined
  const scopeMap = new Map<string, { nodes: FlowNode[]; edges: FlowEdge[] }>();
  for (const comp of components) {
    const scope = comp.nodes[0]?.scope;
    if (scope && !scopeMap.has(scope)) {
      scopeMap.set(scope, comp);
    }
  }

  // Only render multi-node components as standalone diagrams
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

    // Base indent: 2 spaces normally, 4 spaces inside a wrapper subgraph
    const indent = isGenFlow ? "    " : "  ";

    const lines: string[] = ["flowchart TD"];

    // Open wrapper subgraph for gen flows
    if (isGenFlow) {
      const wrapperAnnotation = buildEffectAnnotation(first);
      const wrapperLabel = wrapperAnnotation ?? "Effect.gen";
      const wrapperId = sanitizeId(`wrapper_${parentScope}`);
      lines.push(`  subgraph ${wrapperId} ["${wrapperLabel}"]`);
    }

    const nodeIdMap = renderComponentNodes(
      renderNodes,
      renderEdges,
      scopeMap,
      parentScope,
      "",           // no node prefix at top level
      indent,
      lines,
      new Set([parentScope]),
    );

    // Render edges, redirecting inlined nodes to their subgraph IDs
    for (const edge of renderEdges) {
      const fromId = nodeIdMap.get(edge.from) ?? sanitizeId(edge.from);
      const toId = nodeIdMap.get(edge.to) ?? sanitizeId(edge.to);

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

    // Render layer nodes + dotted edges when layer data is available
    if (layers) {
      const wrapperId = isGenFlow
        ? sanitizeId(`wrapper_${parentScope}`)
        : undefined;
      renderLayerEdges(comp.nodes, layers, wrapperId, lines);
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
 * Render nodes for a component, recursively expanding refs into subgraphs.
 *
 * @param sgPrefix  - prefix for subgraph IDs: sg_{sgPrefix}_{ref}
 * @param nodePrefix - prefix for node IDs (empty at top level, set at recursive depth to avoid collisions)
 * @param expandedRefs - refs already expanded in this branch (cycle prevention)
 *
 * Returns a map of original node IDs → rendered IDs for inlined nodes
 * (subgraph IDs), so the caller can redirect edges.
 */
function renderComponentNodes(
  nodes: FlowNode[],
  edges: FlowEdge[],
  scopeMap: Map<string, { nodes: FlowNode[]; edges: FlowEdge[] }>,
  sgPrefix: string,
  nodePrefix: string,
  indent: string,
  lines: string[],
  expandedRefs: Set<string>,
): Map<string, string> {
  const nodeIdMap = new Map<string, string>();
  const refOccurrences = new Map<string, number>();
  const subIndent = indent + "  ";

  function renderedNodeId(originalId: string): string {
    return sanitizeId(nodePrefix ? `${nodePrefix}_${originalId}` : originalId);
  }

  for (const node of nodes) {
    const refComp = node.ref ? scopeMap.get(node.ref) : undefined;
    // Inline if we have a matching component and haven't already expanded this ref (cycle prevention)
    if (refComp && !expandedRefs.has(node.ref!)) {
      const count = refOccurrences.get(node.ref!) ?? 0;
      refOccurrences.set(node.ref!, count + 1);
      const suffix = count > 0 ? `_${count}` : "";
      const sgId = sanitizeId(`sg_${sgPrefix}_${node.ref}${suffix}`);
      nodeIdMap.set(node.id, sgId);

      lines.push(`${indent}subgraph ${sgId} ["${escapeLabel(node.ref!)}"]`);

      const childPrefix = `${sgPrefix}_${node.ref}${suffix}`;
      const childExpandedRefs = new Set(expandedRefs);
      childExpandedRefs.add(node.ref!);

      // For gen-flow sub-programs, skip the gen-start node
      const isChildGen = refComp.nodes[0]?.kind === "gen-start";
      const childGenStartId = isChildGen ? refComp.nodes[0].id : undefined;
      const childNodes = isChildGen ? refComp.nodes.slice(1) : refComp.nodes;
      const childEdges = isChildGen
        ? refComp.edges.filter((e) => e.from !== childGenStartId)
        : refComp.edges;

      // Recursively render child nodes (childPrefix used for both sg and node namespacing)
      const childIdMap = renderComponentNodes(
        childNodes,
        childEdges,
        scopeMap,
        childPrefix,
        childPrefix,
        subIndent,
        lines,
        childExpandedRefs,
      );

      // Render child edges
      for (const subEdge of childEdges) {
        const subFrom = childIdMap.get(subEdge.from)
          ?? sanitizeId(`${childPrefix}_${subEdge.from}`);
        const subTo = childIdMap.get(subEdge.to)
          ?? sanitizeId(`${childPrefix}_${subEdge.to}`);
        if (subEdge.label) {
          lines.push(`${subIndent}${subFrom} -->|"${escapeLabel(subEdge.label)}"| ${subTo}`);
        } else {
          lines.push(`${subIndent}${subFrom} --> ${subTo}`);
        }
      }

      lines.push(`${indent}end`);
    } else {
      const id = renderedNodeId(node.id);
      lines.push(`${indent}${id}${shapeFor(node)}`);
    }
  }

  return nodeIdMap;
}

/** Convenience wrapper that returns the first diagram result (for single-diagram callers). */
export function renderFlowDiagram(
  graph: FlowGraph,
  layers?: LayerAnalysisResult,
): FlowDiagramResult {
  const results = renderFlowDiagrams(graph, layers);
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
  const parts = [main];
  if (node.description) {
    parts.push(`<br/><small>${escapeLabel(node.description)}</small>`);
  }
  const annotation = buildEffectAnnotation(node);
  if (annotation) {
    parts.push(`<br/><i>${annotation}</i>`);
  }
  return parts.join("");
}

/**
 * Collect requirements from a component's nodes, match them to layers,
 * and render trapezoid layer nodes with dotted edges.
 */
function renderLayerEdges(
  nodes: FlowNode[],
  layers: LayerAnalysisResult,
  wrapperId: string | undefined,
  lines: string[],
): void {
  // Collect all unique requirement service names from the component
  const allRequirements = new Set<string>();
  for (const node of nodes) {
    if (node.requirements) {
      for (const req of node.requirements.split("|")) {
        const trimmed = req.trim();
        if (trimmed) allRequirements.add(trimmed);
      }
    }
  }
  if (allRequirements.size === 0) return;

  // Build a map of service name → layer for quick lookup
  const serviceToLayer = new Map<string, { name: string }>();
  for (const layer of layers.layers) {
    for (const svc of layer.provides) {
      serviceToLayer.set(svc, layer);
    }
  }

  // For each requirement, find a matching layer and render it
  const renderedLayers = new Set<string>();
  for (const req of allRequirements) {
    const layer = serviceToLayer.get(req);
    if (!layer) continue;

    const layerId = sanitizeId(`layer_${layer.name}`);
    // Only render each layer node once per diagram
    if (!renderedLayers.has(layerId)) {
      renderedLayers.add(layerId);
      const provides = layer.name === req
        ? req
        : `provides: ${req}`;
      lines.push(
        `  ${layerId}[/"${escapeLabel(layer.name)}<br/><i>${escapeLabel(provides)}</i>"/]`,
      );
    }

    // Dotted edge from wrapper (or first node) to layer
    const sourceId = wrapperId ?? sanitizeId(nodes[0].id);
    lines.push(`  ${sourceId} -. "${escapeLabel(req)}" .-> ${layerId}`);
  }
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
