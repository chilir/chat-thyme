// src/db/cache.ts

import { Mutex } from "async-mutex";
import type { DbCacheEntry, dbCache } from "../interfaces";

/**
 * Creates and returns a new cache object for user database connections.
 * The cache includes:
 * - A Map to store active database connections
 * - A Mutex for concurrency control
 * - An evictionInterval reference for background cleanup
 *
 * @returns {dbCache} The newly created cache object
 */
export const initUserDbCache = (): dbCache => {
  const cache = new Map<string, DbCacheEntry>();
  const mutex = new Mutex();
  let evictionInterval: ReturnType<typeof setInterval> | undefined;

  return {
    cache: cache,
    mutex: mutex,
    evictionInterval: evictionInterval,
  };
};

/**
 * Launches a scheduled background task to remove stale database connections
 * from the cache. A connection is considered stale if it hasn't been accessed
 * for longer than the configured TTL and has no active references.
 *
 * @param {dbCache} userDbCache - The cache to maintain
 * @param {number} dbConnectionCacheTtl - Milliseconds after which
 *   inactive connections are evicted
 * @param {number} dbConnectionCacheEvictionInterval - Interval in
 *   milliseconds to run the eviction process
 */
export const backgroundEvictExpiredDbs = (
  userDbCache: dbCache,
  dbConnectionCacheTtl: number,
  dbConnectionCacheEvictionInterval: number,
) => {
  if (!userDbCache.evictionInterval) {
    userDbCache.evictionInterval = setInterval(async () => {
      const release = await userDbCache.mutex.acquire();
      try {
        const now = Date.now();
        userDbCache.cache.forEach((entry, userId) => {
          if (
            now - entry.lastAccessed > dbConnectionCacheTtl &&
            entry.refCount === 0
          ) {
            console.info(
              `TTL expired and no active references for user ${userId}. \
Closing database.`,
            );
            entry.db.close();
            userDbCache.cache.delete(userId);
          }
        });
      } finally {
        release();
      }
    }, dbConnectionCacheEvictionInterval);
  }
};

/**
 * Closes and removes all database connections from the cache.
 * Also stops the background cleanup process if it is currently active.
 *
 * @param {dbCache} userDbCache - The cache structure to clear
 * @returns {Promise<void>}
 */
export const clearUserDbCache = async (userDbCache: dbCache): Promise<void> => {
  const release = await userDbCache.mutex.acquire();
  try {
    console.info(
      "Clearing all database connections and stopping cache maintenance.",
    );
    for (const entry of userDbCache.cache.values()) {
      entry.db.close();
    }
    userDbCache.cache.clear();
    if (userDbCache.evictionInterval) {
      clearInterval(userDbCache.evictionInterval);
      userDbCache.evictionInterval = undefined;
    }
  } finally {
    release();
  }
};
