// Top-level consumer: cross-file gen-in-gen, parallel, fibers, error handling
import { Effect, Fiber, pipe, Schedule } from "effect";
import { Database, DbError } from "./infrastructure.js";
import { StatePersister } from "./state-service.js";

// ---------------------------------------------------------------------------
// handleRequest — parallel lookups + catchTag
// ---------------------------------------------------------------------------

export const handleRequest = (id: string) =>
  pipe(
    Effect.gen(function* () {
      const persister = yield* StatePersister;
      const db = yield* Database;

      const [row, related] = yield* Effect.all([
        db.query(`SELECT * FROM requests WHERE id = '${id}'`),
        db.query(`SELECT * FROM related WHERE request_id = '${id}'`),
      ]);

      yield* persister.persist({ id, row, related });

      return { id, row, related };
    }),
    Effect.catchTag("DbError", (err) =>
      Effect.succeed({ id, row: [], related: [], recovered: err.reason }),
    ),
  );

// ---------------------------------------------------------------------------
// handleBatch — fork background fiber, forEach, join
// ---------------------------------------------------------------------------

export const handleBatch = (ids: string[]) =>
  Effect.gen(function* () {
    const persister = yield* StatePersister;

    // Background fiber: poll processedCount on a fixed schedule
    const monitor = yield* Effect.fork(
      persister.processedCount.pipe(
        Effect.tap((n) => Effect.log(`processed so far: ${n}`)),
        Effect.repeat(Schedule.fixed("1 second")),
      ),
    );

    const results = yield* Effect.forEach(ids, (id) =>
      handleRequest(id).pipe(
        Effect.catchAll(() => Effect.succeed({ id, row: [], related: [], recovered: "batch-fallback" })),
      ),
    );

    yield* Fiber.interrupt(monitor);

    return results;
  });

// ---------------------------------------------------------------------------
// healthCheck — simple pipe, no error handlers
// ---------------------------------------------------------------------------

export const healthCheck = Effect.succeed({ status: "starting" }).pipe(
  Effect.map((s) => ({ ...s, ts: Date.now() })),
  Effect.flatMap((s) => Effect.succeed({ ...s, status: "ok" })),
);
