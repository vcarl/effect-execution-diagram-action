// Test fixture: comprehensive error handling patterns
import { Effect, Option, pipe } from "effect";

// Tagged error classes
class NetworkError {
  readonly _tag = "NetworkError";
  constructor(readonly url: string) {}
}

class TimeoutError {
  readonly _tag = "TimeoutError";
  constructor(readonly ms: number) {}
}

class AuthError {
  readonly _tag = "AuthError";
  constructor(readonly reason: string) {}
}

class ValidationError {
  readonly _tag = "ValidationError";
  constructor(readonly field: string) {}
}

// Error source
const riskyCall: Effect.Effect<string, NetworkError | TimeoutError | AuthError> =
  Effect.fail(new NetworkError("/api/data"));

// Program 1: catchTags — handle multiple tagged errors at once
export const withCatchTags = pipe(
  riskyCall,
  Effect.catchTags({
    NetworkError: (err) => Effect.succeed(`retried ${err.url}`),
    TimeoutError: (err) => Effect.succeed(`timeout after ${err.ms}ms`),
  })
);

// Program 2: catchSome — selectively handle some errors
export const withCatchSome = pipe(
  riskyCall,
  Effect.catchSome((err) => {
    if (err._tag === "NetworkError") {
      return Option.some(Effect.succeed("network fallback"));
    }
    return Option.none();
  })
);

// Program 3: orElse — replace with alternative effect
const fallbackCall: Effect.Effect<string, ValidationError> =
  Effect.succeed("fallback value");

export const withOrElse = pipe(
  riskyCall,
  Effect.orElse(() => fallbackCall)
);

// Program 4: orElseFail — replace error with a different error
export const withOrElseFail = pipe(
  riskyCall,
  Effect.orElseFail(() => new ValidationError("input"))
);

// Program 5: orElseSucceed — recover with a default value
export const withOrElseSucceed = pipe(
  riskyCall,
  Effect.orElseSucceed(() => "default value")
);

// Program 6: multi-step progressive narrowing
export const multiStepRecovery = pipe(
  riskyCall,
  Effect.mapError((err) =>
    err._tag === "AuthError" ? new NetworkError("/auth-retry") : err
  ),
  Effect.catchTag("NetworkError", (err) =>
    Effect.succeed(`recovered from ${err.url}`)
  )
);
