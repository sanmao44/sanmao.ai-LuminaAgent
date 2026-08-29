import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [component, layout, page, lifecycle, health, windowsLauncher, macLauncher, linuxLauncher] = await Promise.all([
  readFile(new URL("../components/LocalLifecycle.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/local-lifecycle.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../scripts/start.ps1", import.meta.url), "utf8"),
  readFile(new URL("../scripts/start-macos.sh", import.meta.url), "utf8"),
  readFile(new URL("../start-linux.sh", import.meta.url), "utf8"),
]);

test("local lifecycle is mounted once for both the app and canvas routes", () => {
  assert.match(layout, /import LocalLifecycle from ['"]@\/components\/LocalLifecycle['"]/);
  assert.match(layout, /<LocalLifecycle \/>/);
  assert.doesNotMatch(page, /['"]\/api\/lifecycle['"]/);
  assert.match(component, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
  assert.match(component, /window\.addEventListener\("online", handleOnline\)/);
});

test("lifecycle client keeps refresh safe and retries transient connection failures", () => {
  assert.match(component, /fetch\("\/api\/lifecycle", \{ cache: "no-store" \}\)/);
  assert.match(component, /window\.setInterval\(\(\) => void heartbeat\(\), HEARTBEAT_INTERVAL_MS\)/);
  assert.match(component, /const RETRY_DELAYS_MS = \[1_000, 2_000, 5_000, 10_000\]/);
  assert.match(component, /scheduleStart\(\)/);
  assert.doesNotMatch(component, /sendBeacon/);
  assert.doesNotMatch(component, /addEventListener\("pagehide"/);
});

test("server lifecycle keeps multiple sessions and applies startup grace", () => {
  assert.match(lifecycle, /const sessions = new Map<string, number>\(\)/);
  assert.match(lifecycle, /if \(sessions\.size === 0\) scheduleShutdown\(\)/);
  assert.match(lifecycle, /const delay = elapsed < STARTUP_GRACE_MS/);
  assert.match(lifecycle, /\}, delay\);/);
  assert.match(lifecycle, /const HEARTBEAT_TIMEOUT_MS = 10_000/);
  assert.match(lifecycle, /const SHUTDOWN_GRACE_MS = 3_000/);
});

test("health and official launchers expose the intended lifecycle modes", () => {
  assert.match(health, /lifecycleEnabled: process\.env\.SANMAO_LIFECYCLE === '1'/);
  assert.match(windowsLauncher, /if \(\$Lan\.IsPresent\) \{[\s\S]*Remove-Item Env:SANMAO_LIFECYCLE/);
  assert.match(windowsLauncher, /else \{[\s\S]*\$env:SANMAO_LIFECYCLE = '1'/);
  assert.match(macLauncher, /export SANMAO_LIFECYCLE=1/);
  assert.match(linuxLauncher, /export SANMAO_LIFECYCLE=1/);
});
