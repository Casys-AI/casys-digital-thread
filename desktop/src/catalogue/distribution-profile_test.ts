import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import type { DesktopPlatform } from "../host/mod.ts";
import { startCatalogueService } from "./startup.ts";

/**
 * Runs exclusively under `catalogue:profile-test`, whose flags mirror the
 * `desktop` distribution profile 1:1 (full read/write, allowlisted run/net,
 * listed env). It proves catalogue startup, probe, and preparation work
 * under distribution confinement, against a redirected HOME and the real
 * Docker engine + Build123d provider.
 */
function platformFor(os: typeof Deno.build.os): DesktopPlatform {
  if (os === "windows") return "Windows";
  if (os === "linux") return "Linux";
  return "macOS";
}

Deno.test("distribution profile grants cover catalogue startup, probe, prepare", async () => {
  // Fidelity lock: this process must actually run confined like the profile.
  assertEquals((await Deno.permissions.query({ name: "read" })).state, "granted");
  assertEquals((await Deno.permissions.query({ name: "write" })).state, "granted");
  for (
    const command of [
      "docker",
      "/opt/homebrew/bin/docker",
      "/usr/local/bin/docker",
      "/usr/bin/docker",
    ]
  ) {
    assertEquals(
      (await Deno.permissions.query({ name: "run", command })).state,
      "granted",
      `run grant missing: ${command}`,
    );
  }
  for (const host of ["127.0.0.1:3020", "127.0.0.1:5176", "127.0.0.1:3014"]) {
    assertEquals(
      (await Deno.permissions.query({ name: "net", host })).state,
      "granted",
      `net grant missing: ${host}`,
    );
  }

  const home = await Deno.makeTempDir({ prefix: "casys-profile-home-" });
  // The Docker CLI misbehaves without its config dir (compose probe fails),
  // so link the real one in: Casys state stays isolated, the engine does not.
  try {
    await Deno.symlink(`${Deno.env.get("HOME")}/.docker`, `${home}/.docker`);
  } catch {
    // No docker config on this machine; prepare will say so honestly.
  }
  const saved: Record<string, string | undefined> = {};
  for (const name of ["HOME", "XDG_DATA_HOME", "APPDATA", "LOCALAPPDATA"]) {
    saved[name] = Deno.env.get(name);
    Deno.env.set(name, home);
  }
  try {
    const service = await startCatalogueService({
      platform: platformFor(Deno.build.os),
      env: (name) => Deno.env.get(name),
    });
    assert(service !== undefined, "catalogue startup failed under the profile");
    const snapshot = await service.snapshot();
    assert(
      snapshot.entries.some((entry) => entry.id === "build123d"),
      "build123d entry missing under the profile",
    );
    const probed = await service.probe("build123d");
    assertEquals(probed.capable, true, `probe not capable: ${probed.detail}`);
    const prepared = await service.prepare("build123d");
    assertEquals(
      prepared.outcome,
      "prepared",
      `prepare failed: ${prepared.detail} / ${prepared.recovery ?? ""}`,
    );
    await service.setDefaults(["build123d"]);
    assertEquals(await service.getDefaults(), ["build123d"]);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
    await Deno.remove(home, { recursive: true });
  }
});
