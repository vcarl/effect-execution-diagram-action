import * as core from "@actions/core";
import * as github from "@actions/github";
import { getChangedFiles } from "./github/changed-files.js";
import { upsertComment, formatComment, type DiagramSection } from "./github/comment.js";
import { analyze } from "./analysis/analyzer.js";
import { renderLayerDiagram } from "./diagrams/layer-diagram.js";
import { renderFlowDiagrams } from "./diagrams/flow-diagram.js";
import { renderErrorDiagrams } from "./diagrams/error-diagram.js";

export async function run(): Promise<void> {
  const token = core.getInput("github-token", { required: true });
  const tsconfigPath = core.getInput("tsconfig-path") || "tsconfig.json";
  const includeFlow = core.getBooleanInput("include-flow-diagram");
  const includeLayer = core.getBooleanInput("include-layer-diagram");
  const includeError = core.getBooleanInput("include-error-diagram");

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const pullNumber = github.context.payload.pull_request?.number;

  if (!pullNumber) {
    core.warning("This action only works on pull_request events.");
    return;
  }

  core.info(`Analyzing PR #${pullNumber}...`);

  // 1. Get changed TypeScript files
  const changedFiles = await getChangedFiles(octokit, owner, repo, pullNumber);
  core.info(`Found ${changedFiles.length} changed TypeScript files.`);

  if (changedFiles.length === 0) {
    core.info("No TypeScript files changed, skipping.");
    return;
  }

  // 2. Run unified analysis
  core.info("Running analysis...");
  const result = await analyze(tsconfigPath, changedFiles);

  // 3. Build diagram sections
  const sections: DiagramSection[] = [];

  if (includeFlow && result.nodes.length > 0) {
    for (const diagram of renderFlowDiagrams(result)) {
      sections.push({
        title: `Execution Flow: ${diagram.label}`,
        ...diagram,
      });
    }
  }

  if (includeLayer && result.layers.length > 0) {
    sections.push({
      title: "Layer Dependencies",
      ...renderLayerDiagram(result.layers),
    });
  }

  if (includeError && result.nodes.some((n) => n.errorHandler)) {
    for (const diagram of renderErrorDiagrams(result)) {
      sections.push({
        title: `Error Channels: ${diagram.label}`,
        ...diagram,
      });
    }
  }

  // 4. Post comment
  if (sections.length === 0) {
    core.info("No Effect-TS patterns found in changed files, skipping comment.");
    return;
  }

  const body = formatComment(sections);
  await upsertComment(octokit, owner, repo, pullNumber, body);
  core.info("Posted diagram comment on PR.");
}
