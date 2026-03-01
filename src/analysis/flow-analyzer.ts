import * as ts from "typescript";
import { type ProjectContext, getSourceFile } from "./project-setup.js";

export interface FlowNode {
  id: string;
  label: string;
  line: number;
  file: string;
  scope?: string;
  kind: "effect" | "gen-start" | "gen-end" | "yield" | "pipe-step";
  successType?: string;
  errorType?: string;
  requirements?: string;
  ref?: string;
  description?: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * Analyze execution flow in changed files by walking the AST
 * looking for pipe chains, Effect.gen, and flatMap patterns.
 */
export function analyzeFlows(
  project: ProjectContext,
  files: string[]
): FlowGraph {
  const allNodes: FlowNode[] = [];
  const allEdges: FlowEdge[] = [];
  let nodeCounter = 0;

  function nextId(): string {
    return `n${nodeCounter++}`;
  }

  for (const filePath of files) {
    const sourceFile = getSourceFile(project, filePath);
    if (!sourceFile) continue;

    visitNode(sourceFile, undefined);

    function visitNode(node: ts.Node, scope: string | undefined): void {
      const newScope = getDeclarationName(node) ?? scope;

      // Detect pipe() calls
      if (ts.isCallExpression(node) && isPipeCall(node)) {
        analyzePipeChain(node, filePath, newScope);
        return; // Don't recurse into children, we handled it
      }

      // Detect Effect.gen() calls
      if (ts.isCallExpression(node) && isEffectGen(node)) {
        analyzeEffectGen(node, filePath, newScope);
        return;
      }

      // Detect standalone Effect.flatMap() calls
      if (ts.isCallExpression(node) && isEffectFlatMap(node)) {
        analyzeEffectFlatMap(node, filePath, newScope);
        return;
      }

      ts.forEachChild(node, (child) => visitNode(child, newScope));
    }

    // Second pass: capture simple Effect-typed declarations not already analyzed
    analyzeSimpleEffects(sourceFile, filePath);
  }

  return { nodes: allNodes, edges: allEdges };

  /**
   * Walk top-level variable declarations and capture simple Effect-typed
   * expressions (e.g. Effect.succeed(...)) that weren't already analyzed
   * as pipe/gen/flatMap components.
   */
  function analyzeSimpleEffects(sourceFile: ts.SourceFile, file: string): void {
    // Collect scope names already captured by the main pass
    const analyzedScopes = new Set<string>();
    for (const node of allNodes) {
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

        // Case 1: const x = <Effect expression>
        if (hasEffectType(init)) {
          const id = nextId();
          const typeInfo = getEffectTypeInfo(init, project);
          allNodes.push({
            id,
            label: summarizeExpression(init),
            line: getLine(init, project),
            file,
            scope: name,
            kind: "effect",
            ...typeInfo,
            ...(description ? { description } : {}),
          });
          continue;
        }

        // Case 2: const x = (params) => <Effect expression>  (expression body only)
        if (ts.isArrowFunction(init) && !ts.isBlock(init.body)) {
          if (hasEffectType(init.body)) {
            const id = nextId();
            const typeInfo = getEffectTypeInfo(init.body, project);
            allNodes.push({
              id,
              label: summarizeExpression(init.body),
              line: getLine(init.body, project),
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

  function hasEffectType(node: ts.Node): boolean {
    try {
      const type = project.typeChecker.getTypeAtLocation(node);
      const typeStr = project.typeChecker.typeToString(
        type,
        undefined,
        ts.TypeFormatFlags.NoTruncation
      );
      return typeStr.startsWith("Effect<");
    } catch {
      return false;
    }
  }

  function analyzePipeChain(call: ts.CallExpression, file: string, scope?: string): void {
    const args = call.arguments;
    if (args.length < 2) return;

    const description = getJsDocDescription(call);
    let prevId: string | null = null;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const id = nextId();
      const label =
        i === 0 ? summarizeExpression(arg) : summarizePipeStep(arg);

      const typeInfo = getEffectTypeInfo(arg, project);
      const ref = i === 0 ? getRefName(arg) : undefined;
      allNodes.push({
        id,
        label,
        line: getLine(arg, project),
        file,
        scope,
        kind: i === 0 ? "effect" : "pipe-step",
        ...typeInfo,
        ...(ref ? { ref } : {}),
        ...(i === 0 && description ? { description } : {}),
      });

      if (prevId) {
        allEdges.push({ from: prevId, to: id });
      }
      prevId = id;
    }
  }

  function analyzeEffectGen(call: ts.CallExpression, file: string, scope?: string): void {
    const startId = nextId();
    const line = getLine(call, project);
    const genTypeInfo = getEffectTypeInfo(call, project);
    const description = getJsDocDescription(call);
    allNodes.push({
      id: startId,
      label: "Effect.gen",
      line,
      file,
      scope,
      kind: "gen-start",
      ...genTypeInfo,
      ...(description ? { description } : {}),
    });

    // Find the generator function argument
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
      const ref = yieldedExpr ? getRefName(yieldedExpr) : undefined;
      allNodes.push({
        id,
        label,
        line: getLine(yieldExpr, project),
        file,
        scope,
        kind: "yield",
        ...typeInfo,
        ...(ref ? { ref } : {}),
      });
      allEdges.push({ from: prevId, to: id });
      prevId = id;
    }

    // Add end node
    const endId = nextId();
    allNodes.push({
      id: endId,
      label: "return",
      line: getLine(call, project),
      file,
      scope,
      kind: "gen-end",
    });
    allEdges.push({ from: prevId, to: endId });
  }

  function analyzeEffectFlatMap(call: ts.CallExpression, file: string, scope?: string): void {
    const args = call.arguments;
    if (args.length < 2) return;

    const effectId = nextId();
    const typeInfo0 = getEffectTypeInfo(args[0], project);
    allNodes.push({
      id: effectId,
      label: summarizeExpression(args[0]),
      line: getLine(args[0], project),
      file,
      scope,
      kind: "effect",
      ...typeInfo0,
    });

    const flatMapId = nextId();
    allNodes.push({
      id: flatMapId,
      label: `flatMap: ${summarizeFnArg(args[1])}`,
      line: getLine(args[1], project),
      file,
      scope,
      kind: "pipe-step",
    });

    allEdges.push({ from: effectId, to: flatMapId });
  }
}

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
  // pipe(...)
  if (ts.isIdentifier(expr) && expr.text === "pipe") return true;
  // _.pipe(...) or something.pipe(...)
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

/** Summarize an array literal's elements for display inside Effect.all([...]) */
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

/** Try to expand an Effect.all/allWith call. Returns null if not applicable. */
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
    // Expand Effect.all([...]) to show full contents
    const expanded = tryExpandEffectAll(node);
    if (expanded) return expanded;
    // For other calls, show the function name without args
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
  // For call expressions in yields, just show the call without yield* prefix
  if (ts.isCallExpression(expr)) {
    // Expand Effect.all([...]) to show full contents
    const expanded = tryExpandEffectAll(expr);
    if (expanded) return expanded;

    const callee = expr.expression.getText().trim();
    const args = expr.arguments;
    if (args.length === 0) return `${callee}()`;
    // Build up args until we hit the length limit
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
  // For arrow functions, try to get a meaningful name from the body
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

function getLine(node: ts.Node, project: ProjectContext): number {
  const sourceFile = node.getSourceFile();
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return line + 1; // 1-based
}

const TRIVIAL_TYPES = new Set(["never", "unknown", "any", "void"]);

/**
 * Parse Effect<A, E, R> type params handling nested angle brackets.
 * Returns null if the string doesn't match the Effect<...> pattern.
 */
function parseEffectTypeParams(
  typeStr: string
): { a: string; e: string; r: string } | null {
  if (!typeStr.startsWith("Effect<")) return null;
  const inner = typeStr.slice(7); // skip "Effect<"

  const params: string[] = [];
  let depth = 0; // tracks <>, [], ()
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

/**
 * Extract the A (success), E (error) and R (requirements) type parameters from an
 * Effect<A, E, R> type at a given node.  Returns only non-trivial values.
 */
function getEffectTypeInfo(
  node: ts.Node,
  project: ProjectContext
): { successType?: string; errorType?: string; requirements?: string } {
  try {
    const type = project.typeChecker.getTypeAtLocation(node);
    const typeStr = project.typeChecker.typeToString(
      type,
      undefined,
      ts.TypeFormatFlags.NoTruncation
    );

    const params = parseEffectTypeParams(typeStr);
    if (!params) return {};

    return {
      successType: !TRIVIAL_TYPES.has(params.a) ? params.a : undefined,
      errorType: !TRIVIAL_TYPES.has(params.e) ? params.e : undefined,
      requirements: !TRIVIAL_TYPES.has(params.r) ? params.r : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Extract a reference name from a node if it refers to another program.
 * - Simple identifier: `loadConfig` → "loadConfig"
 * - Call expression: `processOrder(orderId)` → "processOrder"
 * - Property access calls: `http.get(...)` → undefined (method call, not a program)
 */
function getRefName(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) return callee.text;
    // Don't treat property access calls (e.g. http.get(...)) as program refs
  }
  return undefined;
}

/**
 * Extract the first line of a JSDoc comment from the nearest enclosing
 * declaration of the given node. Returns undefined if no JSDoc is found.
 */
function getJsDocDescription(node: ts.Node): string | undefined {
  // Walk up to find the enclosing declaration (variable statement or function)
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
  // For VariableDeclaration, check parent VariableStatement for the JSDoc
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
      // Take first line only, truncate if long
      const firstLine = text.split("\n")[0].trim();
      if (firstLine.length > 80) return firstLine.slice(0, 77) + "...";
      return firstLine;
    }
  }
  return undefined;
}
