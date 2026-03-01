import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLI_BIN = "effect-language-service";

export interface CliResult {
  stdout: string;
  stderr: string;
}

export async function runCli(args: string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync("npx", [CLI_BIN, ...args], {
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        // Disable color output for parseable text
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
    });
    return { stdout, stderr };
  } catch (error: unknown) {
    const err = error as Error & { stdout?: string; stderr?: string };
    throw new Error(
      `effect-language-service ${args.join(" ")} failed: ${err.message}\nstderr: ${err.stderr ?? ""}`
    );
  }
}

export async function runOverview(
  filePath: string,
  tsconfigPath: string
): Promise<string> {
  const result = await runCli([
    "overview",
    "--file",
    filePath,
    "--project",
    tsconfigPath,
  ]);
  return result.stdout;
}

export async function runLayerInfo(
  filePath: string,
  layerName: string,
  tsconfigPath: string
): Promise<string> {
  const result = await runCli([
    "layerinfo",
    "--file",
    filePath,
    "--name",
    layerName,
    "--project",
    tsconfigPath,
  ]);
  return result.stdout;
}

export async function runDiagnostics(
  tsconfigPath: string,
  files?: string[]
): Promise<string> {
  const args = ["diagnostics", "--format", "json", "--project", tsconfigPath];
  if (files && files.length > 0) {
    for (const file of files) {
      args.push("--file", file);
    }
  }
  const result = await runCli(args);
  return result.stdout;
}
