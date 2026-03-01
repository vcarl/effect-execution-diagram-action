import type { FlowGraph, FlowNode } from "./flow-analyzer.js";
import type { ErrorAnalysisResult } from "./error-analyzer.js";
import type { LayerAnalysisResult } from "./layerinfo-parser.js";
import { splitConnectedComponents } from "./graph-utils.js";

export interface ProgramSummary {
  id: string;
  name: string;
  file: string;
  kind: "pipe" | "gen";
  stepCount: number;
  successType?: string;
  errorType?: string;
  requirements: string[];
}

export interface LayerSummary {
  id: string;
  name: string;
  file?: string;
  provides: string[];
  requires: string[];
}

export interface ProgramLayerEdge {
  programId: string;
  layerId: string;
  serviceName: string;
}

export interface ProgramMapData {
  programs: ProgramSummary[];
  layers: LayerSummary[];
  edges: ProgramLayerEdge[];
}

export function buildProgramMap(
  flow: FlowGraph,
  errors: ErrorAnalysisResult | undefined,
  layers: LayerAnalysisResult | undefined,
  layerFileMap?: Map<string, string>
): ProgramMapData {
  const components = splitConnectedComponents(flow);
  const programs: ProgramSummary[] = [];

  for (let i = 0; i < components.length; i++) {
    const comp = components[i];
    if (comp.nodes.length <= 1) continue;

    const kind = determineKind(comp.nodes);
    const name = comp.nodes[0]?.scope ?? "(module-level)";
    const file = comp.nodes[0]?.file ?? "unknown";
    const stepCount = countSteps(comp.nodes, kind);
    const successType = collectSuccessType(comp.nodes);
    const errorType = collectErrorType(comp.nodes, errors, file, name);
    const requirements = collectRequirements(comp.nodes);

    programs.push({
      id: `prog_${i}`,
      name,
      file,
      kind,
      stepCount,
      successType: successType || undefined,
      errorType: errorType || undefined,
      requirements,
    });
  }

  // Build layer summaries
  const layerSummaries: LayerSummary[] = [];
  if (layers) {
    for (let i = 0; i < layers.layers.length; i++) {
      const dep = layers.layers[i];
      layerSummaries.push({
        id: `layer_${i}`,
        name: dep.name,
        file: layerFileMap?.get(dep.name),
        provides: dep.provides,
        requires: dep.requires,
      });
    }
  }

  // Build edges: for each program requirement, find the layer whose provides[] includes it
  const edges: ProgramLayerEdge[] = [];
  for (const prog of programs) {
    for (const req of prog.requirements) {
      const layer = layerSummaries.find((l) => l.provides.includes(req));
      if (layer) {
        edges.push({
          programId: prog.id,
          layerId: layer.id,
          serviceName: req,
        });
      }
    }
  }

  return { programs, layers: layerSummaries, edges };
}

function determineKind(nodes: FlowNode[]): "pipe" | "gen" {
  return nodes.some((n) => n.kind === "gen-start" || n.kind === "gen-end")
    ? "gen"
    : "pipe";
}

function countSteps(nodes: FlowNode[], kind: "pipe" | "gen"): number {
  if (kind === "gen") {
    return nodes.filter((n) => n.kind === "yield").length;
  }
  // For pipe: count pipe-step nodes (excluding the initial effect)
  return nodes.filter((n) => n.kind === "pipe-step").length;
}

function collectErrorType(
  nodes: FlowNode[],
  errors: ErrorAnalysisResult | undefined,
  file: string,
  scope: string
): string {
  // Collect unique error types from flow nodes
  const errorTypes = new Set<string>();
  for (const node of nodes) {
    if (node.errorType) {
      // Split union types and add individually
      for (const part of node.errorType.split("|")) {
        const trimmed = part.trim();
        if (trimmed && trimmed !== "never") errorTypes.add(trimmed);
      }
    }
  }

  // Enrich from error chains if flow nodes lack error types
  if (errorTypes.size === 0 && errors) {
    for (const chain of errors.chains) {
      const matchesScope = chain.steps.some(
        (s) => s.file === file && s.scope === scope
      );
      if (matchesScope) {
        for (const step of chain.steps) {
          if (step.errorType && step.errorType !== "unknown" && step.errorType !== "never") {
            for (const part of step.errorType.split("|")) {
              const trimmed = part.trim();
              if (trimmed && trimmed !== "never") errorTypes.add(trimmed);
            }
          }
        }
      }
    }
  }

  if (errorTypes.size === 0) return "";
  return [...errorTypes].join(" | ");
}

function collectRequirements(nodes: FlowNode[]): string[] {
  const reqs = new Set<string>();
  for (const node of nodes) {
    if (node.requirements) {
      for (const part of node.requirements.split("|")) {
        const trimmed = part.trim();
        if (trimmed && trimmed !== "never") reqs.add(trimmed);
      }
    }
  }
  return [...reqs];
}

/** Take the last node's success type as the program's return type. */
function collectSuccessType(nodes: FlowNode[]): string {
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i].successType) return nodes[i].successType!;
  }
  return "";
}
