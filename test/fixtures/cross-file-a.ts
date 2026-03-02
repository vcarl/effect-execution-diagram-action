// Test fixture: cross-file ref source
// This file imports fetchUser from cross-file-b.ts and uses it in an Effect.gen.
import { Effect } from "effect";
import { fetchUser } from "./cross-file-b.js";

export const program = Effect.gen(function* () {
  const user = yield* fetchUser;
  const greeting = yield* Effect.succeed(`Hello, ${user.name}`);
  return greeting;
});
