# Effect Language Service (`@effect/language-service`)

A TypeScript plugin that enhances any editor supporting the TS LSP (VS Code, Cursor, Zed, Neovim, etc.).

## Setup

1. Install: `npm install @effect/language-service --save-dev`
2. Add to `tsconfig.json`:
   ```json
   { "compilerOptions": { "plugins": [{ "name": "@effect/language-service" }] } }
   ```
3. Set your editor to use the **workspace TypeScript version** (not the bundled one).

## Key Features

### Diagnostics

Detects at edit-time:

- Floating (unassigned/unyielded) Effects
- Layer requirement leaks and scope violations
- Redundant `Effect.gen` or `pipe()` calls
- Misused `.catch` on non-failing Effects
- Multiple Effect versions in a project

### Refactors

- Async-to-Effect conversion
- Tagged error generation
- Service accessor implementation
- Pipe syntax transformation
- Layer composition automation

### Completions

- Generator boilerplate scaffolding
- `Effect.Service` and `Data.TaggedError` scaffolds
- Self parameter auto-completion

### Build-time Diagnostics

Run `effect-language-service patch` to get diagnostics during `tsc` compilation. Can be added as a `prepare` script for team consistency:

```json
{ "scripts": { "prepare": "effect-language-service patch" } }
```

## VS Code / Cursor Extension

A separate extension (does **not** bundle the LSP — that's per-project). Available on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=effectful-tech.effect-vscode).

Adds:

- **Debugger** — context inspection of paused Effect Fibers, span stack visualization, fiber list with interrupt controls, and "pause on defect" breakpoints
- **Built-in Tracer/Metrics** — via `@effect/experimental`'s `DevTools.layer()`, provides a real-time visual tracer panel showing spans as they execute

## Links

- GitHub: https://github.com/Effect-TS/language-service
- Docs: https://effect.website/docs/getting-started/devtools/
- VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=effectful-tech.effect-vscode
