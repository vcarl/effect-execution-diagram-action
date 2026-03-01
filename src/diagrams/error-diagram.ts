import type { ErrorAnalysisResult, ErrorStep } from "../analysis/error-analyzer.js";
import { escapeLabel, sanitizeId } from "./mermaid.js";

export interface ErrorDiagramResult {
  label: string;
  mermaid: string;
  truncated?: boolean;
}

/**
 * Render one diagram per error chain, labelled with the enclosing
 * scope + file name.
 */
export function renderErrorDiagrams(
  analysis: ErrorAnalysisResult
): ErrorDiagramResult[] {
  const results: ErrorDiagramResult[] = [];

  for (const chain of analysis.chains.filter((c) => c.steps.length > 2)) {
    const firstStep = chain.steps[0];
    const fileShort = firstStep
      ? (firstStep.file.split("/").pop() ?? firstStep.file)
      : "unknown";
    const label = firstStep?.scope
      ? `${firstStep.scope} · ${fileShort}`
      : fileShort;

    const lines: string[] = ["flowchart LR"];
    for (const step of chain.steps) {
      const id = sanitizeId(step.id);
      const stepLabel = escapeLabel(step.label);
      lines.push(`  ${id}${shapeFor(step, stepLabel)}`);
    }
    for (const edge of chain.edges) {
      const from = sanitizeId(edge.from);
      const to = sanitizeId(edge.to);
      const errorLabel = escapeLabel(edge.errorLabel);
      lines.push(`  ${from} -->|"E: ${errorLabel}"| ${to}`);
    }

    results.push({ label, mermaid: lines.join("\n") });
  }

  return results;
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
