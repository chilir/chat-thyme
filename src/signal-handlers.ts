// src/signalhandlers.ts

import { clearUserDbCache } from "./db";
import type { DbCache } from "./interfaces";

export const setupSignalHandlers = (userDbCache: DbCache) => {
  process.on("SIGINT", async () => {
    console.info("SIGINT received. Cleaning up user DB cache...");
    try {
      await clearUserDbCache(userDbCache);
      console.info("Cleanup complete. Exiting...");
      process.exit(0);
    } catch (cleanupError) {
      console.error("Error during DB cache cleanup:", cleanupError);
      console.info(
        "Exiting without full cleanup (DB cache connections may remain open).",
      );
      process.exit(1);
    }
  });
  process.on("SIGTERM", async () => {
    console.info("SIGTERM received. Cleaning up user DB cache...");
    try {
      await clearUserDbCache(userDbCache);
      console.info("Cleanup complete. Exiting...");
      process.exit(0);
    } catch (cleanupError) {
      console.error("Error during DB cache cleanup:", cleanupError);
      console.info(
        "Exiting without full cleanup (DB cache connections may remain open).",
      );
      process.exit(1);
    }
  });
  process.on("SIGQUIT", async () => {
    console.info("SIGQUIT received. Cleaning up user DB cache...");
    try {
      await clearUserDbCache(userDbCache);
      console.info("Cleanup complete. Exiting...");
      process.exit(0);
    } catch (cleanupError) {
      console.error("Error during DB cache cleanup:", cleanupError);
      console.info(
        "Exiting without full cleanup (DB cache connections may remain open).",
      );
      process.exit(1);
    }
  });
  process.on("uncaughtException", async (err) => {
    console.error("Uncaught Exception:", err);
    console.info("Cleaning up user DB cache...");
    try {
      await clearUserDbCache(userDbCache);
      console.info("Cleanup complete. Exiting...");
      process.exit(1);
    } catch (cleanupError) {
      console.error("Error during DB cache cleanup:", cleanupError);
      console.info(
        "Exiting without full cleanup (DB cache connections may remain open).",
      );
      process.exit(1);
    }
  });
  process.on("unhandledRejection", async (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
    console.info("Cleaning up user DB cache...");
    try {
      await clearUserDbCache(userDbCache);
      console.info("Cleanup complete. Exiting...");
      process.exit(1);
    } catch (cleanupError) {
      console.error("Error during DB cache cleanup:", cleanupError);
      console.info(
        "Exiting without full cleanup (DB cache connections may remain open).",
      );
      process.exit(1);
    }
  });
};
