# ZenUML Reference

ZenUML is a sequence-diagram DSL supported as a Mermaid diagram type. It renders inside ` ```mermaid ` blocks with a `zenuml` directive on the first line.

**Docs**: https://zenuml.com/docs/category/language-guide/
**Mermaid integration**: https://mermaid.js.org/syntax/zenuml.html

> **GitHub rendering caveat**: GitHub's Mermaid renderer may not support the `zenuml` directive. Needs testing. Works locally with mermaid-cli and VS Code Mermaid extensions.

## Syntax Quick Reference

### Participants

Implicitly declared on first use. Order matches first appearance in source.

Explicit declaration with stereotypes:
```
@Starter(Client)
@Actor Customer
```

Groups:
```
group GroupName {
  A
  B
}
```

### Messages

| Type | Syntax | Arrow |
|------|--------|-------|
| Synchronous call | `A.method()` | Filled arrowhead |
| Async message | `A->B: message` | Open arrowhead |
| Return | `return value` or `ret = A.method()` | Dashed line |
| Object creation | `new ClassName()` | Dashed line |
| Self-message | `A->A: description` | Bent arrow |

### Nesting (call stack)

Braces create an activation bar on the callee. Inside `{ }`, the callee is the active participant making subsequent calls.

```
A.method() {
  B.other()    // A calls B.other()
  C.deep()     // A calls C.deep()
}
```

Nesting composes:
```
A.call() {
  B.work() {
    C.fetch()  // B calls C.fetch()
  }
}
```

### Control Flow

**Conditionals:**
```
if (condition) {
  A.m1()
} else if (other) {
  A.m2()
} else {
  A.m3()
}
```

**Loops:**
```
loop("Every minute") {
  A->B: ping
}
```

**Try/catch:**
```
try {
  A->B.DoSomething()
} catch (Exception e) {
  new Error(e)
} finally {
  A.close()
}
```

**Optional (`opt`):**
```
opt {
  @return A->B: cached result
}
```

### Comments

```
// Single-line comment (supports markdown in some renderers)
// **bold** and [links](url) work in comments
```

### Return values

```
result = Service.compute()
return result
@return A->B: response   // explicit return arrow
```

## Mapping Effect-TS Constructs to ZenUML

> **Validated with mermaid-cli v11.12.0** — sample `.mmd` files and rendered SVG/PNG outputs are in `samples/`.

### Syntax pitfall: `new` + variable reference

**Avoid** `x = new Foo()` followed by `x.method()`. ZenUML creates a participant named `x:Foo` for the object creation, but `x.method()` routes to a *separate* participant named `x` — producing a phantom duplicate column.

**Workarounds:**
- Use direct service calls: `Foo.method()` (preferred — simplest)
- Use quoted participant ref: `"x:Foo".method()` (if you need the creation arrow)

### Gen functions

An `Effect.gen` function is a sequence of `yield*` steps. Each step is either:
- **Service access** (`yield* Database`) — obtaining a service from context
- **Method call** (`yield* db.query(...)`) — calling a method on a service
- **Effect operation** (`yield* Effect.succeed(...)`) — running an effect

**Validated mapping**: The gen function is the `@Starter`. Service methods are called directly on the service participant (no `new`, no variable assignment). This produces the cleanest diagram.

```
zenuml
// processEvent: Effect<Updated, DbError, Database>
@Starter(processEvent)
Database.query("SELECT * FROM state WHERE id = ...")
Database.execute("UPDATE state SET payload = ...")
return updated
```

> See `samples/gen-function.mmd` — renders as a clean 2-participant sequence diagram.

### Services

Effect services (`Context.Tag`) are participants, implicitly declared on first use. When a gen function does `yield* ServiceName`, the service appears as a participant when its methods are called. There is no need to model the `yield*` access step separately — it adds clutter without information.

If you do need to show the service access explicitly (e.g. when the service is obtained but no methods are called), use `Service.access()`.

### Layers

Layers construct services. `Layer.effect(ServiceTag, Effect.gen(...))` means "this layer provides ServiceTag by running a gen function."

**Validated approach — Layers as build sequence with return values:**

Each layer is a participant. `Application` calls `.build()` on each layer, with comments showing `requires:` / `provides:` annotations. The `return ServiceName` produces a dashed return arrow showing what service flows back.

```
zenuml
@Starter(Application)
AppConfigLive.build() {
  // provides: AppConfig
  return AppConfig
}
DatabaseLive.build() {
  // requires: AppConfig
  // provides: Database
  DatabaseLive.connect()
  return Database
}
StatePersisterLive.build() {
  // requires: Database
  // provides: StatePersister
  return StatePersister
}
```

> See `samples/layer-construction.mmd` — renders as a 4-participant diagram. Comments appear inline next to activation bars. Return arrows clearly show what each layer provides.

**Rejected alternatives:**
- **`new` inside build blocks** (e.g. `config = new AppConfig()`) — creates extra participant columns for each created object, making diagrams too wide (7+ participants).
- **Async message syntax** (`Application->DatabaseLive: provide Database { ... }`) — braces don't create activation bars with `->` arrows, so nesting is lost.

### Cross-file refs (sub-program expansion)

When a gen function yields to another gen function defined elsewhere, ZenUML nesting maps naturally — the sub-program becomes a self-call with `{ }` braces containing its expanded steps:

```
zenuml
@Starter(program)
fetchUser() {
  // expanded from cross-file-b.ts
  Effect.succeed(1)
  Effect.succeed("Alice")
  return user
}
greeting = Effect.succeed("Hello, Alice")
return greeting
```

> See `samples/cross-file-ref.mmd` — `fetchUser()` renders as a self-call on `program` with an activation bar containing the expanded steps.

**Note:** ZenUML does not support object literal syntax in return values (`return { id, name }` causes a parse error). Use a simple identifier like `return user` instead.

### Error handling

Pipe chains with `catchTag`/`catchAll`/`mapError` map to `try`/`catch`. Use `par` inside `try` for concurrent operations (see Framing Constructs below):

```
zenuml
@Starter(handleRequest)
try {
  StatePersister.access()
  Database.access()
  par {
    Database.query("SELECT * FROM requests")
    Database.query("SELECT * FROM related")
  }
  StatePersister.persist(result)
} catch (DbError) {
  Effect.succeed(recovered)
}
```

> See `samples/error-handling.mmd` — `par` nests inside `try`, producing a "Par" box within the "Try" box. Concurrent queries get sub-step numbers (1.3.1, 1.3.2).

## Framing Constructs

ZenUML provides interaction fragments that map naturally to Effect-TS control flow. These render as labeled boxes around groups of interactions.

### `par` — Concurrency (`Effect.all`)

`Effect.all([...])` runs multiple effects concurrently. The `par` fragment shows this visually:

```
zenuml
@Starter(handleRequest)
Database.access()
par {
  Database.query("SELECT * FROM requests WHERE id = ...")
  Database.query("SELECT * FROM related WHERE request_id = ...")
}
StatePersister.persist(result)
```

> See `samples/par-concurrent.mmd` — renders a labeled "Par" box with horizontal dividers between concurrent operations.

**Nesting:** `par` composes with `try/catch` — see `samples/combined-handler.mmd` for a full example.

### `forEach` / `while` — Iteration and Retry

**`Effect.forEach`** maps to `forEach(collection)`:
```
zenuml
@Starter(processAll)
forEach(ids) {
  handleRequest.process(id)
}
return results
```

> See `samples/loop-foreach.mmd` — renders as a "Loop" box with "[ids]" condition label.

**`Effect.retry`** maps to `while(policy)`:
```
zenuml
@Starter(DatabaseLive)
while(retryPolicy) {
  Effect.tryPromise(connect)
}
return connection
```

> See `samples/loop-retry.mmd` — renders as a "Loop" box with "[retryPolicy]" condition label.

### Fiber fork/interrupt lifecycle

`Effect.fork` + `Fiber.interrupt` models a background fiber running alongside the main flow. Since `par` only frames concurrent *interactions* (not long-running background tasks), use explicit fork/interrupt calls:

```
zenuml
@Starter(processAll)
monitor = Effect.fork(monitorFiber)
forEach(ids) {
  handleRequest.process(id)
}
Fiber.interrupt(monitor)
```

> See `samples/par-fiber.mmd` — fork returns a fiber handle, loop processes items, then the fiber is interrupted. Clean 4-participant layout.

### `group` — Participant Grouping

Groups organize participant columns (not interactions) into labeled dashed boxes. Useful for showing which services come from which source file or module.

```
zenuml
group "infrastructure.ts" {
  AppConfig
  Database
}
group "state-service.ts" {
  StatePersister
}
@Starter(handleRequest)
Database.query("SELECT * FROM requests")
StatePersister.persist(result)
```

> See `samples/group-files.mmd` — participants are visually grouped by source file with dashed boundaries and labels.

**Layer grouping** — group layer implementations separately from the services they provide:

```
zenuml
group Layers {
  AppConfigLive
  DatabaseLive
  StatePersisterLive
}
@Starter(Application)
AppConfigLive.build() {
  return AppConfig
}
DatabaseLive.build() {
  DatabaseLive.connect()
  return Database
}
StatePersisterLive.build() {
  return StatePersister
}
```

> See `samples/group-layers.mmd` — the "Layers" group wraps the layer participants; Application sits outside.

**Constraints:**
- `group` declarations **must come before** `@Starter` — the parser rejects `@Starter` followed by `group`.
- `@Starter` **cannot be inside** a `group` — only regular participants can be grouped.
- Grouped participants appear on the **left**; the `@Starter` participant appears to their **right**. Arrows flow right-to-left from caller to grouped services.

### Combined example

All framing constructs compose together. See `samples/combined-handler.mmd` for `group` + `try/catch` + `par` in one diagram.

## Rendering

Render samples locally with mermaid-cli:
```bash
npx @mermaid-js/mermaid-cli -i samples/gen-function.mmd -o samples/gen-function.svg
```

## Open Questions

- How deep should sub-program expansion go in the sequence diagram before it gets unreadable?
- Does GitHub actually render `zenuml` in mermaid blocks? (Works locally with mermaid-cli v11.12.0.)
- Should `group` be used by default for file boundaries, or only when there are 3+ source files involved? (Groups reverse arrow direction since the caller moves to the right.)
