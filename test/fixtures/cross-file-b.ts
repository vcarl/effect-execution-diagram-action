// Test fixture: cross-file ref target
// This file defines fetchUser as an Effect.gen, which cross-file-a.ts imports and calls.
import { Effect } from "effect";

export const fetchUser = Effect.gen(function* () {
  const id = yield* Effect.succeed(1);
  const name = yield* Effect.succeed("Alice");
  return { id, name };
});
