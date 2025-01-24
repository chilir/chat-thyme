// src/config/required.ts

import dotenv from "dotenv";
dotenv.config();

const { DISCORD_TOKEN } = process.env;

if (!DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN is not set in environmental variables.");
}

export const requiredConfig = {
  DISCORD_TOKEN: DISCORD_TOKEN,
};
