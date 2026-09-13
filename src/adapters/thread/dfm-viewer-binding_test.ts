import { assert, assertEquals, assertRejects } from "@std/assert";
import type { ThreadEntityRef } from "../../domain/thread/thread-snapshot.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  fingerprintDfmCheckCapture,
  validateDfmCheckCapture,
} from "../make/dfm/dfm-check-capture.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/project/engineering-project-validation.ts";
import {
  buildDfmViewerBinding,
  DFM_VIEWER_APP_ID,
  DFM_VIEWER_AUTHORITY_AMBIGUOUS_REASON,
  DFM_VIEWER_AUTHORITY_DIVERGENT_REASON,
  DFM_VIEWER_AUTHORITY_MISSING_REASON,
  DFM_VIEWER_RESOURCE_URI,
  DFM_VIEWER_SESSION_KIND,
  DFM_VIEWER_SESSION_SCHEMA,
} from "./dfm-viewer-binding.ts";
import {
  archiveArtifact,
  createDfmViewerFixture,
  DFM_VIEWER_PARENT_DIGEST,
  DFM_VIEWER_RUN_ID,
  DFM_VIEWER_STAGED_PATH,
  DFM_VIEWER_STEP_SHA256,
  DFM_VIEWER_WORK_ID,
  dfmRunApproval,
  dfmRunDecision,
  dfmViewerPackages,
  staleArtifact,
} from "./dfm-viewer-test-fixture.ts";

Deno.test("DFM viewer binding preserves recorded measurements, verdicts and limitations", async () => {
  const fixture = await createDfmViewerFixture();
  try {
    const binding = await buildDfmViewerBinding(fixture);
    assertEquals(binding?.session.schema, DFM_VIEWER_SESSION_SCHEMA);
    assertEquals(binding?.app.id, DFM_VIEWER_APP_ID);
    assertEquals(binding?.resource.uri, DFM_VIEWER_RESOURCE_URI);
    assertEquals(binding?.readResources, []);
    assertEquals(binding?.anchor, { kind: "artifact", id: fixture.artifactId });
    assertEquals(
      (binding?.basis.thread as { revision: number }).revision,
      fixture.thread.revision,
    );
    assert(
      fixture.resultThread.revision < fixture.thread.revision,
      "display basis is a later Thread head than the completed run result",
    );
    const payload = binding!.session.payload as {
      kind: string;
      basis: { sessionFingerprint: string };
      provenance: {
        operation: string;
        runId: string;
        caseDigest: string;
        inputArtifact: { uri: string };
      };
      projection: {
        status: string;
        result: {
          geometry: { sha256: string; byteCount: number };
          envelope: {
            measured: { xMm: number; yMm: number; zMm: number };
            declaredVolumeMm: { x: number };
            violations: unknown[];
          };
          thickness: {
            measured: { minThicknessMm: number; sampleCount: number };
            thresholdMm: number;
          };
          overhang: { violations: unknown[]; thresholdDeg: number };
          zMinFilter: {
            applied: boolean;
            declared: { planeZMm: { value: number } };
            filtered: unknown[];
            remaining: unknown[];
          };
          evaluations: {
            owner: string;
            status: string;
            verdicts: readonly {
              check: string;
              status: string;
              violations: readonly { name: string }[];
            }[];
          };
          limitations: readonly string[];
        };
      };
    };
    assertEquals(payload.kind, DFM_VIEWER_SESSION_KIND);
    assertEquals(payload.provenance.operation, "industrialize.run-dfm-checks@1");
    assertEquals(payload.provenance.runId, DFM_VIEWER_RUN_ID);
    assertEquals(payload.provenance.caseDigest, fixture.capture.caseDigest);
    assertEquals(
      payload.provenance.inputArtifact.uri,
      `/api/thread/assets/${DFM_VIEWER_STEP_SHA256}.step`,
    );
    assertEquals(payload.projection.status, "available");
    const result = payload.projection.result;
    assertEquals(result.geometry.sha256, DFM_VIEWER_STEP_SHA256);
    assertEquals(result.geometry.byteCount, 86130);
    assertEquals(result.envelope.measured.xMm, 190);
    assertEquals(result.envelope.measured.yMm, 135);
    assertEquals(result.envelope.measured.zMm, 18);
    assertEquals(result.envelope.declaredVolumeMm.x, 250);
    assertEquals(result.envelope.violations, []);
    assertEquals(result.thickness.measured.sampleCount, 500);
    assertEquals(result.thickness.thresholdMm, 2);
    assertEquals(result.overhang.thresholdDeg, 45);
    assertEquals(result.zMinFilter.applied, true);
    assertEquals(result.zMinFilter.declared.planeZMm.value, -3);
    assertEquals(result.zMinFilter.filtered.length, 1);
    assertEquals(result.zMinFilter.remaining.length, 5);
    assertEquals(result.evaluations.owner, "digital-thread");
    assertEquals(result.evaluations.status, "fail");
    assertEquals(
      result.evaluations.verdicts.find((item) => item.check === "envelope")
        ?.status,
      "pass",
    );
    assertEquals(
      result.evaluations.verdicts.find((item) => item.check === "min-thickness")
        ?.status,
      "pass",
    );
    assertEquals(
      result.evaluations.verdicts.find((item) => item.check === "overhangs")
        ?.violations[0]?.name,
      "overhang-zone-0-requires-support",
    );
    assertEquals(result.limitations, fixture.capture.limitations);
    assert(/^sha256:[a-f0-9]{64}$/.test(payload.basis.sessionFingerprint));
    const serialized = JSON.stringify(payload);
    assertEquals(serialized.includes("stagedPath"), false);
    assertEquals(serialized.includes(DFM_VIEWER_STAGED_PATH), false);
    assertEquals(serialized.includes("volume_status"), false);
    assertEquals(serialized.includes("mass_status"), false);
    assertEquals(serialized.includes("minimum_thickness_status"), false);
    assertEquals(serialized.includes("ray_coverage"), false);
    assertEquals(serialized.includes("mesh_topology"), false);
    const expected = await sha256Fingerprint({
      schemaVersion: DFM_VIEWER_SESSION_SCHEMA,
      kind: payload.kind,
      basis: {
        projectId: binding!.basis.projectId,
        projectRevision: binding!.basis.projectRevision,
        subjectId: binding!.basis.subjectId,
        thread: binding!.basis.thread,
      },
      anchor: (binding!.session.payload as { anchor: unknown }).anchor,
      provenance: payload.provenance,
      projection: payload.projection,
    });
    assertEquals(payload.basis.sessionFingerprint, `sha256:${expected.digest}`);
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("DFM viewer binding is unavailable without an installed compatible package", async () => {
  const fixture = await createDfmViewerFixture();
  try {
    assertEquals(
      await buildDfmViewerBinding({ ...fixture, packages: [] }),
      undefined,
    );
    const incompatible = dfmViewerPackages();
    incompatible[0] = {
      ...incompatible[0]!,
      resources: [{
        ...incompatible[0]!.resources[0]!,
        sessionSchemas: ["io.casys.mcp-dfm.other-session/1.0"],
      }],
    };
    assertEquals(
      await buildDfmViewerBinding({ ...fixture, packages: incompatible }),
      undefined,
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("DFM viewer binding refuses an ambiguous installed package", async () => {
  const fixture = await createDfmViewerFixture();
  try {
    const packages = [...dfmViewerPackages(), ...dfmViewerPackages()];
    await assertRejects(
      () => buildDfmViewerBinding({ ...fixture, packages }),
      TypeError,
      "ambiguous",
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("DFM viewer binding returns undefined for a non-DFM unsupported anchor", async () => {
  const fixture = await createDfmViewerFixture();
  try {
    const binding = await buildDfmViewerBinding({
      ...fixture,
      artifactId: `geometry-${DFM_VIEWER_PARENT_DIGEST}`,
    });
    assertEquals(binding, undefined);
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("DFM viewer binding refuses a trustedRunId, producer or completed-run mismatch", async () => {
  for (
    const mutate of [
      (fixture: Awaited<ReturnType<typeof createDfmViewerFixture>>) => {
        const artifact = fixture.thread.artifacts.find((item) =>
          item.id === fixture.artifactId
        )!;
        const producer = { ...artifact.producer, runId: "run.other" };
        fixture.thread = {
          ...fixture.thread,
          artifacts: fixture.thread.artifacts.map((item) =>
            item.id === artifact.id ? { ...item, producer } : item
          ),
          consumptions: fixture.thread.consumptions.map((item) =>
            item.consumer.runId === artifact.producer.runId
              ? { ...item, consumer: producer }
              : item
          ),
        };
      },
      (fixture: Awaited<ReturnType<typeof createDfmViewerFixture>>) => {
        fixture.project = {
          ...fixture.project,
          agentRuns: fixture.project.agentRuns.map((run) =>
            run.id === DFM_VIEWER_RUN_ID ? { ...run, id: "run.other" } : run
          ),
        };
      },
      async (fixture: Awaited<ReturnType<typeof createDfmViewerFixture>>) => {
        const capture = validateDfmCheckCapture({
          ...fixture.capture,
          trustedRunId: "run.other",
        });
        const text = deterministicJson(capture);
        const fingerprint = await fingerprintDfmCheckCapture(capture);
        const nextId = `dfm-check-${fingerprint.digest}`;
        fixture.checks.read = (named) =>
          Promise.resolve(named.digest === fingerprint.digest ? text : undefined);
        fixture.thread = remapCheckArtifact(fixture, nextId, fingerprint);
        fixture.artifactId = nextId;
        fixture.project = {
          ...fixture.project,
          agentRuns: fixture.project.agentRuns.map((run) =>
            run.id === DFM_VIEWER_RUN_ID
              ? {
                ...run,
                evidenceRefs: run.evidenceRefs.map((item) =>
                  item.id.startsWith("dfm-check-") ? { ...item, id: nextId } : item
                ),
              }
              : run
          ),
        };
      },
    ]
  ) {
    const fixture = await createDfmViewerFixture();
    try {
      await mutate(fixture);
      await assertRejects(() => buildDfmViewerBinding(fixture), Error);
    } finally {
      await Deno.remove(fixture.root, { recursive: true });
    }
  }
});

Deno.test("DFM viewer binding refuses tampered capture bytes or a claimed digest that does not recompute", async () => {
  const fixture = await createDfmViewerFixture();
  try {
    fixture.checks.read = () => Promise.resolve(`${fixture.captureText} `);
    await assertRejects(
      () => buildDfmViewerBinding(fixture),
      TypeError,
      "bytes do not match",
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("DFM viewer binding refuses a missing check or case capture", async () => {
  const missingCheck = await createDfmViewerFixture();
  try {
    missingCheck.checks.read = () => Promise.resolve(undefined);
    await assertRejects(
      () => buildDfmViewerBinding(missingCheck),
      TypeError,
      "check capture is unavailable",
    );
  } finally {
    await Deno.remove(missingCheck.root, { recursive: true });
  }
  const missingCase = await createDfmViewerFixture();
  try {
    missingCase.cases.read = () => Promise.resolve(undefined);
    await assertRejects(
      () => buildDfmViewerBinding(missingCase),
      TypeError,
      "case capture is unavailable",
    );
  } finally {
    await Deno.remove(missingCase.root, { recursive: true });
  }
});

Deno.test("DFM viewer binding refuses a case digest, limits or STEP identity mismatch", async () => {
  const digest = await createDfmViewerFixture();
  try {
    digest.cases.read = () => {
      const value = JSON.parse(digest.caseText) as {
        caseDigest: string;
      };
      value.caseDigest = "c".repeat(64);
      return Promise.resolve(JSON.stringify(value));
    };
    await assertRejects(() => buildDfmViewerBinding(digest), TypeError);
  } finally {
    await Deno.remove(digest.root, { recursive: true });
  }

  const limits = await createDfmViewerFixture();
  try {
    limits.cases.read = () => {
      const value = JSON.parse(limits.caseText) as {
        dfmCase: { minThicknessMm: { value: number } };
        canonicalCaseText: string;
      };
      value.dfmCase.minThicknessMm.value = 9;
      return Promise.resolve(JSON.stringify(value));
    };
    await assertRejects(() => buildDfmViewerBinding(limits), TypeError);
  } finally {
    await Deno.remove(limits.root, { recursive: true });
  }

  const step = await createDfmViewerFixture();
  try {
    step.thread = {
      ...step.thread,
      artifacts: step.thread.artifacts.map((item) =>
        item.id.includes("cad-asset-") ? { ...item, mediaType: "model/stl" } : item
      ),
    };
    await assertRejects(() => buildDfmViewerBinding(step), TypeError);
  } finally {
    await Deno.remove(step.root, { recursive: true });
  }
});

Deno.test("DFM viewer binding refuses archived or stale case, STEP or parent artifacts", async () => {
  for (
    const artifactId of [
      `cad-asset-${DFM_VIEWER_PARENT_DIGEST}-target-0-${DFM_VIEWER_STEP_SHA256}`,
      `geometry-${DFM_VIEWER_PARENT_DIGEST}`,
    ]
  ) {
    const archived = await createDfmViewerFixture();
    try {
      archived.thread = archiveArtifact(archived.thread, artifactId);
      await assertRejects(() => buildDfmViewerBinding(archived), Error);
    } finally {
      await Deno.remove(archived.root, { recursive: true });
    }
    const stale = await createDfmViewerFixture();
    try {
      stale.thread = staleArtifact(stale.thread, artifactId);
      await assertRejects(() => buildDfmViewerBinding(stale), Error);
    } finally {
      await Deno.remove(stale.root, { recursive: true });
    }
  }
  const archivedCase = await createDfmViewerFixture();
  try {
    const caseId = archivedCase.thread.artifacts.find((item) =>
      item.id.startsWith("dfm-case-")
    )!.id;
    archivedCase.thread = archiveArtifact(archivedCase.thread, caseId);
    await assertRejects(() => buildDfmViewerBinding(archivedCase), Error);
  } finally {
    await Deno.remove(archivedCase.root, { recursive: true });
  }
});

function remapRef(ref: ThreadEntityRef, previousId: string, nextId: string) {
  if (ref.id === previousId || ref.id.includes(previousId)) {
    return { ...ref, id: ref.id.replace(previousId, nextId) };
  }
  return ref;
}

function remapCheckArtifact(
  fixture: Awaited<ReturnType<typeof createDfmViewerFixture>>,
  nextId: string,
  fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
) {
  const previousId = fixture.artifactId;
  return {
    ...fixture.thread,
    artifacts: fixture.thread.artifacts.map((item) =>
      item.id === previousId
        ? {
          ...item,
          id: nextId,
          version: fingerprint.digest,
          fingerprint,
          uri: `casys://dfm-check-capture/sha256/${fingerprint.digest}`,
        }
        : item
    ),
    provenance: fixture.thread.provenance.map((link) => ({
      ...link,
      from: remapRef(link.from, previousId, nextId),
      to: remapRef(link.to, previousId, nextId),
    })),
    consumptions: fixture.thread.consumptions.map((item) => ({
      ...item,
      id: item.id.replace(previousId, nextId),
    })),
    changeSet: {
      ...fixture.thread.changeSet,
      changes: fixture.thread.changeSet.changes.map((change) =>
        change.target.kind === "artifact" && change.target.id === previousId
          ? {
            ...change,
            target: { ...change.target, id: nextId },
            afterFingerprint: fingerprint,
          }
          : change
      ),
    },
  };
}

Deno.test("DFM viewer binding refuses a stale DFM check evidence artifact", async () => {
  const fixture = await createDfmViewerFixture();
  try {
    fixture.thread = staleArtifact(fixture.thread, fixture.artifactId);
    await assertRejects(
      () => buildDfmViewerBinding(fixture),
      TypeError,
      "not fresh",
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("DFM viewer binding keeps a readable ID01-style divergent approval as unavailable", async () => {
  const fixture = await createDfmViewerFixture();
  try {
    const laterRunBasis = {
      snapshotId: fixture.resultThread.id,
      revision: fixture.resultThread.revision,
      subjectId: fixture.project.project.subjectId,
    };
    const signed = fixture.project.decisions[0]?.baseSnapshot;
    fixture.project = validateEngineeringProjectSnapshot({
      ...fixture.project,
      agentRuns: fixture.project.agentRuns.map((item) =>
        item.id === DFM_VIEWER_RUN_ID
          ? { ...item, basis: { kind: "thread-snapshot", ...laterRunBasis } }
          : item
      ),
    });
    assertEquals(signed?.snapshotId !== laterRunBasis.snapshotId, true);
    assertEquals(
      (signed?.revision ?? 0) < laterRunBasis.revision,
      true,
    );
    const binding = await buildDfmViewerBinding(fixture);
    const projection = binding!.session.payload.projection as {
      status: string;
      reason?: string;
      result?: unknown;
    };
    assertEquals(binding?.session.schema, DFM_VIEWER_SESSION_SCHEMA);
    assertEquals(binding?.anchor.id, fixture.artifactId);
    assertEquals(projection.status, "unavailable");
    assertEquals(projection.reason, DFM_VIEWER_AUTHORITY_DIVERGENT_REASON);
    assertEquals("result" in projection, false);
    assertEquals(projection.result, undefined);
    assertEquals(
      (binding?.session.payload.provenance as { runId: string }).runId,
      DFM_VIEWER_RUN_ID,
    );
    assertEquals(
      JSON.stringify(binding?.session.payload).includes("stagedPath"),
      false,
    );
  } finally {
    await Deno.remove(fixture.root, { recursive: true });
  }
});

Deno.test("DFM viewer binding keeps missing or ambiguous human approval as unavailable", async () => {
  for (
    const mutate of [
      (fixture: Awaited<ReturnType<typeof createDfmViewerFixture>>) => {
        fixture.project = validateEngineeringProjectSnapshot({
          ...fixture.project,
          phases: fixture.project.phases.map((phase) => ({
            ...phase,
            requiredDecisionIds: [],
          })),
          workItems: fixture.project.workItems.map((item) =>
            item.id === DFM_VIEWER_WORK_ID ? { ...item, decisionIds: [] } : item
          ),
          decisions: [],
          approvals: [],
        });
      },
      (fixture: Awaited<ReturnType<typeof createDfmViewerFixture>>) => {
        const run = fixture.project.agentRuns[0]!;
        const basis = run.basis?.kind === "thread-snapshot"
          ? {
            snapshotId: run.basis.snapshotId,
            revision: run.basis.revision,
            subjectId: run.basis.subjectId,
          }
          : fixture.project.threadSnapshots[0]!;
        const second = {
          decisionId: "decision.dfm-checks-2",
          approvalId: "approval.dfm-checks-2",
        };
        fixture.project = validateEngineeringProjectSnapshot({
          ...fixture.project,
          phases: fixture.project.phases.map((phase) => ({
            ...phase,
            requiredDecisionIds: [
              ...phase.requiredDecisionIds,
              second.decisionId,
            ],
          })),
          workItems: fixture.project.workItems.map((item) =>
            item.id === DFM_VIEWER_WORK_ID
              ? {
                ...item,
                decisionIds: [...item.decisionIds, second.decisionId],
              }
              : item
          ),
          decisions: [
            ...fixture.project.decisions,
            dfmRunDecision(basis, fixture.capture.caseDigest, second),
          ],
          approvals: [
            ...fixture.project.approvals,
            dfmRunApproval(basis, fixture.capture.caseDigest, second),
          ],
        });
      },
    ]
  ) {
    const fixture = await createDfmViewerFixture();
    try {
      mutate(fixture);
      const binding = await buildDfmViewerBinding(fixture);
      const projection = binding!.session.payload.projection as {
        status: string;
        reason?: string;
        result?: unknown;
      };
      assertEquals(projection.status, "unavailable");
      assertEquals("result" in projection, false);
      assert(
        projection.reason === DFM_VIEWER_AUTHORITY_MISSING_REASON ||
          projection.reason === DFM_VIEWER_AUTHORITY_AMBIGUOUS_REASON,
      );
    } finally {
      await Deno.remove(fixture.root, { recursive: true });
    }
  }
});
