# tsserver vs LSP

TypeScript has **two** server interfaces for editor integration.

## tsserver (TypeScript's Native Server)

TypeScript's original custom JSON protocol over stdio. Predates LSP. This is what VS Code uses internally.

### Communication

- Runs as a node process, listens on `stdin`, writes to `stdout`
- Uses a custom JSON protocol (not JSON-RPC), defined in `ts.server.protocol`
- Request format: `{"seq":1,"type":"request","command":"open","arguments":{"file":"path/to/file.ts"}}`
- Responses include a `Content-Length` header preceding the JSON payload

### Startup Options

- `--cancellationPipeName` — request cancellation semaphore
- `--syntaxOnly` — streamlined mode for syntax-only queries
- `--suppressDiagnosticEvents` — opt out of diagnostic events
- `--locale` — error message language preference
- `--useSingleInferredProject` — consolidate unscoped files

Logging configured via `TSS_LOG` environment variable.

### Project System

Three project types manage TypeScript files:

1. **Configured Projects** — defined by `tsconfig.json` or `jsconfig.json`
2. **External Projects** — host-supplied formats (e.g., Visual Studio `.csproj`)
3. **Inferred Projects** — created for loose files without configuration

Priority: configured > external > inferred.

## typescript-language-server (LSP Wrapper)

A thin wrapper that translates **standard LSP <-> tsserver**, so non-VS Code editors (Neovim, Zed, etc.) can use TypeScript intelligence via the standard LSP protocol.

### Running

```bash
npm install -g typescript-language-server typescript
typescript-language-server --stdio
```

### CLI Options

- `-V, --version` — display version
- `--stdio` — use stdin/stdout (required)
- `--log-level <level>` — verbosity (4=log, 3=info, 2=warn, 1=error; default 3)

### Key Details

- Announces support for code actions: `source.organizeImports.ts`, `source.fixAll.ts`, `source.removeUnused.ts`
- Clients execute custom commands via `workspace/executeCommand`, including:
  - `_typescript.goToSourceDefinition`
  - `_typescript.applyRefactoring`
  - `_typescript.organizeImports`
  - `typescript.tsserverRequest` (direct tsserver passthrough)
- Sends `$/typescriptVersion` notification post-initialization with the TS version and source (workspace, user-setting, or bundled)
- Clients must respond to `workspace/configuration` requests for formatting options (`tabSize`, `insertSpaces`)

## Links

- typescript-language-server: https://github.com/typescript-language-server/typescript-language-server
- tsserver wiki: https://github.com/Microsoft/TypeScript/wiki/Standalone-Server-%28tsserver%29
