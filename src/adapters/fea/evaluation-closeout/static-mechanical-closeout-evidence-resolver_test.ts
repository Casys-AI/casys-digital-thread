import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import {
  createCompletedStaticMechanicalCloseoutFixture,
} from "../../../testing/static-mechanical-closeout-fixture.ts";
import {
  resolveStaticMechanicalCloseoutEvidence,
  staticMechanicalCloseoutAdmission,
  StaticMechanicalCloseoutResolutionError,
} from "./static-mechanical-closeout-evidence-resolver.ts";

Deno.test(
  "static-mechanical closeout resolver accepts only canonical model/step and exact fresh FEA @3 evidence",
  async () => {
    const fixture = await createCompletedStaticMechanicalCloseoutFixture();
    try {
      const resolved = await resolveStaticMechanicalCloseoutEvidence(
        fixture.dependencies,
        {
          project: fixture.project,
          basis: fixture.basis,
          snapshot: fixture.snapshot,
        },
      );
      assertEquals(resolved.acceptanceEligible, true);
      assertEquals(
        resolved.criteria.every((criterion) => criterion.status === "pass"),
        true,
      );
      assertEquals(resolved.proofLimitations.proofScope, fixture.fea.proofCase.scope);
      assertEquals(
        resolved.proofLimitations.evidenceBoundary,
        fixture.fea.proofCase.evidenceBoundary,
      );
      assertEquals(
        resolved.proofLimitations.cadEngineeringBoundary,
        fixture.fea.proofCase.cadSource.engineeringBoundary,
      );
      assertEquals(fixture.counts.artifactReads > 0, true);
      assertEquals(fixture.counts.canonicalStepReads > 0, true);
      assertEquals(fixture.counts.executionEvidenceReads > 0, true);
      assertEquals(fixture.counts.evaluationCaptureReads > 0, true);
      assertEquals("solver" in fixture.dependencies, false);
      assertEquals("syson" in fixture.dependencies, false);

      const wrongStep = structuredClone(fixture.snapshot) as ThreadSnapshot;
      const step = wrongStep.artifacts.find((artifact) =>
        artifact.kind === "step"
      )! as {
        mediaType?: string;
      };
      step.mediaType = "application/step";
      await assertRejects(
        () =>
          resolveStaticMechanicalCloseoutEvidence(fixture.dependencies, {
            project: fixture.project,
            basis: fixture.basis,
            snapshot: wrongStep,
          }),
        StaticMechanicalCloseoutResolutionError,
        "canonical STEP",
      );

      const stale = structuredClone(fixture.snapshot) as ThreadSnapshot;
      const evaluation = stale.evaluations[0] as unknown as {
        freshness: {
          status: string;
          changedAt: string;
          invalidatedByChangeIds: string[];
        };
      };
      evaluation.freshness = {
        status: "stale",
        changedAt: evaluation.freshness.changedAt,
        invalidatedByChangeIds: ["later-change"],
      };
      await assertRejects(
        () =>
          resolveStaticMechanicalCloseoutEvidence(fixture.dependencies, {
            project: fixture.project,
            basis: fixture.basis,
            snapshot: stale,
          }),
        StaticMechanicalCloseoutResolutionError,
        "does not exactly bind",
      );

      const incomplete = structuredClone(fixture.snapshot) as ThreadSnapshot;
      (incomplete as unknown as { evaluations: unknown[] }).evaluations = [];
      await assertRejects(
        () =>
          resolveStaticMechanicalCloseoutEvidence(fixture.dependencies, {
            project: fixture.project,
            basis: fixture.basis,
            snapshot: incomplete,
          }),
        StaticMechanicalCloseoutResolutionError,
        "absent",
      );

      const ambiguous = structuredClone(fixture.snapshot) as ThreadSnapshot;
      const mutableAmbiguous = ambiguous as unknown as { evaluations: unknown[] };
      mutableAmbiguous.evaluations.push(
        structuredClone(mutableAmbiguous.evaluations[0]),
      );
      await assertRejects(
        () =>
          resolveStaticMechanicalCloseoutEvidence(fixture.dependencies, {
            project: fixture.project,
            basis: fixture.basis,
            snapshot: ambiguous,
          }),
        StaticMechanicalCloseoutResolutionError,
        "ambiguous",
      );
    } finally {
      await fixture.dispose();
    }
  },
);

Deno.test(
  "static-mechanical closeout resolver rejects CAS and run-basis divergence; accept never follows a non-pass L4 result",
  async () => {
    const passed = await createCompletedStaticMechanicalCloseoutFixture();
    try {
      const tamperedCas = {
        ...passed.dependencies,
        artifacts: {
          readArtifact: (artifact: typeof passed.snapshot.artifacts[number]) =>
            Promise.resolve({
              uri: artifact.uri!,
              mediaType: artifact.mediaType!,
              byteCount: 3,
              sha256: artifact.fingerprint.digest,
              bytes: new TextEncoder().encode("bad"),
            }),
        },
      };
      await assertRejects(
        () =>
          resolveStaticMechanicalCloseoutEvidence(tamperedCas, {
            project: passed.project,
            basis: passed.basis,
            snapshot: passed.snapshot,
          }),
        StaticMechanicalCloseoutResolutionError,
        "CAS bytes",
      );
      const divergentProject = structuredClone(
        passed.project,
      ) as EngineeringProjectSnapshot;
      const run = (divergentProject as unknown as {
        agentRuns: Array<{ id: string; basis?: Record<string, unknown> }>;
      }).agentRuns.find((candidate) => candidate.id === passed.fea.runId)!;
      run.basis = { ...run.basis, snapshotId: "latest" };
      await assertRejects(
        () =>
          resolveStaticMechanicalCloseoutEvidence(passed.dependencies, {
            project: divergentProject,
            basis: passed.basis,
            snapshot: passed.snapshot,
          }),
        StaticMechanicalCloseoutResolutionError,
        "exact Thread basis",
      );
    } finally {
      await passed.dispose();
    }

    const failed = await createCompletedStaticMechanicalCloseoutFixture({
      status: "fail",
    });
    try {
      const resolved = await resolveStaticMechanicalCloseoutEvidence(
        failed.dependencies,
        {
          project: failed.project,
          basis: failed.basis,
          snapshot: failed.snapshot,
        },
      );
      assertEquals(resolved.acceptanceEligible, false);
      assertThrows(
        () => staticMechanicalCloseoutAdmission(resolved, "accept"),
        StaticMechanicalCloseoutResolutionError,
        "non-pass",
      );
      const reject = staticMechanicalCloseoutAdmission(resolved, "reject");
      assertEquals(reject.rejectionDisposition, "mechanical-review-required");
      assertEquals(reject.consequence, "reject");
    } finally {
      await failed.dispose();
    }
  },
);
