import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [component, layout, page, lifecycle, health, windowsLauncher, macLauncher, linuxLauncher, lanLauncher, freeRelayPs, freeRelayWatchPs, freeRelaySh, readme, videoStudio] = await Promise.all([
  readFile(new URL("../components/LocalLifecycle.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../lib/local-lifecycle.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../scripts/start.ps1", import.meta.url), "utf8"),
  readFile(new URL("../scripts/start-macos.sh", import.meta.url), "utf8"),
  readFile(new URL("../start-linux.sh", import.meta.url), "utf8"),
  readFile(new URL("../scripts/lan-launcher.ps1", import.meta.url), "utf8"),
  readFile(new URL("../scripts/free-relay-common.ps1", import.meta.url), "utf8"),
  readFile(new URL("../scripts/free-relay-watch.ps1", import.meta.url), "utf8"),
  readFile(new URL("../scripts/free-relay-common.sh", import.meta.url), "utf8"),
  readFile(new URL("../README.md", import.meta.url), "utf8"),
  readFile(new URL("../components/VideoStudio.tsx", import.meta.url), "utf8"),
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

test("server lifecycle expires stale records without terminating the local service", () => {
  assert.match(lifecycle, /const sessions = new Map<string, number>\(\)/);
  assert.match(lifecycle, /const HEARTBEAT_TIMEOUT_MS = 60_000/);
  assert.match(lifecycle, /function stopCleanupTimer\(\)/);
  assert.doesNotMatch(lifecycle, /process\.exit\(0\)/);
  assert.doesNotMatch(lifecycle, /scheduleShutdown/);
});

test("health and official launchers expose the intended lifecycle modes", () => {
  assert.match(health, /lifecycleEnabled: process\.env\.SANMAO_LIFECYCLE === '1'/);
  assert.match(windowsLauncher, /if \(\$Lan\.IsPresent\) \{[\s\S]*Remove-Item Env:SANMAO_LIFECYCLE/);
  assert.match(windowsLauncher, /else \{[\s\S]*\$env:SANMAO_LIFECYCLE = '1'/);
  assert.match(macLauncher, /export SANMAO_LIFECYCLE=1/);
  assert.match(linuxLauncher, /export SANMAO_LIFECYCLE=1/);
});

test("every existing launcher prepares the optional public media relay", () => {
  assert.equal(freeRelayPs.charCodeAt(0), 0xfeff, "Windows PowerShell relay helper must keep a UTF-8 BOM");
  assert.match(windowsLauncher, /FreeRelay/);
  assert.match(lanLauncher, /FreeRelay/);
  assert.match(macLauncher, /free-relay-common\.sh/);
  assert.match(linuxLauncher, /free-relay-common\.sh/);
  assert.match(freeRelayPs, /cloudflared/);
  assert.match(freeRelayPs, /trycloudflare/);
  assert.match(freeRelayWatchPs, /Test-SanmaoFreeRelayReachable/);
  assert.match(freeRelayWatchPs, /Start-SanmaoFreeRelayTunnel/);
  assert.match(freeRelaySh, /trycloudflare/);
  assert.match(freeRelaySh, /free_relay_probe/);
  assert.match(freeRelaySh, /free_relay_watch/);

  assert.match(videoStudio, /window\.setInterval\(\(\) => void refreshMediaStatus\(\), 15_000\)/);
});

test("launchers enable free relay only for configured providers that need public media", () => {
  assert.match(windowsLauncher, /function Test-SanmaoMediaRelayRequired/);
  assert.match(windowsLauncher, /SANMAO_DATA_DIR/);
  assert.match(windowsLauncher, /if \(\$FreeRelay\.IsPresent -and \$script:MediaRelayRequired\)/);
  assert.match(windowsLauncher, /elseif \(-not \$script:MediaRelayRequired\)/);
  assert.match(windowsLauncher, /openai-videos/);
  assert.match(windowsLauncher, /video-generate/);
  assert.match(windowsLauncher, /Stop-SanmaoFreeRelayTunnel -Root \$root/);
  assert.match(windowsLauncher, /free-relay-watch\.ps1/);
  assert.match(windowsLauncher, /-OriginPort/);

  assert.match(macLauncher, /media_relay_required\(\)/);
  assert.match(macLauncher, /SANMAO_DATA_DIR/);
  assert.match(macLauncher, /if \[ "\$MEDIA_RELAY_REQUIRED" -eq 1 \]; then/);
  assert.match(macLauncher, /openai-videos/);
  assert.match(macLauncher, /free_relay_stop "\$ROOT_DIR"/);
  assert.match(linuxLauncher, /MEDIA_RELAY_REQUIRED=0/);
  assert.match(linuxLauncher, /SANMAO_DATA_DIR/);
  assert.match(linuxLauncher, /if \[ "\$MEDIA_RELAY_REQUIRED" -eq 1 \]; then/);
  assert.match(linuxLauncher, /openai-videos/);
  assert.match(linuxLauncher, /free_relay_stop "\$ROOT_DIR"/);

  assert.match(readme, /只有检测到已保存且有访问密钥、且视频传输需要公网媒体地址的服务商/);
  assert.match(readme, /没有此类配置时不会下载或启动中转/);
});
