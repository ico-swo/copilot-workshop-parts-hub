import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.ts";

const here = dirname(fileURLToPath(import.meta.url));
const schemaSql = () => readFileSync(resolve(here, "schema.sql"), "utf8");

let instance: DatabaseSync | undefined;

function configure(db: DatabaseSync): DatabaseSync {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(schemaSql());
  return db;
}

/** The process-wide handle, created and migrated on first use. */
export function getDatabase(file: string = config.databaseFile): DatabaseSync {
  if (instance) return instance;

  if (file !== ":memory:") mkdirSync(dirname(resolve(file)), { recursive: true });

  const db = new DatabaseSync(file);
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");

  instance = configure(db);
  return instance;
}

/** An isolated in-memory database. Used by the test suite. */
export function createTestDatabase(): DatabaseSync {
  return configure(new DatabaseSync(":memory:"));
}

export function closeDatabase(): void {
  instance?.close();
  instance = undefined;
}
