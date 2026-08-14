// Build the desktop app's FRONTEND into dist/: bundle app.ts (ESM) and copy the
// static shell (index.html, styles.css). Tauri loads dist/ as its `frontendDist`
// (see src-tauri/tauri.conf.json). No framework — esbuild + Node stdlib only,
// mirroring @hanzo/pdf's and @hanzo/canva's build. Every model call goes to
// api.hanzo.ai via @hanzo/ai; the app holds no secret — the user pastes their own
// sk- key into the settings pane, stored only in the webview's localStorage.
//
//   node build.js          → production build  (dist/index.html, app.js, styles.css)
//   node build.js --watch  → rebuild on change (Tauri dev serves dist/)
//
// This is the ONLY step that runs on a developer machine. Building the native
// installers (.dmg / .msi / .AppImage) is `tauri build`, which needs the Rust
// toolchain and code-signing — a CI job, never run locally.

import esbuild from "esbuild";
import { rmSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");
const src = join(__dirname, "src");
const dist = join(__dirname, "dist");

async function build() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  // Bundle app.ts → dist/app.js as ESM for the Tauri webview (a modern WebView2 /
  // WKWebView / WebKitGTK). @hanzo/ai and the @tauri-apps/* JS APIs are bundled
  // in — the page is served standalone from dist/, no import map.
  const ctx = await esbuild.context({
    entryPoints: [join(src, "app.ts")],
    outfile: join(dist, "app.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome100", "edge100", "firefox100", "safari15"],
    define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
    sourcemap: true,
    minify: !watch,
    logLevel: "info",
  });
  await ctx.rebuild();

  // Copy the static shell.
  copyFileSync(join(src, "index.html"), join(dist, "index.html"));
  copyFileSync(join(src, "styles.css"), join(dist, "styles.css"));

  console.log("Hanzo desktop frontend built -> dist/");
  console.log("   Tauri loads dist/index.html as its frontendDist.");

  if (watch) {
    await ctx.watch();
    console.log("watching...");
  } else {
    await ctx.dispose();
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
