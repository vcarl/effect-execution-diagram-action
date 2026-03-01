import * as ts from "typescript";
import { type ProjectContext, getSourceFile } from "./project-setup.js";

export interface FlowNode {
  id: string;
  label: string;
  line: number;
  file: string;
  kind: "effect" | "gen-start" | "gen-end" | "yield" | "pipe-step";
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

    visitNode(sourceFile);

    function visitNode(node: ts.Node): void {
      // Detect pipe() calls
      if (ts.isCallExpression(node) && isPipeCall(node)) {
        analyzePipeChain(node, filePath);
        return; // Don't recurse into children, we handled it
      }

      // Detect Effect.gen() calls
      if (ts.isCallExpression(node) && isEffectGen(node)) {
        analyzeEffectGen(node, filePath);
        return;
      }

      // Detect standalone Effect.flatMap() calls
      if (ts.isCallExpression(node) && isEffectFlatMap(node)) {
        analyzeEffectFlatMap(node, filePath);
        return;
      }

      ts.forEachChild(node, visitNode);
    }
  }

  return { nodes: allNodes, edges: allEdges };

  function analyzePipeChain(call: ts.CallExpression, file: string): void {
    const args = call.arguments;
    if (args.length < 2) return;

    const line = getLine(call, project);
    let prevId: string | null = null;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const id = nextId();
      const label =
        i === 0 ? summarizeExpression(arg) : summarizePipeStep(arg);

      allNodes.push({
        id,
        label,
        line: getLine(arg, project),
        file,
        kind: i === 0 ? "effect" : "pipe-step",
      });

      if (prevId) {
        allEdges.push({ from: prevId, to: id });
      }
      prevId = id;
    }
  }

  function analyzeEffectGen(call: ts.CallExpression, file: string): void {
    const startId = nextId();
    const line = getLine(call, project);
    allNodes.push({
      id: startId,
      label: "Effect.gen",
      line,
      file,
      kind: "gen-start",
    });

    // Find the generator function argument
    const genFn = call.arguments[0];
    if (!genFn) return;

    let prevId = startId;
    const yieldExpressions = collectYieldExpressions(genFn);

    for (const yieldExpr of yieldExpressions) {
      const id = nextId();
      const label = summarizeYield(yieldExpr);
      allNodes.push({
        id,
        label,
        line: getLine(yieldExpr, project),
        file,
        kind: "yield",
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
      kind: "gen-end",
    });
    allEdges.push({ from: prevId, to: endId });
  }

  function analyzeEffectFlatMap(call: ts.CallExpression, file: string): void {
    const args = call.arguments;
    if (args.length < 2) return;

    const effectId = nextId();
    allNodes.push({
      id: effectId,
      label: summarizeExpression(args[0]),
      line: getLine(args[0], project),
      file,
      kind: "effect",
    });

    const flatMapId = nextId();
    allNodes.push({
      id: flatMapId,
      label: `flatMap: ${summarizeFnArg(args[1])}`,
      line: getLine(args[1], project),
      file,
      kind: "pipe-step",
    });

    allEdges.push({ from: effectId, to: flatMapId });
  }
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

function summarizeExpression(node: ts.Node): string {
  const text = node.getText().trim();
  // Truncate long expressions
  if (text.length > 40) return text.slice(0, 37) + "...";
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
  const text = expr.getText().trim();
  if (text.length > 40) return `yield* ${text.slice(0, 34)}...`;
  return `yield* ${text}`;
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
