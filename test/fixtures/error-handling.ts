// Test fixture: error channel propagation
import { Effect, pipe } from "effect";

class HttpError {
  readonly _tag = "HttpError";
  constructor(readonly status: number) {}
}

class ParseError {
  readonly _tag = "ParseError";
  constructor(readonly message: string) {}
}

const fetchUser = Effect.fail(new HttpError(404));
const parseResponse = (data: unknown) => Effect.fail(new ParseError("bad json"));

export const withCatchTag = pipe(
  fetchUser,
  Effect.catchTag("HttpError", (err) =>
    Effect.succeed({ fallback: true })
  )
);

export const withMapError = pipe(
  fetchUser,
  Effect.mapError((err) => new ParseError("mapped"))
);

export const withCatchAll = pipe(
  fetchUser,
  Effect.flatMap(() => parseResponse(null)),
  Effect.catchAll(() => Effect.succeed({ recovered: true }))
);
