import * as core from "@actions/core";
import * as github from "@actions/github";
import { getChangedFiles } from "./github/changed-files.js";
import { upsertComment, formatComment, type DiagramSection } from "./github/comment.js";
import { createProjectContext } from "./analysis/project-setup.js";
import { analyzeOverview } from "./analysis/overview-parser.js";
import { analyzeLayerInfo } from "./analysis/layerinfo-parser.js";
import { analyzeFlows } from "./analysis/flow-analyzer.js";
import { analyzeErrors } from "./analysis/error-analyzer.js";
import { renderLayerDiagram } from "./diagrams/layer-diagram.js";
import { renderFlowDiagram } from "./diagrams/flow-diagram.js";
import { renderErrorDiagram } from "./diagrams/error-diagram.js";

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

  // 2. Set up TypeScript project context
  const project = createProjectContext(tsconfigPath);

  // 3. Determine which analyses are needed
  const needFlow = includeFlow;
  const needLayer = includeLayer || includeFlow;
  const needError = includeError;

  // 4. Run analyses
  let flowResults: ReturnType<typeof analyzeFlows> | undefined;
  let overviewResults: Awaited<ReturnType<typeof analyzeOverview>> | undefined;
  let layerResults: Awaited<ReturnType<typeof analyzeLayerInfo>> | undefined;
  let errorResults: ReturnType<typeof analyzeErrors> | undefined;

  if (needFlow) {
    core.info("Analyzing execution flow...");
    flowResults = analyzeFlows(project, changedFiles);
  }

  if (needLayer) {
    core.info("Analyzing layer dependencies...");
    overviewResults = await analyzeOverview(changedFiles, tsconfigPath);
    if (overviewResults.layers.length > 0) {
      layerResults = await analyzeLayerInfo(
        overviewResults.layers,
        tsconfigPath
      );
    }
  }

  if (needError) {
    core.info("Analyzing error channels...");
    errorResults = analyzeErrors(project, changedFiles);
  }

  // 5. Build diagram sections
  const sections: DiagramSection[] = [];

  if (includeFlow && flowResults && flowResults.nodes.length > 0) {
    sections.push({
      title: "Execution Flow",
      ...renderFlowDiagram(flowResults, layerResults),
    });
  }

  if (includeLayer && layerResults) {
    sections.push({
      title: "Layer Dependencies",
      ...renderLayerDiagram(layerResults),
    });
  }

  if (includeError && errorResults && errorResults.chains.length > 0) {
    sections.push({
      title: "Error Channels",
      ...renderErrorDiagram(errorResults),
    });
  }

  // 6. Post comment
  if (sections.length === 0) {
    core.info("No Effect-TS patterns found in changed files, skipping comment.");
    return;
  }

  const body = formatComment(sections);
  await upsertComment(octokit, owner, repo, pullNumber, body);
  core.info("Posted diagram comment on PR.");
}
