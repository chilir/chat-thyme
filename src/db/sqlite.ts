// src/db/sqlite.ts

import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { ChatThymeConfig } from "../config/schema";
import type { DbCacheEntry, dbCache } from "../interfaces";

/**
 * Gets an existing database connection from cache or initializes a new one.
 * Implements an LRU cache with reference counting for database connections.
 * Creates necessary directory structure and database schema if they don't
 * exist.
 *
 * @param {string} userId - The Discord user ID to get/create database for
 * @param {ChatThymeConfig} config - Application configuration
 * @param {dbCache} userDbCache - The database connection cache
 * @returns {Promise<Database>} The database connection
 * @throws Will throw an error if database operations fail
 */
export const getOrInitUserDb = async (
  userId: string,
  config: ChatThymeConfig,
  userDbCache: dbCache,
) => {
  const getCachedDbRelease = await userDbCache.mutex.acquire();
  try {
    const cachedDb = userDbCache.cache.get(userId);
    if (cachedDb) {
      // Update last accessed and move to the end of the Map (LRU)
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
    await mkdir(path.resolve(config.dbDir), { recursive: true });
  } catch (error) {
    console.error(
      `Error creating/resolving database directory ${config.dbDir}:`,
      error,
    );
    throw error;
  }

  // Initialize new db object from db file on disk
  let db: Database;
  let dbPath: string;
  try {
    dbPath = path.resolve(`${config.dbDir}/chat_history_${userId}.db`);
    console.info(
      `No existing database found in cache (or TTL expired) for user ${userId}.
Initializing new database object from ${dbPath}.`,
    );
    db = new Database(dbPath, { create: true });
  } catch (error) {
    const dbPath = path.resolve(`${config.dbDir}/chat_history_${userId}.db`);
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
        timestamp DATETIME
      )
    `);
  } catch (error) {
    console.error(`Error initializing database schema for ${dbPath}:`, error);
    db.close();
    throw error;
  }

  // Composite index for `chat_id` and message `id` columns (most used)
  try {
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id_id ON chat_messages(
        chat_id, id
      )
    `);
  } catch (error) {
    console.error(`Error creating database index for ${dbPath}:`, error);
    db.close();
    throw error;
  }

  const addDbToCacheRelease = await userDbCache.mutex.acquire();
  try {
    // Best effort LRU cache eviction
    if (userDbCache.cache.size >= config.dbConnectionCacheSize) {
      // Find the least recently used entry with refCount 0
      let keyToEvict: string | undefined;
      for (const [k, v] of userDbCache.cache.entries()) {
        if (v.refCount === 0) {
          keyToEvict = k;
          break;
        }
      }

      if (keyToEvict) {
        const entryToEvict = userDbCache.cache.get(keyToEvict) as DbCacheEntry;
        console.info(
          `Cache full. Evicting database connection for user ${keyToEvict}.`,
        );
        entryToEvict.db.close();
        userDbCache.cache.delete(keyToEvict);
      }
    }

    // Add to cache
    userDbCache.cache.set(userId, {
      filePath: dbPath,
      db: db,
      lastAccessed: Date.now(),
      refCount: 1, // initial ref count
    });
  } finally {
    addDbToCacheRelease();
  }

  return db;
};

/**
 * Decrements the reference count for a user's database connection.
 * This allows the connection to be cleaned up by the cache eviction process
 * when the reference count reaches 0.
 *
 * @param {string} userId - The Discord user ID whose database connection to
 * release
 * @param {dbCache} userDbCache - The database connection cache
 * @returns {Promise<void>}
 */
export const releaseUserDb = async (userId: string, userDbCache: dbCache) => {
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
