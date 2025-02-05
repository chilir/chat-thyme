// src/db/sqlite.ts

import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { DbCache, DbCacheEntry } from "../interfaces";

/**
 * TODO: split up this function to smaller helper functions
 *
 * Gets an existing database connection from cache or initializes a new one.
 * Creates necessary directory structure and database schema if they don't
 * exist. The schema includes a `chat_messages` table and an index for efficient
 * queries. LRU cache eviction is done on a best-effort basis depending on
 * whether or not any database connections are in use.
 *
 * @param {string} userId - Discord user ID
 * @param {DbCache} userDbCache - Database connection cache with mutex and
 *   background eviction
 * @param {string} dbDir - Directory path where database files are stored
 * @param {number} dbConnectionCacheSize - Desired maximum number of database
 *   connections to keep in cache
 * @returns {Promise<Database>} Database connection for the user
 * @throws Will throw an error if database directory creation, file operations,
 *   or schema initialization fails
 */
export const getOrInitUserDb = async (
  userId: string,
  userDbCache: DbCache,
  dbDir: string,
  dbConnectionCacheSize: number,
): Promise<Database> => {
  const getCachedDbRelease = await userDbCache.mutex.acquire();
  try {
    const cachedDb = userDbCache.cache.get(userId);
    if (cachedDb) {
      cachedDb.lastAccessed = Date.now();
      cachedDb.refCount++;
      userDbCache.cache.delete(userId);
      userDbCache.cache.set(userId, cachedDb);
      return cachedDb.db;
    }
  } finally {
    getCachedDbRelease();
  }

  // will do nothing if dir already exists
  try {
    await mkdir(path.resolve(dbDir), { recursive: true });
  } catch (error) {
    console.error(
      `Error creating/resolving database directory ${dbDir}:`,
      error,
    );
    throw error;
  }

  // Initialize new db object from db file on disk
  let db: Database;
  let dbPath: string;
  try {
    dbPath = path.resolve(`${dbDir}/chat_history_${userId}.db`);
    console.info(
      `No existing database found in cache (or TTL expired) for user ${userId}.
Initializing new database object from ${dbPath}.`,
    );
    db = new Database(dbPath, { create: true });
  } catch (error) {
    const dbPath = path.resolve(`${dbDir}/chat_history_${userId}.db`);
    console.error(`Error creating/opening database file at ${dbPath}`, error);
    throw error;
  }

  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_call_id TEXT,
        tool_calls TEXT,
        timestamp DATETIME NOT NULL
      )
    `);
  } catch (error) {
    console.error(`Error initializing database schema for ${dbPath}:`, error);
    db.close();
    throw error;
  }

  // Composite index for `chat_id` and `timestamp` columns (most used)
  try {
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id_timestamp ON chat_messages(
        chat_id, timestamp
      )
    `);
  } catch (error) {
    console.error(`Error creating database index for ${dbPath}:`, error);
    db.close();
    throw error;
  }

  const addDbToCacheRelease = await userDbCache.mutex.acquire();
  try {
    // best effort LRU cache eviction
    // no eviction if all db connections are in use
    if (userDbCache.cache.size >= dbConnectionCacheSize) {
      let keyToEvict: string | undefined;
      let entryToEvict: DbCacheEntry | undefined;
      for (const [k, v] of userDbCache.cache.entries()) {
        if (v.refCount === 0) {
          keyToEvict = k;
          entryToEvict = v;
          break;
        }
      }

      if (keyToEvict && entryToEvict) {
        console.info(
          `Cache full. Evicting database connection for user ${keyToEvict}.`,
        );
        entryToEvict.db.close();
        userDbCache.cache.delete(keyToEvict);
      }
    }

    userDbCache.cache.set(userId, {
      filePath: dbPath,
      db: db,
      lastAccessed: Date.now(),
      refCount: 1, // initial ref count since db will be used by caller
    });
  } finally {
    addDbToCacheRelease();
  }

  return db;
};

/**
 * // TODO: consider moving this to `cache.ts` module
 *
 * Decrements the reference count for a user's database connection.
 * This allows the connection to be cleaned up by the cache eviction process
 * when the reference count reaches 0.
 *
 * @param {string} userId - Discord user ID
 * @param {DbCache} userDbCache - Database connection cache
 * @returns {Promise<void>}
 */
export const releaseUserDb = async (
  userId: string,
  userDbCache: DbCache,
): Promise<void> => {
  const release = await userDbCache.mutex.acquire();
  try {
    const cachedDbEntry = userDbCache.cache.get(userId);
    if (cachedDbEntry) {
      cachedDbEntry.refCount = Math.max(0, cachedDbEntry.refCount - 1);
    }
  } finally {
    release();
  }
};
