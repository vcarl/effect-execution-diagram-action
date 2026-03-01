// Test fixture: simple pipe chains
import { Effect, pipe } from "effect";

export const basicPipe = pipe(
  Effect.succeed(42),
  Effect.map((n) => n + 1),
  Effect.flatMap((n) => Effect.succeed(n * 2)),
  Effect.tap((n) => Effect.log(`Result: ${n}`))
);

export const methodPipe = Effect.succeed("hello").pipe(
  Effect.map((s) => s.toUpperCase()),
  Effect.flatMap((s) => Effect.succeed(s.length))
);
