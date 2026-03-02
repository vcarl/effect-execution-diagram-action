import * as path from "node:path";
import type { AnalysisResult, AnalysisNode } from "./analyzer.js";
import { sanitizeId } from "../diagrams/mermaid.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScopeNode {
  id: string;                    // sanitized scope name
  name: string;                  // original scope name (e.g. "handleRequest")
  file: string;                  // absolute path
  line: number;                  // first line of scope
  scopeType: "gen" | "pipe" | "effect" | "layer";
  signature?: {
    success?: string;
    error?: string;
    requirements?: string[];
  };
  refs: string[];                // scope names this scope calls
  nodeCount: number;             // how many analysis nodes in this scope
  handledErrors?: string[];      // error types caught within
  escapingErrors?: string[];     // error types that propagate out
}

export interface ScopeEdge {
  from: string;                  // scope ID
  to: string;                    // scope ID
  label?: string;                // e.g. "Effect.fork", "Effect.forEach"
}

export interface ScopeTree {
  scopes: ScopeNode[];
  edges: ScopeEdge[];
  fileGroups: Map<string, string[]>;  // file path → scope IDs
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildScopeTree(result: AnalysisResult): ScopeTree {
  // 1. Group nodes by scope
  const scopeGroups = new Map<string, AnalysisNode[]>();
  for (const node of result.nodes) {
    const key = node.scope ?? "(anonymous)";
    if (!scopeGroups.has(key)) scopeGroups.set(key, []);
    scopeGroups.get(key)!.push(node);
  }

  // Skip synthetic combinator scopes (contain "$")
  const scopes: ScopeNode[] = [];
  const scopeIdMap = new Map<string, string>(); // scope name → sanitized ID

  for (const [scopeName, nodes] of scopeGroups) {
    if (scopeName.includes("$")) continue;
    if (nodes.length === 0) continue;

    const id = sanitizeId(`scope_${scopeName}`);
    scopeIdMap.set(scopeName, id);

    const file = nodes[0].file;
    const line = Math.min(...nodes.map(n => n.line));

    // Determine scopeType
    const scopeType = determineScopeType(scopeName, nodes, result);

    // Extract type signature from gen-start or first typed node
    const signature = extractSignature(nodes);

    // Collect refs (cross-scope calls), including from synthetic child scopes.
    // Synthetic scopes like "handleBatch$forEach" are children of "handleBatch",
    // so bubble up their non-synthetic refs to the parent.
    const refs: string[] = [];
    const allScopeNodes = [...nodes];
    for (const [childScope, childNodes] of scopeGroups) {
      if (childScope.startsWith(scopeName + "$")) {
        allScopeNodes.push(...childNodes);
      }
    }
    for (const node of allScopeNodes) {
      if (node.ref && !node.ref.includes("$") && node.ref !== scopeName) {
        if (!refs.includes(node.ref)) refs.push(node.ref);
      }
    }

    // Error info
    const handledErrors: string[] = [];
    const escapingErrors: string[] = [];
    for (const node of nodes) {
      if (node.errorHandler && node.errorType) {
        if (!handledErrors.includes(node.errorType)) {
          handledErrors.push(node.errorType);
        }
      } else if (node.errorTypes) {
        for (const et of node.errorTypes) {
          if (!handledErrors.includes(et) && !escapingErrors.includes(et)) {
            escapingErrors.push(et);
          }
        }
      } else if (node.errorType && node.errorType !== "never" && !node.errorHandler) {
        if (!handledErrors.includes(node.errorType) && !escapingErrors.includes(node.errorType)) {
          escapingErrors.push(node.errorType);
        }
      }
    }

    scopes.push({
      id,
      name: scopeName,
      file,
      line,
      scopeType,
      ...(signature ? { signature } : {}),
      refs,
      nodeCount: nodes.length,
      ...(handledErrors.length > 0 ? { handledErrors } : {}),
      ...(escapingErrors.length > 0 ? { escapingErrors } : {}),
    });
  }

  // 2. Build edges from refs
  const edges: ScopeEdge[] = [];
  for (const scope of scopes) {
    for (const ref of scope.refs) {
      // Resolve target: try file-qualified match first, then bare name
      const sourceNode = findRefSourceNode(scopeGroups.get(scope.name) ?? [], ref);
      const targetId = resolveTargetId(ref, scopes, scopeIdMap, sourceNode);
      if (targetId) {
        const label = sourceNode?.refLabel;
        edges.push({
          from: scope.id,
          to: targetId,
          ...(label ? { label } : {}),
        });
      }
    }
  }

  // 3. Group scopes by file
  const fileGroups = new Map<string, string[]>();
  for (const scope of scopes) {
    if (!fileGroups.has(scope.file)) fileGroups.set(scope.file, []);
    fileGroups.get(scope.file)!.push(scope.id);
  }

  return { scopes, edges, fileGroups };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function determineScopeType(
  scopeName: string,
  nodes: AnalysisNode[],
  result: AnalysisResult,
): ScopeNode["scopeType"] {
  // Check if this scope is a known layer
  if (result.layers.some(l => l.name === scopeName)) return "layer";

  const kinds = new Set(nodes.map(n => n.kind));
  if (kinds.has("gen-start")) return "gen";
  if (kinds.has("pipe-step")) return "pipe";
  return "effect";
}

function extractSignature(
  nodes: AnalysisNode[],
): ScopeNode["signature"] | undefined {
  // Prefer gen-start node for signature
  const genStart = nodes.find(n => n.kind === "gen-start");
  const source = genStart ?? nodes.find(n => n.successType || n.errorType || n.requirements);
  if (!source) return undefined;

  const sig: NonNullable<ScopeNode["signature"]> = {};
  if (source.successType) sig.success = source.successType;
  if (source.errorType) sig.error = source.errorType;
  if (source.requirements) sig.requirements = source.requirements;

  if (Object.keys(sig).length === 0) return undefined;
  return sig;
}

function findRefSourceNode(nodes: AnalysisNode[], ref: string): AnalysisNode | undefined {
  return nodes.find(n => n.ref === ref);
}

function resolveTargetId(
  ref: string,
  scopes: ScopeNode[],
  scopeIdMap: Map<string, string>,
  sourceNode?: AnalysisNode,
): string | undefined {
  // If the source node has a refFile, try to find a scope in that file with that name
  if (sourceNode?.refFile) {
    const target = scopes.find(s => s.file === sourceNode.refFile && s.name === ref);
    if (target) return target.id;
  }
  // Fall back to bare name match
  return scopeIdMap.get(ref);
}
