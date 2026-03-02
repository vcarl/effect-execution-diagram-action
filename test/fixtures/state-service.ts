// Middle layer: consumes Database, tracks state with Ref, processes from Queue
import { Context, Effect, Layer, Queue, Ref, Stream } from "effect";
import { Database, DbError, retryPolicy } from "./infrastructure.js";

// ---------------------------------------------------------------------------
// processEvent — per-item handler
// ---------------------------------------------------------------------------

export const processEvent = (event: { id: string; payload: string }) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const current = yield* db.query(
      `SELECT * FROM state WHERE id = '${event.id}'`,
    );
    const updated = { ...(current[0] as Record<string, unknown>), payload: event.payload, processed: true };
    yield* db.execute(
      `UPDATE state SET payload = '${event.payload}' WHERE id = '${event.id}'`,
    );
    return updated;
  });

// ---------------------------------------------------------------------------
// runFromQueue — Stream.fromQueue + mapEffect with retry
// ---------------------------------------------------------------------------

export const runFromQueue = (
  queue: Queue.Queue<{ id: string; payload: string }>,
) =>
  Effect.gen(function* () {
    const stream = Stream.fromQueue(queue).pipe(
      Stream.mapEffect((event) =>
        Effect.retry(processEvent(event), retryPolicy),
      ),
    );
    const results = yield* Stream.runCollect(stream);
    return results;
  });

// ---------------------------------------------------------------------------
// StatePersister service
// ---------------------------------------------------------------------------

export class StatePersister extends Context.Tag("StatePersister")<
  StatePersister,
  {
    readonly persist: (
      data: unknown,
    ) => Effect.Effect<void, DbError>;
    readonly processedCount: Effect.Effect<number>;
  }
>() {}

export const StatePersisterLive = Layer.effect(
  StatePersister,
  Effect.gen(function* () {
    const db = yield* Database;
    const count = yield* Ref.make(0);

    return {
      persist: (data: unknown) =>
        Effect.acquireUseRelease(
          db.execute("BEGIN"),
          () =>
            Effect.gen(function* () {
              yield* db.execute(`INSERT INTO state VALUES ('${JSON.stringify(data)}')`);
              yield* Ref.update(count, (n) => n + 1);
            }),
          () => db.execute("COMMIT").pipe(Effect.orDie),
        ),
      processedCount: Ref.get(count),
    };
  }),
);
