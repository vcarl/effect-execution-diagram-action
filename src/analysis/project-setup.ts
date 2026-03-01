import * as path from "node:path";
import * as ts from "typescript";

export interface ProjectContext {
  program: ts.Program;
  typeChecker: ts.TypeChecker;
  ts: typeof ts;
}

export function createProjectContext(tsconfigPath: string): ProjectContext {
  const absoluteTsconfigPath = path.resolve(tsconfigPath);
  const configFile = ts.readConfigFile(absoluteTsconfigPath, ts.sys.readFile);

  if (configFile.error) {
    throw new Error(
      `Failed to read tsconfig at ${absoluteTsconfigPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`
    );
  }

  const configDir = path.dirname(absoluteTsconfigPath);
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    configDir
  );

  if (parsedConfig.errors.length > 0) {
    const messages = parsedConfig.errors
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
      .join("\n");
    throw new Error(`tsconfig parse errors:\n${messages}`);
  }

  const program = ts.createProgram({
    rootNames: parsedConfig.fileNames,
    options: parsedConfig.options,
  });

  return {
    program,
    typeChecker: program.getTypeChecker(),
    ts,
  };
}

export function getSourceFile(
  project: ProjectContext,
  filePath: string
): ts.SourceFile | undefined {
  const absolutePath = path.resolve(filePath);
  return project.program.getSourceFile(absolutePath);
}
