import { runOverview } from "./cli-runner.js";

export interface ServiceInfo {
  name: string;
  file: string;
  type: string;
}

export interface LayerInfo {
  name: string;
  file: string;
  type: string;
}

export interface ErrorInfo {
  name: string;
  file: string;
  type: string;
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
      const item = { name: currentName, file: currentFile, type: currentType };
      if (section === "errors") result.errors.push(item);
      else if (section === "services") result.services.push(item);
      else if (section === "layers") result.layers.push(item);
    }
    currentName = null;
    currentType = "";
  }
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}
