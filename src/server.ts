import { createServer } from "node:http";
import { config } from "./config.ts";
import { getDatabase, closeDatabase } from "./db/index.ts";
import { createApp } from "./app.ts";

const db = getDatabase();
const server = createServer(createApp(db));

server.listen(config.port, config.host, () => {
  console.log(
    JSON.stringify({
      level: "info",
      message: "Astra Parts Hub started",
      port: config.port,
      environment: config.environment,
      version: config.version,
      authDisabled: config.authDisabled,
    }),
  );
});

function shutdown(signal: string): void {
  console.log(JSON.stringify({ level: "info", message: "Shutting down", signal }));
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
