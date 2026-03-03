import * as path from "node:path";
import type {
  AnalysisResult,
  AnalysisNode,
  AnalysisEdge,
  ServiceInfo,
  LayerInfo,
} from "../analysis/analyzer.js";
import type { ScopeTree, ScopeNode } from "../analysis/scope-tree.js";
import { splitConnectedComponents } from "../analysis/graph-utils.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SequenceDiagramResult {
  label: string;
  mermaid: string; // "zenuml\n..." (goes inside ```mermaid block)
  truncated?: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render one ZenUML sequence diagram per top-level scope (gen function or
 * pipe chain). Synthetic combinator scopes (containing "$") are expanded
 * inline and not rendered as standalone diagrams.
 *
 * When a ScopeTree is provided, uses its signature data as a fallback for
 * type comments on scopes where node-level type data is missing.
 */
export function renderSequenceDiagrams(
  analysis: AnalysisResult,
  scopeTree?: ScopeTree,
): SequenceDiagramResult[] {
  const components = splitConnectedComponents(analysis);
  const results: SequenceDiagramResult[] = [];

  // Build scope → component map for sub-program expansion
  const scopeMap = buildScopeMap(components);

  // Service name set for quick lookup
  const serviceNames = new Set(analysis.services.map((s) => s.name));

  // Build scope name → ScopeNode map for signature fallback
  const scopeTreeMap = new Map<string, ScopeNode>();
  if (scopeTree) {
    for (const s of scopeTree.scopes) {
      scopeTreeMap.set(s.name, s);
    }
  }

  for (const comp of components) {
    if (comp.nodes.length <= 1) continue;
    const scope = comp.nodes[0]?.scope;
    // Skip synthetic combinator scopes — they get expanded inline
    if (scope && scope.includes("$")) continue;

    const diagram = renderScope(
      comp.nodes,
      comp.edges,
      scopeMap,
      serviceNames,
      analysis.services,
      scopeTreeMap,
    );
    if (!diagram) continue;

    const file = comp.nodes[0]?.file ?? "";
    const fileShort = path.basename(file);
    const label = scope ? `${scope} · ${fileShort}` : fileShort;

    results.push({ label, mermaid: diagram });
  }

  // Layer diagram
  if (analysis.layers.length > 0) {
    const layerDiagram = renderLayerDiagram(analysis.layers);
    if (layerDiagram) {
      results.push({ label: "Layer Construction", mermaid: layerDiagram });
    }
  }

  return results;
}

/** Convenience wrapper: returns the first diagram result. */
export function renderSequenceDiagram(
  analysis: AnalysisResult,
): SequenceDiagramResult {
  const results = renderSequenceDiagrams(analysis);
  return results[0] ?? { label: "", mermaid: "zenuml\n" };
}

/**
 * Render overview sequence diagrams showing scope-to-scope call chains.
 * Produces one ZenUML diagram per root scope (scopes with outgoing edges
 * but no incoming edges from the ScopeTree).
 */
export function renderOverviewSequence(
  tree: ScopeTree,
): SequenceDiagramResult[] {
  const results: SequenceDiagramResult[] = [];

  // Build adjacency: who calls whom
  const outgoing = new Map<string, ScopeNode[]>();
  const incoming = new Set<string>();

  const scopeById = new Map<string, ScopeNode>();
  for (const scope of tree.scopes) {
    scopeById.set(scope.id, scope);
  }

  for (const edge of tree.edges) {
    const source = scopeById.get(edge.from);
    const target = scopeById.get(edge.to);
    if (!source || !target) continue;

    if (!outgoing.has(source.id)) outgoing.set(source.id, []);
    outgoing.get(source.id)!.push(target);
    incoming.add(target.id);
  }

  // Root scopes: have outgoing edges, no incoming edges
  const roots = tree.scopes.filter(
    (s) => outgoing.has(s.id) && !incoming.has(s.id),
  );

  for (const root of roots) {
    const lines: string[] = ["zenuml"];

    // Type comment for root
    const rootTypeComment = buildScopeTypeComment(root);
    if (rootTypeComment) lines.push(rootTypeComment);

    lines.push(`@Starter(${sanitizeParticipant(root.name)})`);

    // Walk call chain (BFS to avoid cycles)
    const visited = new Set<string>();
    renderOverviewCalls(root, outgoing, scopeById, visited, lines, "");

    const label = `Overview: ${root.name}`;
    results.push({ label, mermaid: lines.join("\n") });
  }

  return results;
}

function renderOverviewCalls(
  scope: ScopeNode,
  outgoing: Map<string, ScopeNode[]>,
  scopeById: Map<string, ScopeNode>,
  visited: Set<string>,
  lines: string[],
  indent: string,
): void {
  visited.add(scope.id);

  const callees = outgoing.get(scope.id) ?? [];
  for (const callee of callees) {
    if (visited.has(callee.id)) continue;

    const typeComment = buildScopeTypeComment(callee);
    if (typeComment) lines.push(`${indent}${typeComment}`);

    // Check if callee has its own calls
    const calleeCallees = outgoing.get(callee.id) ?? [];
    const hasChildren = calleeCallees.some((c) => !visited.has(c.id));

    if (hasChildren) {
      lines.push(`${indent}${sanitizeParticipant(callee.name)}() {`);
      if (callee.handledErrors?.length) {
        lines.push(`${indent}  // catches: ${callee.handledErrors.join(", ")}`);
      }
      renderOverviewCalls(callee, outgoing, scopeById, visited, lines, indent + "  ");
      lines.push(`${indent}}`);
    } else {
      lines.push(`${indent}${sanitizeParticipant(callee.name)}()`);
      if (callee.handledErrors?.length) {
        lines.push(`${indent}// catches: ${callee.handledErrors.join(", ")}`);
      }
    }
  }
}

function buildScopeTypeComment(scope: ScopeNode): string | undefined {
  if (!scope.signature) return undefined;

  const parts: string[] = [];
  parts.push(scope.signature.success ?? "_");
  if (scope.signature.error || scope.signature.requirements?.length) {
    parts.push(scope.signature.error ?? "never");
  }
  if (scope.signature.requirements?.length) {
    parts.push(scope.signature.requirements.join(" | "));
  }

  if (parts.length === 1 && parts[0] === "_") return undefined;

  return `// ${scope.name}: Effect<${parts.join(", ")}>`;
}

// ---------------------------------------------------------------------------
// Scope map
// ---------------------------------------------------------------------------

type ScopeComponent = { nodes: AnalysisNode[]; edges: AnalysisEdge[] };

function buildScopeMap(
  components: ScopeComponent[],
): Map<string, ScopeComponent> {
  const scopeMap = new Map<string, ScopeComponent>();
  for (const comp of components) {
    const scope = comp.nodes[0]?.scope;
    const file = comp.nodes[0]?.file;
    if (scope) {
      if (file) scopeMap.set(`${file}::${scope}`, comp);
      if (!scopeMap.has(scope)) scopeMap.set(scope, comp);
    }
  }
  return scopeMap;
}

// ---------------------------------------------------------------------------
// Variable → service map
// ---------------------------------------------------------------------------

/**
 * Scan nodes for the pattern: yield node with ref=ServiceName followed by
 * a node whose label starts with "varName.". This means the gen function
 * did `const varName = yield* ServiceName`, so varName.method() calls
 * should be rendered as ServiceName.method().
 *
 * Only maps lowercase-starting names (local variables), not uppercase module
 * names like Effect, Ref, Stream, etc.
 */
function buildVarServiceMap(
  ordered: AnalysisNode[],
  serviceNames: Set<string>,
): Map<string, string> {
  const map = new Map<string, string>();

  // Pass 1: match service yields to the first direct lowercase-dot label
  for (let i = 0; i < ordered.length; i++) {
    const node = ordered[i];
    if (node.kind !== "yield") continue;
    if (!node.ref || !serviceNames.has(node.ref)) continue;

    for (let j = i + 1; j < ordered.length; j++) {
      const later = ordered[j];
      const dotMatch = later.label.match(/^([a-z_$][a-zA-Z0-9_$]*)\./);
      if (dotMatch && !map.has(dotMatch[1])) {
        map.set(dotMatch[1], node.ref);
        break;
      }
    }
  }

  // Pass 2: for unmapped service yields, scan Effect.all elements
  const mappedServices = new Set(map.values());
  for (let i = 0; i < ordered.length; i++) {
    const node = ordered[i];
    if (node.kind !== "yield") continue;
    if (!node.ref || !serviceNames.has(node.ref)) continue;
    if (mappedServices.has(node.ref)) continue;

    for (let j = i + 1; j < ordered.length; j++) {
      const later = ordered[j];
      const allElements = parseEffectAllElements(later.label);
      if (!allElements) continue;
      let found = false;
      for (const elem of allElements) {
        const elemMatch = elem.match(/^([a-z_$][a-zA-Z0-9_$]*)\./);
        if (elemMatch && !map.has(elemMatch[1])) {
          map.set(elemMatch[1], node.ref);
          mappedServices.add(node.ref);
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Node ordering (follow edges)
// ---------------------------------------------------------------------------

function orderNodes(
  nodes: AnalysisNode[],
  edges: AnalysisEdge[],
): AnalysisNode[] {
  if (nodes.length === 0) return [];

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, string>();
  const incoming = new Set<string>();
  for (const edge of edges) {
    outgoing.set(edge.from, edge.to);
    incoming.add(edge.to);
  }

  // Find the start node (no incoming edges)
  let startId = nodes[0].id;
  for (const node of nodes) {
    if (!incoming.has(node.id)) {
      startId = node.id;
      break;
    }
  }

  const ordered: AnalysisNode[] = [];
  const visited = new Set<string>();
  let current: string | undefined = startId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const node = nodeMap.get(current);
    if (node) ordered.push(node);
    current = outgoing.get(current);
  }

  return ordered;
}

// ---------------------------------------------------------------------------
// Per-scope rendering
// ---------------------------------------------------------------------------

function renderScope(
  nodes: AnalysisNode[],
  edges: AnalysisEdge[],
  scopeMap: Map<string, ScopeComponent>,
  serviceNames: Set<string>,
  services: ServiceInfo[],
  scopeTreeMap?: Map<string, ScopeNode>,
): string | null {
  const ordered = orderNodes(nodes, edges);
  if (ordered.length === 0) return null;

  const first = ordered[0];
  const scope = first.scope ?? "anonymous";
  const isGen = first.kind === "gen-start";
  const isPipe = first.kind === "effect" && ordered.some((n) => n.kind === "pipe-step");

  const varServiceMap = buildVarServiceMap(ordered, serviceNames);
  const lines: string[] = ["zenuml"];

  // File grouping: collect service participants from other files
  const currentFile = first.file;
  const servicesByFile = new Map<string, string[]>();
  for (const [varName, svcName] of varServiceMap) {
    const svc = services.find((s) => s.name === svcName);
    if (svc && svc.file) {
      const svcFile = svc.file.startsWith("./")
        ? path.resolve(svc.file)
        : svc.file;
      if (svcFile !== currentFile) {
        const fileShort = path.basename(svcFile);
        if (!servicesByFile.has(fileShort)) servicesByFile.set(fileShort, []);
        const arr = servicesByFile.get(fileShort)!;
        if (!arr.includes(svcName)) arr.push(svcName);
      }
    }
  }

  // Emit group declarations (must come before @Starter)
  if (servicesByFile.size >= 1) {
    const totalFiles = servicesByFile.size;
    // Only use groups when ≥2 source files contribute participants
    if (totalFiles >= 2 || (totalFiles === 1 && servicesByFile.size >= 1)) {
      for (const [fileShort, svcNames] of servicesByFile) {
        lines.push(`group "${fileShort}" {`);
        for (const s of svcNames) {
          lines.push(`  ${s}`);
        }
        lines.push(`}`);
      }
    }
  }

  // Type annotation comment (with ScopeTree signature fallback)
  const scopeTreeNode = scopeTreeMap?.get(scope);
  const typeComment = buildTypeComment(scope, first, scopeTreeNode);
  if (typeComment) lines.push(typeComment);

  // @Starter
  lines.push(`@Starter(${sanitizeParticipant(scope)})`);

  // Determine if we need try/catch wrapping (pipe chain with error handler)
  const errorHandlerNode = ordered.find((n) => n.errorHandler);
  const needsTryCatch = isPipe && errorHandlerNode;

  if (needsTryCatch) {
    lines.push("try {");

    // Check if the initial node refs a gen sub-scope (gen-in-pipe pattern)
    const genSubScope = first.ref?.endsWith("$gen")
      ? lookupScope(first.ref, first.refFile ?? currentFile, scopeMap)
      : undefined;

    if (genSubScope) {
      // Expand gen body inline inside try block
      const subOrdered = orderNodes(genSubScope.nodes, genSubScope.edges);
      // Build var→service map from the gen body nodes
      const genVarServiceMap = buildVarServiceMap(subOrdered, serviceNames);
      // Merge gen body mappings into the outer map
      const mergedVarServiceMap = new Map([...varServiceMap, ...genVarServiceMap]);

      const subBody = subOrdered[0]?.kind === "gen-start"
        ? subOrdered.slice(1)
        : subOrdered;

      for (const subNode of subBody) {
        const rendered = renderNode(
          subNode,
          mergedVarServiceMap,
          scopeMap,
          serviceNames,
          currentFile,
          "  ",
        );
        lines.push(...rendered);
      }
    } else {
      // Include the initial effect and all non-error-handler nodes in the try body
      const bodyNodes = ordered.filter((n) => !n.errorHandler);
      for (const node of bodyNodes) {
        // For the initial effect node, render its label directly (it's the pipe source)
        if (node === first) {
          lines.push(`  ${sanitizeZenUML(first.label)}`);
          continue;
        }
        const rendered = renderNode(
          node,
          varServiceMap,
          scopeMap,
          serviceNames,
          currentFile,
          "  ",
        );
        lines.push(...rendered);
      }
    }
    // catch block
    const errorType = findErrorTypeForHandler(ordered, errorHandlerNode!);
    lines.push(`} catch (${errorType}) {`);
    lines.push(`  ${sanitizeZenUML(errorHandlerNode!.label)}`);
    lines.push("}");
  } else if (isGen) {
    // Gen flow: skip gen-start, walk remaining nodes
    const bodyNodes = ordered.slice(1);

    // Check for Effect.all → par block handling
    // Check for error handlers in gen flow (from pipe wrappers around gen)
    for (const node of bodyNodes) {
      const rendered = renderNode(
        node,
        varServiceMap,
        scopeMap,
        serviceNames,
        currentFile,
        "",
      );
      lines.push(...rendered);
    }
  } else {
    // Pipe chain without error handler, or other
    const bodyNodes = first.kind === "effect" ? ordered.slice(1) : ordered;
    if (first.kind === "effect") {
      lines.push(sanitizeZenUML(first.label));
    }
    for (const node of bodyNodes) {
      const rendered = renderNode(
        node,
        varServiceMap,
        scopeMap,
        serviceNames,
        currentFile,
        "",
      );
      lines.push(...rendered);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Node rendering
// ---------------------------------------------------------------------------

function renderNode(
  node: AnalysisNode,
  varServiceMap: Map<string, string>,
  scopeMap: Map<string, ScopeComponent>,
  serviceNames: Set<string>,
  currentFile: string,
  indent: string,
): string[] {
  const lines: string[] = [];

  // gen-end → return
  if (node.kind === "gen-end") {
    const returnType = node.label === "return"
      ? findReturnValue(node)
      : node.label;
    lines.push(`${indent}return ${sanitizeReturn(returnType)}`);
    return lines;
  }

  // Service access yield (yield* Database) — skip, captured in varServiceMap
  if (node.kind === "yield" && node.ref && serviceNames.has(node.ref) && !node.refLabel) {
    // Implicit service access — no output
    return lines;
  }

  // Effect.all → par block
  const allElements = parseEffectAllElements(node.label);
  if (allElements) {
    lines.push(`${indent}par {`);
    for (const elem of allElements) {
      // Try to resolve var.method() → Service.method()
      const resolved = resolveServiceCall(elem, varServiceMap);
      lines.push(`${indent}  ${sanitizeZenUML(resolved)}`);
    }
    lines.push(`${indent}}`);
    return lines;
  }

  // Effect.forEach → forEach loop
  if (node.refLabel === "Effect.forEach") {
    const collectionArg = extractForEachCollection(node.label);
    lines.push(`${indent}forEach(${collectionArg}) {`);
    // Expand sub-scope if available
    const subLines = expandSubScope(
      node,
      scopeMap,
      varServiceMap,
      serviceNames,
      currentFile,
      indent + "  ",
    );
    if (subLines.length > 0) {
      lines.push(...subLines);
    }
    lines.push(`${indent}}`);
    return lines;
  }

  // Effect.fork → assignment
  if (node.refLabel === "Effect.fork") {
    const varName = extractVarFromLabel(node.label);
    lines.push(`${indent}${varName} = Effect.fork()`);
    return lines;
  }

  // Gen-in-pipe inline expansion: $gen refs expand their body inline
  // instead of creating a named block
  if (node.ref?.endsWith("$gen")) {
    const genComp = lookupScope(node.ref, node.refFile ?? currentFile, scopeMap);
    if (genComp) {
      const subOrdered = orderNodes(genComp.nodes, genComp.edges);
      const genVarMap = buildVarServiceMap(subOrdered, serviceNames);
      const mergedMap = new Map([...varServiceMap, ...genVarMap]);
      const subBody = subOrdered[0]?.kind === "gen-start"
        ? subOrdered.slice(1)
        : subOrdered;
      for (const subNode of subBody) {
        const rendered = renderNode(
          subNode,
          mergedMap,
          scopeMap,
          serviceNames,
          currentFile,
          indent,
        );
        lines.push(...rendered);
      }
      return lines;
    }
  }

  // Cross-file ref expansion (non-combinator)
  if (node.ref && node.refFile && !node.refLabel) {
    const refComp = lookupScope(node.ref, node.refFile, scopeMap);
    if (refComp && !serviceNames.has(node.ref)) {
      const refFileShort =
        node.refFile !== currentFile
          ? ` // expanded from ${path.basename(node.refFile)}`
          : "";
      lines.push(`${indent}${sanitizeParticipant(node.ref)}() {${refFileShort}`);
      const subOrdered = orderNodes(refComp.nodes, refComp.edges);
      // Skip gen-start if present
      const subBody =
        subOrdered[0]?.kind === "gen-start" ? subOrdered.slice(1) : subOrdered;
      for (const subNode of subBody) {
        const rendered = renderNode(
          subNode,
          varServiceMap,
          scopeMap,
          serviceNames,
          currentFile,
          indent + "  ",
        );
        lines.push(...rendered);
      }
      lines.push(`${indent}}`);
      return lines;
    }
  }

  // var.method() → Service.method()
  const label = node.label;
  const dotMatch = label.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\.(.+)/);
  if (dotMatch) {
    const [, varName, rest] = dotMatch;
    const serviceName = varServiceMap.get(varName);
    if (serviceName) {
      lines.push(`${indent}${serviceName}.${sanitizeZenUML(rest)}`);
      return lines;
    }
  }

  // Fiber.interrupt → direct call
  if (label.startsWith("Fiber.interrupt")) {
    lines.push(`${indent}${sanitizeZenUML(label)}`);
    return lines;
  }

  // Error handler node in non-try/catch context (pipe-step with errorHandler)
  if (node.errorHandler) {
    // Standalone error handler — just emit the label
    lines.push(`${indent}${sanitizeZenUML(label)}`);
    return lines;
  }

  // Default: emit label as-is
  lines.push(`${indent}${sanitizeZenUML(label)}`);
  return lines;
}

// ---------------------------------------------------------------------------
// Sub-scope expansion
// ---------------------------------------------------------------------------

function expandSubScope(
  node: AnalysisNode,
  scopeMap: Map<string, ScopeComponent>,
  varServiceMap: Map<string, string>,
  serviceNames: Set<string>,
  currentFile: string,
  indent: string,
): string[] {
  const lines: string[] = [];
  if (!node.ref) return lines;

  const refComp = lookupScope(node.ref, node.refFile, scopeMap);
  if (!refComp) return lines;

  const subOrdered = orderNodes(refComp.nodes, refComp.edges);
  for (const subNode of subOrdered) {
    const rendered = renderNode(
      subNode,
      varServiceMap,
      scopeMap,
      serviceNames,
      currentFile,
      indent,
    );
    lines.push(...rendered);
  }
  return lines;
}

function lookupScope(
  ref: string,
  refFile: string | undefined,
  scopeMap: Map<string, ScopeComponent>,
): ScopeComponent | undefined {
  if (refFile) {
    const qualified = scopeMap.get(`${refFile}::${ref}`);
    if (qualified) return qualified;
  }
  return scopeMap.get(ref);
}

// ---------------------------------------------------------------------------
// Layer diagram
// ---------------------------------------------------------------------------

function renderLayerDiagram(layers: LayerInfo[]): string | null {
  // Filter out non-layer entries (e.g. tips from CLI output)
  const realLayers = layers.filter(
    (l) => l.provides.length > 0 || l.requires.length > 0,
  );
  if (realLayers.length === 0) return null;

  const lines: string[] = ["zenuml"];

  // Group all layers
  lines.push("group Layers {");
  for (const layer of realLayers) {
    lines.push(`  ${sanitizeParticipant(layer.name)}`);
  }
  lines.push("}");

  lines.push("@Starter(Application)");

  for (const layer of realLayers) {
    const name = sanitizeParticipant(layer.name);
    lines.push(`${name}.build() {`);
    if (layer.requires.length > 0) {
      lines.push(`  // requires: ${layer.requires.join(", ")}`);
    }
    if (layer.provides.length > 0) {
      lines.push(`  // provides: ${layer.provides.join(", ")}`);
    }
    if (layer.provides.length > 0) {
      lines.push(`  return ${sanitizeParticipant(layer.provides[0])}`);
    }
    lines.push("}");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTypeComment(
  scope: string,
  node: AnalysisNode,
  scopeTreeNode?: ScopeNode,
): string | undefined {
  // Use node-level type data, falling back to ScopeTree signature
  const successType = node.successType ?? scopeTreeNode?.signature?.success;
  const errorType = node.errorType ?? scopeTreeNode?.signature?.error;
  const requirements = node.requirements ?? scopeTreeNode?.signature?.requirements;

  const parts: string[] = [];
  parts.push(successType ?? "_");
  if (errorType || (requirements && requirements.length > 0)) {
    parts.push(errorType ?? "never");
  }
  if (requirements && requirements.length > 0) {
    parts.push(requirements.join(" | "));
  }

  // Don't emit comment if all parts are trivial
  if (parts.length === 1 && parts[0] === "_") return undefined;

  return `// ${scope}: Effect<${parts.join(", ")}>`;
}

/** Parse `Effect.all([a(), b(), c()])` labels into individual elements. */
function parseEffectAllElements(label: string): string[] | null {
  const match = label.match(/^Effect\.all\(\[(.+)\]\)$/);
  if (!match) return null;

  // Split on top-level commas (respecting parentheses)
  const inner = match[1];
  const elements: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      elements.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  elements.push(inner.slice(start).trim());

  return elements.length > 0 ? elements : null;
}

/** Resolve a call expression through the var→service map. */
function resolveServiceCall(
  expr: string,
  varServiceMap: Map<string, string>,
): string {
  const dotMatch = expr.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\.(.+)/);
  if (dotMatch) {
    const [, varName, rest] = dotMatch;
    const serviceName = varServiceMap.get(varName);
    if (serviceName) return `${serviceName}.${rest}`;
  }
  return expr;
}

/** Extract collection argument from Effect.forEach label. */
function extractForEachCollection(label: string): string {
  const match = label.match(/^Effect\.forEach\(([^,)]+)/);
  if (match) return match[1].trim();
  return "items";
}

/** Extract a variable-like name from fork labels like "Effect.fork(...)". */
function extractVarFromLabel(label: string): string {
  // The label is typically "Effect.fork(…)" — use a generic name
  return "fiber";
}

/** Find the error type that a handler is catching, by looking at preceding nodes. */
function findErrorTypeForHandler(
  ordered: AnalysisNode[],
  handlerNode: AnalysisNode,
): string {
  // Look backwards from the handler for the first node with an errorType
  const idx = ordered.indexOf(handlerNode);
  for (let i = idx - 1; i >= 0; i--) {
    if (ordered[i].errorType) return ordered[i].errorType!;
  }
  // Try to extract from handler label (e.g. "catchTag" with specific tag)
  return "Error";
}

/** Find a suitable return value identifier from a gen-end node's context. */
function findReturnValue(node: AnalysisNode): string {
  return node.successType ?? "result";
}

/**
 * Sanitize a string for use as a ZenUML participant name.
 * ZenUML participant names must be valid identifiers.
 */
function sanitizeParticipant(name: string): string {
  return name.replace(/[^a-zA-Z0-9_$]/g, "_");
}

/**
 * Sanitize a string for ZenUML output. ZenUML doesn't need the same
 * escaping as Mermaid, but we need to avoid syntax-breaking characters.
 * Specifically, avoid object literal returns `{ }` at statement level.
 */
function sanitizeZenUML(text: string): string {
  // Replace template literal backticks with quotes
  return text.replace(/`/g, '"');
}

/**
 * Sanitize a return value for ZenUML. Object literals cause parse errors,
 * so simplify them to a plain identifier.
 */
function sanitizeReturn(text: string): string {
  if (!text) return "result";
  // Object literal or complex type → simplify
  if (text.includes("{") || text.includes("<")) return "result";
  // Already a simple identifier
  return sanitizeZenUML(text);
}
