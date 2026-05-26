// Strips public/index.html after Vite build. The Cloudflare Worker renders
// its own root HTML for / — leaving Vite's default index.html in [assets]
// would shadow that handler.

import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const target = join(import.meta.dir, "..", "public", "index.html");
if (existsSync(target)) {
  unlinkSync(target);
  console.log("stripped", target);
}
