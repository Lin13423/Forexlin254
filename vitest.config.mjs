import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The test tooling lives in test/ so the repository root stays a plain static
// site; the modules under test sit one level up.
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");

const stubs = {
  app: path.join(testDir, "stubs/firebase-app.js"),
  auth: path.join(testDir, "stubs/firebase-auth.js"),
  database: path.join(testDir, "stubs/firebase-database.js")
};

// The browser modules import Firebase straight from the gstatic CDN, which the
// test runner cannot fetch. This plugin rewrites those specifiers to local
// stubs so the modules can be exercised under test.
const stubFirebaseCdn = {
  name: "stub-firebase-cdn",
  enforce: "pre",
  transform(code, id) {
    if (!/\/(auth-guard|settings|ag-firebase)\.js$/.test(id)) return null;
    const stubbed = code.replace(
      /https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-(app|auth|database)\.js/g,
      (_match, module) => stubs[module]
    );
    return stubbed === code ? null : { code: stubbed, map: null };
  }
};

export default defineConfig({
  root: repoRoot,
  plugins: [stubFirebaseCdn],
  server: {
    fs: { allow: [repoRoot] }
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["auth-guard.js", "settings.js", "server.js"]
    }
  }
});
