// Test fixture: layer composition patterns
import { Context, Effect, Layer } from "effect";

// Services
class DatabaseService extends Context.Tag("DatabaseService")<
  DatabaseService,
  { query: (sql: string) => Effect.Effect<unknown> }
>() {}

class HttpServer extends Context.Tag("HttpServer")<
  HttpServer,
  { listen: (port: number) => Effect.Effect<void> }
>() {}

class Logger extends Context.Tag("Logger")<
  Logger,
  { log: (msg: string) => Effect.Effect<void> }
>() {}

// Layers
export const LoggerLive = Layer.succeed(
  Logger,
  { log: (msg: string) => Effect.log(msg) }
);

export const DatabaseLive = Layer.effect(
  DatabaseService,
  Effect.gen(function* () {
    const logger = yield* Logger;
    yield* logger.log("Connecting to database...");
    return { query: (sql: string) => Effect.succeed({ rows: [] }) };
  })
);

export const HttpServerLive = Layer.effect(
  HttpServer,
  Effect.gen(function* () {
    const db = yield* DatabaseService;
    const logger = yield* Logger;
    yield* logger.log("Starting HTTP server...");
    return { listen: (port: number) => Effect.log(`Listening on ${port}`) };
  })
);

export const AppLayer = HttpServerLive.pipe(
  Layer.provide(DatabaseLive),
  Layer.provide(LoggerLive)
);
