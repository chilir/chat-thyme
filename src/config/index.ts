//src/config/index.ts

import { parseConfig } from "./parse";

export { defaultAppConfig } from "./schema";
export const config = parseConfig();
