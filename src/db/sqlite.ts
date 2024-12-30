// src/db/sqlite.ts

import { Database } from "bun:sqlite";
import path from "node:path";

const dbCache = new Map<string, Database>();

export const initializeDatabase = async (userId: string) => {
  const existingDb = dbCache.get(userId);
  if (existingDb) return existingDb;

  const dbPath = path.resolve(`./chat_history_${userId}.db`);
  const db = new Database(dbPath);
  db.run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  dbCache.set(userId, db);
  return db;
};

export const getDatabase = (userId: string): Database => {
  const db = dbCache.get(userId);
  if (!db) {
    throw new Error("Database not initialized. Call initializeDatabase first.");
  }
  return db;
};
