import { assertEquals, assertRejects } from "@std/assert";
import {
  CLOSEOUT_REVIEW_L4_RUN_ID,
  CLOSEOUT_REVIEW_L4_WORK_ID,
  createAdmittedModelicaCloseoutEvidenceFixture,
} from "../../../testing/admitted-modelica-evaluation-closeout-fixture.ts";
import {
  encodeAdmittedObservationEvaluationCloseoutAdmission,
} from "../../../domain/modelica/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { requirementEvaluationIdentity } from "../../../domain/thread/requirement-evaluation-identity.ts";
import {
  admittedModelicaEvaluationCloseoutAdmission,
  AdmittedModelicaEvaluationCloseoutResolutionError,
  resolveAdmittedModelicaEvaluationCloseoutEvidence,
} from "./admitted-observation-evaluation-closeout-evidence-resolver.ts";

Deno.test(
  "closeout resolver recrosses the unique current L4 and names both consequences from the same identities",
  async () => {
    const fixture = await createAdmittedModelicaCloseoutEvidenceFixture();
    const resolved = await resolveAdmittedModelicaEvaluationCloseoutEvidence(
      fixture.dependencies,
      {
        project: fixture.project,
        basis: fixture.basis,
        snapshot: fixture.snapshot,
      },
    );
    assertEquals(resolved.captureArtifact.id, fixture.l4Artifact?.id);
    assertEquals(resolved.sheet.id, fixture.sheet.id);
    assertEquals(
      resolved.evaluations[0]?.id,
      requirementEvaluationIdentity({
        requirementId: fixture.snapshot.evaluations[0]!.requirementId,
        evidenceFingerprint: fixture.l4Artifact!.fingerprint,
      }).id,
    );
    assertEquals(resolved.evaluations[0]?.status, "unresolved");
    assertEquals(resolved.evaluations[0]?.message.includes("unresolved"), true);
    assertEquals(
      resolved.evaluations[0]?.output.modelSymbolId,
      fixture.sheet.outputs[0]?.modelSymbolId,
    );
    assertEquals(
      resolved.evaluations[0]?.output.limitation,
      fixture.sheet.outputs[0]?.limitation,
    );
    assertEquals(resolved.limitations.l4PassIsNotL5, true);
    assertEquals(resolved.limitations.engineCalls, "none");
    assertEquals(resolved.limitations.sheetScope, fixture.sheet.scope);
    assertEquals(resolved.limitations.sheetLimitations, fixture.sheet.limitations);
    const accept = admittedModelicaEvaluationCloseoutAdmission(resolved, "accept");
    const reject = admittedModelicaEvaluationCloseoutAdmission(resolved, "reject");
    assertEquals(accept.consequence, "accept");
    assertEquals(reject.consequence, "reject");
    assertEquals(accept.projectId, reject.projectId);
    assertEquals(accept.subjectId, reject.subjectId);
    assertEquals(accept.basis, reject.basis);
    assertEquals(accept.sheet, reject.sheet);
    assertEquals(accept.capture, reject.capture);
    assertEquals(
      deterministicJson(
        encodeAdmittedObservationEvaluationCloseoutAdmission(accept),
      ) ===
        deterministicJson(
          encodeAdmittedObservationEvaluationCloseoutAdmission(reject),
        ),
      false,
    );
    assertEquals("syson" in fixture.dependencies, false);
    assertEquals("omc" in fixture.dependencies, false);
  },
);

Deno.test(
  "closeout resolver recrosses the capture-addressed L4 evaluation and refuses an unversioned id",
  async () => {
    const fixture = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
    });
    const resolved = await resolveAdmittedModelicaEvaluationCloseoutEvidence(
      fixture.dependencies,
      {
        project: fixture.project,
        basis: fixture.basis,
        snapshot: fixture.snapshot,
      },
    );
    const requirementId = fixture.snapshot.evaluations[0]!.requirementId;
    const expectedId = requirementEvaluationIdentity({
      requirementId,
      evidenceFingerprint: fixture.l4Artifact!.fingerprint,
    }).id;
    assertEquals(resolved.evaluations[0]?.id, expectedId);
    assertEquals(resolved.evaluations[0]?.id.includes(requirementId), true);
    assertEquals(
      resolved.evaluations[0]?.id.endsWith(
        fixture.l4Artifact!.fingerprint.digest,
      ),
      true,
    );
    assertEquals(
      resolved.evaluations[0]?.id === `${requirementId}-evaluation`,
      false,
    );

    const unversioned = structuredClone(fixture.snapshot) as ThreadSnapshot;
    mutableRecord(unversioned.evaluations[0]!).id = `${requirementId}-evaluation`;
    await rejectCloseout(
      fixture,
      unversioned,
      "is not the exact capture outcome topology",
    );

    const foreign = structuredClone(fixture.snapshot) as ThreadSnapshot;
    mutableRecord(foreign.evaluations[0]!).id = requirementEvaluationIdentity({
      requirementId,
      evidenceFingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
    }).id;
    await rejectCloseout(
      fixture,
      foreign,
      "is not the exact capture outcome topology",
    );
  },
);

Deno.test(
  "closeout resolver preserves pass, fail, unresolved and error without inferring a closeout",
  async () => {
    for (const status of ["pass", "fail", "unresolved", "error"] as const) {
      const fixture = await createAdmittedModelicaCloseoutEvidenceFixture({
        evaluationStatus: status,
      });
      const resolved = await resolveAdmittedModelicaEvaluationCloseoutEvidence(
        fixture.dependencies,
        {
          project: fixture.project,
          basis: fixture.basis,
          snapshot: fixture.snapshot,
        },
      );
      assertEquals(resolved.evaluations.map((item) => item.status), [status]);
      const accept = admittedModelicaEvaluationCloseoutAdmission(resolved, "accept");
      const reject = admittedModelicaEvaluationCloseoutAdmission(resolved, "reject");
      assertEquals(accept.consequence, "accept");
      assertEquals(reject.consequence, "reject");
      assertEquals(accept.capture, reject.capture);
      assertEquals(
        resolved.evaluations[0]?.output.declaredUnit,
        fixture.sheet.outputs[0]?.declaredUnit,
      );
      assertEquals(
        resolved.evaluations[0]?.output.role,
        fixture.sheet.outputs[0]?.role,
      );
      if (status === "pass" || status === "fail") {
        assertEquals(
          resolved.evaluations[0]?.comparison?.normalizedUnit,
          "unit-pending-source",
        );
        assertEquals(resolved.evaluations[0]?.observationIds.length, 1);
      } else {
        assertEquals(resolved.evaluations[0]?.comparison, undefined);
      }
    }
  },
);

Deno.test("closeout resolver fails closed on zero or two L4 documents", async () => {
  const missing = await createAdmittedModelicaCloseoutEvidenceFixture({
    includeL4Artifact: false,
  });
  await assertRejects(
    () =>
      resolveAdmittedModelicaEvaluationCloseoutEvidence(missing.dependencies, {
        project: missing.project,
        basis: missing.basis,
        snapshot: missing.snapshot,
      }),
    AdmittedModelicaEvaluationCloseoutResolutionError,
    "unavailable",
  );

  const duplicate = await createAdmittedModelicaCloseoutEvidenceFixture({
    l4Count: 2,
  });
  await assertRejects(
    () =>
      resolveAdmittedModelicaEvaluationCloseoutEvidence(duplicate.dependencies, {
        project: duplicate.project,
        basis: duplicate.basis,
        snapshot: duplicate.snapshot,
      }),
    AdmittedModelicaEvaluationCloseoutResolutionError,
    "ambiguous",
  );
  assertEquals(
    duplicate.snapshot.artifacts.filter((item) =>
      item.id.startsWith("modelica-admitted-observation-evaluation-")
    ).length,
    2,
  );
});

Deno.test("closeout resolver fails closed on stale or archived L4 documents", async () => {
  const stale = await createAdmittedModelicaCloseoutEvidenceFixture({
    stale: true,
  });
  await assertRejects(
    () =>
      resolveAdmittedModelicaEvaluationCloseoutEvidence(stale.dependencies, {
        project: stale.project,
        basis: stale.basis,
        snapshot: stale.snapshot,
      }),
    AdmittedModelicaEvaluationCloseoutResolutionError,
    "stale",
  );

  const archived = await createAdmittedModelicaCloseoutEvidenceFixture({
    archived: true,
  });
  await assertRejects(
    () =>
      resolveAdmittedModelicaEvaluationCloseoutEvidence(archived.dependencies, {
        project: archived.project,
        basis: archived.basis,
        snapshot: archived.snapshot,
      }),
    AdmittedModelicaEvaluationCloseoutResolutionError,
    "stale",
  );
});

Deno.test(
  "closeout resolver fails closed on wrong producer, server, unattached or foreign run",
  async () => {
    const wrongTool = await createAdmittedModelicaCloseoutEvidenceFixture({
      producerTool: "simulate.run-admitted-modelica@1",
    });
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(wrongTool.dependencies, {
          project: wrongTool.project,
          basis: wrongTool.basis,
          snapshot: wrongTool.snapshot,
        }),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "producer",
    );

    const wrongServer = await createAdmittedModelicaCloseoutEvidenceFixture({
      producerServerId: "syson",
    });
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          wrongServer.dependencies,
          {
            project: wrongServer.project,
            basis: wrongServer.basis,
            snapshot: wrongServer.snapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "producer",
    );

    const unattached = await createAdmittedModelicaCloseoutEvidenceFixture({
      attachProducerRun: false,
    });
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          unattached.dependencies,
          {
            project: unattached.project,
            basis: unattached.basis,
            snapshot: unattached.snapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "unattached",
    );

    const foreignRun = await createAdmittedModelicaCloseoutEvidenceFixture({
      producerResultRevision: 99,
    });
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          foreignRun.dependencies,
          {
            project: foreignRun.project,
            basis: foreignRun.basis,
            snapshot: foreignRun.snapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "foreign",
    );
  },
);

Deno.test(
  "closeout resolver fails closed on mismatched capture fingerprint, URI, or non-L4 bytes",
  async () => {
    const wrongUri = await createAdmittedModelicaCloseoutEvidenceFixture({
      captureUri: "casys://foreign-capture/sha256/deadbeef",
    });
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(wrongUri.dependencies, {
          project: wrongUri.project,
          basis: wrongUri.basis,
          snapshot: wrongUri.snapshot,
        }),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "URI",
    );

    const missingUri = await createAdmittedModelicaCloseoutEvidenceFixture({
      captureUri: null,
    });
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          missingUri.dependencies,
          {
            project: missingUri.project,
            basis: missingUri.basis,
            snapshot: missingUri.snapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "URI",
    );

    const malformed = await createAdmittedModelicaCloseoutEvidenceFixture({
      l4Body: { kind: "modelica-qualified-kit", modelicaText: "model Fake" },
    });
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          malformed.dependencies,
          {
            project: malformed.project,
            basis: malformed.basis,
            snapshot: malformed.snapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "not an L4",
    );

    const tampered = await createAdmittedModelicaCloseoutEvidenceFixture();
    const snapshot = structuredClone(tampered.snapshot) as ThreadSnapshot;
    const artifact = snapshot.artifacts.find((item) =>
      item.id === tampered.l4Artifact?.id
    ) as { fingerprint: { digest: string } };
    artifact.fingerprint = { ...artifact.fingerprint, digest: "d".repeat(64) };
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(tampered.dependencies, {
          project: tampered.project,
          basis: tampered.basis,
          snapshot,
        }),
      AdmittedModelicaEvaluationCloseoutResolutionError,
    );
  },
);

Deno.test(
  "closeout resolver fails closed on a missing, foreign, or unsigned thermal method sheet",
  async () => {
    const missingSheet = await createAdmittedModelicaCloseoutEvidenceFixture({
      includeSheet: false,
    });
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          missingSheet.dependencies,
          {
            project: missingSheet.project,
            basis: missingSheet.basis,
            snapshot: missingSheet.snapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "thermal method sheet",
    );

    const foreignSheet = await createAdmittedModelicaCloseoutEvidenceFixture({
      sheetForeignProject: true,
    });
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          foreignSheet.dependencies,
          {
            project: foreignSheet.project,
            basis: foreignSheet.basis,
            snapshot: foreignSheet.snapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "foreign",
    );
  },
);

function mutableRecord(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

Deno.test(
  "closeout resolver fails closed on missing, wrong, extra, or incomplete L4 evidence attachment",
  async () => {
    const missingRunRefs = await createAdmittedModelicaCloseoutEvidenceFixture();
    mutableRecord(
      missingRunRefs.project.agentRuns.find((run) =>
        run.id === CLOSEOUT_REVIEW_L4_RUN_ID
      )!,
    ).evidenceRefs = [];
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          missingRunRefs.dependencies,
          {
            project: missingRunRefs.project,
            basis: missingRunRefs.basis,
            snapshot: missingRunRefs.snapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "missing",
    );

    const wrongRunRefs = await createAdmittedModelicaCloseoutEvidenceFixture();
    mutableRecord(
      wrongRunRefs.project.agentRuns.find((run) =>
        run.id === CLOSEOUT_REVIEW_L4_RUN_ID
      )!.evidenceRefs[0]!,
    ).id = "foreign-artifact";
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          wrongRunRefs.dependencies,
          {
            project: wrongRunRefs.project,
            basis: wrongRunRefs.basis,
            snapshot: wrongRunRefs.snapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "foreign",
    );

    const extraRunRefs = await createAdmittedModelicaCloseoutEvidenceFixture();
    const extraRun = extraRunRefs.project.agentRuns.find((run) =>
      run.id === CLOSEOUT_REVIEW_L4_RUN_ID
    )!;
    mutableRecord(extraRun).evidenceRefs = [
      ...extraRun.evidenceRefs,
      extraRun.evidenceRefs[0]!,
    ];
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          extraRunRefs.dependencies,
          {
            project: extraRunRefs.project,
            basis: extraRunRefs.basis,
            snapshot: extraRunRefs.snapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "ambiguous",
    );

    const missingWorkRefs = await createAdmittedModelicaCloseoutEvidenceFixture();
    mutableRecord(
      missingWorkRefs.project.workItems.find((item) =>
        item.id === CLOSEOUT_REVIEW_L4_WORK_ID
      )!,
    ).evidenceRefs = [];
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          missingWorkRefs.dependencies,
          {
            project: missingWorkRefs.project,
            basis: missingWorkRefs.basis,
            snapshot: missingWorkRefs.snapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "missing",
    );

    const wrongWorkRefs = await createAdmittedModelicaCloseoutEvidenceFixture();
    mutableRecord(
      wrongWorkRefs.project.workItems.find((item) =>
        item.id === CLOSEOUT_REVIEW_L4_WORK_ID
      )!.evidenceRefs[0]!,
    ).id = "foreign-artifact";
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          wrongWorkRefs.dependencies,
          {
            project: wrongWorkRefs.project,
            basis: wrongWorkRefs.basis,
            snapshot: wrongWorkRefs.snapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "foreign",
    );

    const incompleteWork = await createAdmittedModelicaCloseoutEvidenceFixture();
    mutableRecord(
      incompleteWork.project.workItems.find((item) =>
        item.id === CLOSEOUT_REVIEW_L4_WORK_ID
      )!,
    ).status = "in-progress";
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          incompleteWork.dependencies,
          {
            project: incompleteWork.project,
            basis: incompleteWork.basis,
            snapshot: incompleteWork.snapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "not completed",
    );
  },
);

Deno.test(
  "closeout resolver recrosses capture statuses one-to-one and rejects tampered or extra rows",
  async () => {
    const passToFail = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
    });
    const passSnapshot = structuredClone(passToFail.snapshot) as ThreadSnapshot;
    (passSnapshot.evaluations[0] as { status: string }).status = "fail";
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(passToFail.dependencies, {
          project: passToFail.project,
          basis: passToFail.basis,
          snapshot: passSnapshot,
        }),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "does not equal the exact capture outcome",
    );

    const errorToPass = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "error",
    });
    const errorSnapshot = structuredClone(errorToPass.snapshot) as ThreadSnapshot;
    (errorSnapshot.evaluations[0] as { status: string }).status = "pass";
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          errorToPass.dependencies,
          {
            project: errorToPass.project,
            basis: errorToPass.basis,
            snapshot: errorSnapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "does not equal the exact capture outcome",
    );

    const missing = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
    });
    const missingSnapshot = structuredClone(missing.snapshot);
    mutableRecord(missingSnapshot).evaluations = [];
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(missing.dependencies, {
          project: missing.project,
          basis: missing.basis,
          snapshot: missingSnapshot,
        }),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "missing",
    );

    const extra = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
    });
    const extraSnapshot = structuredClone(extra.snapshot);
    mutableRecord(extraSnapshot).evaluations = [
      extraSnapshot.evaluations[0]!,
      {
        ...extraSnapshot.evaluations[0]!,
        id: "extra-requirement-evaluation",
        requirementId: "extra-requirement",
      },
    ];
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(extra.dependencies, {
          project: extra.project,
          basis: extra.basis,
          snapshot: extraSnapshot,
        }),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "extra",
    );

    const duplicate = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
    });
    const duplicateSnapshot = structuredClone(duplicate.snapshot);
    mutableRecord(duplicateSnapshot).evaluations = [
      duplicateSnapshot.evaluations[0]!,
      {
        ...duplicateSnapshot.evaluations[0]!,
        id: "placeholder-requirement-evaluation-copy",
      },
    ];
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(duplicate.dependencies, {
          project: duplicate.project,
          basis: duplicate.basis,
          snapshot: duplicateSnapshot,
        }),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "duplicate",
    );

    const duplicateRows = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
      captureRows: "duplicate",
    });
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          duplicateRows.dependencies,
          {
            project: duplicateRows.project,
            basis: duplicateRows.basis,
            snapshot: duplicateRows.snapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "duplicate constraintId",
    );

    const extraRows = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
      captureRows: "extra",
    });
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(extraRows.dependencies, {
          project: extraRows.project,
          basis: extraRows.basis,
          snapshot: extraRows.snapshot,
        }),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "capture identity extra-requirement",
    );

    const overlap = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
      captureRows: "overlap",
    });
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(overlap.dependencies, {
          project: overlap.project,
          basis: overlap.basis,
          snapshot: overlap.snapshot,
        }),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "overlaps",
    );
  },
);

Deno.test(
  "closeout resolver fails closed on missing, tampered, or ambiguous method-sheet consumption",
  async () => {
    const missing = await createAdmittedModelicaCloseoutEvidenceFixture();
    const missingSnapshot = structuredClone(missing.snapshot);
    const sheetId =
      missing.snapshot.artifacts.find((item) =>
        item.id.startsWith("modelica-thermal-method-sheet-seal-")
      )!.id;
    mutableRecord(missingSnapshot).consumptions = missingSnapshot.consumptions
      .filter((item) => item.artifactId !== sheetId);
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(missing.dependencies, {
          project: missing.project,
          basis: missing.basis,
          snapshot: missingSnapshot,
        }),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "missing its verified consumption",
    );

    const tampered = await createAdmittedModelicaCloseoutEvidenceFixture();
    const tamperedSnapshot = structuredClone(tampered.snapshot) as ThreadSnapshot;
    const consumption = tamperedSnapshot.consumptions.find((item) =>
      item.artifactId.startsWith("modelica-thermal-method-sheet-seal-")
    ) as { observedFingerprint: { digest: string }; verifiedAt: string };
    consumption.observedFingerprint = {
      ...consumption.observedFingerprint,
      digest: "e".repeat(64),
    };
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(tampered.dependencies, {
          project: tampered.project,
          basis: tampered.basis,
          snapshot: tamperedSnapshot,
        }),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "consumer, fingerprint, time, and topology",
    );

    const wrongTime = await createAdmittedModelicaCloseoutEvidenceFixture();
    const timed = structuredClone(wrongTime.snapshot) as ThreadSnapshot;
    const timedConsumption = timed.consumptions.find((item) =>
      item.artifactId.startsWith("modelica-thermal-method-sheet-seal-")
    ) as { verifiedAt: string };
    timedConsumption.verifiedAt = "2020-01-01T00:00:00.000Z";
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(wrongTime.dependencies, {
          project: wrongTime.project,
          basis: wrongTime.basis,
          snapshot: timed,
        }),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "consumer, fingerprint, time, and topology",
    );

    const missingUses = await createAdmittedModelicaCloseoutEvidenceFixture();
    const usesSnapshot = structuredClone(missingUses.snapshot);
    const consumptionId =
      usesSnapshot.consumptions.find((item) =>
        item.artifactId.startsWith("modelica-thermal-method-sheet-seal-")
      )!.id;
    mutableRecord(usesSnapshot).provenance = usesSnapshot.provenance.filter(
      (link) => link.from.id !== consumptionId,
    );
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          missingUses.dependencies,
          {
            project: missingUses.project,
            basis: missingUses.basis,
            snapshot: usesSnapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "uses provenance",
    );

    const ambiguous = await createAdmittedModelicaCloseoutEvidenceFixture();
    const ambiguousSnapshot = structuredClone(ambiguous.snapshot);
    const original = ambiguousSnapshot.consumptions.find((item) =>
      item.artifactId.startsWith("modelica-thermal-method-sheet-seal-")
    )!;
    mutableRecord(ambiguousSnapshot).consumptions = [
      ...ambiguousSnapshot.consumptions,
      { ...original, id: `${original.id}-copy` },
    ];
    await assertRejects(
      () =>
        resolveAdmittedModelicaEvaluationCloseoutEvidence(
          ambiguous.dependencies,
          {
            project: ambiguous.project,
            basis: ambiguous.basis,
            snapshot: ambiguousSnapshot,
          },
        ),
      AdmittedModelicaEvaluationCloseoutResolutionError,
      "ambiguous sealed thermal method-sheet consumption",
    );
  },
);

async function rejectCloseout(
  fixture: Awaited<ReturnType<typeof createAdmittedModelicaCloseoutEvidenceFixture>>,
  snapshot: ThreadSnapshot,
  message: string,
): Promise<void> {
  await assertRejects(
    () =>
      resolveAdmittedModelicaEvaluationCloseoutEvidence(fixture.dependencies, {
        project: fixture.project,
        basis: fixture.basis,
        snapshot,
      }),
    AdmittedModelicaEvaluationCloseoutResolutionError,
    message,
  );
}

function mutableComparison(snapshot: ThreadSnapshot) {
  return mutableRecord(snapshot.evaluations[0]!.comparison!);
}

Deno.test(
  "closeout resolver recrosses Thread comparison to capture evidence without local verdict arithmetic",
  async () => {
    const actual = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
    });
    const actualSnapshot = structuredClone(actual.snapshot) as ThreadSnapshot;
    mutableRecord(actualSnapshot.evaluations[0]!.comparison!.actual).value = 99;
    await rejectCloseout(
      actual,
      actualSnapshot,
      "comparison actual does not equal the capture computedValue",
    );

    const limit = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "fail",
    });
    const limitSnapshot = structuredClone(limit.snapshot) as ThreadSnapshot;
    mutableRecord(limitSnapshot.evaluations[0]!.comparison!.limit).value = 99;
    await rejectCloseout(
      limit,
      limitSnapshot,
      "comparison limit does not equal the capture threshold",
    );

    const margin = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
    });
    const marginSnapshot = structuredClone(margin.snapshot) as ThreadSnapshot;
    mutableRecord(marginSnapshot.evaluations[0]!.comparison!.margin!).value = 99;
    await rejectCloseout(
      margin,
      marginSnapshot,
      "comparison margin does not equal the capture margin",
    );

    const unit = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
    });
    const unitSnapshot = structuredClone(unit.snapshot) as ThreadSnapshot;
    mutableRecord(unitSnapshot.evaluations[0]!.comparison!.actual).unit = "K";
    await rejectCloseout(
      unit,
      unitSnapshot,
      "comparison units do not equal the validated capture unit",
    );

    const normalized = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "fail",
    });
    const normalizedSnapshot = structuredClone(normalized.snapshot) as ThreadSnapshot;
    mutableComparison(normalizedSnapshot).normalizedUnit = "K";
    await rejectCloseout(
      normalized,
      normalizedSnapshot,
      "comparison units do not equal the validated capture unit",
    );

    const operator = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
    });
    const operatorSnapshot = structuredClone(operator.snapshot) as ThreadSnapshot;
    mutableComparison(operatorSnapshot).operator = ">=";
    await rejectCloseout(
      operator,
      operatorSnapshot,
      "comparison operator is not the exact Thread requirement operator",
    );

    const errorComparison = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "error",
    });
    const errorSnapshot = structuredClone(errorComparison.snapshot) as ThreadSnapshot;
    mutableRecord(errorSnapshot.evaluations[0]!).comparison = {
      observationId: "placeholder-output-observation",
      actual: { value: 0, unit: "unit-pending-source" },
      operator: "<=",
      limit: { value: 1, unit: "unit-pending-source" },
      normalizedUnit: "unit-pending-source",
      margin: { value: 1, unit: "unit-pending-source" },
    };
    await rejectCloseout(
      errorComparison,
      errorSnapshot,
      "must not carry a comparison for error",
    );

    const unresolvedComparison = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "unresolved",
    });
    const unresolvedSnapshot = structuredClone(
      unresolvedComparison.snapshot,
    ) as ThreadSnapshot;
    mutableRecord(unresolvedSnapshot.evaluations[0]!).comparison = {
      observationId: "placeholder-output-observation",
      actual: { value: 0, unit: "unit-pending-source" },
      operator: "<=",
      limit: { value: 1, unit: "unit-pending-source" },
      normalizedUnit: "unit-pending-source",
      margin: { value: 1, unit: "unit-pending-source" },
    };
    await rejectCloseout(
      unresolvedComparison,
      unresolvedSnapshot,
      "must not carry a comparison for unresolved",
    );
  },
);

Deno.test(
  "closeout resolver rejects malformed, unit-mismatched, and non-numeric capture rows",
  async () => {
    const missingComputed = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
      captureRows: "missing-computed",
    });
    await rejectCloseout(
      missingComputed,
      missingComputed.snapshot,
      "computedValue must be a finite number",
    );

    const unitMismatch = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
      captureRows: "unit-mismatch",
    });
    await rejectCloseout(
      unitMismatch,
      unitMismatch.snapshot,
      'unit must equal "unit-pending-source"',
    );

    const nonNumeric = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
      captureRows: "non-numeric",
    });
    await rejectCloseout(
      nonNumeric,
      nonNumeric.snapshot,
      "computedValue must be a finite number",
    );
  },
);

Deno.test(
  "closeout resolver joins the sheet output through Thread requirement id or trace.elementId",
  async () => {
    const distinctId = "thread.requirement.distinct";
    const joined = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
      threadRequirementId: distinctId,
    });
    const resolved = await resolveAdmittedModelicaEvaluationCloseoutEvidence(
      joined.dependencies,
      {
        project: joined.project,
        basis: joined.basis,
        snapshot: joined.snapshot,
      },
    );
    assertEquals(joined.snapshot.requirements[0]?.id, distinctId);
    assertEquals(
      joined.snapshot.requirements[0]?.trace.elementId,
      "placeholder-requirement",
    );
    assertEquals(
      joined.sheet.outputs[0]?.requirementElementId,
      "placeholder-requirement",
    );
    assertEquals(joined.snapshot.evaluations[0]?.requirementId, distinctId);
    assertEquals(
      joined.snapshot.evaluations[0]?.id,
      requirementEvaluationIdentity({
        requirementId: distinctId,
        evidenceFingerprint: joined.l4Artifact!.fingerprint,
      }).id,
    );
    const captureResults = (joined.l4Capture as {
      readonly response: {
        readonly structuredContent: {
          readonly results: readonly { readonly constraintId?: string }[];
        };
      };
    }).response.structuredContent.results;
    assertEquals(captureResults[0]?.constraintId, "placeholder-requirement");
    assertEquals(captureResults[0]?.constraintId === distinctId, false);
    assertEquals(resolved.evaluations[0]?.requirementId, distinctId);
    assertEquals(
      resolved.evaluations[0]?.output.modelSymbolId,
      joined.sheet.outputs[0]?.modelSymbolId,
    );
    assertEquals(resolved.evaluations[0]?.comparison?.actual.value, 0);
    assertEquals(resolved.evaluations[0]?.comparison?.limit.value, 1);
    assertEquals(resolved.evaluations[0]?.comparison?.margin?.value, 1);

    const foreign = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
      threadRequirementId: distinctId,
      sheetRequirementElementId: "foreign.requirement",
    });
    await rejectCloseout(
      foreign,
      foreign.snapshot,
      "no output mapped to capture identity placeholder-requirement",
    );

    const ambiguous = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
      threadRequirementId: distinctId,
      extraSheetOutputRequirementElementId: distinctId,
    });
    await rejectCloseout(
      ambiguous,
      ambiguous.snapshot,
      "ambiguous output mapping",
    );

    const shared = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
      threadRequirementId: distinctId,
    });
    const extras = [
      closeoutSharedRequirement(
        "thread-max-displacement",
        "maxDisplacement",
        shared.snapshot.requirements[0]!.trace,
      ),
      closeoutSharedRequirement(
        "thread-max-von-mises",
        "maxVonMises",
        shared.snapshot.requirements[0]!.trace,
      ),
    ];
    const sharedSnapshot = validateThreadSnapshot({
      ...shared.snapshot,
      requirements: [...extras, ...shared.snapshot.requirements],
      provenance: [
        ...shared.snapshot.provenance,
        ...extras.map((requirement) => ({
          id: `trace-${requirement.id}-to-brief`,
          relation: "traces_to" as const,
          from: { kind: "requirement" as const, id: requirement.id },
          to: {
            kind: "artifact" as const,
            id: requirement.trace.sourceArtifactId,
          },
          rationale: "The extra mechanical projection shares the SysML identity.",
        })),
      ],
    });
    const resolvedShared = await resolveAdmittedModelicaEvaluationCloseoutEvidence(
      shared.dependencies,
      {
        project: shared.project,
        basis: shared.basis,
        snapshot: sharedSnapshot,
      },
    );
    assertEquals(resolvedShared.evaluations[0]?.requirementId, distinctId);
  },
);

function closeoutSharedRequirement(
  id: string,
  metric: string,
  trace: ThreadSnapshot["requirements"][number]["trace"],
) {
  return {
    id,
    name: id,
    statement: "Placeholder requirement. Not a thermal verdict.",
    version: "1",
    criterion: {
      metric,
      operator: "<=" as const,
      limit: { value: 1, unit: "unit-pending-source" },
    },
    trace: { ...trace },
    freshness: {
      status: "fresh" as const,
      changedAt: "2026-08-21T12:00:00.000Z",
      invalidatedByChangeIds: [] as const,
    },
  };
}

Deno.test(
  "closeout resolver fails closed on duplicate method-sheet derived_from and evaluation provenance",
  async () => {
    const fixture = await createAdmittedModelicaCloseoutEvidenceFixture({
      evaluationStatus: "pass",
    });
    const sheetId =
      fixture.snapshot.artifacts.find((item) =>
        item.id.startsWith("modelica-thermal-method-sheet-seal-")
      )!.id;
    const evaluationId = fixture.snapshot.evaluations[0]!.id;
    const observationId = fixture.snapshot.evaluations[0]!.observationIds[0]!;
    const expected = {
      derived_from: `derived-from-${sheetId}-by-${fixture.l4Artifact!.id}`,
      evaluates: `evaluates-${evaluationId}`,
      evidences: `evidences-${evaluationId}`,
      uses: `${evaluationId}-uses-${observationId}`,
    } as const;

    for (const [relation, expectedId] of Object.entries(expected)) {
      const snapshot = structuredClone(fixture.snapshot) as ThreadSnapshot;
      const original = snapshot.provenance.find((link) => link.id === expectedId)!;
      mutableRecord(snapshot).provenance = [
        ...snapshot.provenance,
        { ...original, id: `${expectedId}-copy` },
      ];
      await rejectCloseout(
        fixture,
        snapshot,
        `duplicate ${relation} provenance; expected unique ${expectedId}`,
      );
    }
  },
);
