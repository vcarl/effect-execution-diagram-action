import type { LayerAnalysisResult, LayerDependency } from "../analysis/layerinfo-parser.js";
import { escapeLabel, sanitizeId, truncateIfNeeded } from "./mermaid.js";

export interface LayerDiagramResult {
  mermaid: string;
  truncated?: boolean;
  shownNodes?: number;
  totalNodes?: number;
}

export function renderLayerDiagram(
  analysis: LayerAnalysisResult
): LayerDiagramResult {
  const { items: layers, info } = truncateIfNeeded(analysis.layers);

  const lines: string[] = ["flowchart TB"];

  // Build a map of service -> providing layer for edge linking
  const serviceProviders = new Map<string, string>();
  for (const layer of layers) {
    for (const svc of layer.provides) {
      serviceProviders.set(svc, layer.name);
    }
  }

  for (const layer of layers) {
    const layerId = sanitizeId(layer.name);
    lines.push(`  subgraph ${layerId} ["${escapeLabel(layer.name)}"]`);

    if (layer.provides.length > 0) {
      lines.push(`    ${layerId}_p["Provides:\\n${layer.provides.map(escapeLabel).join("\\n")}"]`);
    }
    if (layer.requires.length > 0) {
      lines.push(`    ${layerId}_r["Requires:\\n${layer.requires.map(escapeLabel).join("\\n")}"]`);
    }

    lines.push("  end");
  }

  // Draw dependency edges: required service -> providing layer
  for (const layer of layers) {
    const layerId = sanitizeId(layer.name);
    for (const req of layer.requires) {
      const provider = serviceProviders.get(req);
      if (provider) {
        const providerId = sanitizeId(provider);
        lines.push(
          `  ${layerId}_r -. "${escapeLabel(req)}" .-> ${providerId}_p`
        );
      }
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
