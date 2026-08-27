import { assertEquals, assertThrows } from "@std/assert";
import { impactFingerprint } from "../../testing/cross-domain-impact-fixtures.ts";
import {
  CROSS_DOMAIN_IMPACT_DECISION_ADMISSION_SCHEMA,
  encodeCrossDomainImpactDecisionAdmission,
  parseCrossDomainImpactDecisionParameters,
} from "./cross-domain-impact-decision-proposal.ts";
import { deterministicJson } from "../kernel/deterministic-json.ts";

Deno.test("cross-domain impact decision MRTR grammar is closed, canonical, and replayable", () => {
  const admission = admissionFixture();
  const parameters = encodeCrossDomainImpactDecisionAdmission(admission);
  const parsed = parseCrossDomainImpactDecisionParameters(parameters);
  assertEquals(deterministicJson(parsed), deterministicJson(admission));
  assertEquals(
    deterministicJson(encodeCrossDomainImpactDecisionAdmission(parsed)),
    deterministicJson(parameters),
  );
  assertThrows(() =>
    parseCrossDomainImpactDecisionParameters([
      ...parameters,
      { key: "provider", label: "Provider", value: "ngspice" },
    ])
  );
  assertThrows(() =>
    parseCrossDomainImpactDecisionParameters([
      parameters[1]!,
      parameters[0]!,
      ...parameters.slice(2),
    ])
  );
});

Deno.test("cross-domain impact decision grammar refuses caller-selected reruns and new work items", () => {
  const admission = admissionFixture();
  assertThrows(() =>
    encodeCrossDomainImpactDecisionAdmission({
      ...admission,
      limits: { ...admission.limits, reruns: "thermal" },
    })
  );
  assertThrows(() =>
    encodeCrossDomainImpactDecisionAdmission({
      ...admission,
      limits: { ...admission.limits, newWorkItems: "queued" },
    })
  );
});

function admissionFixture() {
  const captureDigest = "c".repeat(64);
  return {
    schemaVersion: CROSS_DOMAIN_IMPACT_DECISION_ADMISSION_SCHEMA,
    consequence: "accept" as const,
    projectId: "project-led-1",
    subjectId: "subject-led-1",
    basis: {
      snapshotId: "thread-led-r9",
      revision: 9,
      fingerprint: impactFingerprint("1"),
    },
    brief: {
      id: "brief-impact",
      revision: 2,
      fingerprint: impactFingerprint("2"),
    },
    evaluation: {
      capture: {
        id: `cross-domain-impact-evaluation-${captureDigest}`,
        fingerprint: { algorithm: "sha256" as const, digest: captureDigest },
      },
      trustedRunId: "run-impact-evaluation",
    },
    manifestSeal: {
      id: "manifest-seal-document",
      fingerprint: impactFingerprint("9"),
    },
    workItemClaims: [
      {
        workItemId: "work-electrical",
        gateItemId: "gate-electrical",
        role: "satisfies" as const,
        previousStatus: "current" as const,
        status: "invalidated" as const,
      },
      {
        workItemId: "work-mechanical",
        gateItemId: "gate-mechanical",
        role: "satisfies" as const,
        previousStatus: "current" as const,
        status: "carried-forward" as const,
      },
      {
        workItemId: "work-thermal",
        gateItemId: "gate-thermal",
        role: "contributes-to" as const,
        previousStatus: "current" as const,
        status: "invalidated" as const,
      },
    ],
    limits: {
      providerCalls: "none" as const,
      solverCalls: "none" as const,
      reruns: "none" as const,
      newWorkItems: "none" as const,
    },
  };
}
