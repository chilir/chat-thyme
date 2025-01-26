// src/db/cache.ts

import { Mutex } from "async-mutex";
import type { ChatThymeConfig } from "../config/schema";
import type { DbCacheEntry, dbCache } from "../interfaces";

/**
 * Initializes a new database cache for user connections.
 * Creates a new Map to store database connections, a mutex for thread safety,
 * and a placeholder for the cache maintenance interval.
 *
 * @returns {dbCache} A new database cache object containing the cache Map,
 * mutex, and interval ID
 */
export const initUserDbCache = () => {
  const cache = new Map<string, DbCacheEntry>();
  const mutex = new Mutex();
  let checkIntervalId: ReturnType<typeof setInterval> | undefined;

  return { cache, mutex, checkIntervalId };
};

/**
 * Starts a background task that periodically checks and evicts expired database
 * connections.
 * A database connection is considered expired if it hasn't been accessed for
 * longer than the TTL and has no active references.
 *
 * @param {ChatThymeConfig} config - The application configuration containing
 * cache settings
 * @param {dbCache} userDbCache - The database cache to maintain
 */
export const backgroundEvictExpiredDbs = (
  config: ChatThymeConfig,
  userDbCache: dbCache,
) => {
  if (!userDbCache.checkIntervalId) {
    userDbCache.checkIntervalId = setInterval(async () => {
      const release = await userDbCache.mutex.acquire();
      try {
        const now = Date.now();
        userDbCache.cache.forEach((entry, userId) => {
          if (
            now - entry.lastAccessed > config.dbConnectionCacheTtl &&
            entry.refCount === 0
          ) {
            console.info(
              `TTL expired and no active references for user ${userId}. Closing \
      database.`,
            );
            entry.db.close();
            userDbCache.cache.delete(userId);
          }
        });
      } finally {
        release();
      }
    }, config.dbConnectionCacheCheckInterval);
  }
};

/**
 * Closes all database connections and clears the cache.
 * This function also stops the background cache maintenance task.
 * Should be called during application shutdown.
 * 
 * @param {dbCache} userDbCache - The database cache to clear
 * @returns {Promise<void>}
 */
export const clearUserDbCache = async (userDbCache: dbCache) => {
  const release = await userDbCache.mutex.acquire();
  try {
    console.info(
      "Clearing all database connections and stopping cache maintenance.",
    );
    for (const entry of userDbCache.cache.values()) {
      entry.db.close();
    }
    userDbCache.cache.clear();
    if (userDbCache.checkIntervalId) {
      clearInterval(userDbCache.checkIntervalId);
      userDbCache.checkIntervalId = undefined;
    }
  } finally {
    release();
  }
};
