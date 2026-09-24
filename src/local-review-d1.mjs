import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DATABASE = path.join(ROOT, "artifacts", "runtime", "review-capture-local.sqlite3");
const MIGRATIONS = [
  path.join(ROOT, "migrations", "002_email_machine.sql"),
  path.join(ROOT, "migrations", "004_review_capture.sql"),
  path.join(ROOT, "migrations", "005_canonical_contact_capture.sql"),
];

function resultMeta(result) {
  return {
    success: true,
    meta: {
      changes: Number(result.changes),
      last_row_id: Number(result.lastInsertRowid),
    },
  };
}

export async function createLocalReviewD1(databasePath = DEFAULT_DATABASE) {
  await mkdir(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  for (const migration of MIGRATIONS) database.exec(await readFile(migration, "utf8"));
  let closed = false;
  const assertOpen = () => {
    if (closed) throw new Error("local_d1_closed");
  };
  const prepare = (sql) => ({
    _sql: sql,
    bind(...params) {
      const statement = database.prepare(sql);
      return {
        _sql: sql,
        _params: params,
        async run() {
          assertOpen();
          return resultMeta(statement.run(...params));
        },
        async first() {
          assertOpen();
          return statement.get(...params) ?? null;
        },
        async all() {
          assertOpen();
          const results = statement.all(...params);
          return { success: true, results };
        },
      };
    },
  });
  return {
    databasePath,
    close() {
      if (closed) return;
      database.close();
      closed = true;
    },
    prepare,
    async batch(statements) {
      assertOpen();
      database.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) {
          if (!statement?._sql || !Array.isArray(statement._params)) throw new Error("local_d1_batch_statement_invalid");
          results.push(resultMeta(database.prepare(statement._sql).run(...statement._params)));
        }
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export async function createLocalReviewEnvironment(databasePath = DEFAULT_DATABASE) {
  return {
    REVIEW_CAPTURE_MODE: "local_test",
    GLP_DB: await createLocalReviewD1(databasePath),
  };
}
