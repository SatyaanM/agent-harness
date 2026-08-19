/// <reference path="./node-sqlite.d.ts" />
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type {
  ISqliteDatabase,
  ISqliteRunResult,
  ISqliteStatement,
  SqliteBindValue,
} from "./types.js";

function isPromiseLike(val: unknown): boolean {
  if (typeof val === "object" && val !== null && "then" in val) {
    return typeof val.then === "function";
  }
  return false;
}

class SqliteStatementWrapper<
  TBind extends SqliteBindValue[] = SqliteBindValue[],
  TResult = Record<string, unknown>,
> implements ISqliteStatement<TBind, TResult>
{
  constructor(private readonly stmt: StatementSync<TBind, TResult>) {}

  run(...params: TBind): ISqliteRunResult {
    const result = this.stmt.run(...params);
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  get(...params: TBind): TResult | undefined {
    return this.stmt.get(...params);
  }

  all(...params: TBind): TResult[] {
    return this.stmt.all(...params);
  }
}

export class SqliteDatabaseDriver implements ISqliteDatabase {
  private readonly db: DatabaseSync;
  private readonly dbPath: string;
  private isClosed = false;
  private transactionDepth = 0;

  constructor(dbPath: string, options?: { readonly?: boolean }) {
    this.dbPath = dbPath;
    if (dbPath !== ":memory:" && !dbPath.startsWith("file:")) {
      const dir = path.dirname(path.resolve(dbPath));
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath, {
      readOnly: options?.readonly ?? false,
    });
    this.applyPragmas();
  }

  get path(): string {
    return this.dbPath;
  }

  get isOpen(): boolean {
    return !this.isClosed;
  }

  private applyPragmas(): void {
    const isMemory = this.dbPath === ":memory:";

    // Foreign keys must be ON for relational integrity
    this.exec("PRAGMA foreign_keys = ON;");
    this.exec("PRAGMA busy_timeout = 5000;");
    this.exec("PRAGMA temp_store = MEMORY;");

    if (!isMemory) {
      this.exec("PRAGMA journal_mode = WAL;");
      this.exec("PRAGMA synchronous = NORMAL;");
      this.exec("PRAGMA cache_size = -64000;");
      try {
        this.exec("PRAGMA mmap_size = 268435456;");
      } catch {
        // Some systems might restrict mmap; non-fatal
      }
    }
  }

  exec(sql: string): void {
    this.assertOpen();
    this.db.exec(sql);
  }

  prepare<TBind extends SqliteBindValue[] = SqliteBindValue[], TResult = Record<string, unknown>>(
    sql: string,
  ): ISqliteStatement<TBind, TResult> {
    this.assertOpen();
    const statement = this.db.prepare<TBind, TResult>(sql);
    return new SqliteStatementWrapper<TBind, TResult>(statement);
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.assertOpen();
      if (this.transactionDepth > 0) {
        const savepointName = `sp_${this.transactionDepth}`;
        this.transactionDepth += 1;
        this.exec(`SAVEPOINT ${savepointName};`);
        try {
          const result = fn();
          if (isPromiseLike(result)) {
            throw new Error(
              "Transactions must be synchronous. Async functions bypass ACID guarantees.",
            );
          }
          this.exec(`RELEASE SAVEPOINT ${savepointName};`);
          return result;
        } catch (err) {
          try {
            this.exec(`ROLLBACK TO SAVEPOINT ${savepointName};`);
            this.exec(`RELEASE SAVEPOINT ${savepointName};`);
          } catch {
            // ignore
          }
          throw err;
        } finally {
          this.transactionDepth -= 1;
        }
      }

      this.transactionDepth = 1;
      this.exec("BEGIN DEFERRED;");
      try {
        const result = fn();
        if (isPromiseLike(result)) {
          throw new Error(
            "Transactions must be synchronous. Async functions bypass ACID guarantees.",
          );
        }
        this.exec("COMMIT;");
        return result;
      } catch (err) {
        try {
          this.exec("ROLLBACK;");
        } catch {
          // Ignore rollback errors if transaction was already aborted
        }
        throw err;
      } finally {
        this.transactionDepth = 0;
      }
    };
  }

  immediateTransaction<T>(fn: () => T): () => T {
    return () => {
      this.assertOpen();
      if (this.transactionDepth > 0) {
        const savepointName = `sp_imm_${this.transactionDepth}`;
        this.transactionDepth += 1;
        this.exec(`SAVEPOINT ${savepointName};`);
        try {
          const result = fn();
          if (isPromiseLike(result)) {
            throw new Error(
              "Transactions must be synchronous. Async functions bypass ACID guarantees.",
            );
          }
          this.exec(`RELEASE SAVEPOINT ${savepointName};`);
          return result;
        } catch (err) {
          try {
            this.exec(`ROLLBACK TO SAVEPOINT ${savepointName};`);
            this.exec(`RELEASE SAVEPOINT ${savepointName};`);
          } catch {
            // ignore
          }
          throw err;
        } finally {
          this.transactionDepth -= 1;
        }
      }

      this.transactionDepth = 1;
      this.exec("BEGIN IMMEDIATE;");
      try {
        const result = fn();
        if (isPromiseLike(result)) {
          throw new Error(
            "Transactions must be synchronous. Async functions bypass ACID guarantees.",
          );
        }
        this.exec("COMMIT;");
        return result;
      } catch (err) {
        try {
          this.exec("ROLLBACK;");
        } catch {
          // Ignore rollback errors if transaction was already aborted
        }
        throw err;
      } finally {
        this.transactionDepth = 0;
      }
    };
  }

  pragma(pragmaSql: string): unknown {
    this.assertOpen();
    const stmt = this.db.prepare(`PRAGMA ${pragmaSql};`);
    return stmt.all();
  }

  close(): void {
    if (!this.isClosed) {
      try {
        if (this.dbPath !== ":memory:") {
          try {
            this.exec("PRAGMA wal_checkpoint(TRUNCATE);");
          } catch {
            // Best effort truncate on close
          }
        }
        this.db.close();
      } finally {
        this.isClosed = true;
      }
    }
  }

  private assertOpen(): void {
    if (this.isClosed) {
      throw new Error(`Database connection at "${this.dbPath}" is closed.`);
    }
  }
}

export function createDatabaseConnection(
  dbPath = ":memory:",
  options?: { readonly?: boolean },
): ISqliteDatabase {
  return new SqliteDatabaseDriver(dbPath, options);
}

export function withTransaction<T>(db: ISqliteDatabase, fn: () => T): T {
  return db.transaction(fn)();
}

export function withImmediateTransaction<T>(db: ISqliteDatabase, fn: () => T): T {
  return db.immediateTransaction(fn)();
}

export function walCheckpoint(
  db: ISqliteDatabase,
  mode: "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE" = "PASSIVE",
): unknown {
  return db.pragma(`wal_checkpoint(${mode})`);
}
