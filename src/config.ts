/**
 * Application configuration, resolved once at startup.
 *
 * Every value is read from the environment so the same code runs unchanged
 * in a Codespace, in CI and in Azure App Service.
 */
export interface AppConfig {
  readonly port: number;
  readonly host: string;
  readonly databaseFile: string;
  readonly environment: "development" | "test" | "production";
  readonly version: string;
  readonly requestBodyLimitBytes: number;
  readonly rateLimitPerMinute: number;
  readonly authDisabled: boolean;
}

function readPort(): number {
  const raw = process.env.PORT ?? "3000";
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${raw}`);
  }
  return port;
}

function readEnvironment(): AppConfig["environment"] {
  const raw = process.env.NODE_ENV ?? "development";
  if (raw === "development" || raw === "test" || raw === "production") return raw;
  throw new Error(`Invalid NODE_ENV value: ${raw}`);
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid ${name} value: ${raw}`);
  return value;
}

export const config: AppConfig = Object.freeze({
  port: readPort(),
  host: process.env.HOST ?? "0.0.0.0",
  databaseFile: process.env.DATABASE_FILE ?? "data/parts-hub.db",
  environment: readEnvironment(),
  version: process.env.APP_VERSION ?? "1.0.0",
  requestBodyLimitBytes: 256 * 1024,
  rateLimitPerMinute: readPositiveInt("RATE_LIMIT_PER_MINUTE", 240),
  // Read-only anonymous browsing, so the dashboard shows data immediately in a
  // Codespace. Writing always requires a key. Never enable this in production.
  authDisabled: process.env.AUTH_DISABLED === "true",
});
