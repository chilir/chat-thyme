// src/db/cache.ts

import { Mutex } from "async-mutex";
import type { ChatThymeConfig } from "../config/schema";
import type { DbCacheEntry, dbCache } from "../interfaces";

export const initUserDbCache = () => {
  const cache = new Map<string, DbCacheEntry>();
  const mutex = new Mutex();
  let checkIntervalId: ReturnType<typeof setInterval> | undefined;

  return { cache, mutex, checkIntervalId };
};

// background task
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
