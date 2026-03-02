import type { AnalysisResult } from "../analysis/analyzer.js";
import type { ScopeTree } from "../analysis/scope-tree.js";
import type { DiagramSection } from "../github/comment.js";
import { renderOverviewDiagram } from "./overview-diagram.js";
import { renderFlowDiagrams } from "./flow-diagram.js";
import { renderErrorDiagrams } from "./error-diagram.js";
import { renderSequenceDiagrams } from "./sequence-diagram.js";
import { renderLayerDiagram } from "./layer-diagram.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LensContext {
  analysis: AnalysisResult;
  scopeTree: ScopeTree;
}

export interface LensOverrides {
  [lensName: string]: boolean | undefined;
}

export interface DiagramLens {
  name: string;
  shouldApply(ctx: LensContext): boolean;
  priority: number;
  render(ctx: LensContext): DiagramSection[];
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export function applyLenses(
  ctx: LensContext,
  lenses: DiagramLens[],
  overrides?: LensOverrides,
): DiagramSection[] {
  const sorted = [...lenses].sort((a, b) => a.priority - b.priority);
  const sections: DiagramSection[] = [];

  for (const lens of sorted) {
    const override = overrides?.[lens.name];
    if (override === false) continue;
    if (override === true || lens.shouldApply(ctx)) {
      sections.push(...lens.render(ctx));
    }
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Lens definitions
// ---------------------------------------------------------------------------

export const overviewLens: DiagramLens = {
  name: "overview",
  priority: 10,
  shouldApply(ctx) {
    return ctx.scopeTree.scopes.length > 3;
  },
  render(ctx) {
    if (ctx.scopeTree.scopes.length === 0) return [];
    return [{
      title: "Scope Overview",
      mermaid: renderOverviewDiagram(ctx.scopeTree),
    }];
  },
};

export const flowLens: DiagramLens = {
  name: "flow",
  priority: 20,
  shouldApply(ctx) {
    return ctx.analysis.nodes.length > 0;
  },
  render(ctx) {
    const diagrams = renderFlowDiagrams(ctx.analysis);
    return diagrams.map(d => ({
      title: `Execution Flow: ${d.label}`,
      mermaid: d.mermaid,
      ...(d.truncated ? { truncated: true } : {}),
    }));
  },
};

export const errorLens: DiagramLens = {
  name: "error",
  priority: 30,
  shouldApply(ctx) {
    return ctx.analysis.nodes.some(n => n.errorHandler);
  },
  render(ctx) {
    const diagrams = renderErrorDiagrams(ctx.analysis);
    return diagrams.map(d => ({
      title: `Error Channels: ${d.label}`,
      mermaid: d.mermaid,
      ...(d.truncated ? { truncated: true } : {}),
    }));
  },
};

export const sequenceLens: DiagramLens = {
  name: "sequence",
  priority: 40,
  shouldApply() {
    return false;
  },
  render(ctx) {
    const diagrams = renderSequenceDiagrams(ctx.analysis);
    return diagrams.map(d => ({
      title: `Sequence: ${d.label}`,
      mermaid: d.mermaid,
      ...(d.truncated ? { truncated: true } : {}),
    }));
  },
};

export const layerLens: DiagramLens = {
  name: "layer",
  priority: 50,
  shouldApply(ctx) {
    return ctx.analysis.layers.length > 0;
  },
  render(ctx) {
    if (ctx.analysis.layers.length === 0) return [];
    const result = renderLayerDiagram(ctx.analysis.layers);
    return [{
      title: "Layer Dependencies",
      mermaid: result.mermaid,
      ...(result.truncated
        ? { truncated: true, shownNodes: result.shownNodes, totalNodes: result.totalNodes }
        : {}),
    }];
  },
};

export const defaultLenses: DiagramLens[] = [
  overviewLens,
  flowLens,
  errorLens,
  sequenceLens,
  layerLens,
];
