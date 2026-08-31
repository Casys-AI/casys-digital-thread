import { assertEquals, assertRejects } from "@std/assert";
import {
  CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
  createFirstPartyCapabilityRuntimeQualificationCandidates,
} from "./first-party-capability-runtime-qualification-candidates.ts";
import {
  validateCapabilityRuntimeQualificationCandidate,
} from "../../domain/capability/runtime/capability-runtime-qualification-candidate.ts";

Deno.test("the first-party Chrono qualification candidate is exact and code-owned", async () => {
  const candidates = await createFirstPartyCapabilityRuntimeQualificationCandidates();
  assertEquals(candidates.length, 1);
  const [candidate] = candidates;
  if (!candidate) throw new Error("candidate absent");
  assertEquals(candidate.id, CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID);
  assertEquals(candidate.binding, { id: "chrono-prescribed-kinematics", version: "1" });
  assertEquals(candidate.contract, {
    id: "chrono-prescribed-kinematics-adapter",
    version: "0.3.2",
    source: "src/adapters/mechanics/chrono/chrono-prescribed-kinematics-client.ts",
  });
  assertEquals(candidate.unit.id, "casys.mcp-chrono");
  assertEquals(candidate.unit.version, "0.3.2");
  assertEquals(
    candidate.material.imageDigest,
    "2e9b7d5b27e344499fe233ff4e0a1fcdbbe77c8f83bd78ee0cdbc26eb7a74557",
  );
  assertEquals(candidate.launchGroup.id, "casys-chrono");
  assertEquals(candidate.launchGroup.version, "1.0.0");
  assertEquals(candidate.observedHostPlatform, "linux/arm64");
  assertEquals(candidate.targetPlatform, "linux/amd64");
  assertEquals(candidate.mode, "emulated");
  assertEquals(candidate.fixture.source.bodies.length, 2);
  assertEquals(candidate.fixture.source.joints.length, 1);
  assertEquals(Object.isFrozen(candidate), true);
});

Deno.test("a candidate rejects altered identity, provider surface, platform claim, and non-hinge fixture", async () => {
  const [candidate] = await createFirstPartyCapabilityRuntimeQualificationCandidates();
  if (!candidate) throw new Error("candidate absent");
  for (
    const value of [
      { ...candidate, fingerprint: { algorithm: "sha256", digest: "0".repeat(64) } },
      { ...candidate, endpoint: "http://127.0.0.1:3025/mcp" },
      { ...candidate, mode: "native" },
      {
        ...candidate,
        fixture: {
          ...candidate.fixture,
          source: { ...candidate.fixture.source, joints: [] },
        },
      },
    ]
  ) {
    await assertRejects(
      () => validateCapabilityRuntimeQualificationCandidate(value),
      TypeError,
    );
  }
});
