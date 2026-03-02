import * as path from "node:path";
import type { AnalysisResult, AnalysisNode, AnalysisEdge, LayerInfo } from "../analysis/analyzer.js";
import { splitConnectedComponents } from "../analysis/graph-utils.js";
import { escapeLabel, sanitizeId, truncateIfNeeded } from "./mermaid.js";

export interface FlowDiagramResult {
  label: string;
  mermaid: string;
  truncated?: boolean;
}

/**
 * Render one diagram per file, with each scope as a nested subgraph.
 *
 * When a node has a `ref` that matches another scope, that sub-program is
 * inlined as a mermaid subgraph, recursively expanding nested references
 * (with cycle prevention).
 */
export function renderFlowDiagrams(
  analysis: AnalysisResult,
): FlowDiagramResult[] {
  const components = splitConnectedComponents(analysis);
  const results: FlowDiagramResult[] = [];

  // Build scope name → component map for sub-program lookup.
  // Dual keys: file-qualified ("filePath::scope") for cross-file disambiguation,
  // and bare name ("scope") as fallback for same-file refs.
  const scopeMap = new Map<string, { nodes: AnalysisNode[]; edges: AnalysisEdge[] }>();
  for (const comp of components) {
    const scope = comp.nodes[0]?.scope;
    const file = comp.nodes[0]?.file;
    if (scope) {
      if (file) scopeMap.set(`${file}::${scope}`, comp);
      if (!scopeMap.has(scope)) scopeMap.set(scope, comp);
    }
  }

  // Group multi-node components by file.
  // Exclude synthetic combinator scopes (contain "$") — they are expanded inline via refs.
  const fileMap = new Map<string, Array<{ nodes: AnalysisNode[]; edges: AnalysisEdge[] }>>();
  for (const comp of components) {
    if (comp.nodes.length <= 1) continue;
    const scope = comp.nodes[0]?.scope;
    if (scope && scope.includes("$")) continue;
    const file = comp.nodes[0]?.file;
    if (!file) continue;
    if (!fileMap.has(file)) fileMap.set(file, []);
    fileMap.get(file)!.push(comp);
  }

  for (const [file, comps] of fileMap) {
    const fileShort = path.basename(file);
    const fileId = sanitizeId(`file_${fileShort}`);
    const lines: string[] = ["flowchart TD"];
    lines.push(`  subgraph ${fileId} ["${escapeLabel(fileShort)}"]`);

    // Track gen-start node IDs → scope subgraph IDs for layer edge resolution
    const genStartToScopeId = new Map<string, string>();
    const allFileNodes: AnalysisNode[] = [];

    for (const comp of comps) {
      const { items: nodes, info } = truncateIfNeeded(comp.nodes);
      const nodeIds = new Set(nodes.map((n) => n.id));
      const edges = comp.edges.filter(
        (e) => nodeIds.has(e.from) && nodeIds.has(e.to),
      );

      const first = nodes[0];
      const scope = first?.scope ?? "";
      const scopeId = sanitizeId(`scope_${scope}`);

      const isGenFlow = first?.kind === "gen-start";
      const genStartId = isGenFlow ? first.id : undefined;

      // Build scope subgraph label
      let scopeLabel: string;
      if (isGenFlow) {
        const annotation = buildEffectAnnotation(first);
        scopeLabel = annotation
          ? `${escapeLabel(scope)}<br/><i>${annotation}</i>`
          : escapeLabel(scope);
        genStartToScopeId.set(first.id, scopeId);
      } else {
        scopeLabel = escapeLabel(scope);
      }

      lines.push(`    subgraph ${scopeId} ["${scopeLabel}"]`);

      // Skip gen-start for gen flows (absorbed into scope label)
      const renderNodes = isGenFlow ? nodes.slice(1) : nodes;
      const renderEdges = isGenFlow
        ? edges.filter((e) => e.from !== genStartId)
        : edges;

      const nodeIdMap = renderComponentNodes(
        renderNodes,
        renderEdges,
        scopeMap,
        scope,
        "",
        "      ",
        lines,
        new Set([scope]),
        file,
      );

      // Render edges, redirecting inlined nodes to their subgraph IDs
      for (const edge of renderEdges) {
        const fromId = nodeIdMap.get(edge.from) ?? sanitizeId(edge.from);
        const toId = nodeIdMap.get(edge.to) ?? sanitizeId(edge.to);

        if (edge.label) {
          lines.push(`      ${fromId} -->|"${escapeLabel(edge.label)}"| ${toId}`);
        } else {
          lines.push(`      ${fromId} --> ${toId}`);
        }
      }

      lines.push(`    end`);
      allFileNodes.push(...comp.nodes);
    }

    lines.push(`  end`);

    // Render layer nodes + dotted edges when layer data is available
    if (analysis.layers.length > 0) {
      renderLayerEdges(allFileNodes, analysis.layers, genStartToScopeId, lines);
    }

    results.push({
      label: fileShort,
      mermaid: lines.join("\n"),
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
 * @param currentFile - file path of the diagram being rendered (for cross-file provenance)
 *
 * Returns a map of original node IDs → rendered IDs for inlined nodes
 * (subgraph IDs), so the caller can redirect edges.
 */
function renderComponentNodes(
  nodes: AnalysisNode[],
  edges: AnalysisEdge[],
  scopeMap: Map<string, { nodes: AnalysisNode[]; edges: AnalysisEdge[] }>,
  sgPrefix: string,
  nodePrefix: string,
  indent: string,
  lines: string[],
  expandedRefs: Set<string>,
  currentFile: string,
): Map<string, string> {
  const nodeIdMap = new Map<string, string>();
  const refOccurrences = new Map<string, number>();
  const subIndent = indent + "  ";

  function renderedNodeId(originalId: string): string {
    return sanitizeId(nodePrefix ? `${nodePrefix}_${originalId}` : originalId);
  }

  for (const node of nodes) {
    // Look up ref component: prefer file-qualified key, fall back to bare name
    let refComp: { nodes: AnalysisNode[]; edges: AnalysisEdge[] } | undefined;
    if (node.ref) {
      if (node.refFile) refComp = scopeMap.get(`${node.refFile}::${node.ref}`);
      if (!refComp) refComp = scopeMap.get(node.ref);
    }
    // Inline if we have a matching component and haven't already expanded this ref (cycle prevention)
    if (refComp && !expandedRefs.has(node.ref!)) {
      const count = refOccurrences.get(node.ref!) ?? 0;
      refOccurrences.set(node.ref!, count + 1);
      const suffix = count > 0 ? `_${count}` : "";
      const sgId = sanitizeId(`sg_${sgPrefix}_${node.ref}${suffix}`);
      nodeIdMap.set(node.id, sgId);

      // Determine subgraph label
      let sgLabel: string;
      if (node.refLabel) {
        sgLabel = escapeLabel(node.refLabel);
      } else if (node.refFile && node.refFile !== currentFile) {
        const refFileShort = path.basename(node.refFile);
        sgLabel = `${escapeLabel(node.ref!)} (${escapeLabel(refFileShort)})`;
      } else {
        sgLabel = escapeLabel(node.ref!);
      }

      // For gen-flow sub-programs, add Effect type annotation to label
      const isChildGen = refComp.nodes[0]?.kind === "gen-start";
      if (isChildGen) {
        const annotation = buildEffectAnnotation(refComp.nodes[0]);
        if (annotation) sgLabel += `<br/><i>${annotation}</i>`;
      }

      lines.push(`${indent}subgraph ${sgId} ["${sgLabel}"]`);

      const childPrefix = `${sgPrefix}_${node.ref}${suffix}`;
      const childExpandedRefs = new Set(expandedRefs);
      childExpandedRefs.add(node.ref!);

      // For gen-flow sub-programs, skip the gen-start node
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
        currentFile,
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
  analysis: AnalysisResult,
): FlowDiagramResult {
  const results = renderFlowDiagrams(analysis);
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
function buildEffectAnnotation(node: AnalysisNode): string | undefined {
  const a = node.successType;
  const e = node.errorType;
  const r = node.requirements?.join(" | ");

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

function buildLabel(node: AnalysisNode): string {
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
 * Collect requirements from a file's nodes, match them to layers,
 * and render trapezoid layer nodes with dotted edges.
 *
 * @param genStartToScopeId - maps gen-start node IDs to their scope subgraph IDs,
 *   fixing the ghost node bug where gen-start nodes are absorbed into scope labels
 *   but renderLayerEdges would otherwise reference the non-existent node ID.
 */
function renderLayerEdges(
  nodes: AnalysisNode[],
  layers: LayerInfo[],
  genStartToScopeId: Map<string, string>,
  lines: string[],
): void {
  // Collect all unique requirement service names from the component
  const allRequirements = new Set<string>();
  for (const node of nodes) {
    if (node.requirements) {
      for (const req of node.requirements) {
        allRequirements.add(req);
      }
    }
  }
  if (allRequirements.size === 0) return;

  // Build a map of service name → layer for quick lookup
  const serviceToLayer = new Map<string, { name: string }>();
  for (const layer of layers) {
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

    // Dotted edges from nodes that have this requirement to the layer.
    // Resolve gen-start IDs through genStartToScopeId to avoid ghost references.
    const sourceNodes = nodes.filter(n => n.requirements?.includes(req));
    for (const sourceNode of sourceNodes) {
      const sourceId = genStartToScopeId.get(sourceNode.id) ?? sanitizeId(sourceNode.id);
      lines.push(`  ${sourceId} -. "${escapeLabel(req)}" .-> ${layerId}`);
    }
  }
}

function shapeFor(node: AnalysisNode): string {
  const label = buildLabel(node);
  switch (node.kind) {
    case "gen-start":
    case "gen-end":
      return `(["${label}"])`;
    case "yield":
    case "pipe-step":
      return `(["${label}"])`;
    case "effect":
    default:
      return `["${label}"]`;
  }
}
