# Visualizing Effect Programs

Effect-TS programs have a layered structure that doesn't map neatly onto a single diagram type. This document is a working set of notes on the levels of abstraction present in Effect code and how different visual forms might clarify each one. It's based on early experiments building automated diagram renderers — the observations here are preliminary and the design space is largely unexplored.

## The levels

### 1. The type signature

Every Effect value carries `Effect<A, E, R>` — success type, error type, and requirements. This is the densest summary available: it tells you what a computation produces, how it can fail, and what it needs from context to run.

A one-line annotation might be more effective than any diagram for this:

```
// processEvent: Effect<Updated, DbError, Database>
```

Our current approach treats this as context — a title or comment on other diagrams rather than something to draw. That seems right so far, but there are cases (complex union error types, deeply nested requirements) where the pure-text label becomes too complex to be easily understood at a glance.

### 2. Sequential steps within a scope

An `Effect.gen` function is a sequence of `yield*` steps. A `pipe` chain is a sequence of transformations. These are the building blocks of Effect programs — linear chains where each step depends on the previous one.

```typescript
const processEvent = (event) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const current = yield* db.query(`SELECT * FROM state WHERE id = '${event.id}'`);
    const updated = { ...current[0], payload: event.payload, processed: true };
    yield* db.execute(`UPDATE state SET payload = '${event.payload}' WHERE id = '${event.id}'`);
    return updated;
  });
```

**Flowchart (top-to-bottom):** Each yield is a node, edges connect them sequentially. Shows the shape of a function — how many steps, where it branches, how long it is. Type annotations on each node show how `A`, `E`, `R` evolve step by step.

```
[Database] → [db.query(...)] → [db.execute(...)] → [return]
```

**Sequence diagram (top-to-bottom):** Each yield that calls a service method becomes a message arrow to that service's participant column. Steps that don't involve services are self-calls.

```
@Starter(processEvent)
Database.query("SELECT * FROM state WHERE id = ...")
Database.execute("UPDATE state SET payload = ...")
return updated
```

**Initial observations:** Sequence diagrams seem to have an advantage when services are involved. The flowchart treats `yield* Database` and `yield* db.query(...)` as equivalent nodes — just boxes in a chain. The sequence diagram eliminates the service-access yield entirely (it's implicit in calling `Database.query()`) and shows the caller→service relationship as a directional arrow. For pure pipe chains without services (like `Effect.succeed(42).pipe(Effect.map(...), Effect.flatMap(...))`), the flowchart seems equally clear. But we haven't tested this against many real-world codebases yet — there may be patterns where the tradeoff is different.

### 3. Service interactions

Effect services (`Context.Tag`) are a primary abstraction boundary. A gen function yields a service to get a handle, then calls methods on it. The service is defined elsewhere — possibly in another file, backed by a different implementation per environment.

One way to frame the question: it's not just "what steps does this function take" but "which services does it talk to, and what does it ask them to do?"

**Flowchart:** Services show up as yield nodes. The fact that `Database` is a service — not just a variable — isn't visually distinct from any other yield. You can *read* the label and figure it out, but the diagram's structure doesn't communicate it. There might be ways to improve this (different node shapes, colors, or grouping), but we haven't explored that yet.

**Sequence diagram:** Services are *participants* — named columns that persist across the diagram. When a function calls `Database.query(...)`, an arrow goes from the caller to the Database column. Multiple calls to the same service stack vertically under the same column. This feels like a natural visual form for "who talks to whom," though the participant model breaks down for computations that don't involve services.

**File grouping** adds another layer: when services come from different source files, `group` declarations organize participants by origin.

```
group "infrastructure.ts" {
  Database
}
group "state-service.ts" {
  StatePersister
}
@Starter(handleRequest)
Database.query("SELECT * FROM requests")
StatePersister.persist(result)
```

This is potentially useful for orientation — "where is this service defined?" — but it also reverses the arrow direction (grouped participants appear left of the starter) which might confuse readers. Needs more testing with real codebases to see if the tradeoff is worth it, and whether file-level grouping is the right granularity or if module/package-level would be better.

### 4. Error handling

Effect tracks errors in the type system. Pipe steps like `catchTag`, `catchAll`, and `mapError` narrow or transform the error channel. This creates two kinds of information:

- **The error flow:** how the `E` type parameter changes through a chain. `Effect<User, HttpError | DbError, Env>` → `catchTag("DbError", ...)` → `Effect<User, HttpError, Env>`.
- **The branching structure:** the happy path vs. recovery paths.

**Error channel diagram (LR flowchart):** A specialized view. Each node is a pipe step, each edge is labeled with the error type at that point. Diamond shapes for catch nodes, trapezoids for mapError. Strips away everything else and focuses on how `E` propagates.

```
[fetchUser] --E: HttpError | DbError--> {catchTag} --E: HttpError--> {catchAll}
```

**Sequence diagram `try/catch`:** Shows the structural branching — which steps are inside the try, which are recovery.

```
try {
  Database.query(...)
  StatePersister.persist(result)
} catch (DbError) {
  Effect.succeed(recovered)
}
```

These seem to answer different questions. The error channel diagram answers "how does the error type change?" The try/catch answers "what's the happy path vs. the recovery path?" They may be complementary rather than competing, but we haven't explored whether they could be combined into a single view that does both.

### 5. Concurrency

`Effect.all([...])` runs effects concurrently. `Effect.fork` creates a background fiber. `Effect.forEach` iterates with potential concurrency. These break the linear sequential model.

**Flowchart:** In our current implementation, concurrency is mostly invisible. `Effect.all([db.query(a), db.query(b)])` is a single node with a long label. Forks and forEach show up as subgraphs (when combinator expansion is enabled), but the "parallel" aspect isn't structurally distinct from "sequential." There's room to explore here — parallel branches in the flowchart, or swimlanes, or some other structural cue.

**Sequence diagram:** ZenUML has dedicated constructs for this. `par { }` visually groups concurrent operations in a labeled box. `forEach(collection) { }` is a loop box. `Effect.fork` assigns a fiber handle.

```
par {
  Database.query("SELECT * FROM requests")
  Database.query("SELECT * FROM related")
}
```

Early impression: having first-class visual constructs for concurrency seems better than encoding it in labels. But there are Effect concurrency patterns we haven't attempted yet — `Race`, `Deferred`, `Semaphore`, fiber supervision trees. These might not map as cleanly.

### 6. Cross-file composition

Effect programs are typically split across files: services in one, handlers in another, layers in a third. When a gen function yields to another gen function defined in a different file, that's a sub-program call.

**Flowchart:** Subgraphs. The referenced scope is expanded inline as a nested subgraph with a label showing the source file.

**Sequence diagram:** Nesting with `{ }` braces. The sub-program becomes a self-call (activation bar) containing its expanded steps. A comment notes the source file.

```
fetchUser() { // expanded from cross-file-b.ts
  Effect.succeed(1)
  Effect.succeed("Alice")
  return user
}
```

Both approaches work for shallow expansion. Neither handles deep nesting well — flowcharts get wide, sequence diagrams get deeply indented. Two levels seems like a practical limit for either format, but we haven't rigorously tested this. There's also an open question about whether expansion should be the default or whether a collapsed reference (just showing the call, not its internals) would be more useful in most cases.

### 7. Layers and construction

Layers are compile-time/startup-time wiring — they describe how services are constructed and what they depend on. `DatabaseLive` requires `AppConfig` and provides `Database`. This is a dependency graph, not an execution sequence.

**Flowchart (the existing layer dependency diagram):** Subgraphs for each layer, "provides" and "requires" labels, dotted edges showing dependency relationships.

**Sequence diagram (layer construction):** `Application` as the starter, calling `.build()` on each layer in dependency order. Requires/provides as comments, `return ServiceName` for the output. This answers "in what order are layers constructed?" rather than "what depends on what?"

```
@Starter(Application)
AppConfigLive.build() {
  // provides: AppConfig
  return AppConfig
}
DatabaseLive.build() {
  // requires: AppConfig
  // provides: Database
  return Database
}
```

The dependency DAG might be more generally useful — you probably care about "what does this layer need?" more often than "in what order are layers constructed?" — but we're not sure yet. It likely depends on what problem the reader is trying to solve.

## Early observations

These are tentative takeaways from the first round of implementation. They might change as we test against more codebases and iterate on the design.

### Flowcharts are a safe default, but generic

Flowcharts can represent anything. Every node is a box, every relationship is an arrow. This universality might also be a weakness — nothing is structurally distinguished. A service access, a computation step, a concurrent fork, and an error handler are all just boxes connected by arrows. The *labels* carry the meaning; the *structure* is the same throughout.

This makes flowcharts reasonable as a starting point. Whether they're sufficient or whether more specialized views always add value is an open question.

### Sequence diagrams encode an interpretation

Choosing to represent services as participants, concurrency as `par` blocks, and error handling as `try/catch` is an *interpretation* of the code. It says: "the interesting thing about this function is which services it talks to and in what order." That interpretation seems right for many Effect patterns — service interaction is a primary design concern — but it's an editorial choice.

When the interpretation fits (service-heavy gen functions), sequence diagrams seem to communicate more per pixel than flowcharts. When it doesn't fit (pure pipe chains, schedule construction, simple value computations), they might add ceremony without value. We need to see more examples to know where the line is.

### Type annotations are awkward in diagrams

The `Effect<A, E, R>` type is essential context but it makes a dense label. A node labeled `Effect.tryPromise(…)<br/>Effect<{ id: number; }[], DbError>` is hard to read in a flowchart. A sequence diagram comment `// processEvent: Effect<Updated, DbError, Database>` is easier.

Our current approach puts type information in titles and comments rather than in node labels or edge labels. This seems to work but might lose information that readers need step-by-step. There may be a middle ground — showing types on hover or in a separate panel, or only showing the type parameter that changed from the previous step.

### Multiple targeted diagrams might beat one comprehensive one

No single diagram type has answered all questions about an Effect program in our testing:

| Question | Current best view |
|---|---|
| What steps does this function take? | Flowchart |
| Which services does it talk to? | Sequence diagram |
| How does the error type narrow? | Error channel diagram (LR flowchart) |
| What runs concurrently? | Sequence diagram (par blocks) |
| What depends on what? | Layer dependency DAG |
| What's the construction order? | Layer sequence diagram |
| What's the full expansion? | Flowchart with subgraphs |

Whether 2-3 targeted diagrams is actually better than one rich diagram is unproven — it's possible a well-designed combined view could do more. We haven't explored interactive or layered visualizations (e.g., click to expand, filter by concern) which might change the calculus entirely.

### Suppression seems important

One of the more effective rendering decisions in the sequence diagram has been *not showing* certain things. `yield* Database` followed by `db.query(...)` becomes just `Database.query(...)`. Suppressing `gen-start` nodes, collapsing combinator scopes inline, and using generic `return result` instead of complex type literals all reduce noise.

This is a form of editorial judgment that's hard to get right automatically. Our current heuristics work for the test fixtures but might suppress useful information in other codebases. It's worth exploring whether suppression should be configurable, or whether different levels of detail should be separate diagram modes.

## Open questions

- What patterns exist in real-world Effect codebases that our test fixtures don't cover? Layer merging, resource scoping (`acquireUseRelease`), Stream pipelines, STM transactions, etc.
- Is there a useful visualization for the R (requirements) parameter specifically — showing how requirements accumulate through composition?
- Could interactive diagrams (expand on click, filter by service, toggle type annotations) replace the need for multiple static diagram types?
- How should the diagrams handle large programs — hundreds of nodes across dozens of files? Truncation? Summary views? Hierarchical drill-down?
- Are there established visual conventions from other effect system communities (Haskell, Scala ZIO) that we should learn from?
- Would color-coding by concern (service calls one color, error handling another, concurrency another) work in flowcharts to offset their structural genericity?
