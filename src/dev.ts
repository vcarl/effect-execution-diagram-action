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
import { analyze } from "./analysis/analyzer.js";
import { renderFlowDiagrams } from "./diagrams/flow-diagram.js";
import { renderErrorDiagrams } from "./diagrams/error-diagram.js";

function usage(): never {
  console.log(`Usage: npx tsx src/dev.ts [options] [files...]

Options:
  --diff [ref]      Analyze files changed vs ref (default: uncommitted changes)
  --all             Analyze all .ts files in the project
  --tsconfig PATH   Path to tsconfig.json (default: tsconfig.json)
  --json            Output raw analysis JSON (skips diagram rendering)
  --no-flow         Skip execution flow diagram
  --no-error        Skip error channel diagram
  --max-depth N     Max depth for cross-file ref expansion (default: 3, 0 disables)
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
let jsonOutput = false;
let includeFlow = true;
let includeError = true;
let maxDepth: number | undefined;
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
  } else if (arg === "--json") {
    jsonOutput = true;
  } else if (arg === "--no-flow") {
    includeFlow = false;
  } else if (arg === "--no-error") {
    includeError = false;
  } else if (arg === "--max-depth") {
    maxDepth = parseInt(args[++i], 10);
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

// Use stderr for status messages so stdout stays clean for --json piping
const log = jsonOutput ? console.error : console.log;
log(`Analyzing ${files.length} file(s):\n`);
for (const f of files) {
  log(`  ${path.relative(process.cwd(), f)}`);
}
log();

// --- Run analysis ---
async function main() {
  const result = await analyze(tsconfigPath, files, {
    ...(maxDepth !== undefined ? { maxDepth } : {}),
  });

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (includeFlow) {
    if (result.nodes.length > 0) {
      const diagrams = renderFlowDiagrams(result);
      for (const diagram of diagrams) {
        mermaidBlock(`Execution Flow: ${diagram.label}`, diagram.mermaid);
      }
      if (diagrams.length === 0) {
        console.log("### Execution Flow\n\nNo pipe/gen/flatMap patterns found.\n");
      }
    } else {
      console.log("### Execution Flow\n\nNo pipe/gen/flatMap patterns found.\n");
    }
  }

  if (includeError) {
    const hasErrorHandlers = result.nodes.some((n) => n.errorHandler);
    if (hasErrorHandlers) {
      const diagrams = renderErrorDiagrams(result);
      for (const diagram of diagrams) {
        mermaidBlock(`Error Channels: ${diagram.label}`, diagram.mermaid);
      }
    } else {
      console.log("### Error Channels\n\nNo error handling patterns found.\n");
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
