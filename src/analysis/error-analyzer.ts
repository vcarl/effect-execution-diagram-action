import * as ts from "typescript";
import { type ProjectContext, getSourceFile } from "./project-setup.js";

export interface ErrorStep {
  id: string;
  label: string;
  errorType: string;
  errorTypes?: string[];
  line: number;
  file: string;
  scope?: string;
  kind: "operation" | "catch" | "mapError";
}

export interface ErrorEdge {
  from: string;
  to: string;
  errorLabel: string;
}

export interface ErrorChain {
  steps: ErrorStep[];
  edges: ErrorEdge[];
}

export interface ErrorAnalysisResult {
  chains: ErrorChain[];
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

/**
 * Analyze error channel propagation in changed files.
 * Walks pipe chains and tracks how the E type parameter changes
 * through error-handling combinators.
 */
export function analyzeErrors(
  project: ProjectContext,
  files: string[]
): ErrorAnalysisResult {
  const chains: ErrorChain[] = [];
  let nodeCounter = 0;

  function nextId(): string {
    return `e${nodeCounter++}`;
  }

  for (const filePath of files) {
    const sourceFile = getSourceFile(project, filePath);
    if (!sourceFile) continue;

    visitNode(sourceFile, undefined);

    function visitNode(node: ts.Node, scope: string | undefined): void {
      const newScope = getDeclarationName(node) ?? scope;
      if (ts.isCallExpression(node) && isPipeCall(node)) {
        const chain = analyzePipeErrors(node, filePath, newScope);
        if (chain && chain.steps.length > 0) {
          chains.push(chain);
        }
        return;
      }
      ts.forEachChild(node, (child) => visitNode(child, newScope));
    }
  }

  return { chains };

  function analyzePipeErrors(
    call: ts.CallExpression,
    file: string,
    scope?: string
  ): ErrorChain | null {
    const args = call.arguments;
    if (args.length < 2) return null;

    const steps: ErrorStep[] = [];
    const edges: ErrorEdge[] = [];
    let hasErrorHandler = false;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const errorHandlerName = getErrorHandlerName(arg);

      if (errorHandlerName) {
        hasErrorHandler = true;
      }

      const id = nextId();
      const errorInfo = getErrorTypeAtNode(arg, project);
      const label =
        i === 0
          ? summarizeExpression(arg)
          : errorHandlerName ?? summarizePipeStep(arg);

      steps.push({
        id,
        label,
        errorType: errorInfo.errorType,
        ...(errorInfo.errorTypes ? { errorTypes: errorInfo.errorTypes } : {}),
        line: getLine(arg),
        file,
        scope,
        kind: errorHandlerName
          ? errorHandlerName === "mapError"
            ? "mapError"
            : "catch"
          : "operation",
      });

      if (i > 0) {
        edges.push({
          from: steps[i - 1].id,
          to: id,
          errorLabel: steps[i - 1].errorType,
        });
      }
    }

    // Only return chains that have error-handling steps
    if (!hasErrorHandler) return null;
    return { steps, edges };
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

function getErrorHandlerName(node: ts.Node): string | null {
  if (!ts.isCallExpression(node)) return null;
  const expr = node.expression;
  if (ts.isPropertyAccessExpression(expr)) {
    const name = expr.name.text;
    if (ERROR_HANDLERS.has(name)) return name;
  }
  return null;
}

interface ErrorTypeInfo {
  errorType: string;
  errorTypes?: string[];
}

function getErrorTypeAtNode(node: ts.Node, project: ProjectContext): ErrorTypeInfo {
  try {
    const type = project.typeChecker.getTypeAtLocation(node);
    return extractErrorType(type, project);
  } catch {
    return { errorType: "unknown" };
  }
}

function extractErrorType(type: ts.Type, project: ProjectContext): ErrorTypeInfo {
  // Try to get the E type parameter as a Type object
  let errorParamType: ts.Type | undefined;

  if (type.aliasTypeArguments && type.aliasTypeArguments.length >= 2) {
    errorParamType = type.aliasTypeArguments[1];
  }

  // Fall back to string parsing if aliasTypeArguments didn't work
  if (!errorParamType) {
    const typeStr = project.typeChecker.typeToString(type);
    const match = typeStr.match(/^Effect<[^,]+,\s*([^,>]+)/);
    if (match) {
      return { errorType: match[1].trim() };
    }
    return { errorType: "unknown" };
  }

  const errorType = project.typeChecker.typeToString(errorParamType);

  // Decompose union types into individual members
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

function isPipeCall(node: ts.CallExpression): boolean {
  const expr = node.expression;
  if (ts.isIdentifier(expr) && expr.text === "pipe") return true;
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === "pipe")
    return true;
  return false;
}

function summarizeExpression(node: ts.Node): string {
  if (ts.isCallExpression(node)) {
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
    if (ts.isIdentifier(expr)) return expr.text;
  }
  return summarizeExpression(node);
}

function getLine(node: ts.Node): number {
  const sourceFile = node.getSourceFile();
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return line + 1;
}
