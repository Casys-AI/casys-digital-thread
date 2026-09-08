import { assertEquals, assertRejects } from "@std/assert";
import {
  CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_CANDIDATE_ID,
  canonicalCalculixHttpRuntimeQualificationCandidateText,
  createFirstPartyCalculixHttpRuntimeQualificationCandidates,
  validateCalculixHttpRuntimeQualificationCandidate,
} from "./first-party-calculix-http-runtime-qualification-candidates.ts";
import {
  createFirstPartyCapabilityRuntimeQualificationCandidates,
} from "./first-party-capability-runtime-qualification-candidates.ts";

Deno.test("the first-party CalculiX HTTP qualification candidate is exact, native, and code-owned", async () => {
  const [candidate] =
    await createFirstPartyCalculixHttpRuntimeQualificationCandidates();
  if (!candidate) throw new Error("candidate absent");
  assertEquals(candidate.id, CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_CANDIDATE_ID);
  assertEquals(candidate.version, "1");
  assertEquals(candidate.binding, {
    id: "calculix-http-static-sensitivity",
    version: "1.0.0",
  });
  assertEquals(candidate.selector, {
    capability: { id: "mechanics.observe-static-structural-sensitivity", version: "1" },
    use: "execution",
  });
  assertEquals(candidate.contract, {
    id: "calculix-http-static-sensitivity-adapter",
    version: "1.0.0",
    source: "src/adapters/sensitivity/live-fea/mcp-calculix-sensitivity-solver.ts",
  });
  assertEquals(candidate.profile, null);
  assertEquals(candidate.unit.id, "casys.mcp-calculix");
  assertEquals(candidate.unit.version, "0.8.2");
  assertEquals(
    candidate.material.imageDigest,
    "ea933089d0941dd7c45d7e00a825be64c412edbb334a05dc568745ce885abfc8",
  );
  assertEquals(candidate.launchGroup.id, "casys-mcp-calculix");
  assertEquals(candidate.launchGroup.version, "1.0.0");
  assertEquals(candidate.observedHostPlatform, "linux/arm64");
  assertEquals(candidate.targetPlatform, "linux/arm64");
  assertEquals(candidate.mode, "native");
  assertEquals(candidate.fixture.step.sha256.length, 64);
  assertEquals(Object.isFrozen(candidate), true);
  assertEquals(
    await canonicalCalculixHttpRuntimeQualificationCandidateText(candidate),
    JSON.stringify(
      JSON.parse(
        await canonicalCalculixHttpRuntimeQualificationCandidateText(candidate),
      ),
    ),
  );
});

Deno.test("the CalculiX candidate rejects drift while the Chrono fixture remains on its existing schema", async () => {
  const [candidate] =
    await createFirstPartyCalculixHttpRuntimeQualificationCandidates();
  if (!candidate) throw new Error("candidate absent");
  await assertRejects(
    () =>
      validateCalculixHttpRuntimeQualificationCandidate({
        ...candidate,
        mode: "emulated",
      }),
    TypeError,
    "not canonical",
  );
  const [chrono] = await createFirstPartyCapabilityRuntimeQualificationCandidates();
  if (!chrono) throw new Error("Chrono candidate absent");
  assertEquals(chrono.schemaVersion, "capability-runtime-qualification-candidate/1.0");
  assertEquals(
    chrono.fixture.source.schemaVersion,
    "prescribed-kinematics-case-source/1.0",
  );
  assertEquals(chrono.fixture.source.bodies.length, 2);
  assertEquals(chrono.fixture.source.joints.length, 1);
});
