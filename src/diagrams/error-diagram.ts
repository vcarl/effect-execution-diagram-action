import type { ErrorAnalysisResult, ErrorStep } from "../analysis/error-analyzer.js";
import { escapeLabel, sanitizeId, truncateIfNeeded } from "./mermaid.js";

export interface ErrorDiagramResult {
  mermaid: string;
  truncated?: boolean;
  shownNodes?: number;
  totalNodes?: number;
}

export function renderErrorDiagram(
  analysis: ErrorAnalysisResult
): ErrorDiagramResult {
  const allSteps = analysis.chains.flatMap((c) => c.steps);
  const { info } = truncateIfNeeded(allSteps);

  const lines: string[] = ["flowchart LR"];

  for (const chain of analysis.chains) {
    for (const step of chain.steps) {
      const id = sanitizeId(step.id);
      const label = escapeLabel(step.label);
      lines.push(`  ${id}${shapeFor(step, label)}`);
    }

    for (const edge of chain.edges) {
      const from = sanitizeId(edge.from);
      const to = sanitizeId(edge.to);
      const errorLabel = escapeLabel(edge.errorLabel);
      lines.push(`  ${from} -->|"E: ${errorLabel}"| ${to}`);
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

function shapeFor(step: ErrorStep, label: string): string {
  switch (step.kind) {
    case "catch":
      return `{"${label}"}`;
    case "mapError":
      return `[/"${label}"/]`;
    case "operation":
    default:
      return `["${label}"]`;
  }
}
