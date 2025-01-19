// src/db/sqlite.ts

import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const userDbCache = new Map<string, { dbFilePath: string; dbObj: Database }>();

export const getOrInitializeDatabase = async (userId: string) => {
  const existingDb = userDbCache.get(userId);
  if (existingDb) return existingDb.dbObj;

  // will do nothing if dir already exists
  await mkdir(path.resolve(".sqlite"), { recursive: true });

  const dbPath = path.resolve(`.sqlite/chat_history_${userId}.db`);
  console.log(
    `No existing database found in cache for user ${userId}.
    Initializing new database object from ${dbPath}.`,
  );
  const db = new Database(dbPath, { create: true });
  db.run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  userDbCache.set(userId, { dbFilePath: dbPath, dbObj: db });
  return db;
};
