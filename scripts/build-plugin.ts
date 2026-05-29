// Build script for the plugin variant of the workspace SPA.
// 1. Runs vite build -c vite.plugin.config.ts
// 2. Post-processes dist-plugin/index.html:
//    a. Injects a bootstrap <script> at the top of <head> that translates
//       window.__SSG_PLUGIN_CONFIG__ into window.__WORKSPACE_CONFIG__.
//    b. Strips any leading "/" from <script src> / <link href> paths in case
//       vite emits absolute paths despite base:"./".
// 3. Reports dist-plugin/ contents + SHA-256 of app.js.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const distDir = join(root, "dist-plugin");

// ── 1. Vite build ────────────────────────────────────────────────────────────
console.log("building plugin bundle...");
execSync("vite build --config vite.plugin.config.ts", {
  cwd: root,
  stdio: "inherit",
});

// ── 2. Post-process index.html ───────────────────────────────────────────────
const indexPath = join(distDir, "index.html");
if (!existsSync(indexPath)) {
  console.error("ERROR: dist-plugin/index.html not found after build");
  process.exit(1);
}

let html = readFileSync(indexPath, "utf8");

// 2a. Bootstrap script — translate __SSG_PLUGIN_CONFIG__ → __WORKSPACE_CONFIG__
const bootstrapScript = `<script>
(function(){
  var c = window.__SSG_PLUGIN_CONFIG__;
  if (!c) return;
  window.__WORKSPACE_CONFIG__ = {
    runtime: 'local',
    port: c.port,
    token: c.token,
    root: ''
  };
})();
</script>`;

// Insert at the very top of <head> (before any other tag inside head).
html = html.replace(/<head>/, `<head>\n  ${bootstrapScript}`);

// 2b. Strip leading "/" from <script src="/..."> and <link href="/..."> so
// assets resolve relative to the plugin mount point.
html = html.replace(/(<script\s[^>]*src=")\/([^"]*")/g, "$1$2");
html = html.replace(/(<link\s[^>]*href=")\/([^"]*")/g, "$1$2");

writeFileSync(indexPath, html, "utf8");
console.log("post-processed dist-plugin/index.html");

// ── 3. Report ────────────────────────────────────────────────────────────────
const appJsPath = join(distDir, "app.js");
if (!existsSync(appJsPath)) {
  console.error("ERROR: dist-plugin/app.js not found");
  process.exit(1);
}

const sha256 = createHash("sha256").update(readFileSync(appJsPath)).digest("hex");

console.log("\ndist-plugin/ contents:");
for (const f of readdirSync(distDir)) {
  console.log(`  ${f}`);
}
console.log(`\napp.js sha256: ${sha256}`);
