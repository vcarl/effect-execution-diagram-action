#!/usr/bin/env node
/**
 * Local dev CLI for testing the analysis pipeline without GitHub.
 *
 * Usage:
 *   npx tsx src/dev.ts [options] [files...]
 *
 * Examples:
 *   npx tsx src/dev.ts src/foo.ts src/bar.ts     # analyze specific files
 *   npx tsx src/dev.ts --diff                     # analyze uncommitted changes
 *   npx tsx src/dev.ts --diff main                # analyze changes vs a base ref
 *   npx tsx src/dev.ts --all                      # analyze all project .ts files
 */
import * as path from "node:path";
import { execSync } from "node:child_process";
import { createProjectContext } from "./analysis/project-setup.js";
import { analyzeFlows } from "./analysis/flow-analyzer.js";
import { analyzeErrors } from "./analysis/error-analyzer.js";
import { renderFlowDiagram } from "./diagrams/flow-diagram.js";
import { renderErrorDiagram } from "./diagrams/error-diagram.js";

function usage(): never {
  console.log(`Usage: npx tsx src/dev.ts [options] [files...]

Options:
  --diff [ref]      Analyze files changed vs ref (default: uncommitted changes)
  --all             Analyze all .ts files in the project
  --tsconfig PATH   Path to tsconfig.json (default: tsconfig.json)
  --no-flow         Skip execution flow diagram
  --no-error        Skip error channel diagram
  -h, --help        Show this help

Examples:
  npx tsx src/dev.ts src/action.ts
  npx tsx src/dev.ts --diff
  npx tsx src/dev.ts --diff main
  npx tsx src/dev.ts --all --tsconfig test/fixtures/tsconfig.json`);
  process.exit(0);
}

function getFilesFromDiff(ref?: string): string[] {
  let cmd: string;
  if (ref) {
    cmd = `git diff --name-only --diff-filter=ACMR ${ref}`;
  } else {
    // Uncommitted changes (staged + unstaged)
    cmd = `git diff --name-only --diff-filter=ACMR HEAD 2>/dev/null; git diff --name-only --diff-filter=ACMR --cached 2>/dev/null; git ls-files --others --exclude-standard`;
  }
  const output = execSync(cmd, { encoding: "utf-8" });
  const files = [...new Set(output.split("\n").filter(Boolean))];
  return files.filter((f) => /\.(ts|tsx)$/.test(f));
}

function getAllTsFiles(tsconfigPath: string): string[] {
  const project = createProjectContext(tsconfigPath);
  return project.program
    .getSourceFiles()
    .map((sf) => sf.fileName)
    .filter((f) => !f.includes("node_modules"));
}

function mermaidBlock(title: string, mermaid: string): void {
  console.log(`### ${title}\n`);
  console.log("```mermaid");
  console.log(mermaid);
  console.log("```\n");
}

// --- Parse args ---
const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) usage();

let tsconfigPath = "tsconfig.json";
let files: string[] = [];
let includeFlow = true;
let includeError = true;
let mode: "explicit" | "diff" | "all" = "explicit";
let diffRef: string | undefined;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--tsconfig") {
    tsconfigPath = args[++i];
  } else if (arg === "--diff") {
    mode = "diff";
    // Next arg is the ref if it doesn't start with --
    if (args[i + 1] && !args[i + 1].startsWith("--")) {
      diffRef = args[++i];
    }
  } else if (arg === "--all") {
    mode = "all";
  } else if (arg === "--no-flow") {
    includeFlow = false;
  } else if (arg === "--no-error") {
    includeError = false;
  } else {
    files.push(arg);
  }
}

// --- Resolve files ---
if (mode === "diff") {
  files = getFilesFromDiff(diffRef);
} else if (mode === "all") {
  files = getAllTsFiles(tsconfigPath);
} else if (files.length === 0) {
  console.error("No files specified. Use --diff, --all, or pass file paths.");
  console.error("Run with --help for usage.");
  process.exit(1);
}

// Resolve to absolute paths
files = files.map((f) => path.resolve(f));

console.log(`Analyzing ${files.length} file(s):\n`);
for (const f of files) {
  console.log(`  ${path.relative(process.cwd(), f)}`);
}
console.log();

// --- Run analysis ---
const project = createProjectContext(tsconfigPath);

if (includeFlow) {
  const flowResult = analyzeFlows(project, files);
  if (flowResult.nodes.length > 0) {
    const diagram = renderFlowDiagram(flowResult);
    mermaidBlock("Execution Flow", diagram.mermaid);
  } else {
    console.log("### Execution Flow\n\nNo pipe/gen/flatMap patterns found.\n");
  }
}

if (includeError) {
  const errorResult = analyzeErrors(project, files);
  if (errorResult.chains.length > 0) {
    const diagram = renderErrorDiagram(errorResult);
    mermaidBlock("Error Channels", diagram.mermaid);
  } else {
    console.log("### Error Channels\n\nNo error handling patterns found.\n");
  }
}
