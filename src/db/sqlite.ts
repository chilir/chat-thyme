// src/db/sqlite.ts

import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { DbCacheEntry } from "../interfaces";

const MAX_CACHE_SIZE = 10; // You can make this configurable
const CACHE_TTL = 3600000; // Time to live in milliseconds (e.g., 1hr)
const CACHE_CHECK_INTERVAL = 600000; // How often to check for expired entries (e.g., 10min)

const userDbCache = new Map<string, DbCacheEntry>();
let cacheCheckIntervalId: ReturnType<typeof setInterval> | undefined;

// background task
const backgroundCheckAndEvictExpiredDbs = () => {
  const now = Date.now();
  userDbCache.forEach((entry, userId) => {
    if (now - entry.lastAccessed > CACHE_TTL) {
      console.log(`TTL expired for user ${userId}. Closing database.`);
      entry.dbObj.close();
      userDbCache.delete(userId);
    }
  });
};

// Initialize the background task when the module is loaded
if (!cacheCheckIntervalId) {
  cacheCheckIntervalId = setInterval(
    backgroundCheckAndEvictExpiredDbs,
    CACHE_CHECK_INTERVAL,
  );
}

export const getOrInitUserDb = async (userId: string) => {
  const cachedDb = userDbCache.get(userId);
  if (cachedDb) {
    // Update last accessed and move to the end of the Map (LRU)
    cachedDb.lastAccessed = Date.now();
    userDbCache.delete(userId);
    userDbCache.set(userId, cachedDb);
    return cachedDb.dbObj;
  }

  // will do nothing if dir already exists
  await mkdir(path.resolve(".sqlite"), { recursive: true });

  // Initialize new db object from db file on disk
  const dbPath = path.resolve(`.sqlite/chat_history_${userId}.db`);
  console.log(`
    No existing database found in cache (or TTL expired) for user ${userId}.
    Initializing new database object from ${dbPath}.
  `);
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

  // Composite index for `chat_id` and `timestamp` columns (most used)
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id_timestamp ON chat_messages(chat_id, timestamp)",
  );

  // LRU cache eviction
  if (userDbCache.size >= MAX_CACHE_SIZE) {
    const keyToEvict = userDbCache.keys().next().value as string; // literally can't be undefined here
    const entryToEvict = userDbCache.get(keyToEvict);
    if (entryToEvict) {
      console.log(
        `Cache full. Evicting database connection for user ${keyToEvict}.`,
      );
      entryToEvict.dbObj.close();
      userDbCache.delete(keyToEvict);
    }
  }

  // Add to cache
  userDbCache.set(userId, {
    dbFilePath: dbPath,
    dbObj: db,
    lastAccessed: Date.now(),
  });

  return db;
};

export const clearUserDbCache = () => {
  console.log(
    "Clearing all database connections and stopping cache maintenance.",
  );
  for (const entry of userDbCache.values()) {
    entry.dbObj.close();
  }
  userDbCache.clear();
  if (cacheCheckIntervalId) {
    clearInterval(cacheCheckIntervalId);
    cacheCheckIntervalId = undefined;
  }
};
