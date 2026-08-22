import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.14";
import {
  CONTROL_PLANE_ENDPOINT,
  MARKER_SCHEMA,
  PRODUCT_VERSION,
  SERVER_VERSION,
  SidecarFailure,
} from "./contracts.ts";
import {
  compareAndDeleteMarker,
  parseLaunchMarker,
  serializeLaunchMarker,
  writeLaunchMarker,
} from "./marker.ts";

const MARKER = {
  schema: MARKER_SCHEMA,
  productVersion: PRODUCT_VERSION,
  serverVersion: SERVER_VERSION,
  launchId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  pid: 4242,
  endpoint: CONTROL_PLANE_ENDPOINT,
  configDigest: `sha256:${"ab".repeat(32)}`,
  startedAt: "2026-08-22T06:00:00.000Z",
} as const;

Deno.test("parseLaunchMarker accepts the exact versioned marker", () => {
  assertEquals(parseLaunchMarker(serializeLaunchMarker(MARKER)), MARKER);
});

Deno.test("parseLaunchMarker fails closed on unknown, missing, or corrupt fields", () => {
  const extra = { ...MARKER, path: "/tmp" };
  assertThrows(() => parseLaunchMarker(JSON.stringify(extra)), SidecarFailure);
  const { pid: _, ...missing } = MARKER;
  assertThrows(() => parseLaunchMarker(JSON.stringify(missing)), SidecarFailure);
  assertThrows(() => parseLaunchMarker("{"), SidecarFailure);
  assertThrows(
    () =>
      parseLaunchMarker(
        JSON.stringify({ ...MARKER, endpoint: "http://localhost:3020/mcp" }),
      ),
    SidecarFailure,
  );
});

Deno.test("compareAndDeleteMarker deletes only the matching launch id", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-marker-" });
  const path = `${directory}/owner.json`;
  await Deno.writeTextFile(path, serializeLaunchMarker(MARKER));
  await assertRejects(
    () => compareAndDeleteMarker(path, "ffffffff-ffff-4fff-8fff-ffffffffffff"),
    SidecarFailure,
    "different launch id",
  );
  assertEquals(await Deno.readTextFile(path), serializeLaunchMarker(MARKER));
  await compareAndDeleteMarker(path, MARKER.launchId);
  await assertRejects(() => Deno.stat(path), Deno.errors.NotFound);
});

Deno.test("writeLaunchMarker publishes complete bytes and never overwrites a stale marker", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-marker-atomic-" });
  const path = `${directory}/owner.json`;
  await writeLaunchMarker(path, MARKER);
  assertEquals(await Deno.readTextFile(path), serializeLaunchMarker(MARKER));
  assertEquals(
    [...Deno.readDirSync(directory)].some((entry) => entry.name.endsWith(".tmp")),
    false,
  );
  await assertRejects(
    () => writeLaunchMarker(path, { ...MARKER, pid: 999 }),
    SidecarFailure,
    "already exists",
  );
  assertEquals(await Deno.readTextFile(path), serializeLaunchMarker(MARKER));
});
