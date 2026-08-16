import { assertEquals, assertRejects } from "@std/assert";
import {
  PrepareProjectCorrectedAdmissionReview,
  ProjectCorrectedAdmissionReviewError,
} from "./prepare-project-corrected-admission-review.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";

const AT = "2026-08-15T00:00:00.000Z";
const SUBJECT_ID = "project:desk-lamp-dl05";

Deno.test("corrected admission review fails closed when the Thread basis is absent", async () => {
  const review = new PrepareProjectCorrectedAdmissionReview({
    snapshots: emptySnapshots(),
    captures: { read: () => Promise.resolve(undefined) },
    admissions: { read: () => Promise.resolve(undefined) },
    preview: { execute: () => Promise.reject(new Error("not called")) },
  });
  await assertRejects(
    () =>
      review.execute({
        projectId: "desk-lamp-dl05",
        basis: {
          kind: "thread-snapshot",
          snapshotId: "missing",
          revision: 16,
          subjectId: SUBJECT_ID,
        },
        correctedSourceArtifactId: "corrected-source-absent",
      }),
    ProjectCorrectedAdmissionReviewError,
    "exact Thread basis",
  );
});

Deno.test("corrected admission review is unresolved when the artifact is absent", async () => {
  const snapshot = minimalSnapshot();
  const review = new PrepareProjectCorrectedAdmissionReview({
    snapshots: new MemorySnapshots(snapshot),
    captures: { read: () => Promise.resolve(undefined) },
    admissions: { read: () => Promise.resolve(undefined) },
    preview: { execute: () => Promise.reject(new Error("not called")) },
  });
  const result = await review.execute({
    projectId: "desk-lamp-dl05",
    basis: {
      kind: "thread-snapshot",
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: SUBJECT_ID,
    },
    correctedSourceArtifactId: "corrected-source-absent",
  });
  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.error.code, "capture_not_found");
});

Deno.test("corrected admission review is unresolved when the capture is not a 1.0 document", async () => {
  const fingerprint = await sha256Fingerprint({ broken: true });
  const artifactId = `corrected-source-${fingerprint.digest}`;
  const snapshot = minimalSnapshot({
    artifactId,
    fingerprint,
  });
  const review = new PrepareProjectCorrectedAdmissionReview({
    snapshots: new MemorySnapshots(snapshot),
    captures: { read: () => Promise.resolve("{not-json") },
    admissions: { read: () => Promise.reject(new Error("not called")) },
    preview: { execute: () => Promise.reject(new Error("not called")) },
  });
  const result = await review.execute({
    projectId: "desk-lamp-dl05",
    basis: {
      kind: "thread-snapshot",
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: SUBJECT_ID,
    },
    correctedSourceArtifactId: artifactId,
  });
  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.error.code, "capture_integrity_failed");
});

function minimalSnapshot(options?: {
  readonly artifactId?: string;
  readonly fingerprint?: ContentFingerprint;
}) {
  const briefId = "approved-brief-document";
  const briefFp = { algorithm: "sha256" as const, digest: "1".repeat(64) };
  const extra = options?.artifactId && options.fingerprint
    ? [{
      id: options.artifactId,
      name: "Corrected source",
      kind: "document" as const,
      version: options.fingerprint.digest,
      fingerprint: options.fingerprint,
      producer: {
        serverId: "digital-thread",
        tool: "compile.capture-corrected-source@1",
        runId: "run.corrected",
      },
      inputArtifactIds: [briefId],
      freshness: fresh(),
    }]
    : [];
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.corrected.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "dl05",
      kind: "system",
      version: "1",
      modelArtifactId: briefId,
    },
    freshness: fresh(),
    changeSet: {
      id: "cs",
      name: "brief",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [
        change("ch-brief", briefId, briefFp),
        ...extra.map((item) => change(`ch-${item.id}`, item.id, item.fingerprint)),
      ],
    },
    artifacts: [
      {
        id: briefId,
        name: "brief",
        kind: "document",
        version: "1",
        fingerprint: briefFp,
        producer: {
          serverId: "digital-thread",
          tool: "baseline.from-approved-brief@1",
          runId: "run.brief",
        },
        inputArtifactIds: [],
        freshness: fresh(),
      },
      ...extra,
    ],
    consumptions: extra.map((item) => ({
      id: `consume-${briefId}-by-${item.id}`,
      artifactId: briefId,
      consumer: item.producer,
      observedFingerprint: briefFp,
      verifiedAt: AT,
      status: "verified" as const,
    })),
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      link("changes", "change", "ch-brief", "artifact", briefId),
      ...extra.flatMap((item) => [
        link("changes", "change", `ch-${item.id}`, "artifact", item.id),
        link(
          "uses",
          "consumption",
          `consume-${briefId}-by-${item.id}`,
          "artifact",
          briefId,
        ),
        link("derived_from", "artifact", item.id, "artifact", briefId),
      ]),
    ],
    proposedActions: [],
  });
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

function change(
  id: string,
  artifactId: string,
  fingerprint: ContentFingerprint,
) {
  return {
    id,
    kind: "created" as const,
    target: { kind: "artifact" as const, id: artifactId },
    summary: `Created ${artifactId}.`,
    afterFingerprint: fingerprint,
  };
}

function link(
  relation: "changes" | "uses" | "derived_from",
  fromKind: "change" | "consumption" | "artifact",
  fromId: string,
  toKind: "artifact",
  toId: string,
) {
  return {
    id: `${relation}:${fromKind}:${fromId}->${toKind}:${toId}`,
    relation,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    rationale: relation,
  };
}

class MemorySnapshots {
  saves = 0;
  constructor(
    private readonly snapshot?: ReturnType<typeof validateThreadSnapshot>,
  ) {}
  get(snapshotId: string) {
    return Promise.resolve(
      this.snapshot && snapshotId === this.snapshot.id ? this.snapshot : undefined,
    );
  }
  latest() {
    return Promise.resolve(this.snapshot);
  }
  save() {
    this.saves += 1;
    return Promise.reject(new Error("review must not persist a Thread snapshot"));
  }
}

function emptySnapshots() {
  return new MemorySnapshots();
}
