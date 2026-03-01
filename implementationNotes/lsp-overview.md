# Language Server Protocol (LSP) Overview

LSP standardizes communication between development tools (editors) and language servers, allowing a single language implementation to work across multiple editors.

## Transport & Message Format

LSP uses **JSON-RPC 2.0** over a simple transport — most commonly **stdio** (stdin/stdout). The server runs as a separate process; the client (editor) sends JSON messages to its stdin and reads responses from its stdout.

Messages have a small HTTP-like header followed by a JSON body:

```
Content-Length: 123\r\n
\r\n
{"jsonrpc":"2.0","id":1,"method":"textDocument/hover","params":{...}}
```

## Three Message Types

1. **Requests** — client sends, expects a response (has an `id`). E.g. "give me completions at line 5, col 12"
2. **Responses** — server replies to a request (matched by `id`). Contains `result` or `error`
3. **Notifications** — one-way, no response expected (no `id`). E.g. "the user changed this file"

## Lifecycle

1. **Initialize** — client sends `initialize` with its capabilities, server responds with its capabilities (what methods it supports)
2. **Initialized** — client sends `initialized` notification, server can start working
3. **Document sync** — `textDocument/didOpen`, `didChange`, `didClose` notifications keep the server in sync with editor buffers
4. **Feature requests** — client sends requests like `textDocument/completion`, `textDocument/hover`, `textDocument/definition`
5. **Server push** — server sends `textDocument/publishDiagnostics` notifications (errors/warnings)
6. **Shutdown** — `shutdown` request, then `exit` notification

## Key Methods

| Category    | Methods                                                      |
| ----------- | ------------------------------------------------------------ |
| Navigation  | `definition`, `references`, `typeDefinition`, `implementation` |
| Editing     | `completion`, `hover`, `signatureHelp`, `rename`, `codeAction` |
| Diagnostics | `publishDiagnostics` (server -> client notification)         |
| Workspace   | `workspace/symbol`, `workspace/executeCommand`               |

## Capabilities Negotiation

During initialization, both client and server announce what they support. This allows graceful degradation — a server that doesn't support rename won't receive rename requests, and a client that doesn't support diagnostics won't receive them.

## Practical Interaction

You can talk to a language server from a terminal:

```bash
echo 'Content-Length: 52\r\n\r\n{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | typescript-language-server --stdio
```

The `--stdio` flag is the standard way to launch an LSP server — the client spawns the process and pipes JSON-RPC messages through stdin/stdout.

## Links

- LSP Specification: https://microsoft.github.io/language-server-protocol/overviews/lsp/overview/
