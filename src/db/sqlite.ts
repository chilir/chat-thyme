// src/db/sqlite.ts

import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Mutex } from "async-mutex";
import { config } from "../config";
import type { DbCacheEntry } from "../interfaces";

const userDbCache = new Map<string, DbCacheEntry>();
const userDbCacheMutex = new Mutex();
let cacheCheckIntervalId: ReturnType<typeof setInterval> | undefined;

// background task
const backgroundEvictExpiredDbs = async () => {
  const release = await userDbCacheMutex.acquire();
  try {
    const now = Date.now();
    userDbCache.forEach((entry, userId) => {
      if (
        now - entry.lastAccessed > config.DB_CACHE_TTL_MILLISECONDS &&
        entry.refCount === 0
      ) {
        console.log(`
          TTL expired and no active references for user ${userId}.
          Closing database.
        `);
        entry.dbObj.close();
        userDbCache.delete(userId);
      }
    });
  } finally {
    release();
  }
};

// Initialize the background task when the module is loaded
if (!cacheCheckIntervalId) {
  cacheCheckIntervalId = setInterval(
    backgroundEvictExpiredDbs,
    config.DB_CACHE_CHECK_INTERVAL_MILLISECONDS,
  );
}

export const getOrInitUserDb = async (userId: string) => {
  const getCachedDbRelease = await userDbCacheMutex.acquire();
  try {
    const cachedDb = userDbCache.get(userId);
    if (cachedDb) {
      // Update last accessed and move to the end of the Map (LRU)
      cachedDb.lastAccessed = Date.now();
      cachedDb.refCount++;
      userDbCache.delete(userId);
      userDbCache.set(userId, cachedDb);
      return cachedDb.dbObj;
    }
  } finally {
    getCachedDbRelease();
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

  const addDbToCacheRelease = await userDbCacheMutex.acquire();
  try {
    // Best effort LRU cache eviction
    if (userDbCache.size >= config.DESIRED_MAX_DB_CACHE_SIZE) {
      // Find the least recently used entry with refCount 0
      let keyToEvict: string | undefined;
      for (const [k, v] of userDbCache.entries()) {
        if (v.refCount === 0) {
          keyToEvict = k;
          break;
        }
      }

      if (keyToEvict) {
        const entryToEvict = userDbCache.get(keyToEvict) as DbCacheEntry;
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
      refCount: 1, // initial ref count
    });
  } finally {
    addDbToCacheRelease();
  }

  return db;
};

export const releaseUserDb = async (userId: string) => {
  const release = await userDbCacheMutex.acquire();
  try {
    const cachedDbEntry = userDbCache.get(userId);
    if (cachedDbEntry) {
      cachedDbEntry.refCount = Math.max(0, cachedDbEntry.refCount - 1);
    }
  } finally {
    release();
  }
};

export const clearUserDbCache = async () => {
  const release = await userDbCacheMutex.acquire();
  try {
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
  } finally {
    release();
  }
};
