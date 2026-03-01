# CLAUDE.md

## Build

- `npm run build` — compiles TypeScript and bundles into `dist/index.js` via ncc. **Must be run and committed** after any source changes for the GitHub Action to pick them up.
- `npm run lint` — type-check only (`tsc --noEmit`)
- `npm test` — runs vitest

## Dev workflow

- `npx tsx src/dev.ts --all --no-error --tsconfig test/fixtures/tsconfig.json` — run the analysis pipeline locally against test fixtures to inspect Mermaid output
- Test fixtures live in `test/fixtures/` with their own `tsconfig.json`

## Architecture

- `src/index.ts` → `src/action.ts` — GitHub Action entry point
- `src/analysis/flow-analyzer.ts` — AST walker that finds pipe/gen/flatMap patterns and simple Effect declarations
- `src/diagrams/flow-diagram.ts` — renders FlowGraph into Mermaid diagrams with recursive sub-program expansion
- `dist/index.js` — **committed to git**, the bundled output that GitHub Actions actually runs
