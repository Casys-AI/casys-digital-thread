import { assertEquals, assertRejects } from "@std/assert";
import type { ThermalMethodSheetStore } from "../../../application/ports/out/modelica/thermal-method-sheet-store.ts";
import { MODELICA_THERMAL_METHOD_SHEET_SEAL_ADMISSION_SCHEMA } from "../../../domain/modelica/thermal-method-sheet-proposal.ts";
import {
  fingerprintModelicaThermalMethodSheet,
  MODELICA_THERMAL_METHOD_SHEET_SCHEMA,
  type ModelicaThermalMethodSheet,
  validateModelicaThermalMethodSheet,
} from "../../../domain/modelica/thermal-method-sheet.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { validThermalMethodSheetPlaceholder } from "../../../testing/modelica-thermal-method-sheet-fixtures.ts";
import { CaptureBackedThermalMethodSheetCompilationJoin } from "./capture-backed-thermal-method-sheet-compilation-join.ts";
import {
  MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
  MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX,
  thermalMethodSheetUri,
  validateModelicaThermalMethodSheetSealCapture,
} from "./thermal-method-sheet-seal-capture.ts";
import type { ThermalMethodSheetSealCaptureStore } from "./verify-seal-modelica-thermal-method-sheet-run-executor.ts";

const AT = "2026-08-21T12:00:00.000Z";
const LATER = "2026-08-24T12:00:00.000Z";
const PROJECT_ID = "articulated-led-desk-lamp";
const SUBJECT_ID = "articulated-led-desk-lamp";
const SNAPSHOT_ID = "placeholder-thread-snapshot";
const REVISION = 3;
const BRIEF_ID = "artifact.brief";
const BRIEF_FINGERPRINT: ContentFingerprint = {
  algorithm: "sha256",
  digest: "1".repeat(64),
};

Deno.test(
  "thermal method-sheet compilation join selects the unique active seal when a fresh archived seal remains",
  async () => {
    const archived = await persistSeal("placeholder-thermal-method-sheet");
    const active = await persistSeal("placeholder-thermal-method-sheet-active");
    const join = joinFor(
      [archived, active],
      snapshot([
        { seal: archived, archived: true, changedAt: LATER },
        { seal: active, changedAt: AT },
      ]),
    );
    assertEquals(await join.read(request()), active.sheet);
  },
);

Deno.test(
  "thermal method-sheet compilation join fails closed on two active seals",
  async () => {
    const first = await persistSeal("placeholder-thermal-method-sheet");
    const second = await persistSeal("placeholder-thermal-method-sheet-active");
    const join = joinFor(
      [first, second],
      snapshot([
        { seal: first, changedAt: AT },
        { seal: second, changedAt: LATER },
      ]),
    );
    await assertRejects(
      () => join.read(request()),
      TypeError,
      "The Thread basis has an ambiguous thermal method-sheet seal.",
    );
  },
);

Deno.test(
  "thermal method-sheet compilation join treats archived-only seals as absence",
  async () => {
    const first = await persistSeal("placeholder-thermal-method-sheet");
    const second = await persistSeal("placeholder-thermal-method-sheet-active");
    const join = joinFor(
      [first, second],
      snapshot([
        { seal: first, archived: true, changedAt: AT },
        { seal: second, archived: true, changedAt: LATER },
      ]),
    );
    assertEquals(await join.read(request()), undefined);
  },
);

function request() {
  return {
    projectId: PROJECT_ID,
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: SNAPSHOT_ID,
      revision: REVISION,
      subjectId: SUBJECT_ID,
    },
  };
}

function joinFor(seals: readonly PersistedSeal[], current: ThreadSnapshot) {
  const captures = new MemoryCaptures();
  const sheets = new MemorySheets();
  for (const seal of seals) {
    captures.seed(seal.captureFingerprint, seal.text);
    sheets.seed(seal.sheetFingerprint, seal.sheet);
  }
  return new CaptureBackedThermalMethodSheetCompilationJoin({
    snapshots: {
      get: (id) => Promise.resolve(id === current.id ? current : undefined),
    },
    captures,
    sheets,
  });
}

interface PersistedSeal {
  readonly sheet: ModelicaThermalMethodSheet;
  readonly sheetFingerprint: ContentFingerprint;
  readonly captureFingerprint: ContentFingerprint;
  readonly text: string;
  readonly runId: string;
}

async function persistSeal(sheetId: string): Promise<PersistedSeal> {
  const input = validThermalMethodSheetPlaceholder();
  input.id = sheetId;
  const sheet = validateModelicaThermalMethodSheet(input);
  const sheetFingerprint = await fingerprintModelicaThermalMethodSheet(sheet);
  const runId = `run.seal-${sheetId}`;
  const capture = validateModelicaThermalMethodSheetSealCapture({
    schemaVersion: MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
    kind: "modelica-thermal-method-sheet-seal",
    operation: {
      id: "verify.seal-modelica-thermal-method-sheet",
      version: "1",
    },
    trustedRunId: runId,
    decisionId: "placeholder-seal-decision",
    sealedAt: AT,
    admission: {
      schemaVersion: MODELICA_THERMAL_METHOD_SHEET_SEAL_ADMISSION_SCHEMA,
      sheetSchemaVersion: MODELICA_THERMAL_METHOD_SHEET_SCHEMA,
      sheetId: sheet.id,
      sheetFingerprint,
      projectId: sheet.project.id,
      subjectId: sheet.subject.id,
      basis: sheet.basis,
      model: sheet.model,
      sealDecisionId: sheet.review.sealDecisionId,
    },
    sheet: {
      id: sheet.id,
      fingerprint: sheetFingerprint,
      uri: thermalMethodSheetUri(sheetFingerprint),
    },
    recross: {
      sourceCapture: {
        fingerprint: sheet.model.sourceCaptureFingerprint,
        role: "modelica-model",
        language: "modelica",
      },
      attributeUsageIds: sheet.bindings.parameterizes.map((item) =>
        item.attributeUsageId
      ),
      requirementElementIds: sheet.bindings.outputRequirements.map((item) =>
        item.requirementElementId
      ),
    },
  });
  const text = deterministicJson(capture);
  const captureFingerprint = await sha256Fingerprint(capture);
  return { sheet, sheetFingerprint, captureFingerprint, text, runId };
}

function snapshot(
  seals: ReadonlyArray<{
    readonly seal: PersistedSeal;
    readonly archived?: boolean;
    readonly changedAt: string;
  }>,
): ThreadSnapshot {
  const artifacts = [
    {
      id: BRIEF_ID,
      name: "Brief",
      kind: "document" as const,
      version: "1",
      fingerprint: BRIEF_FINGERPRINT,
      producer: {
        serverId: "digital-thread",
        tool: "baseline.from-approved-brief@1",
        runId: "run.brief",
      },
      inputArtifactIds: [] as const,
      freshness: fresh(AT),
    },
    ...seals.map(({ seal, changedAt }) => sealArtifact(seal, changedAt)),
  ];
  const created = [
    change("change.brief", "created", BRIEF_ID, BRIEF_FINGERPRINT),
    ...seals.map(({ seal }) => {
      const id = artifactId(seal);
      return change(`change.${id}`, "created", id, seal.captureFingerprint);
    }),
  ];
  const archived = seals.filter((item) => item.archived === true).map(
    ({ seal }) => {
      const id = artifactId(seal);
      return {
        id: `change.archive.${id}`,
        kind: "archived" as const,
        target: { kind: "artifact" as const, id },
        summary: "Archived the thermal method-sheet seal.",
      };
    },
  );
  const changes = [...created, ...archived];
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: SNAPSHOT_ID,
    revision: REVISION,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Thermal method sheet fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: BRIEF_ID,
    },
    freshness: fresh(AT),
    changeSet: {
      id: "change-set.seals",
      name: "Thermal method-sheet seals",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes,
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: changes.map((item) => ({
      id: `provenance.${item.id}`,
      relation: "changes",
      from: { kind: "change", id: item.id },
      to: { kind: "artifact", id: item.target.id },
      rationale: "The applied change targets this exact Thread artifact.",
    })),
    proposedActions: [],
  });
}

function sealArtifact(seal: PersistedSeal, changedAt: string) {
  const digest = seal.captureFingerprint.digest;
  return {
    id: artifactId(seal),
    name: "Modelica thermal method sheet",
    kind: "document" as const,
    version: digest,
    fingerprint: seal.captureFingerprint,
    uri: `${MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX}${digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "verify.seal-modelica-thermal-method-sheet@1",
      runId: seal.runId,
    },
    inputArtifactIds: [] as const,
    freshness: fresh(changedAt),
  };
}

function artifactId(seal: PersistedSeal): string {
  return `modelica-thermal-method-sheet-seal-${seal.captureFingerprint.digest}`;
}

function change(
  id: string,
  kind: "created",
  targetId: string,
  afterFingerprint: ContentFingerprint,
) {
  return {
    id,
    kind,
    target: { kind: "artifact" as const, id: targetId },
    summary: "Published the exact Thread artifact.",
    afterFingerprint,
  };
}

function fresh(at: string) {
  return { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] };
}

class MemoryCaptures implements ThermalMethodSheetSealCaptureStore {
  readonly #items = new Map<string, string>();
  seed(fingerprint: ContentFingerprint, text: string): void {
    this.#items.set(fingerprint.digest, text);
  }
  save() {
    return Promise.reject(new Error("join must not write captures"));
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.#items.get(fingerprint.digest));
  }
}

class MemorySheets implements ThermalMethodSheetStore {
  readonly #items = new Map<string, ModelicaThermalMethodSheet>();
  seed(
    fingerprint: ContentFingerprint,
    sheet: ModelicaThermalMethodSheet,
  ): void {
    this.#items.set(fingerprint.digest, sheet);
  }
  save() {
    return Promise.reject(new Error("join must not write sheets"));
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.#items.get(fingerprint.digest));
  }
}
