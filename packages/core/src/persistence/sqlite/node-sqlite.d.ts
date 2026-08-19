declare module "node:sqlite" {
  export interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export type SqliteBindValue = string | number | bigint | null | Uint8Array;

  export class StatementSync<
    TBind extends SqliteBindValue[] = SqliteBindValue[],
    TResult = Record<string, unknown>,
  > {
    run(...params: TBind): RunResult;
    get(...params: TBind): TResult | undefined;
    all(...params: TBind): TResult[];
    setReadonlyMode(readOnly: boolean): void;
    setAllowBareNamedParameters(allow: boolean): void;
  }

  export interface DatabaseSyncOptions {
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    open?: boolean;
  }

  export class DatabaseSync {
    constructor(location: string, options?: DatabaseSyncOptions);
    close(): void;
    exec(sql: string): void;
    prepare<TBind extends SqliteBindValue[] = SqliteBindValue[], TResult = Record<string, unknown>>(
      sql: string,
    ): StatementSync<TBind, TResult>;
  }
}
