# Architecture Proposals for Effect Diagram Generation

Four proposed architectures for building an IR and rendering pipeline that
generates legible, scalable diagrams from Effect-TS source code. They range from
incremental to ambitious and are not mutually exclusive — the final section
proposes a phased synthesis.

For background on the empirical findings motivating these proposals, see
[design-considerations.md](./design-considerations.md) and
[literature-review.md](./literature-review.md).

---

## Current state

The current IR is a flat list of `AnalysisNode` and `AnalysisEdge`. Nodes carry
a string `scope` (the enclosing function/variable name), a `kind` (effect,
gen-start, gen-end, yield, pipe-step), type information (successType, errorType,
requirements), and optional cross-file `ref` data. Four renderers consume the
same `AnalysisResult`: flow diagram (Mermaid flowchart), error diagram, layer
diagram, and sequence diagram (ZenUML).

The main limitations this creates:

- **No hierarchy.** Scopes are flat strings. There's no way to collapse "show me
  just the top-level functions" without ad-hoc grouping.
- **One detail level.** Every diagram renders at full resolution. The only
  scaling mechanism is hard-truncation at 100 nodes.
- **Concerns are entangled.** Error handlers, service requirements, and
  execution flow all live on the same nodes. Each renderer filters for what it
  cares about, but the IR doesn't make the separation structural.

---

## 1. Scope Tree with Depth-Based Rendering

### Core idea

Make the IR hierarchical. Effect programs are already composed of named scopes
— `Effect.gen` blocks, `pipe` chains, layer definitions — that call each other.
Make this nesting explicit as a tree, and render at configurable depth.

### What the IR looks like

```
ScopeTree
├── file: "handler.ts"
│   ├── scope: handleRequest (gen)
│   │   ├── step: yield* Database → db
│   │   ├── step: yield* db.query(...)
│   │   ├── step: yield* Effect.all([validate, enrich])
│   │   │   ├── child-scope: validate (ref)
│   │   │   └── child-scope: enrich (ref)
│   │   └── step: catchTag("DbError", fallback)
│   └── scope: handleBatch (gen)
│       ├── step: yield* Effect.fork(process)
│       │   └── child-scope: process (ref)
│       └── step: yield* Effect.forEach(items, fn)
├── file: "infrastructure.ts"
│   ├── scope: DatabaseLive (layer)
│   └── scope: AppConfigLive (layer)
```

Each `ScopeNode` carries:
- Its own summary type signature (`Effect<A, E, R>` for the scope as a whole)
- An internal step list with edges (the detailed flow within the scope)
- Child scope references (what it calls)
- Error handling summary: which error types are caught within, which escape

The flat node list becomes a derived view — flatten the tree and you get back
what we have today.

### Rendering at different depths

**Depth 0 — Scope overview.** One Mermaid node per scope. Edges show which
scopes call which. Labels include the scope's overall `Effect<A, E, R>` type.
For a 40-function codebase, this produces a ~40-node call graph — the upper
end of what node-link can handle (Ghoniem 2004), but feasible with Sugiyama
layout. Subgraphs cluster by file.

```
subgraph handler.ts
  handleRequest["handleRequest\nEffect<Response, DbError | ValidationError, Database>"]
  handleBatch["handleBatch\nEffect<void, never, Database>"]
end
subgraph infrastructure.ts
  DatabaseLive["DatabaseLive\nLayer<Database, ConfigError, AppConfig>"]
end
handleRequest --> validate
handleRequest --> enrich
handleBatch --> process
handleRequest -.-> DatabaseLive
```

**Depth 1 — Scope internals.** Pick a scope and expand its internal flow.
This is close to what the current flow diagram produces for one connected
component. The rest of the tree stays collapsed.

**Depth 2+ — Full recursive expansion.** Expand child scopes inline, using
Mermaid subgraphs. This is current behavior.

### Adaptive depth

Instead of hard-truncating at 100 nodes, reduce depth until the diagram fits:

```
depth = requested_depth
while (node_count_at(depth) > threshold && depth > 0):
    depth -= 1
```

This means small programs render at full detail automatically, and large programs
get a scope overview with individual scopes expandable in `<details>` sections.

### How it handles the PR use case

For a GitHub Action on PR: render the scope overview for all changed files, then
render depth-1 detail for each scope that was *modified in the diff*. Unchanged
scopes appear as collapsed nodes in the overview, giving context without noise.

### Tradeoffs

**Good:** Directly solves the scale problem. The tree provides natural collapse
boundaries. Backward-compatible — the flat node list is still derivable.
Low risk, can be shipped incrementally.

**Limited:** Doesn't enable new analysis capabilities (slicing, concern
separation). It's a presentation improvement, not a semantic one. Also, not all
Effect code lives in named scopes — inline anonymous effects need synthetic
scope names.

---

## 2. Concern-Separated Sub-Graphs

### Core idea

Decompose the analysis into three independent sub-graphs, one per Effect type
parameter:

- **Flow graph** (the A channel) — what calls what, in what order
- **Error graph** (the E channel) — what can fail, where each error type is caught
- **Requirement graph** (the R channel) — what services are needed, who provides them

Each sub-graph is small enough to render independently, and each answers a
different developer question.

### Why this matters

The literature finding that motivates this most directly: **developers ask
targeted questions** (LaToza and Myers 2010). Not "show me everything about this
program" but "what can fail here?" or "why does this need DatabaseService?" A
unified diagram forces the viewer to visually filter for the concern they care
about. Separate sub-graphs do the filtering for them.

The RxFiddle finding (Banken et al. 2018) reinforces this: dual views
(structural + trace) beat single views. Multiple targeted diagrams are better
than one comprehensive diagram.

### What the sub-graphs look like

**Flow graph.** Nodes are scopes or steps. Edges are "calls" or "then" (pipe
step sequencing). This is the current flow diagram minus the error handler
clutter — cleaner, more room for labels.

**Error graph.** A bipartite-style layout: error *sources* on one side (steps
that can fail, annotated with their error types), error *handlers* on the other
(catchTag, catchAll, mapError nodes). Edges connect source to handler, labeled
with the specific error type. This enables the Koka-style "error row narrowing"
view: the full error union at the top of a pipeline, shrinking as each handler
removes a type, until it reaches `never` (fully handled) or the remaining
escaping types.

```
DbError -----> catchTag("DbError", fallback)
ValidationError -----> [escapes]
NetworkError -----> catchAll(logAndRetry)
```

This graph is inherently small. Most codebases have 5-20 error types. Even
a 500-node program's error graph might have 15-30 nodes.

**Requirement graph.** Consumers (functions/scopes that need services) on one
side, providers (layers) on the other. Edges labeled with the service name. This
replaces and improves the current layer diagram by also showing *who consumes*
each service, not just the layer DAG.

```
handleRequest --Database--> DatabaseLive
handleRequest --Logger--> LoggerLive
DatabaseLive --AppConfig--> AppConfigLive
```

Also inherently small. The number of services grows slowly relative to program
size.

### Enabling slicing

This architecture makes two novel slicing operations natural:

**Backward slice from R:** "Why does `handleRequest` need `Database`?" Filter
the requirement graph to just edges involving `Database`, then trace which
steps within `handleRequest` introduced the requirement. This directly answers
a question that's currently invisible.

**Forward slice from E:** "What happens when `db.query()` fails with `DbError`?"
Filter the error graph to just `DbError` edges, then trace forward from the
source to the handler (or to the scope boundary if it escapes). This shows the
error propagation path.

### Cross-concern linking

The three sub-graphs need to reference each other. A flow node can say "this
step has error sources — see the error graph" or "this step requires services —
see the requirement graph." In static Markdown, this could be anchor links
between diagram sections.

### Tradeoffs

**Good:** Each sub-graph is independently small and focused. The error and
requirement graphs stay readable regardless of program size. Enables the
slicing questions from the design considerations. Aligns with how `Effect<A, E,
R>` actually works — three parameters, three concerns.

**Challenging:** Three diagrams per scope could mean 15+ diagrams in a PR
comment. Needs careful presentation (probably: show flow by default, error and
requirement diagrams in collapsed `<details>` sections). Also, some Effect
patterns span concerns — a `catchTag` handler that calls a fallback service is
simultaneously E-channel and R-channel — and the separation creates an
artificial boundary.

---

## 3. Adaptive Lens Selection

### Core idea

Keep the IR close to what exists. Invest in the rendering layer. Define multiple
rendering strategies ("lenses"), and automatically select which to apply based
on the size and shape of the analysis result.

The developer doesn't choose a rendering mode — the system examines the code
and picks the most appropriate diagrams.

### How it works

A cheap summary pass over the analysis result produces:

```
totalNodes: 47
totalScopes: 8
totalFiles: 3
hasErrorHandlers: true
errorTypeCount: 4
serviceCount: 3
hasCrossFileRefs: true
```

Each lens declares when it applies and at what priority:

| Lens | Applies when | Produces |
|---|---|---|
| Detailed flow | totalNodes ≤ 30 | Full flow diagram, all steps visible |
| Scope overview | totalNodes > 30, totalScopes > 3 | One node per scope, cross-scope edges |
| Error focus | hasErrorHandlers, errorTypeCount ≥ 2 | Error source → handler diagram |
| Requirement map | serviceCount ≥ 2 | Consumer → provider diagram |
| Per-scope detail | totalNodes > 30 | One collapsed `<details>` per scope |
| Sequence | serviceCount ≥ 2, totalScopes ≤ 10 | ZenUML sequence diagrams |

For a small program (15 nodes, 2 scopes, 1 error type): the system produces a
detailed flow diagram. For a large program (200 nodes, 30 scopes, 5 error
types, 8 services): it produces a scope overview + error focus + requirement map
+ per-scope details in collapsible sections.

### Why automatic selection

Petre (1995) showed that bad visualizations are worse than text. The wrong
diagram for the situation — a 200-node flowchart, or a sequence diagram for a
pure computation — is actively harmful. Automatic selection based on measured
properties of the code avoids this.

It also avoids configuration burden. A developer running the Action on a PR
doesn't want to pick rendering modes. They want useful diagrams.

### Tradeoffs

**Good:** Lowest migration cost — existing renderers become lenses with
applicability guards. Extensible — new lenses can be added without touching the
IR or other lenses. Good UX for the PR review case.

**Limited:** The heuristic thresholds (30 nodes, 2 error types, etc.) are
tuning parameters that will need adjustment. Doesn't enable fundamentally new
analysis — it's a presentation-layer improvement over a flat IR. The scope
grouping at render time papers over the lack of hierarchy in the IR.

---

## 4. Wiring Diagram IR

### Core idea

The ambitious option. Replace the flat node/edge list with a compositional IR
following Spivak's wiring diagram formalism. Every Effect becomes a box with
typed ports — success output, error output, requirement inputs. Composition is
explicit port wiring.

### What the IR looks like

```typescript
interface Box {
  id: string
  label: string
  kind: "gen" | "pipe" | "layer" | "handler" | "combinator"
  ports: {
    inputs:       Port[]   // what this box consumes
    outputs:      Port[]   // success values produced
    errors:       Port[]   // error types emitted
    requirements: Port[]   // services needed
  }
  children?: Box[]         // nested structure
}

interface Wire {
  from: { box: string, port: string }
  to:   { box: string, port: string }
  channel: "success" | "error" | "requirement"
}
```

A `pipe(source, Effect.map(f), Effect.flatMap(g))` becomes three boxes wired in
series on the success channel. A `catchTag("DbError", handler)` creates a wire
from the `DbError` error port to a handler box's input port. A
`Layer.provide(DatabaseLive)` wires the layer's output port to a consumer box's
`Database` requirement port.

| Effect-TS construct | Wiring diagram element |
|---|---|
| `Effect<A, E, R>` | Box with output port A, error port E, requirement ports per service in R |
| `pipe` / `flatMap` | Serial wiring: output of one box → input of next |
| `Effect.all` | Parallel boxes, outputs merged |
| `catchTag` | Error port → handler box input |
| `Layer.provide` | Provider output → consumer requirement port |
| `Effect.gen` yield | Child box, wired to parent's ports |

### What it enables

The wiring diagram IR is the only architecture that makes concern separation
*structural* rather than *derived*. The flow view is "show only success-channel
wires." The error view is "show only error-channel wires." The requirement view
is "show only requirement-channel wires." No post-hoc filtering needed — the
channels are first-class in the IR.

It also enables diagram simplification via rewriting. Bonchi et al. (2022)
developed the theory of string diagram rewriting — transforming one diagram
into a provably equivalent simpler form. If two pipe steps have trivially
composable types, they could be collapsed into one box.

### The port-typing problem

This is the hard part. When analyzing `pipe(source, Effect.map(f))`, the current
analyzer records whatever the TypeChecker says the overall expression type is.
The wiring diagram needs the *per-step* types: what does `source` output? What
does `Effect.map(f)` input and output? Deriving per-step port types requires
asking the TypeChecker about intermediate expressions, which is feasible but
significantly more work — and will produce `unknown` ports for anything the
checker can't resolve.

### Rendering challenge

Mermaid can't render port-based wiring diagrams. Boxes with labeled ports on
their edges, wires connecting specific ports — this needs either a custom
renderer, Graphviz (which supports records with ports), or a richer output
format. This is a real constraint given our static-Markdown output target.

A pragmatic compromise: render the wiring diagram IR *as if* it were a regular
flowchart, using edge labels to indicate which channel a wire belongs to and
node annotations to list ports. This loses the visual clarity of explicit ports
but stays within Mermaid's capabilities.

### Tradeoffs

**Good:** Theoretically the cleanest architecture. Enables all novel views
(concern separation, slicing, simplification). The IR directly encodes
Effect-TS's `Effect<A, E, R>` semantics.

**Risky:** Requires a substantial analyzer rewrite. The port-typing problem may
not be tractable enough for real-world TypeScript code — `unknown` ports would
defeat the purpose. Mermaid can't render it natively. Real Effect code has
escape hatches (`Effect.promise`, `Effect.sync`, imperative service
implementations) that don't have clean port typings.

**Best as:** A research direction to prototype against real codebases before
committing to.

---

## Synthesis: a phased path

These architectures address different layers of the problem and compose
naturally into a phased approach:

### Phase 1: Scope tree + adaptive lenses

Combine architectures 1 and 3. Build the scope tree IR (giving us hierarchy),
and implement the lens abstraction (giving us automatic rendering selection).
This immediately solves the scale problem and improves the PR review experience
without novel analysis work.

Concrete deliverables:
- `ScopeTree` data structure with depth-based rendering
- Lens abstraction with `shouldApply` / `priority` / `render`
- Scope overview lens (new), detailed flow lens (existing renderer wrapped),
  per-scope detail lens (existing renderer, scoped)
- Adaptive depth reduction replacing hard truncation

### Phase 2: Concern separation for E and R

Add architecture 2's error and requirement sub-graphs as new lenses. The scope
tree provides the structural backbone; the sub-graphs project onto specific
channels. This is where the novel value lives — slicing by requirement,
error propagation tracing.

Concrete deliverables:
- Error graph extraction and the error-narrowing diagram
- Requirement graph extraction and the consumer-provider diagram
- Backward-slice-from-R and forward-slice-from-E queries
- Cross-concern linking in PR comment output

### Phase 3: Wiring diagram exploration

Prototype the wiring diagram IR against real codebases (not test fixtures) to
assess whether per-step port typing is tractable. If it is, the wiring diagram
subsumes the scope tree + concern separation with a cleaner formalism. If it
isn't, phases 1-2 are the production architecture and the wiring diagram remains
a theoretical reference point.

### What this phased path optimizes for

**Phase 1** optimizes for shipping — the highest-impact improvement (scale
handling) with the lowest risk.

**Phase 2** optimizes for novelty — the slicing operations and concern-separated
diagrams are things no existing tool does, and they directly answer the
questions developers ask about Effect code.

**Phase 3** optimizes for correctness — the wiring diagram is the right
long-term formalism if the static analysis can support it.
