// Test fixture: parallel and batch patterns with Effect.all expansion
import { Effect, pipe } from "effect";

// Helper effects for composition
const fetchName = (id: string) => Effect.succeed(`User ${id}`);
const fetchEmail = (id: string) => Effect.succeed(`${id}@example.com`);
const fetchAvatar = (id: string) => Effect.succeed(`https://avatar.io/${id}`);

// Program 1: pipe with Effect.all — shows expanded array contents
export const fetchAllUsers = (id: string) =>
  pipe(
    Effect.all([fetchName(id), fetchEmail(id), fetchAvatar(id)]),
    Effect.map(([name, email, avatar]) => ({ name, email, avatar }))
  );

// Program 2: Effect.gen with multiple Effect.all calls in sequence
export const batchProcess = Effect.gen(function* () {
  const users = yield* Effect.all([fetchName("1"), fetchName("2"), fetchName("3")]);
  const emails = yield* Effect.all([fetchEmail("1"), fetchEmail("2"), fetchEmail("3")]);
  return { users, emails };
});

// Program 3: pipe with several flatMap steps
export const raceHandlers = pipe(
  Effect.succeed({ requestId: "abc" }),
  Effect.flatMap((req) => Effect.succeed({ ...req, validated: true })),
  Effect.flatMap((req) => Effect.succeed({ ...req, authorized: true })),
  Effect.flatMap((req) => Effect.succeed({ ...req, processed: true })),
  Effect.map((req) => ({ status: "done", ...req }))
);

// Program 4: pipe using Effect.all then Effect.map
export const validateInputs = pipe(
  Effect.all([
    Effect.succeed("valid-name"),
    Effect.succeed("valid@email.com"),
    Effect.succeed(25),
  ]),
  Effect.map(([name, email, age]) => ({ name, email, age, valid: true }))
);
