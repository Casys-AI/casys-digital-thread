import { assertEquals, assertRejects } from "@std/assert";
import {
  CHRONO_MCP_BEARER_TOKEN_SLOT,
  LocalChronoRuntimeSecretResolver,
} from "./local-chrono-runtime-secret-resolver.ts";
import {
  capabilityRuntimeLaunchGroupReference,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  createFirstPartyCapabilityRuntimeLaunchGroups,
} from "./first-party-capability-runtime-launch-groups.ts";

Deno.test("Chrono secret resolver retains one opaque bearer generation for the server process", async () => {
  let token = "first-test-bearer";
  const resolver = new LocalChronoRuntimeSecretResolver({ readToken: () => token });
  const group = (await createFirstPartyCapabilityRuntimeLaunchGroups()).find((
    candidate,
  ) => candidate.id === "casys-chrono");
  if (!group) throw new Error("Expected exact Chrono group.");
  const request = {
    group: capabilityRuntimeLaunchGroupReference(group),
    slots: [CHRONO_MCP_BEARER_TOKEN_SLOT],
  } as const;

  const first = await resolver.beginSnapshot(request);
  token = "rotated-test-bearer";
  const second = await resolver.beginSnapshot(request);
  const [firstOverlay, secondOverlay] = await Promise.all([
    resolver.composeOverlay({ group, snapshot: first }),
    resolver.composeOverlay({ group, snapshot: second }),
  ]);
  const decodedFirst = new TextDecoder().decode(firstOverlay);
  const decodedSecond = new TextDecoder().decode(secondOverlay);

  assertEquals(decodedFirst.includes("first-test-bearer"), true);
  assertEquals(decodedSecond.includes("first-test-bearer"), true);
  assertEquals(decodedFirst.includes("rotated-test-bearer"), false);
  assertEquals(decodedSecond.includes("rotated-test-bearer"), false);
  assertEquals(group.compose.content.includes("first-test-bearer"), false);
});

Deno.test("Chrono secret resolver refuses a same-name launch-group substitution", async () => {
  const resolver = new LocalChronoRuntimeSecretResolver({
    readToken: () => "test-bearer",
  });
  const group = (await createFirstPartyCapabilityRuntimeLaunchGroups()).find((
    candidate,
  ) => candidate.id === "casys-chrono");
  if (!group) throw new Error("Expected exact Chrono group.");
  const reference = capabilityRuntimeLaunchGroupReference(group);

  await assertRejects(
    () =>
      resolver.beginSnapshot({
        group: {
          ...reference,
          fingerprint: { ...reference.fingerprint, digest: "f".repeat(64) },
        },
        slots: [CHRONO_MCP_BEARER_TOKEN_SLOT],
      }),
    TypeError,
    "exact Chrono launch group",
  );
});
