// src/db/sqlite.ts

import { Database } from "bun:sqlite";
import path from "node:path";

const userDbCache = new Map<string, { dbFilePath: string; dbObj: Database }>();

export const getOrInitializeDatabase = async (userId: string) => {
  const existingDb = userDbCache.get(userId);
  if (existingDb) {
    console.log(
      `Existing database located at ${existingDb.dbFilePath} for user ${userId} found in cache.`,
    );
    return existingDb.dbObj;
  }

  const dbPath = path.resolve(`./chat_history_${userId}.sqlite`);
  console.log(
    `No existing database found in cache for user ${userId}.
    Initializing new database object from ${dbPath}.`,
  );
  const db = new Database(dbPath, { create: true });
  db.run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  userDbCache.set(userId, { dbFilePath: dbPath, dbObj: db });
  return db;
};
