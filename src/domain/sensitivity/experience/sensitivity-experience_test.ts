import { assertEquals, assertRejects } from "@std/assert";
import type { TechnicalCompilationDocument } from "../../compile/admission/technical-compilation.ts";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import {
  assembleSensitivityStudyCaseV3,
  validateSensitivityStudyCaseTemplate,
} from "../study/sensitivity-study-template.ts";
import { computeSensitivities } from "../study/sensitivity-study.ts";
import type { SensitivityStudyCaseV3 } from "../study/sensitivity-study-v3.ts";
import {
  compileSensitivityExperienceTarget,
  compileSensitivityExperienceTargetWithMethod,
  deriveSensitivityExperienceRecord,
  SENSITIVITY_EXPERIENCE_LEGACY_SOLVER_METHOD,
  SENSITIVITY_EXPERIENCE_RECORDED_SOLVER_METHOD,
  SENSITIVITY_EXPERIENCE_SOLVER_OPERATION_LEGACY,
  SENSITIVITY_EXPERIENCE_SOLVER_OPERATION_RECORDED,
  SENSITIVITY_EXPERIENCE_WORK_AVOIDED,
  SENSITIVITY_EXPERIENCE_WORK_AVOIDED_LEGACY,
  type SensitivityExperienceBuild123dProfileInput,
  validateSensitivityExperienceRecord,
  validateSensitivityExperienceReuseReceipt,
} from "./sensitivity-experience.ts";

const AT = "2026-08-23T00:00:00.000Z";
const SOURCE = "size_z = 50\nresult = Box(1, 1, size_z)\n";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);

Deno.test("experience identity excludes project-local case and capture identities", async () => {
  const firstCase = await studyCase(
    "source-project",
    "source-subject",
    "source-case",
    1,
  );
  const secondCase = {
    ...firstCase,
    id: "target-case",
    revision: 9,
    project: { id: "target-project", subjectId: "target-subject" },
    cadSource: {
      artifactUri: "thread-artifact://target-project/other-admission",
      sha256: DIGEST_C,
    },
  } satisfies SensitivityStudyCaseV3;
  const admission = await admittedSource();
  const first = await compileSensitivityExperienceTarget({
    studyCase: firstCase,
    admission,
    build123dProfile: profile(),
    solverRuntime: solverRuntime(DIGEST_B),
  });
  const second = await compileSensitivityExperienceTarget({
    studyCase: secondCase,
    admission,
    build123dProfile: profile(),
    solverRuntime: solverRuntime(DIGEST_B),
  });
  assertEquals(first.scientificKey, second.scientificKey);

  const capture = await studyCapture(firstCase);
  const record = await deriveSensitivityExperienceRecord(first, capture);
  const otherLineageRecord = await deriveSensitivityExperienceRecord(first, {
    ...capture,
    trustedRunId: "other-run",
    cad: {
      base: { ...capture.cad.base, executionRunId: "other-run:cad-base" },
      stepped: {
        ...capture.cad.stepped,
        executionRunId: "other-run:cad-stepped",
      },
    },
    capturedAt: "2026-08-24T00:00:00.000Z",
  });
  assertEquals(record, otherLineageRecord);
  const text = JSON.stringify(record);
  for (
    const forbidden of [
      "source-project",
      "source-subject",
      "source-case",
      "source-run",
      "thread-artifact://",
      AT,
      SOURCE.trim(),
      "caseDigest",
      "trustedRunId",
      "capturedAt",
    ]
  ) assertEquals(text.includes(forbidden), false, forbidden);
  const keys = allKeys(record);
  for (
    const forbiddenKey of [
      "projectId",
      "subjectId",
      "trustedRunId",
      "capturedAt",
      "caseDigest",
      "artifactUri",
      "sourceText",
      "uri",
    ]
  ) assertEquals(keys.has(forbiddenKey), false, forbiddenKey);
});

Deno.test("experience key includes frozen CAD and solver method identities", async () => {
  const sealedCase = await studyCase("project-a", "subject-a", "case-a", 1);
  const admission = await admittedSource();
  const baseline = await compileSensitivityExperienceTarget({
    studyCase: sealedCase,
    admission,
    build123dProfile: profile(),
    solverRuntime: solverRuntime(DIGEST_B),
  });
  const changedCad = await compileSensitivityExperienceTarget({
    studyCase: sealedCase,
    admission,
    build123dProfile: profile(DIGEST_C),
    solverRuntime: solverRuntime(DIGEST_B),
  });
  const changedSolver = await compileSensitivityExperienceTarget({
    studyCase: sealedCase,
    admission,
    build123dProfile: profile(),
    solverRuntime: solverRuntime(DIGEST_C),
  });
  assertEquals(
    baseline.scientificKey.digest === changedCad.scientificKey.digest,
    false,
  );
  assertEquals(
    baseline.scientificKey.digest === changedSolver.scientificKey.digest,
    false,
  );
});

Deno.test("current experience targets the recorded CalculiX protocol, not the legacy live call", async () => {
  const sealedCase = await studyCase("project-a", "subject-a", "case-a", 1);
  const admission = await admittedSource();
  const current = await compileSensitivityExperienceTarget({
    studyCase: sealedCase,
    admission,
    build123dProfile: profile(),
    solverRuntime: solverRuntime(DIGEST_B),
  });
  assertEquals(
    current.identity.method.solver.operationId,
    SENSITIVITY_EXPERIENCE_SOLVER_OPERATION_RECORDED,
  );
  assertEquals(
    current.identity.method.solver.requestLowerer,
    SENSITIVITY_EXPERIENCE_RECORDED_SOLVER_METHOD.requestLowerer,
  );
  assertEquals(
    current.identity.method.solver.responseParser,
    SENSITIVITY_EXPERIENCE_RECORDED_SOLVER_METHOD.responseParser,
  );
  assertEquals(
    current.identity.method.solver.outputValidator,
    SENSITIVITY_EXPERIENCE_RECORDED_SOLVER_METHOD.outputValidator,
  );
  const currentMethod = current.identity.method;
  const legacy = await compileSensitivityExperienceTargetWithMethod({
    studyCase: sealedCase,
    admission,
    method: {
      ...currentMethod,
      solver: {
        ...currentMethod.solver,
        operationId: SENSITIVITY_EXPERIENCE_LEGACY_SOLVER_METHOD.operationId,
        requestLowerer: SENSITIVITY_EXPERIENCE_LEGACY_SOLVER_METHOD.requestLowerer,
        responseParser: SENSITIVITY_EXPERIENCE_LEGACY_SOLVER_METHOD.responseParser,
        outputValidator: SENSITIVITY_EXPERIENCE_LEGACY_SOLVER_METHOD.outputValidator,
      },
    },
  });
  assertEquals(
    legacy.identity.method.solver.operationId,
    SENSITIVITY_EXPERIENCE_SOLVER_OPERATION_LEGACY,
  );
  assertEquals(
    current.scientificKey.digest === legacy.scientificKey.digest,
    false,
  );
  const mixed = {
    ...currentMethod,
    solver: {
      ...currentMethod.solver,
      operationId: SENSITIVITY_EXPERIENCE_SOLVER_OPERATION_LEGACY,
    },
  };
  await assertRejects(
    () =>
      compileSensitivityExperienceTargetWithMethod({
        studyCase: sealedCase,
        admission,
        method: mixed,
      }),
    TypeError,
  );
});

Deno.test("legacy experience records and receipts stay readable under their original identity", async () => {
  const sealedCase = await studyCase("project-a", "subject-a", "case-a", 1);
  const admission = await admittedSource();
  const current = await compileSensitivityExperienceTarget({
    studyCase: sealedCase,
    admission,
    build123dProfile: profile(),
    solverRuntime: solverRuntime(DIGEST_B),
  });
  const legacyTarget = await compileSensitivityExperienceTargetWithMethod({
    studyCase: sealedCase,
    admission,
    method: {
      ...current.identity.method,
      solver: {
        ...current.identity.method.solver,
        operationId: SENSITIVITY_EXPERIENCE_LEGACY_SOLVER_METHOD.operationId,
        requestLowerer: SENSITIVITY_EXPERIENCE_LEGACY_SOLVER_METHOD.requestLowerer,
        responseParser: SENSITIVITY_EXPERIENCE_LEGACY_SOLVER_METHOD.responseParser,
        outputValidator: SENSITIVITY_EXPERIENCE_LEGACY_SOLVER_METHOD.outputValidator,
      },
    },
  });
  const capture = await studyCapture(sealedCase);
  const legacyRecord = await deriveSensitivityExperienceRecord(legacyTarget, capture);
  const reread = await validateSensitivityExperienceRecord(
    JSON.parse(JSON.stringify(legacyRecord)),
  );
  assertEquals(reread.identity.method.solver.operationId, "calculix_solve_static");
  assertEquals(reread.scientificKey, legacyRecord.scientificKey);

  const currentReceipt = {
    schemaVersion: "sensitivity-experience-reuse-receipt/1.0",
    audience: "installation-private",
    status: "reused-exact",
    target: {
      projectId: "target-project",
      basis: {
        kind: "thread-snapshot",
        snapshotId: "snapshot-target",
        revision: 1,
        subjectId: "subject-target",
      },
      basisFingerprint: { algorithm: "sha256", digest: DIGEST_A },
    },
    scientificKey: current.scientificKey,
    reviewFingerprint: { algorithm: "sha256", digest: DIGEST_A },
    recordFingerprint: { algorithm: "sha256", digest: DIGEST_B },
    originBindingFingerprint: { algorithm: "sha256", digest: DIGEST_C },
    derivationProfile: { id: "sensitivity-experience-exact-v1", version: "1.0.0" },
    compatibilityVersion: "1.0.0",
    sourceHealth: "valid",
    workAvoided: SENSITIVITY_EXPERIENCE_WORK_AVOIDED,
    freshExecutionRequired: false,
    issuedAt: AT,
  };
  const currentValidated = validateSensitivityExperienceReuseReceipt(currentReceipt);
  assertEquals(currentValidated.workAvoided, SENSITIVITY_EXPERIENCE_WORK_AVOIDED);
  const legacyValidated = validateSensitivityExperienceReuseReceipt({
    ...currentReceipt,
    workAvoided: SENSITIVITY_EXPERIENCE_WORK_AVOIDED_LEGACY,
  });
  assertEquals(legacyValidated.workAvoided, SENSITIVITY_EXPERIENCE_WORK_AVOIDED_LEGACY);
  assertEquals(
    legacyValidated.workAvoided === currentValidated.workAvoided,
    false,
  );
});

Deno.test("derived record canonicalizes measurements and rejects wider records", async () => {
  const sealedCase = await studyCase("project-a", "subject-a", "case-a", 1);
  const target = await compileSensitivityExperienceTarget({
    studyCase: sealedCase,
    admission: await admittedSource(),
    build123dProfile: profile(),
    solverRuntime: solverRuntime(DIGEST_B),
  });
  const capture = await studyCapture(sealedCase, true);
  const record = await deriveSensitivityExperienceRecord(target, capture);
  assertEquals(record.result.measurements.base.map((item) => item.metric), [
    "assembly_max_displacement",
    "assembly_max_von_mises",
  ]);
  await assertRejects(
    () =>
      validateSensitivityExperienceRecord({
        ...record,
        sourceProjectId: "must-not-be-admitted",
      }),
    TypeError,
  );
  await assertRejects(
    () =>
      validateSensitivityExperienceRecord({
        ...record,
        result: {
          ...record.result,
          measurements: {
            ...record.result.measurements,
            base: [...record.result.measurements.base].reverse(),
          },
        },
      }),
    TypeError,
    "canonical order",
  );
});

async function studyCase(
  projectId: string,
  subjectId: string,
  id: string,
  revision: number,
): Promise<SensitivityStudyCaseV3> {
  const template = validateSensitivityStudyCaseTemplate(
    JSON.parse(
      await Deno.readTextFile(
        "config/sensitivity-study-cases/dl04-size-z-sensitivity.json",
      ),
    ),
  );
  return assembleSensitivityStudyCaseV3({
    ...template,
    id,
    revision,
    project: { id: projectId, subjectId },
  }, {
    artifactUri: `thread-artifact://${projectId}/admission`,
    sha256: DIGEST_A,
  });
}

function allKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, found);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      found.add(key);
      allKeys(item, found);
    }
  }
  return found;
}

async function admittedSource(): Promise<{
  readonly document: TechnicalCompilationDocument;
}> {
  const sourceFingerprint = await sha256Fingerprint(SOURCE);
  const unitId = `technical-unit:${sourceFingerprint.digest}`;
  const analysis = {
    schemaVersion: "source-analysis/1.0" as const,
    source: {
      id: unitId,
      role: "cad-script" as const,
      language: "python" as const,
      fingerprint: sourceFingerprint,
    },
    analyzer: { id: "python-cad-source-frontend", version: "1.0.0" },
    policy: {
      profile: "build123d-closed-subset-v1",
      status: "passed" as const,
      findings: [],
    },
    symbols: [{
      id: "symbol.size-z",
      kind: "parameter" as const,
      name: "size_z",
      span: { start: { line: 1, column: 0 }, end: { line: 1, column: 6 } },
    }],
    dependencies: [],
    unresolvedConstructs: [],
  };
  const source = {
    sourceText: SOURCE,
    analysis,
    analysisFingerprint: await sha256Fingerprint(analysis),
    effectiveUnit: {
      kind: "authored-root" as const,
      closureKind: "root-only" as const,
      unitId,
      closureFingerprint: sourceFingerprint,
      scriptFingerprint: sourceFingerprint,
    },
  };
  const profileFingerprint = { algorithm: "sha256" as const, digest: DIGEST_A };
  const compilationProfile = {
    id: "build123d-parameterized-v2",
    version: "2.0.0",
    target: "build123d-source" as const,
    sourceRole: "cad-script" as const,
    language: "python" as const,
    analyzer: analysis.analyzer,
    analysisPolicyProfile: analysis.policy.profile,
    requiredBindingSymbolKinds: ["parameter" as const],
  };
  const binding = {
    id: "binding.size-z",
    sourceId: unitId,
    sourceSymbolId: "symbol.size-z",
    sysmlElementId: "attribute.size-z",
    sysmlElementKind: "AttributeUsage",
    relation: "parameterizes" as const,
  };
  return {
    document: {
      schemaVersion: "technical-compilation/2.0",
      basis: {} as never,
      basisFingerprint: profileFingerprint,
      inputManifest: {
        sources: [source],
        bindings: [binding],
        profileRequests: [],
      },
      status: "ready-for-review",
      diagnostics: [],
      projections: [{
        target: "build123d-source",
        profile: compilationProfile,
        profileFingerprint,
        status: "ready-for-review",
        diagnostics: [],
        sources: [{ ...source, bindings: [binding] }],
      }],
    },
  };
}

function profile(
  runtimeDigest = DIGEST_B,
): SensitivityExperienceBuild123dProfileInput {
  return {
    executionProfile: { id: "build123d-closed-subset-v1", version: "1.0.0" },
    profileFingerprint: { algorithm: "sha256", digest: DIGEST_A },
    compilationProfileFingerprint: { algorithm: "sha256", digest: DIGEST_A },
    runtimeBackend: { id: "microsandbox-local", version: "1.0.0" },
    runtime: {
      isolationClass: "microvm",
      imageDigest: { algorithm: "sha256", digest: runtimeDigest },
    },
    outputValidator: { id: "build123d-step-validator", version: "1.0.0" },
    outputManifest: [{ role: "geometry", format: "step-ap214" }],
  };
}

function solverRuntime(digest: string) {
  return {
    imageReference: `ghcr.io/casys/calculix@sha256:${digest}`,
    imageDigest: { algorithm: "sha256" as const, digest },
  };
}

async function studyCapture(
  studyCase: SensitivityStudyCaseV3,
  reverse = false,
) {
  const base = [
    { metric: "assembly_max_displacement", value: 2, unit: "mm" },
    { metric: "assembly_max_von_mises", value: 10, unit: "MPa" },
  ];
  const stepped = [
    { metric: "assembly_max_displacement", value: 3, unit: "mm" },
    { metric: "assembly_max_von_mises", value: 12, unit: "MPa" },
  ];
  const orderedBase = reverse ? [...base].reverse() : base;
  const orderedStepped = reverse ? [...stepped].reverse() : stepped;
  return {
    schemaVersion: "sensitivity-study-capture/1.0",
    operation: { id: "analyze.run-fea-sensitivity", version: "1" },
    trustedRunId: "source-run",
    caseDigest: (await sha256Fingerprint(studyCase)).digest,
    studyCase,
    cad: {
      base: {
        executionRunId: "source-run:cad-base",
        sourceSha256: DIGEST_A,
        stepSha256: DIGEST_B,
        stepBytes: 10,
      },
      stepped: {
        executionRunId: "source-run:cad-stepped",
        sourceSha256: DIGEST_A,
        stepSha256: DIGEST_C,
        stepBytes: 11,
      },
    },
    measurements: { base: orderedBase, stepped: orderedStepped },
    derivatives: computeSensitivities(
      studyCase,
      new Map(orderedBase.map((item) => [item.metric, item])),
      new Map(orderedStepped.map((item) => [item.metric, item])),
    ),
    capturedAt: AT,
  };
}
