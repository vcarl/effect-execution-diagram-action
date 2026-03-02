# Design Considerations for Visualizing Effect Programs

This document distills what we've learned from prior art and academic research
into the questions and constraints most relevant to our specific task:
automatically generating visual summaries of Effect-TS programs via static
analysis.

See [literature-review.md](./literature-review.md) for the full survey.

---

## The core tension: diagrams vs. scale

The box-and-wire metaphor — transformations as boxes, data flowing through
wires — is the natural way to draw a pipeline. Every dataflow visualization
system since the 1970s converges on it (Hils 1992, Johnston et al. 2004). It's
what our Mermaid flowcharts already do.

But the empirical literature is blunt about the limits:

- **Node-link diagrams become unreadable around 20 nodes** (Ghoniem et al.
  2004). Matrix representations outperform them for large, dense graphs.
- **Dataflow box-and-wire breaks down at ~50 nodes** due to "spaghetti wiring"
  (Johnston et al. 2004).
- **Poorly laid out diagrams are worse than text** (Petre 1995). Secondary
  notation — spatial grouping, visual cues beyond the formal syntax — is what
  actually makes a diagram useful. Getting the layout wrong isn't just unhelpful,
  it's actively harmful.

This means that for anything beyond a single small pipeline, we can't just dump
the full graph and call it useful. The diagram format that works for a 5-step
pipe chain does not work for an application with 40 services and 200 effects.

## What developers actually need from these diagrams

The program comprehension literature points to specific questions that
visualizations should help answer:

**Reachability questions** (LaToza and Myers 2010) dominate developer
comprehension. "Can this code reach that code? Under what conditions?" This is
exactly what an execution flow diagram shows — which effects call which other
effects, and what the path between them looks like.

**Program model before domain model** (Pennington 1987). Developers build an
understanding of *what the code does* (control flow, data flow) before they
build an understanding of *what it means* in the domain. Our diagrams serve the
program model — they show the mechanical flow of effect composition.

**Comprehension is question-driven, not linear** (Letovsky 1987). Developers
don't read code top-to-bottom; they jump between locations driven by specific
questions. This suggests diagrams should support targeted lookup ("what does
*this* effect do?") rather than requiring the viewer to absorb the whole picture.

**Abstraction level drives comprehension strategy** (Storey et al. 2000). The
level of detail a tool provides changes how developers think. Showing too much
detail forces bottom-up reasoning; showing too little forces guessing.

## Prior art most relevant to us

**RxFiddle** (Banken, Meijer, and Gousios 2018) is the closest published work
to what we're building — automated visualization of pipeline composition in a
functional DSL (RxJS). Their key finding: a structural graph view alongside a
marble/trace view was essential for comprehension. Neither alone was sufficient.
The implication for us: multiple targeted diagram types (flowcharts, sequence
diagrams, layer graphs) likely serve users better than one comprehensive view.

**Travesty** (Akka Streams) extracts stream topology from the DSL's internal
representation and renders structural diagrams. It works because Akka Streams
has a well-defined graph structure at the API level — the topology is explicit
in the code. Effect-TS `pipe` chains have a similar property: the pipeline
structure is syntactically visible, making static extraction feasible.

**Calligraphy** (Haskell) takes an "80% accuracy for 20% effort" approach to
call graphs from `.hie` files. This pragmatic tradeoff — accepting imprecision
in exchange for tractability — is relevant because static analysis of
TypeScript is inherently imprecise (dynamic dispatch, type erasure, conditional
types).

**Flink's multi-level execution plans** transform programs through four
representations (StreamGraph → JobGraph → ExecutionGraph → physical plan), each
at a different abstraction level. This suggests that our intermediate
representation (FlowGraph) could support multiple rendering levels rather than a
single fixed view.

## Constraints specific to Effect-TS

Effect programs have structure that distinguishes them from general dataflow:

**Three type parameters track distinct concerns.** `Effect<A, E, R>` carries
success type, error channel, and requirements. Each could be visualized
independently — the execution flow (what calls what), the error propagation
(what can fail and how it's handled), and the dependency graph (what services
are needed and who provides them). These are three different questions
developers ask, and they probably shouldn't be mashed into one diagram.

**Composition is the primary structuring mechanism.** Effect programs are built
by composing smaller effects via `pipe`, `flatMap`, `Effect.gen`, `Effect.all`,
etc. This compositional structure is what Spivak's wiring diagrams (2013)
formalize: boxes with typed ports, composed by connecting outputs to inputs.
The visualization should mirror this compositionality — the diagram of a
composed program should be recognizably built from the diagrams of its parts.

**Layers form a separate DAG.** The `R` parameter creates a dependency graph
that is structurally different from the execution flow. Services depend on other
services; layers provide them. This is closer to a dependency injection
container than to a dataflow pipeline, and it wants a different visual treatment
(dependency graph, not flowchart).

**Error handling is structural, not exceptional.** Unlike try/catch in
imperative code, Effect-TS error channels are tracked in the type system and
handled explicitly via `catchTag`, `catchAll`, etc. This means error flow is
statically visible — we can diagram it. The Koka work (Leijen 2017) shows
this as effect row narrowing: each handler removes an error type from the
channel. We could show error channel evolution through a pipeline.

## Open questions

### How do we handle scale?

The literature's consensus answer is **hierarchical abstraction with progressive
disclosure** — start with a high-level view, let users drill down (Elmqvist and
Fekete 2010, van Ham and Perer 2009, Johnston et al. 2004). Our current
subgraph expansion in Mermaid is a version of this.

But we generate static Markdown, not interactive diagrams. We can't do
expand-on-click. Options:
- Generate diagrams at multiple granularities (overview + per-module + per-function)
- Use Mermaid subgraphs to cluster related steps
- Omit detail below a configurable depth
- Generate separate diagrams per entry point rather than one global view

### One diagram or many?

The RxFiddle finding — that dual views (structural + trace) beat either alone —
suggests we should lean into generating *multiple complementary diagrams* rather
than trying to pack everything into one:
- **Execution flow** — what calls what, in what order
- **Error propagation** — what can fail, where it's caught
- **Service dependencies** — what requires what, what provides it

This is already somewhat reflected in our having both flowcharts and the layer
analysis, but it could be made more deliberate.

### What's the right unit of visualization?

A single `pipe` chain? A single exported function? A module? An entire
application entry point? The comprehension literature (Letovsky 1987) suggests
developers approach code with specific questions — so the most useful unit is
probably "the smallest scope that answers the question being asked."

For a GitHub Action that runs on PR, the practical unit is probably
per-file or per-exported-function, with an optional rolled-up overview.

### How imprecise can we be?

Static analysis of TypeScript will always miss things — dynamic dispatch,
computed property access, conditional types, runtime configuration. Calligraphy's
"80% accuracy" philosophy suggests this is fine: a diagram that captures the
common case and misses edge cases is still far more useful than no diagram.

The risk is that an inaccurate diagram is *misleading*. Petre (1995) showed that
bad visualizations are worse than no visualization. We should be transparent
about what the analysis can and can't see, and err on the side of showing less
rather than guessing wrong.

### Should error flow and service dependencies be separate diagrams?

Spivak's wiring diagram formalism suggests these could be unified — each Effect
box has success, error, and requirement ports, all wired together. But the
Ghoniem et al. (2004) finding about node-link scalability limits argues against
overloading a single diagram. Separate diagrams for separate concerns may be
more legible even if less theoretically elegant.

### Is there a slicing story?

The program slicing literature (Weiser 1984, Biswas 1997) suggests two
operations that would be uniquely useful for Effect programs:
- **Backward slice from R:** "Why does this effect need DatabaseService?" →
  trace backward through the pipe chain to find the step that introduced the
  requirement.
- **Forward slice from E:** "What happens if this fails with HttpError?" →
  trace forward to find all handlers and fallback paths.

Neither has been done before. Both are feasible from the static analysis we
already perform. This might be the highest-value direction for new work.
