// Test fixture: multi-step workflow with services and mixed patterns
import { Context, Effect, pipe } from "effect";

// Services
class Config extends Context.Tag("Config")<
  Config,
  { get: (key: string) => Effect.Effect<string> }
>() {}

class Database extends Context.Tag("Database")<
  Database,
  {
    query: (sql: string) => Effect.Effect<unknown[]>;
    insert: (table: string, data: unknown) => Effect.Effect<void>;
  }
>() {}

class EmailService extends Context.Tag("EmailService")<
  EmailService,
  { send: (to: string, subject: string, body: string) => Effect.Effect<void> }
>() {}

// Domain types
interface Order {
  id: string;
  userId: string;
  items: string[];
  total: number;
}

// Program 1: small pipe chain (2 steps)
export const loadConfig = pipe(
  Config,
  Effect.flatMap((config) => config.get("ORDER_PREFIX"))
);

// Program 2: Effect.gen with 5+ yield steps — tall gen flow diagram
export const processOrder = (orderId: string) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const prefix = yield* config.get("ORDER_PREFIX");
    const db = yield* Database;
    const rows = yield* db.query(`SELECT * FROM orders WHERE id = '${prefix}-${orderId}'`);
    const order = rows[0] as Order;
    const validated = { ...order, verified: true };
    yield* db.insert("processed_orders", validated);
    const email = yield* EmailService;
    yield* email.send(order.userId, "Order Processed", `Order ${order.id} is complete`);
    return validated;
  });

// Program 3: pipe chain with flatMap and tap
export const notifyAdmin = (order: Order) =>
  pipe(
    EmailService,
    Effect.flatMap((email) =>
      email.send("admin@example.com", "New Order", `Order ${order.id}: $${order.total}`)
    ),
    Effect.tap(() => Effect.log(`Admin notified about order ${order.id}`))
  );

// Program 4: Effect.gen composing the above programs
export const orderWorkflow = (orderId: string) =>
  Effect.gen(function* () {
    const prefix = yield* loadConfig;
    const order = yield* processOrder(orderId);
    yield* notifyAdmin(order);
    yield* Effect.log(`Workflow complete for ${prefix}-${orderId}`);
    return order;
  });
