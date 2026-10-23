import { DatabaseError } from "./errors";

/** Run one prepared statement and return its rows; D1 failures become `DatabaseError`. */
export async function queryAll<T>(statement: D1PreparedStatement): Promise<T[]> {
  try {
    const result = await statement.all<T>();
    return result.results;
  } catch (error) {
    throw new DatabaseError(error);
  }
}

/** Run one prepared statement and return its first row, or null. */
export async function queryFirst<T>(statement: D1PreparedStatement): Promise<T | null> {
  try {
    return await statement.first<T>();
  } catch (error) {
    throw new DatabaseError(error);
  }
}

/** Run several statements in one round trip (D1 batches are a single transaction). */
export async function queryBatch(db: D1Database, statements: D1PreparedStatement[]): Promise<unknown[][]> {
  try {
    const results = await db.batch(statements);
    return results.map((result) => result.results);
  } catch (error) {
    throw new DatabaseError(error);
  }
}

/** Build a prepared statement with bound parameters. SQL text must never contain user input. */
export function statement(db: D1Database, sql: string, params: readonly unknown[] = []): D1PreparedStatement {
  const prepared = db.prepare(sql);
  return params.length ? prepared.bind(...params) : prepared;
}
