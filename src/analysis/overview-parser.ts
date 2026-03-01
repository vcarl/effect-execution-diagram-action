import { runOverview } from "./cli-runner.js";

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
}

export interface ErrorInfo {
  name: string;
  file: string;
  type: string;
  typeParams?: string[];
}

export interface OverviewResult {
  services: ServiceInfo[];
  layers: LayerInfo[];
  errors: ErrorInfo[];
}

type Section = "errors" | "services" | "layers" | null;

/**
 * Run `effect-language-service overview` on each file and parse the text output.
 *
 * Expected format (with NO_COLOR=1):
 *   Yieldable Errors (N)
 *     errorName
 *       ./path:line:col
 *       ErrorType
 *
 *   Services (N)
 *     serviceName
 *       ./path:line:col
 *       Context.Tag<...>
 *
 *   Layers (N)
 *     layerName
 *       ./path:line:col
 *       Layer<...>
 */
export async function analyzeOverview(
  files: string[],
  tsconfigPath: string
): Promise<OverviewResult> {
  const result: OverviewResult = {
    services: [],
    layers: [],
    errors: [],
  };

  for (const file of files) {
    try {
      const output = await runOverview(file, tsconfigPath);
      const parsed = parseOverviewOutput(output, file);
      result.services.push(...parsed.services);
      result.layers.push(...parsed.layers);
      result.errors.push(...parsed.errors);
    } catch {
      // File may not contain any Effect exports; skip silently
    }
  }

  return result;
}

export function parseOverviewOutput(
  output: string,
  defaultFile: string
): OverviewResult {
  const result: OverviewResult = {
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

    // Detect section headers
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

    // Indentation-based parsing:
    // 2-space indent = item name
    // 4-space indent = file location or type
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (indent <= 2 && trimmed.length > 0 && !trimmed.startsWith("./")) {
      flushItem();
      currentName = trimmed;
      currentFile = defaultFile;
      currentType = "";
    } else if (trimmed.startsWith("./") || trimmed.includes(":")) {
      // File location line like ./path:line:col
      const filePart = trimmed.split(":")[0];
      if (filePart.startsWith("./")) {
        currentFile = filePart;
      }
    } else if (indent >= 4 && trimmed.length > 0) {
      // Type line
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

/**
 * Extract top-level generic type parameters from a type string like
 * "Context.Tag<DatabaseService>" or "Layer<HttpServer | Logger, never>".
 * Returns an empty array if no angle brackets are found.
 */
export function parseTypeParams(typeStr: string): string[] {
  const openIdx = typeStr.indexOf("<");
  if (openIdx === -1) return [];

  // Find matching closing bracket
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

  // Split on commas at depth 0 (respecting nested <> brackets)
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

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}
