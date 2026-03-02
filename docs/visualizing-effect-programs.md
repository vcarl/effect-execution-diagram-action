# Visualizing Effect Programs

Effect-TS programs have a layered structure that doesn't map neatly onto a single diagram type. This document describes the levels of abstraction present in Effect code and which visual forms clarify each one, based on what we've learned building automated diagram renderers.

## The levels

### 1. The type signature

Every Effect value carries `Effect<A, E, R>` — success type, error type, and requirements. This is the densest summary available: it tells you what a computation produces, how it can fail, and what it needs from context to run.

No diagram is needed here. A one-line annotation is better than any visual:

```
// processEvent: Effect<Updated, DbError, Database>
```

This line communicates more about the function's contract than most diagrams can. It belongs in every visualization as context — a title or comment — but trying to *draw* it adds clutter without insight.

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

**Flowchart (top-to-bottom):** Each yield is a node, edges connect them sequentially. Good for seeing the shape of a function — how many steps, where it branches, how long it is. Type annotations on each node show how `A`, `E`, `R` evolve step by step.

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

**Which works better:** Sequence diagrams, when services are involved. The flowchart treats `yield* Database` and `yield* db.query(...)` as equivalent nodes — just boxes in a chain. The sequence diagram eliminates the service-access yield entirely (it's implicit in calling `Database.query()`) and shows the caller→service relationship as a directional arrow. For pure pipe chains without services (like `Effect.succeed(42).pipe(Effect.map(...), Effect.flatMap(...))`), the flowchart is equally clear and the sequence diagram has no advantage.

### 3. Service interactions

Effect services (`Context.Tag`) are the primary abstraction boundary. A gen function yields a service to get a handle, then calls methods on it. The service is defined elsewhere — possibly in another file, backed by a different implementation per environment.

The interesting question isn't "what steps does this function take" but "which services does it talk to, and what does it ask them to do?"

**Flowchart:** Services show up as yield nodes. The fact that `Database` is a service — not just a variable — isn't visually distinct from any other yield. You can *read* the label and figure it out, but nothing in the diagram's structure communicates it.

**Sequence diagram:** Services are *participants* — named columns that persist across the diagram. When a function calls `Database.query(...)`, an arrow goes from the caller to the Database column. Multiple calls to the same service stack vertically under the same column. This is the natural visual form for "who talks to whom."

**File grouping** adds another layer: when services come from different source files, `group` declarations organize participants by origin. This answers "where is this service defined?" at a glance.

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

### 4. Error handling

Effect tracks errors in the type system. Pipe steps like `catchTag`, `catchAll`, and `mapError` narrow or transform the error channel. This creates two kinds of information:

- **The error flow:** how the `E` type parameter changes through a chain. `Effect<User, HttpError | DbError, Env>` → `catchTag("DbError", ...)` → `Effect<User, HttpError, Env>`.
- **The branching structure:** the happy path vs. recovery paths.

**Error channel diagram (LR flowchart):** Specialized. Each node is a pipe step, each edge is labeled with the error type at that point. Diamond shapes for catch nodes, trapezoids for mapError. This is the best view for understanding error type narrowing — it strips away everything else and focuses on how `E` propagates.

```
[fetchUser] --E: HttpError | DbError--> {catchTag} --E: HttpError--> {catchAll}
```

**Sequence diagram `try/catch`:** Shows the structural branching — which steps are inside the try, which are recovery. Good for understanding "what happens when it fails" but doesn't track the type narrowing step by step.

```
try {
  Database.query(...)
  StatePersister.persist(result)
} catch (DbError) {
  Effect.succeed(recovered)
}
```

**Which works better:** They answer different questions. The error channel diagram answers "how does the error type change?" The try/catch answers "what's the happy path vs. the recovery path?" Both are useful. They're complementary, not competing.

### 5. Concurrency

`Effect.all([...])` runs effects concurrently. `Effect.fork` creates a background fiber. `Effect.forEach` iterates with potential concurrency. These break the linear sequential model.

**Flowchart:** Concurrency is invisible. `Effect.all([db.query(a), db.query(b)])` is a single node with a long label. The fact that these run in parallel is only apparent if you read the label and recognize the combinator. Forks and forEach show up as subgraphs (when combinator expansion is enabled), but the "parallel" aspect isn't structurally distinct from "sequential."

**Sequence diagram:** Concurrency has dedicated constructs. `par { }` visually groups concurrent operations in a labeled box. `forEach(collection) { }` is a loop box. `Effect.fork` assigns a fiber handle. These are first-class visual elements, not just labels on nodes.

```
par {
  Database.query("SELECT * FROM requests")
  Database.query("SELECT * FROM related")
}
```

**Which works better:** Sequence diagrams, clearly. Concurrency is a structural property that deserves structural representation. A `par` box communicates "these happen at the same time" instantly. A flowchart node labeled `Effect.all([...])` requires the reader to parse the label, recognize the combinator, and mentally model the concurrency.

### 6. Cross-file composition

Effect programs are typically split across files: services in one, handlers in another, layers in a third. When a gen function yields to another gen function defined in a different file, that's a sub-program call.

**Flowchart:** Subgraphs. The referenced scope is expanded inline as a nested subgraph with a label showing the source file. This works well for showing the full expansion — you see every step of the sub-program. It gets wide with deep nesting.

**Sequence diagram:** Nesting with `{ }` braces. The sub-program becomes a self-call (activation bar) containing its expanded steps. A comment notes the source file.

```
fetchUser() { // expanded from cross-file-b.ts
  Effect.succeed(1)
  Effect.succeed("Alice")
  return user
}
```

Both work similarly. The flowchart's subgraph is slightly better for complex expansions because it visually boxes the sub-program with a clear border. The sequence diagram's nesting is more compact and reads more like pseudocode.

The real question is *depth*. How far should expansion go before the diagram becomes unreadable? Two levels is usually the practical limit for either format.

### 7. Layers and construction

Layers are compile-time/startup-time wiring — they describe how services are constructed and what they depend on. `DatabaseLive` requires `AppConfig` and provides `Database`. This is a dependency graph, not an execution sequence.

**Flowchart (the existing layer dependency diagram):** Subgraphs for each layer, "provides" and "requires" labels, dotted edges showing dependency relationships. Good for seeing the full dependency DAG.

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

**Which works better:** The dependency DAG (flowchart) is better for understanding the architecture. The sequence diagram is better for understanding the construction sequence. In practice the DAG is more useful — you rarely care about construction order, but you often care about "what does this layer need?"

## What we've learned

### Flowcharts are a lowest-common-denominator

Flowcharts can represent anything. Every node is a box, every relationship is an arrow. This universality is also their weakness — nothing is structurally distinguished. A service access, a computation step, a concurrent fork, and an error handler are all just boxes connected by arrows. The *labels* carry the meaning; the *structure* is always the same.

This makes flowcharts good as a default and bad as a specialized view. They're the right choice when you have no better option, or when you want to show everything at once without committing to a particular interpretation.

### Sequence diagrams encode domain knowledge

Choosing to represent services as participants, concurrency as `par` blocks, and error handling as `try/catch` is an *interpretation* of the code. It says: "the interesting thing about this function is which services it talks to and in what order." That interpretation is usually right for Effect code — the service interaction pattern is the primary design concern — but it's an editorial choice that the flowchart doesn't make.

When the interpretation fits, sequence diagrams communicate more per pixel than flowcharts. When it doesn't fit (pure pipe chains, schedule construction, simple value computations), they add participant columns that serve no purpose.

### Type annotations belong in context, not in structure

The `Effect<A, E, R>` type is essential context but it makes a terrible label. A node labeled `Effect.tryPromise(…)<br/>Effect<{ id: number; }[], DbError>` is hard to read in a flowchart. A sequence diagram comment `// processEvent: Effect<Updated, DbError, Database>` is easy to read.

The lesson: put type information where the eye expects summary text (titles, comments, tooltips), not where it competes with structural information (node labels, edge labels).

### Different questions need different diagrams

No single diagram type answers all questions about an Effect program:

| Question | Best view |
|---|---|
| What steps does this function take? | Flowchart |
| Which services does it talk to? | Sequence diagram |
| How does the error type narrow? | Error channel diagram (LR flowchart) |
| What runs concurrently? | Sequence diagram (par blocks) |
| What depends on what? | Layer dependency DAG |
| What's the construction order? | Layer sequence diagram |
| What's the full expansion? | Flowchart with subgraphs |

The most useful output is usually 2-3 targeted diagrams rather than one comprehensive one.

### Suppression is as important as rendering

The most impactful rendering decision in the sequence diagram is *not showing* the service access yield. `yield* Database` followed by `db.query(...)` becomes just `Database.query(...)`. One line instead of two, and the line that remains is the one that matters.

Similarly, suppressing `gen-start` nodes (absorbing them into the `@Starter` declaration), collapsing combinator scopes (expanding them inline rather than as separate diagrams), and using generic `return result` instead of complex type literals all reduce noise.

The best diagram is the one that leaves out everything the reader doesn't need.
