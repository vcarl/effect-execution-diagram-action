import type { ProgramMapData, ProgramSummary, LayerSummary } from "../analysis/program-map.js";
import { escapeLabel, sanitizeId, truncateIfNeeded } from "./mermaid.js";

export interface ProgramMapDiagramResult {
  mermaid: string;
  truncated?: boolean;
  shownNodes?: number;
  totalNodes?: number;
}

export function renderProgramMapDiagram(
  data: ProgramMapData
): ProgramMapDiagramResult {
  const allNodes = [...data.programs, ...data.layers];
  const { info } = truncateIfNeeded(allNodes);

  const lines: string[] = ["flowchart TB"];

  // Group programs by file
  const programsByFile = new Map<string, ProgramSummary[]>();
  for (const prog of data.programs) {
    const file = prog.file;
    if (!programsByFile.has(file)) programsByFile.set(file, []);
    programsByFile.get(file)!.push(prog);
  }

  // Group layers by file
  const layersByFile = new Map<string | undefined, LayerSummary[]>();
  for (const layer of data.layers) {
    const file = layer.file;
    if (!layersByFile.has(file)) layersByFile.set(file, []);
    layersByFile.get(file)!.push(layer);
  }

  // Render program subgraphs by file
  for (const [file, progs] of programsByFile) {
    const fileShort = file.split("/").pop() ?? file;
    const subgraphId = sanitizeId(`file_${file}`);
    lines.push(`  subgraph ${subgraphId} ["${escapeLabel(fileShort)}"]`);
    for (const prog of progs) {
      lines.push(`    ${renderProgramNode(prog)}`);
    }
    lines.push("  end");
  }

  // Render layer subgraphs by file
  for (const [file, layers] of layersByFile) {
    const subgraphLabel = file
      ? (file.split("/").pop() ?? file)
      : "Layers";
    const subgraphId = sanitizeId(`layers_${file ?? "shared"}`);
    lines.push(`  subgraph ${subgraphId} ["${escapeLabel(subgraphLabel)}"]`);
    for (const layer of layers) {
      lines.push(`    ${renderLayerNode(layer)}`);
    }
    lines.push("  end");
  }

  // Render edges
  for (const edge of data.edges) {
    const from = sanitizeId(edge.programId);
    const to = sanitizeId(edge.layerId);
    lines.push(`  ${from} -. "${escapeLabel(edge.serviceName)}" .-> ${to}`);
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

function renderProgramNode(prog: ProgramSummary): string {
  const id = sanitizeId(prog.id);
  const parts: string[] = [];
  parts.push(`${prog.kind}: ${prog.stepCount} steps`);

  const effectAnno = buildProgramEffectAnnotation(prog);
  if (effectAnno) parts.push(effectAnno);

  const detail = parts.join(" · ");
  return `${id}["${escapeLabel(prog.name)}<br/><i>${detail}</i>"]`;
}

/**
 * Build `Effect<A, E, R>` annotation for a program summary, using the same
 * trailing-trivial-omission rules as the flow diagram.
 */
function buildProgramEffectAnnotation(prog: ProgramSummary): string | undefined {
  const a = prog.successType;
  const e = prog.errorType;
  const r = prog.requirements.length > 0 ? prog.requirements.join(" | ") : undefined;

  if (!a && !e && !r) return undefined;

  const ea = a ? escapeLabel(a) : "_";
  const ee = e ? escapeLabel(e) : "_";
  const er = r ? escapeLabel(r) : undefined;

  // Only A non-trivial
  if (a && !e && !r) return `Effect&lt;${ea}&gt;`;
  // A and E non-trivial, R trivial
  if (a && e && !r) return `Effect&lt;${ea}, ${ee}&gt;`;
  // All present
  if (a && e && r) return `Effect&lt;${ea}, ${ee}, ${er}&gt;`;
  // A and R but no E
  if (a && !e && r) return `Effect&lt;${ea}, _, ${er}&gt;`;
  // E only
  if (!a && e && !r) return `Effect&lt;_, ${ee}&gt;`;
  // R only
  if (!a && !e && r) return `Effect&lt;_, _, ${er}&gt;`;
  // E and R
  if (!a && e && r) return `Effect&lt;_, ${ee}, ${er}&gt;`;

  return undefined;
}

function renderLayerNode(layer: LayerSummary): string {
  const id = sanitizeId(layer.id);
  const parts: string[] = [];
  if (layer.provides.length > 0)
    parts.push(`provides: ${escapeLabel(layer.provides.join(", "))}`);
  if (layer.requires.length > 0)
    parts.push(`requires: ${escapeLabel(layer.requires.join(", "))}`);
  const detail = parts.length > 0 ? `Layer → ${parts.join("<br/>")}` : "Layer";
  return `${id}["${escapeLabel(layer.name)}<br/><i>${detail}</i>"]`;
}
