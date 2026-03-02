import * as core from "@actions/core";
import * as github from "@actions/github";
import { getChangedFiles } from "./github/changed-files.js";
import { upsertComment, formatComment } from "./github/comment.js";
import { analyze } from "./analysis/analyzer.js";
import { buildScopeTree } from "./analysis/scope-tree.js";
import { applyLenses, defaultLenses, type LensOverrides } from "./diagrams/lens.js";

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

  // 3. Build diagram sections via lens pipeline
  const scopeTree = buildScopeTree(result);
  const ctx = { analysis: result, scopeTree };

  const overrides: LensOverrides = {};
  if (!includeFlow) overrides.flow = false;
  if (!includeLayer) overrides.layer = false;
  if (!includeError) overrides.error = false;

  const sections = applyLenses(ctx, defaultLenses, overrides);

  // 4. Post comment
  if (sections.length === 0) {
    core.info("No Effect-TS patterns found in changed files, skipping comment.");
    return;
  }

  const body = formatComment(sections);
  await upsertComment(octokit, owner, repo, pullNumber, body);
  core.info("Posted diagram comment on PR.");
}
