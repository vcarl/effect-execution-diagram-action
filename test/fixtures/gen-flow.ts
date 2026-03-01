// Test fixture: Effect.gen patterns
import { Effect } from "effect";

interface Config {
  host: string;
  port: number;
}

const getConfig = Effect.succeed<Config>({ host: "localhost", port: 3000 });
const connectDb = (config: Config) => Effect.succeed(`db://${config.host}:${config.port}`);
const startServer = (dbUrl: string) => Effect.succeed({ url: dbUrl, running: true });

export const program = Effect.gen(function* () {
  const config = yield* getConfig;
  const dbUrl = yield* connectDb(config);
  const server = yield* startServer(dbUrl);
  return server;
});
