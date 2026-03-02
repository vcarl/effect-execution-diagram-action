// Foundation layer: config, database, errors, retry policy
import { Context, Data, Effect, Layer, Schedule } from "effect";

// ---------------------------------------------------------------------------
// Config service
// ---------------------------------------------------------------------------

export class AppConfig extends Context.Tag("AppConfig")<
  AppConfig,
  { readonly connectionUrl: string; readonly maxRetries: number }
>() {}

export const AppConfigLive = Layer.succeed(AppConfig, {
  connectionUrl: "postgres://localhost:5432/app",
  maxRetries: 5,
});

// ---------------------------------------------------------------------------
// Tagged error
// ---------------------------------------------------------------------------

export class DbError extends Data.TaggedError("DbError")<{
  readonly reason: string;
}> {}

// ---------------------------------------------------------------------------
// Retry policy (composed Schedule, reused across files)
// ---------------------------------------------------------------------------

export const retryPolicy = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.intersect(Schedule.recurs(5)),
);

// ---------------------------------------------------------------------------
// Database service
// ---------------------------------------------------------------------------

export class Database extends Context.Tag("Database")<
  Database,
  {
    readonly query: (sql: string) => Effect.Effect<unknown[], DbError>;
    readonly execute: (sql: string) => Effect.Effect<void, DbError>;
  }
>() {}

/** Provides query and execute methods backed by a Postgres connection */
export const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const config = yield* AppConfig;

    const connection = yield* Effect.retry(
      Effect.tryPromise({
        try: () =>
          Promise.resolve({ url: config.connectionUrl, connected: true }),
        catch: () => new DbError({ reason: "connection failed" }),
      }),
      retryPolicy,
    );

    return {
      query: (sql: string) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () => Promise.resolve([{ id: 1 }]),
            catch: () => new DbError({ reason: `query failed: ${sql}` }),
          });
          if (rows.length === 0) {
            return yield* new DbError({ reason: "empty result" });
          }
          return rows;
        }),
      execute: (sql: string) =>
        Effect.tryPromise({
          try: () => Promise.resolve(undefined),
          catch: () => new DbError({ reason: `execute failed: ${sql}` }),
        }).pipe(
          Effect.tap(() => Effect.log(`executed: ${sql}`)),
          Effect.asVoid,
        ),
    };
  }),
);
