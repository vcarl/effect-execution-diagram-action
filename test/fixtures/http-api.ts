// Test fixture: service-dependent API handler with typed errors and requirements
import { Context, Effect, pipe } from "effect";

// Services
class HttpClient extends Context.Tag("HttpClient")<
  HttpClient,
  { get: (url: string) => Effect.Effect<unknown, HttpError> }
>() {}

class UserRepo extends Context.Tag("UserRepo")<
  UserRepo,
  {
    findById: (id: string) => Effect.Effect<User, NotFoundError>;
    validate: (user: unknown) => Effect.Effect<User, ParseError>;
  }
>() {}

// Domain types
interface User {
  id: string;
  name: string;
  email: string;
}

// Tagged error classes
class HttpError {
  readonly _tag = "HttpError";
  constructor(readonly status: number, readonly message: string) {}
}

class ParseError {
  readonly _tag = "ParseError";
  constructor(readonly input: unknown) {}
}

class NotFoundError {
  readonly _tag = "NotFoundError";
  constructor(readonly resource: string, readonly id: string) {}
}

// Program 1: Effect.gen yielding services — shows R: annotations
export const fetchUser = (userId: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient;
    const raw = yield* http.get(`/users/${userId}`);
    const repo = yield* UserRepo;
    const user = yield* repo.validate(raw);
    const verified = yield* repo.findById(user.id);
    return verified;
  });

// Program 2: pipe chain composing fetchUser — shows error union growth
export const fetchAndValidateUser = (userId: string) =>
  pipe(
    fetchUser(userId),
    Effect.flatMap((user) =>
      user.email.includes("@")
        ? Effect.succeed(user)
        : Effect.fail(new ParseError(user))
    ),
    Effect.map((user) => ({ ...user, verified: true }))
  );

// Program 3: pipe with catchTag — shows error narrowing
export const handleRequest = (userId: string) =>
  pipe(
    fetchAndValidateUser(userId),
    Effect.map((user) => ({ status: 200, body: user })),
    Effect.catchTag("NotFoundError", (err) =>
      Effect.succeed({ status: 404, body: { error: `${err.resource} ${err.id} not found` } })
    ),
    Effect.catchTag("HttpError", (err) =>
      Effect.succeed({ status: err.status, body: { error: err.message } })
    )
  );
