import { runLayerInfo } from "./cli-runner.js";
import type { LayerInfo } from "./overview-parser.js";

export interface LayerDependency {
  name: string;
  provides: string[];
  requires: string[];
}

export interface LayerAnalysisResult {
  layers: LayerDependency[];
}

/**
 * For each layer discovered by `overview`, run `layerinfo` to get its
 * provides/requires relationships.
 *
 * Expected layerinfo output format:
 *   layerName
 *     ./path:line:col
 *     Layer<Out, In>
 *
 *   Provides (N):
 *     - ServiceType
 *     - AnotherService
 *
 *   Requires (N):
 *     - RequiredService
 *
 *   Suggested Composition:
 *     ...
 */
export async function analyzeLayerInfo(
  layers: LayerInfo[],
  tsconfigPath: string
): Promise<LayerAnalysisResult> {
  const result: LayerDependency[] = [];

  for (const layer of layers) {
    try {
      const output = await runLayerInfo(layer.file, layer.name, tsconfigPath);
      const parsed = parseLayerInfoOutput(output, layer.name);
      result.push(parsed);
    } catch {
      // Layer may not be analyzable; skip
      result.push({ name: layer.name, provides: [], requires: [] });
    }
  }

  return { layers: result };
}

export function parseLayerInfoOutput(
  output: string,
  layerName: string
): LayerDependency {
  const provides: string[] = [];
  const requires: string[] = [];

  const lines = output.split("\n").map(stripAnsi);
  let section: "provides" | "requires" | null = null;

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
      section = null;
      continue;
    }

    if (section && trimmed.startsWith("- ")) {
      const item = trimmed.slice(2).trim();
      if (item) {
        if (section === "provides") provides.push(item);
        else requires.push(item);
      }
    }
  }

  return { name: layerName, provides, requires };
}

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, "");
}
