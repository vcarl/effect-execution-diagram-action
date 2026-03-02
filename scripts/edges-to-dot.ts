#!/usr/bin/env node
/**
 * Convert analysis JSON edges (and optionally nodes) to Graphviz DOT notation.
 *
 * Accepts either:
 *   - A full analysis result (with .nodes and .edges)
 *   - A bare array of edges
 *
 * Usage:
 *   npx tsx scripts/edges-to-dot.ts < analysis.json
 *   npx tsx src/dev.ts --json --all --tsconfig test/fixtures/tsconfig.json | npx tsx scripts/edges-to-dot.ts
 */

const chunks: Buffer[] = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const input = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  const edges: { from: string; to: string; label?: string }[] = input.edges ?? input;
  const nodes: { id: string; label?: string; scope?: string }[] | undefined = input.nodes;

  const lines: string[] = ["digraph G {"];

  if (nodes) {
    for (const n of nodes) {
      const label = n.label ?? n.scope ?? n.id;
      lines.push(`  ${n.id} [label="${label.replace(/"/g, '\\"')}"];`);
    }
  }

  for (const e of edges) {
    const attr = e.label ? ` [label="${e.label.replace(/"/g, '\\"')}"]` : "";
    lines.push(`  ${e.from} -> ${e.to}${attr};`);
  }

  lines.push("}");
  console.log(lines.join("\n"));
});
