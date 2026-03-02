import * as ts from "typescript";
import { type ProjectContext, createProjectContext, getSourceFile } from "./project-setup.js";
import { runOverview, runLayerInfo } from "./cli-runner.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalysisNode {
  id: string;
  label: string;
  line: number;
  file: string;
  scope?: string;
  kind: "effect" | "gen-start" | "gen-end" | "yield" | "pipe-step";
  successType?: string;
  errorType?: string;
  errorTypes?: string[];
  requirements?: string[];
  ref?: string;
  refFile?: string;
  refLabel?: string;
  hasWeakType?: boolean;
  description?: string;
  errorHandler?: string;
}

export interface AnalysisEdge {
  from: string;
  to: string;
  label?: string;
}

export interface ServiceInfo {
  name: string;
  file: string;
  type: string;
  typeParams?: string[];
}

export interface LayerInfo {
  name: string;
  file: string;
  type: string;
  typeParams?: string[];
  provides: string[];
  requires: string[];
  suggestedComposition?: string[];
}

export interface ErrorInfo {
  name: string;
  file: string;
  type: string;
  typeParams?: string[];
}

export interface AnalysisResult {
  nodes: AnalysisNode[];
  edges: AnalysisEdge[];
  services: ServiceInfo[];
  layers: LayerInfo[];
  discoveredErrors: ErrorInfo[];
}

export interface AnalyzeOptions {
  maxDepth?: number;
}

// ---------------------------------------------------------------------------
// Main entry points
// ---------------------------------------------------------------------------

/**
 * Full analysis: AST walk + CLI overview/layerinfo.
 */
export async function analyze(
  tsconfigPath: string,
  files: string[],
  options?: AnalyzeOptions,
): Promise<AnalysisResult> {
  const astResult = analyzeAst(tsconfigPath, files, { maxDepth: options?.maxDepth });

  // CLI: overview + layerinfo
  const overviewResult = await runOverviewAnalysis(files, tsconfigPath);
  const layers = await enrichLayers(overviewResult.layers);

  return {
    ...astResult,
    services: overviewResult.services,
    layers,
    discoveredErrors: overviewResult.errors,
  };
}

/**
 * AST-only analysis (synchronous, no CLI calls).
 * Returns nodes/edges with empty services/layers/discoveredErrors.
 *
 * Uses iterative ref expansion: after walking the initial files, collects
 * unresolved refs, uses TypeScript's symbol resolution to find their
 * declaration files, walks those files, and repeats until resolved or
 * maxDepth is hit.
 */
export function analyzeAst(
  tsconfigPath: string,
  files: string[],
  options?: AnalyzeOptions,
): AnalysisResult {
  const maxDepth = options?.maxDepth ?? 3;
  const project = createProjectContext(tsconfigPath);
  const analyzedFiles = new Set<string>();
  const fileCache = new Map<string, { nodes: AnalysisNode[]; edges: AnalysisEdge[] }>();
  const allNodes: AnalysisNode[] = [];
  const allEdges: AnalysisEdge[] = [];
  const nodeCounter = { value: 0 };

  let pendingFiles = files;

  for (let depth = 0; depth <= maxDepth && pendingFiles.length > 0; depth++) {
    for (const filePath of pendingFiles) {
      if (analyzedFiles.has(filePath)) continue;
      analyzedFiles.add(filePath);

      let result = fileCache.get(filePath);
      if (!result) {
        result = analyzeFile(
          project,
          filePath,
          nodeCounter,
        );
        fileCache.set(filePath, result);
      }

      allNodes.push(...result.nodes);
      allEdges.push(...result.edges);
    }

    // Collect unresolved refs: nodes with ref + refFile where refFile not yet analyzed
    const unresolvedFiles = new Set<string>();
    for (const node of allNodes) {
      if (node.ref && node.refFile && !analyzedFiles.has(node.refFile)) {
        unresolvedFiles.add(node.refFile);
      }
    }
    pendingFiles = [...unresolvedFiles];
  }

  return {
    nodes: allNodes,
    edges: allEdges,
    services: [],
    layers: [],
    discoveredErrors: [],
  };
}

// ---------------------------------------------------------------------------
// Per-file analysis
// ---------------------------------------------------------------------------

interface SingleFileResult {
  nodes: AnalysisNode[];
  edges: AnalysisEdge[];
}

function analyzeFile(
  project: ProjectContext,
  filePath: string,
  nodeCounter: { value: number },
): SingleFileResult {
  const nodes: AnalysisNode[] = [];
  const edges: AnalysisEdge[] = [];

  function nextId(): string {
    return `n${nodeCounter.value++}`;
  }

  const sourceFile = getSourceFile(project, filePath);
  if (!sourceFile) return { nodes, edges };

  visitNode(sourceFile, undefined);

  function visitNode(node: ts.Node, scope: string | undefined): void {
    const newScope = getDeclarationName(node) ?? scope;

    if (ts.isCallExpression(node) && isPipeCall(node)) {
      analyzePipeChain(node, filePath, newScope);
      return;
    }

    if (ts.isCallExpression(node) && isEffectGen(node)) {
      analyzeEffectGen(node, filePath, newScope);
      return;
    }

    if (ts.isCallExpression(node) && isEffectFlatMap(node)) {
      analyzeEffectFlatMap(node, filePath, newScope);
      return;
    }

    ts.forEachChild(node, (child) => visitNode(child, newScope));
  }

  // Second pass: capture simple Effect-typed declarations not already analyzed
  analyzeSimpleEffects(sourceFile, filePath);

  return { nodes, edges };

  // -----------------------------------------------------------------------
  // Pipe chain analysis (unified flow + error)
  // -----------------------------------------------------------------------

  function analyzePipeChain(
    call: ts.CallExpression,
    file: string,
    scope?: string,
  ): void {
    const expr = call.expression;

    // Detect method-style: receiver.pipe(step1, step2, ...)
    // vs function-style: pipe(initial, step1, step2, ...)
    let initial: ts.Expression;
    let steps: readonly ts.Expression[];

    if (ts.isPropertyAccessExpression(expr) && expr.name.text === "pipe") {
      // Method-style: the receiver is the initial expression, all args are steps
      if (call.arguments.length < 1) return;
      initial = expr.expression;
      steps = call.arguments;
    } else {
      // Function-style: first arg is initial, rest are steps
      if (call.arguments.length < 2) return;
      initial = call.arguments[0];
      steps = Array.prototype.slice.call(call.arguments, 1);
    }

    const description = getJsDocDescription(call);

    // Emit entry node for the initial expression
    const entryId = nextId();
    const entryTypeInfo = getEffectTypeInfo(initial, project);
    const entryErrorInfo = getErrorTypeAtNode(initial, project);
    const entryRef = getRefName(initial);
    const entryRefFile = resolveRefFile(initial, project);

    nodes.push({
      id: entryId,
      label: summarizeExpression(initial),
      line: getLine(initial),
      file,
      scope,
      kind: "effect",
      ...entryTypeInfo,
      ...(entryErrorInfo.errorType && entryErrorInfo.errorType !== "unknown"
        ? { errorType: entryErrorInfo.errorType }
        : {}),
      ...(entryErrorInfo.errorTypes ? { errorTypes: entryErrorInfo.errorTypes } : {}),
      ...(entryRef ? { ref: entryRef } : {}),
      ...(entryRefFile ? { refFile: entryRefFile } : {}),
      ...(description ? { description } : {}),
    });

    let prevId = entryId;

    // Emit pipe-step nodes for each step
    for (const step of steps) {
      const id = nextId();
      const errorHandlerName = getErrorHandlerName(step);
      const label = errorHandlerName ?? summarizePipeStep(step);

      const typeInfo = getEffectTypeInfo(step, project);
      const errorInfo = getErrorTypeAtNode(step, project);
      const ref = getRefFromPipeStep(step);
      const refFile = resolveRefFile(step, project);

      nodes.push({
        id,
        label,
        line: getLine(step),
        file,
        scope,
        kind: "pipe-step",
        ...typeInfo,
        ...(errorInfo.errorType && errorInfo.errorType !== "unknown"
          ? { errorType: errorInfo.errorType }
          : {}),
        ...(errorInfo.errorTypes ? { errorTypes: errorInfo.errorTypes } : {}),
        ...(ref ? { ref } : {}),
        ...(refFile ? { refFile } : {}),
        ...(errorHandlerName ? { errorHandler: errorHandlerName } : {}),
      });

      edges.push({ from: prevId, to: id });
      prevId = id;
    }
  }

  // -----------------------------------------------------------------------
  // Effect.gen analysis
  // -----------------------------------------------------------------------

  function analyzeEffectGen(
    call: ts.CallExpression,
    file: string,
    scope?: string,
  ): void {
    const startId = nextId();
    const line = getLine(call);
    const genTypeInfo = getEffectTypeInfo(call, project);
    const description = getJsDocDescription(call);
    nodes.push({
      id: startId,
      label: "Effect.gen",
      line,
      file,
      scope,
      kind: "gen-start",
      ...genTypeInfo,
      ...(description ? { description } : {}),
    });

    const genFn = call.arguments[0];
    if (!genFn) return;

    let prevId = startId;
    const yieldExpressions = collectYieldExpressions(genFn);

    for (const yieldExpr of yieldExpressions) {
      const id = nextId();
      const label = summarizeYield(yieldExpr);
      const yieldedExpr = yieldExpr.expression;
      const typeInfo = yieldedExpr
        ? getEffectTypeInfo(yieldedExpr, project)
        : {};
      let ref = yieldedExpr ? getRefName(yieldedExpr) : undefined;
      let refFile = yieldedExpr ? resolveRefFile(yieldedExpr, project) : undefined;
      let refLabel: string | undefined;

      // Combinator expansion: detect Effect.fork/retry/forEach and analyze inner expr
      if (yieldedExpr && ts.isCallExpression(yieldedExpr)) {
        const combinator = getCombinatorInner(yieldedExpr);
        if (combinator) {
          const syntheticScope = `${scope ?? "anon"}$${combinator.name}`;
          visitNode(combinator.innerExpr, syntheticScope);
          // Only set ref if inner analysis produced nodes under the synthetic scope
          const hasInnerNodes = nodes.some(n => n.scope === syntheticScope);
          if (hasInnerNodes) {
            ref = syntheticScope;
            refFile = file;
            refLabel = `Effect.${combinator.name}`;
          }
        }
      }

      nodes.push({
        id,
        label,
        line: getLine(yieldExpr),
        file,
        scope,
        kind: "yield",
        ...typeInfo,
        ...(ref ? { ref } : {}),
        ...(refFile ? { refFile } : {}),
        ...(refLabel ? { refLabel } : {}),
      });
      edges.push({ from: prevId, to: id });
      prevId = id;
    }

    const endId = nextId();
    nodes.push({
      id: endId,
      label: "return",
      line: getLine(call),
      file,
      scope,
      kind: "gen-end",
    });
    edges.push({ from: prevId, to: endId });
  }

  // -----------------------------------------------------------------------
  // Effect.flatMap analysis
  // -----------------------------------------------------------------------

  function analyzeEffectFlatMap(
    call: ts.CallExpression,
    file: string,
    scope?: string,
  ): void {
    const args = call.arguments;
    if (args.length < 2) return;

    const effectId = nextId();
    const typeInfo0 = getEffectTypeInfo(args[0], project);
    nodes.push({
      id: effectId,
      label: summarizeExpression(args[0]),
      line: getLine(args[0]),
      file,
      scope,
      kind: "effect",
      ...typeInfo0,
    });

    const flatMapId = nextId();
    nodes.push({
      id: flatMapId,
      label: `flatMap: ${summarizeFnArg(args[1])}`,
      line: getLine(args[1]),
      file,
      scope,
      kind: "pipe-step",
    });

    edges.push({ from: effectId, to: flatMapId });
  }

  // -----------------------------------------------------------------------
  // Simple Effect declarations
  // -----------------------------------------------------------------------

  function analyzeSimpleEffects(sourceFile: ts.SourceFile, file: string): void {
    const analyzedScopes = new Set<string>();
    for (const node of nodes) {
      if (node.scope && node.file === file) {
        analyzedScopes.add(node.scope);
      }
    }

    for (const stmt of sourceFile.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const name = decl.name.text;
        if (analyzedScopes.has(name)) continue;
        if (!decl.initializer) continue;

        const init = decl.initializer;
        const description = getJsDocDescription(stmt);

        if (hasEffectType(init, project)) {
          const id = nextId();
          const typeInfo = getEffectTypeInfo(init, project);
          nodes.push({
            id,
            label: summarizeExpression(init),
            line: getLine(init),
            file,
            scope: name,
            kind: "effect",
            ...typeInfo,
            ...(description ? { description } : {}),
          });
          continue;
        }

        if (ts.isArrowFunction(init) && !ts.isBlock(init.body)) {
          if (hasEffectType(init.body, project)) {
            const id = nextId();
            const typeInfo = getEffectTypeInfo(init.body, project);
            nodes.push({
              id,
              label: summarizeExpression(init.body),
              line: getLine(init.body),
              file,
              scope: name,
              kind: "effect",
              ...typeInfo,
              ...(description ? { description } : {}),
            });
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CLI: overview + layerinfo
// ---------------------------------------------------------------------------

interface OverviewParseResult {
  services: ServiceInfo[];
  layers: Array<{
    name: string;
    file: string;
    type: string;
    typeParams?: string[];
  }>;
  errors: ErrorInfo[];
}

async function runOverviewAnalysis(
  files: string[],
  tsconfigPath: string,
): Promise<OverviewParseResult> {
  if (files.length === 0) {
    return { services: [], layers: [], errors: [] };
  }

  // overview returns project-wide results regardless of --file,
  // so we only need to call it once.
  try {
    const output = await runOverview(files[0], tsconfigPath);
    return parseOverviewOutput(output, files[0]);
  } catch {
    return { services: [], layers: [], errors: [] };
  }
}

async function enrichLayers(
  overviewLayers: OverviewParseResult["layers"],
): Promise<LayerInfo[]> {
  const result: LayerInfo[] = [];

  for (const layer of overviewLayers) {
    try {
      const output = await runLayerInfo(layer.file, layer.name);
      const parsed = parseLayerInfoOutput(output, layer.name);
      result.push({
        ...layer,
        provides: parsed.provides,
        requires: parsed.requires,
        ...(parsed.suggestedComposition
          ? { suggestedComposition: parsed.suggestedComposition }
          : {}),
      });
    } catch {
      result.push({
        ...layer,
        provides: [],
        requires: [],
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Overview output parser
// ---------------------------------------------------------------------------

type Section = "errors" | "services" | "layers" | null;

export function parseOverviewOutput(
  output: string,
  defaultFile: string,
): OverviewParseResult {
  const result: OverviewParseResult = {
    services: [],
    layers: [],
    errors: [],
  };

  const lines = output.split("\n");
  let section: Section = null;
  let currentName: string | null = null;
  let currentFile = defaultFile;
  let currentType = "";

  for (const rawLine of lines) {
    const line = stripAnsi(rawLine);

    if (/^Yieldable Errors/i.test(line)) {
      flushItem();
      section = "errors";
      currentName = null;
      continue;
    }
    if (/^Services/i.test(line)) {
      flushItem();
      section = "services";
      currentName = null;
      continue;
    }
    if (/^Layers/i.test(line)) {
      flushItem();
      section = "layers";
      currentName = null;
      continue;
    }

    if (section === null || line.trim() === "") continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (indent <= 2 && trimmed.length > 0 && !trimmed.startsWith("./")) {
      flushItem();
      currentName = trimmed;
      currentFile = defaultFile;
      currentType = "";
    } else if (trimmed.startsWith("./") || trimmed.includes(":")) {
      const filePart = trimmed.split(":")[0];
      if (filePart.startsWith("./")) {
        currentFile = filePart;
      }
    } else if (indent >= 4 && trimmed.length > 0) {
      currentType = trimmed;
    }
  }

  flushItem();
  return result;

  function flushItem() {
    if (currentName && section) {
      const typeParams = parseTypeParams(currentType);
      const item = {
        name: currentName,
        file: currentFile,
        type: currentType,
        ...(typeParams.length > 0 ? { typeParams } : {}),
      };
      if (section === "errors") result.errors.push(item);
      else if (section === "services") result.services.push(item);
      else if (section === "layers") result.layers.push(item);
    }
    currentName = null;
    currentType = "";
  }
}

// ---------------------------------------------------------------------------
// Layer info output parser
// ---------------------------------------------------------------------------

interface LayerInfoParseResult {
  provides: string[];
  requires: string[];
  suggestedComposition?: string[];
}

export function parseLayerInfoOutput(
  output: string,
  layerName: string,
): LayerInfoParseResult {
  const provides: string[] = [];
  const requires: string[] = [];
  const suggestedComposition: string[] = [];

  const lines = output.split("\n").map(stripAnsi);
  let section: "provides" | "requires" | "suggested" | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^Provides\s*\(/i.test(trimmed)) {
      section = "provides";
      continue;
    }
    if (/^Requires\s*\(/i.test(trimmed)) {
      section = "requires";
      continue;
    }
    if (/^Suggested Composition/i.test(trimmed)) {
      section = "suggested";
      continue;
    }

    if (section && trimmed.startsWith("- ")) {
      const item = trimmed.slice(2).trim();
      if (item) {
        if (section === "provides") provides.push(item);
        else if (section === "requires") requires.push(item);
        else if (section === "suggested") suggestedComposition.push(item);
      }
    }
  }

  return {
    provides,
    requires,
    ...(suggestedComposition.length > 0 ? { suggestedComposition } : {}),
  };
}

// ---------------------------------------------------------------------------
// Type parameter parser
// ---------------------------------------------------------------------------

export function parseTypeParams(typeStr: string): string[] {
  const openIdx = typeStr.indexOf("<");
  if (openIdx === -1) return [];

  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < typeStr.length; i++) {
    if (typeStr[i] === "<") depth++;
    else if (typeStr[i] === ">") {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx === -1) return [];

  const inner = typeStr.slice(openIdx + 1, closeIdx);

  const params: string[] = [];
  let current = "";
  depth = 0;
  for (const ch of inner) {
    if (ch === "<") depth++;
    else if (ch === ">") depth--;
    if (ch === "," && depth === 0) {
      params.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) params.push(current.trim());

  return params;
}

// ---------------------------------------------------------------------------
// Cross-file ref resolution
// ---------------------------------------------------------------------------

function resolveRefFile(node: ts.Node, project: ProjectContext): string | undefined {
  const identifier = ts.isCallExpression(node) ? node.expression : node;
  if (!ts.isIdentifier(identifier)) return undefined;

  const symbol = project.typeChecker.getSymbolAtLocation(identifier);
  if (!symbol) return undefined;

  const resolved = (symbol.flags & ts.SymbolFlags.Alias)
    ? project.typeChecker.getAliasedSymbol(symbol)
    : symbol;

  const decl = resolved.valueDeclaration ?? resolved.declarations?.[0];
  if (!decl) return undefined;

  const fileName = decl.getSourceFile().fileName;
  if (fileName.includes("node_modules")) return undefined;
  return fileName;
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function getDeclarationName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
    return node.name.text;
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name))
    return node.name.text;
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name))
    return node.name.text;
  return undefined;
}

function isPipeCall(node: ts.CallExpression): boolean {
  const expr = node.expression;
  if (ts.isIdentifier(expr) && expr.text === "pipe") return true;
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === "pipe")
    return true;
  return false;
}

function isEffectGen(node: ts.CallExpression): boolean {
  const expr = node.expression;
  if (!ts.isPropertyAccessExpression(expr)) return false;
  if (expr.name.text !== "gen") return false;
  const obj = expr.expression;
  return ts.isIdentifier(obj) && obj.text === "Effect";
}

/** Known Effect combinators whose first (or second) argument contains analyzable structure. */
const COMBINATOR_DEFS: Record<string, { argIndex: number; extractBody: boolean }> = {
  fork: { argIndex: 0, extractBody: false },
  retry: { argIndex: 0, extractBody: false },
  forEach: { argIndex: 1, extractBody: true },
};

function getCombinatorInner(
  node: ts.CallExpression,
): { name: string; innerExpr: ts.Node } | undefined {
  const expr = node.expression;
  if (!ts.isPropertyAccessExpression(expr)) return undefined;
  const methodName = expr.name.text;
  const obj = expr.expression;
  if (!ts.isIdentifier(obj) || obj.text !== "Effect") return undefined;

  const def = COMBINATOR_DEFS[methodName];
  if (!def) return undefined;

  const arg = node.arguments[def.argIndex];
  if (!arg) return undefined;

  if (def.extractBody) {
    // For forEach, extract the arrow function body
    if (ts.isArrowFunction(arg)) {
      return { name: methodName, innerExpr: arg.body };
    }
    if (ts.isFunctionExpression(arg)) {
      return { name: methodName, innerExpr: arg.body };
    }
    return undefined;
  }

  return { name: methodName, innerExpr: arg };
}

function isEffectFlatMap(node: ts.CallExpression): boolean {
  const expr = node.expression;
  if (!ts.isPropertyAccessExpression(expr)) return false;
  if (expr.name.text !== "flatMap") return false;
  const obj = expr.expression;
  return ts.isIdentifier(obj) && obj.text === "Effect";
}

function collectYieldExpressions(node: ts.Node): ts.YieldExpression[] {
  const yields: ts.YieldExpression[] = [];
  function walk(n: ts.Node) {
    if (ts.isYieldExpression(n)) {
      yields.push(n);
    }
    ts.forEachChild(n, walk);
  }
  ts.forEachChild(node, walk);
  return yields;
}

const ERROR_HANDLERS = new Set([
  "catchAll",
  "catchTag",
  "catchTags",
  "catchSome",
  "catchAllCause",
  "catchAllDefect",
  "mapError",
  "orElse",
  "orElseSucceed",
  "orElseFail",
]);

function getErrorHandlerName(node: ts.Node): string | null {
  if (!ts.isCallExpression(node)) return null;
  const expr = node.expression;
  if (ts.isPropertyAccessExpression(expr)) {
    const name = expr.name.text;
    if (ERROR_HANDLERS.has(name)) return name;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Summarization helpers
// ---------------------------------------------------------------------------

function summarizeArrayElements(elements: ts.NodeArray<ts.Expression>): string {
  return elements
    .map((el) => {
      if (ts.isCallExpression(el)) {
        const callee = el.expression.getText().trim();
        const args = el.arguments;
        if (args.length === 0) return callee + "()";
        const firstArg = args[0].getText().trim();
        if (firstArg.length > 25) return callee + "(…)";
        if (args.length > 1) return callee + "(" + firstArg + ", …)";
        return callee + "(" + firstArg + ")";
      }
      const text = el.getText().trim();
      if (text.length > 30) return text.slice(0, 27) + "...";
      return text;
    })
    .join(", ");
}

function tryExpandEffectAll(node: ts.CallExpression): string | null {
  const callee = node.expression.getText().trim();
  if (callee !== "Effect.all") return null;
  const args = node.arguments;
  if (args.length < 1) return null;
  const first = args[0];
  if (ts.isArrayLiteralExpression(first)) {
    return `Effect.all([${summarizeArrayElements(first.elements)}])`;
  }
  return null;
}

function summarizeExpression(node: ts.Node): string {
  if (ts.isCallExpression(node)) {
    const expanded = tryExpandEffectAll(node);
    if (expanded) return expanded;
    const callee = node.expression.getText().trim();
    if (callee.length <= 60) return callee + "(…)";
    return callee.slice(0, 57) + "...";
  }
  const text = node.getText().trim();
  if (text.length > 60) return text.slice(0, 57) + "...";
  return text;
}

function summarizePipeStep(node: ts.Node): string {
  if (ts.isCallExpression(node)) {
    const expr = node.expression;
    if (ts.isPropertyAccessExpression(expr)) {
      return `${expr.expression.getText()}.${expr.name.text}`;
    }
    if (ts.isIdentifier(expr)) {
      return expr.text;
    }
  }
  return summarizeExpression(node);
}

function summarizeYield(node: ts.YieldExpression): string {
  const expr = node.expression;
  if (!expr) return "yield*";
  if (ts.isCallExpression(expr)) {
    const expanded = tryExpandEffectAll(expr);
    if (expanded) return expanded;

    const callee = expr.expression.getText().trim();
    const args = expr.arguments;
    if (args.length === 0) return `${callee}()`;
    let summary = `${callee}(`;
    for (let i = 0; i < args.length; i++) {
      const argText = args[i].getText().trim();
      const sep = i > 0 ? ", " : "";
      const candidate = summary + sep + argText;
      if (candidate.length > 55) {
        summary += sep + "…";
        break;
      }
      summary = candidate;
      if (i === args.length - 1) break;
    }
    return summary + ")";
  }
  const text = expr.getText().trim();
  if (text.length > 60) return text.slice(0, 57) + "...";
  return text;
}

function summarizeFnArg(node: ts.Node): string {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const body = node.body;
    if (ts.isCallExpression(body)) {
      return summarizeExpression(body);
    }
    return "(fn)";
  }
  if (ts.isIdentifier(node)) return node.text;
  return summarizeExpression(node);
}

// ---------------------------------------------------------------------------
// Type extraction helpers
// ---------------------------------------------------------------------------

function getLine(node: ts.Node): number {
  const sourceFile = node.getSourceFile();
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return line + 1;
}

const TRIVIAL_TYPES = new Set(["never", "unknown", "any", "void"]);

function parseEffectTypeParams(
  typeStr: string,
): { a: string; e: string; r: string } | null {
  if (!typeStr.startsWith("Effect<")) return null;
  const inner = typeStr.slice(7);

  const params: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "<" || ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (ch === ">") {
      if (depth === 0) {
        params.push(inner.slice(start, i).trim());
        break;
      }
      depth--;
    } else if (ch === "," && depth === 0) {
      params.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }

  if (params.length < 3) return null;
  return { a: params[0], e: params[1], r: params[2] };
}

const WEAK_TYPE_RE = /\b(unknown|any)\b/;

function getEffectTypeInfo(
  node: ts.Node,
  project: ProjectContext,
): { successType?: string; errorType?: string; requirements?: string[]; hasWeakType?: boolean } {
  try {
    const type = project.typeChecker.getTypeAtLocation(node);
    const typeStr = project.typeChecker.typeToString(
      type,
      undefined,
      ts.TypeFormatFlags.NoTruncation,
    );

    const params = parseEffectTypeParams(typeStr);
    if (!params) return {};

    // Check raw params before trivial filtering — bare "unknown"/"any" get
    // stripped by TRIVIAL_TYPES, but we still want to flag them.
    const hasWeakType =
      WEAK_TYPE_RE.test(params.a) ||
      WEAK_TYPE_RE.test(params.e) ||
      WEAK_TYPE_RE.test(params.r);

    return {
      successType: !TRIVIAL_TYPES.has(params.a) ? params.a : undefined,
      errorType: !TRIVIAL_TYPES.has(params.e) ? params.e : undefined,
      requirements: !TRIVIAL_TYPES.has(params.r)
        ? params.r.split("|").map(s => s.trim()).filter(Boolean)
        : undefined,
      ...(hasWeakType ? { hasWeakType: true } : {}),
    };
  } catch {
    return {};
  }
}

function hasEffectType(node: ts.Node, project: ProjectContext): boolean {
  try {
    const type = project.typeChecker.getTypeAtLocation(node);
    const typeStr = project.typeChecker.typeToString(
      type,
      undefined,
      ts.TypeFormatFlags.NoTruncation,
    );
    return typeStr.startsWith("Effect<");
  } catch {
    return false;
  }
}

interface ErrorTypeInfo {
  errorType: string;
  errorTypes?: string[];
}

function getErrorTypeAtNode(
  node: ts.Node,
  project: ProjectContext,
): ErrorTypeInfo {
  try {
    const type = project.typeChecker.getTypeAtLocation(node);
    return extractErrorType(type, project);
  } catch {
    return { errorType: "unknown" };
  }
}

function extractErrorType(
  type: ts.Type,
  project: ProjectContext,
): ErrorTypeInfo {
  let errorParamType: ts.Type | undefined;

  if (type.aliasTypeArguments && type.aliasTypeArguments.length >= 2) {
    errorParamType = type.aliasTypeArguments[1];
  }

  if (!errorParamType) {
    const typeStr = project.typeChecker.typeToString(type);
    const match = typeStr.match(/^Effect<[^,]+,\s*([^,>]+)/);
    if (match) {
      return { errorType: match[1].trim() };
    }
    return { errorType: "unknown" };
  }

  const errorType = project.typeChecker.typeToString(errorParamType);

  if (errorParamType.isUnion()) {
    const members = (errorParamType as ts.UnionType).types
      .map((t) => project.typeChecker.typeToString(t))
      .filter((s) => s !== "never");
    if (members.length > 1) {
      return { errorType, errorTypes: members };
    }
  }

  return { errorType };
}

function getRefName(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) return callee.text;
  }
  return undefined;
}

function getRefFromPipeStep(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  for (const arg of node.arguments) {
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
      const body = arg.body;
      if (!ts.isBlock(body)) {
        return getRefName(body);
      }
      const returns = body.statements.filter(ts.isReturnStatement);
      if (returns.length === 1 && returns[0].expression) {
        return getRefName(returns[0].expression);
      }
    }
    if (ts.isIdentifier(arg)) {
      return arg.text;
    }
  }
  return undefined;
}

function getJsDocDescription(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      ts.isVariableStatement(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isVariableDeclaration(current)
    ) {
      break;
    }
    current = current.parent;
  }
  if (current && ts.isVariableDeclaration(current) && current.parent?.parent) {
    current = current.parent.parent;
  }
  if (!current) return undefined;

  const jsDocs = ts.getJSDocCommentsAndTags(current);
  for (const doc of jsDocs) {
    if (ts.isJSDoc(doc) && doc.comment) {
      const text =
        typeof doc.comment === "string"
          ? doc.comment
          : doc.comment.map((c) => c.text ?? "").join("");
      if (!text) continue;
      const firstLine = text.split("\n")[0].trim();
      if (firstLine.length > 80) return firstLine.slice(0, 77) + "...";
      return firstLine;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}
