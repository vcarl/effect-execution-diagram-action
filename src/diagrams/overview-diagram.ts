import * as path from "node:path";
import type { ScopeTree, ScopeNode } from "../analysis/scope-tree.js";
import { escapeLabel, sanitizeId } from "./mermaid.js";

/**
 * Render a single Mermaid flowchart showing all scopes grouped by file,
 * with edges for cross-scope references.
 */
export function renderOverviewDiagram(tree: ScopeTree): string {
  const lines: string[] = ["flowchart TD"];

  // One subgraph per file
  for (const [file, scopeIds] of tree.fileGroups) {
    const fileShort = path.basename(file);
    const fileId = sanitizeId(`overview_${fileShort}`);
    lines.push(`  subgraph ${fileId} ["${escapeLabel(fileShort)}"]`);

    for (const scopeId of scopeIds) {
      const scope = tree.scopes.find(s => s.id === scopeId);
      if (!scope) continue;
      lines.push(`    ${renderScopeNode(scope)}`);
    }

    lines.push(`  end`);
  }

  // Edges between scopes
  for (const edge of tree.edges) {
    if (edge.label) {
      lines.push(`  ${edge.from} -->|"${escapeLabel(edge.label)}"| ${edge.to}`);
    } else {
      lines.push(`  ${edge.from} --> ${edge.to}`);
    }
  }

  return lines.join("\n");
}

function renderScopeNode(scope: ScopeNode): string {
  const label = buildScopeLabel(scope);

  // Layer scopes get trapezoid shape, everything else gets rounded rect
  if (scope.scopeType === "layer") {
    return `${scope.id}[/"${label}"\\]`;
  }
  return `${scope.id}(["${label}"])`;
}

function buildScopeLabel(scope: ScopeNode): string {
  const parts: string[] = [];

  // Name + type indicator
  parts.push(`${escapeLabel(scope.name)} (${scope.scopeType})`);

  // Type signature
  const sig = formatSignature(scope);
  if (sig) parts.push(sig);

  // Node count if > 1
  if (scope.nodeCount > 1) {
    parts.push(`${scope.nodeCount} nodes`);
  }

  return parts.join("<br/>");
}

function formatSignature(scope: ScopeNode): string | undefined {
  if (!scope.signature) return undefined;

  const a = scope.signature.success ?? "_";
  const e = scope.signature.error ?? "never";
  const r = scope.signature.requirements?.join(" | ") ?? "never";

  // Skip if everything is trivial
  if (a === "_" && e === "never" && r === "never") return undefined;

  return `Effect&lt;${escapeLabel(a)}, ${escapeLabel(e)}, ${escapeLabel(r)}&gt;`;
}
