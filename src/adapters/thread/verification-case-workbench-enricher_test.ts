import { assertEquals } from "@std/assert";
import type {
  ThreadArtifact,
  ThreadWorkbenchSnapshot,
} from "../../presentation/workbench/thread/snapshot.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
} from "../../presentation/workbench/thread/graph.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  canonicalProofText,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
} from "../../domain/fea/seal-case/fea-proof-proposal.ts";
import {
  type MechanicalProofCase,
  validateMechanicalProofCase,
} from "../../domain/fea/seal-case/mechanical-proof-case.ts";
import { FEA_PROOF_CASE_CAPTURE_SCHEMA } from "../../domain/fea/seal-case/fea-proof-case-capture.ts";
import {
  SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA,
  SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX,
} from "../sensitivity/study/sensitivity-study-case-capture.ts";
import {
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
} from "../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import {
  type SensitivityStudyCaseV3,
  validateSensitivityStudyCaseV3,
} from "../../domain/sensitivity/study/sensitivity-study-v3.ts";
import {
  PRINTABILITY_CASE_CAPTURE_SCHEMA,
  PRINTABILITY_CASE_CAPTURE_URI_PREFIX,
} from "../make/printability/printability-case-capture.ts";
import { INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION } from "../../domain/make/printability/printability-proposal.ts";
import { validatePrintabilityCheckCase } from "../../domain/make/printability/printability-case.ts";
import {
  PRINT_ESTIMATE_CASE_CAPTURE_SCHEMA,
  PRINT_ESTIMATE_CASE_CAPTURE_URI_PREFIX,
} from "../make/print-estimate/print-estimate-case-capture.ts";
import { INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION } from "../../domain/make/print-estimate/print-estimate-proposal.ts";
import { validatePrintEstimateCase } from "../../domain/make/print-estimate/print-estimate-case.ts";
import {
  DFM_CASE_CAPTURE_SCHEMA,
  DFM_CASE_CAPTURE_URI_PREFIX,
} from "../make/dfm/dfm-case-capture.ts";
import {
  INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
  validateDfmCheckCase,
} from "../../domain/make/dfm/dfm-case.ts";
import {
  compareEngineeringCaseIssues,
  projectCurrentEngineeringCases,
  unavailableEngineeringCaseCatalog,
  verificationCaseKey,
} from "../../presentation/workbench/thread/evidence.ts";
import {
  type EngineeringCaseWorkbenchEnricherDependencies,
  enrichThreadWorkbenchWithEngineeringCases,
} from "./verification-case-workbench-enricher.ts";

const PROOF_CASE = validateMechanicalProofCase(JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../../../src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl05-arm-cantilever.json",
      import.meta.url,
    ),
  ),
));
const CASE_CONTEXT = { projectId: PROOF_CASE.project.id } as const;

function caseReaders(
  overrides: EngineeringCaseWorkbenchEnricherDependencies = {},
): EngineeringCaseWorkbenchEnricherDependencies {
  const absent = { read: () => Promise.resolve(undefined) };
  return {
    mechanicalProof: absent,
    sensitivityStudy: absent,
    printabilityCheck: absent,
    printEstimate: absent,
    dfmCheck: absent,
    ...overrides,
  };
}

Deno.test(
  "verification case enricher reopens exact seals and projects many-to-many lineage without labels",
  async () => {
    const first = await sealedProof(PROOF_CASE, "run.seal.first");
    const second = await sealedProof({
      ...PROOF_CASE,
      id: `${PROOF_CASE.id}-alternate`,
      revision: PROOF_CASE.revision + 1,
      scope: `${PROOF_CASE.scope} Alternate reviewed load case.`,
    }, "run.seal.second");
    const snapshot = workbenchFor([first, second]);
    const captureByDigest = new Map([
      [first.captureFingerprint, first.captureText],
      [second.captureFingerprint, second.captureText],
    ]);

    const enriched = await enrichThreadWorkbenchWithEngineeringCases(
      snapshot,
      caseReaders({
        mechanicalProof: {
          read: (fingerprint) =>
            Promise.resolve(captureByDigest.get(fingerprint.digest)),
        },
        sensitivityStudy: { read: () => Promise.resolve(undefined) },
      }),
      CASE_CONTEXT,
    );

    assertEquals(enriched.engineeringCases.status, "observed");
    assertEquals(enriched.engineeringCases.issues, []);
    assertEquals(enriched.engineeringCases.cases.length, 2);
    assertEquals(
      enriched.engineeringCases.cases.map((item) => item.id),
      [PROOF_CASE.id, `${PROOF_CASE.id}-alternate`],
    );
    assertEquals(
      enriched.engineeringCases.cases[0]?.scope,
      PROOF_CASE.scope,
      "scope remains source text and is never synthesized from a label",
    );

    const caseKeys = enriched.engineeringCases.cases.map((item) => item.key);
    const sortedCaseKeys = [...caseKeys].sort();
    for (
      const ref of [
        "artifact:geometry",
        "artifact:requirements",
        "artifact:step",
        "artifact:result",
        "observation:observation",
        "requirement:requirement",
        "evaluation:evaluation",
        "violation:violation",
      ]
    ) {
      assertEquals(
        nodeByRef(enriched, ref)?.engineeringCaseRefs,
        sortedCaseKeys,
        `${ref} belongs to both exact cases without a dominant case`,
      );
    }
    assertEquals(
      nodeByRef(enriched, `artifact:${first.artifact.id}`)
        ?.engineeringCaseRefs,
      [caseKeys[0]],
    );
    assertEquals(
      nodeByRef(enriched, "artifact:unrelated")?.engineeringCaseRefs,
      undefined,
      "an unrelated fact is never joined by component or label",
    );
    assertEquals(
      enriched.engineeringCases.current,
      projectCurrentEngineeringCases(enriched.engineeringCases.cases).current,
    );
    assertEquals(enriched.engineeringCases.current.length, 2);
  },
);

Deno.test(
  "verification case enricher projects Camera r1/r3 current r3 and a distinct RadialArm r2",
  async () => {
    const cameraR1 = await sealedProof(
      proofCaseWith({
        id: "id01-camera-bracket-bench",
        revision: 1,
      }),
      "run.seal.camera-r1",
    );
    const cameraR3 = await sealedProof(
      proofCaseWith({
        id: "id01-camera-bracket-bench",
        revision: 3,
      }),
      "run.seal.camera-r3",
    );
    const radialR2 = await sealedProof(
      proofCaseWith({
        id: "id01-radial-arm-bench",
        revision: 2,
        target: {
          id: "RadialArm",
          modelElementId: "444df600-019b-45d5-ac36-617ff0a0f791",
        },
      }),
      "run.seal.radial-r2",
    );
    const snapshot = workbenchFor([cameraR1, cameraR3, radialR2]);
    const captureByDigest = new Map([
      [cameraR1.captureFingerprint, cameraR1.captureText],
      [cameraR3.captureFingerprint, cameraR3.captureText],
      [radialR2.captureFingerprint, radialR2.captureText],
    ]);
    const incomingSupersedes = snapshot.graph.edges.filter((edge) =>
      edge.relation === "supersedes"
    );

    const enriched = await enrichThreadWorkbenchWithEngineeringCases(
      snapshot,
      caseReaders({
        mechanicalProof: {
          read: (fingerprint) =>
            Promise.resolve(captureByDigest.get(fingerprint.digest)),
        },
      }),
      CASE_CONTEXT,
    );

    const cameraR1Key = verificationCaseKey(
      "mechanical-proof",
      cameraR1.proofDigest,
    );
    const cameraR3Key = verificationCaseKey(
      "mechanical-proof",
      cameraR3.proofDigest,
    );
    const radialR2Key = verificationCaseKey(
      "mechanical-proof",
      radialR2.proofDigest,
    );
    assertEquals(cameraR1Key === cameraR3Key, false);
    assertEquals(enriched.engineeringCases.status, "observed");
    assertEquals(enriched.engineeringCases.issues, []);
    assertEquals(
      enriched.engineeringCases.cases.map((item) => ({
        key: item.key,
        id: item.id,
        revision: item.revision,
        caseDigest: item.caseDigest,
        authorityArtifactIds: item.authorityArtifactIds,
      })),
      [
        {
          key: cameraR1Key,
          id: "id01-camera-bracket-bench",
          revision: 1,
          caseDigest: cameraR1.proofDigest,
          authorityArtifactIds: [cameraR1.artifact.id],
        },
        {
          key: cameraR3Key,
          id: "id01-camera-bracket-bench",
          revision: 3,
          caseDigest: cameraR3.proofDigest,
          authorityArtifactIds: [cameraR3.artifact.id],
        },
        {
          key: radialR2Key,
          id: "id01-radial-arm-bench",
          revision: 2,
          caseDigest: radialR2.proofDigest,
          authorityArtifactIds: [radialR2.artifact.id],
        },
      ],
    );
    // Cancelled Camera r2 never sealed a case, so it is not invented as a
    // current selection or archived hole between r1 and r3.
    assertEquals(enriched.engineeringCases.current, [
      {
        family: "mechanical-proof",
        id: "id01-camera-bracket-bench",
        currentCaseKey: cameraR3Key,
        revision: 3,
      },
      {
        family: "mechanical-proof",
        id: "id01-radial-arm-bench",
        currentCaseKey: radialR2Key,
        revision: 2,
      },
    ]);
    assertEquals(
      nodeByRef(enriched, `artifact:${cameraR1.artifact.id}`)
        ?.engineeringCaseRefs,
      [cameraR1Key],
    );
    assertEquals(
      nodeByRef(enriched, `artifact:${cameraR3.artifact.id}`)
        ?.engineeringCaseRefs,
      [cameraR3Key],
    );
    assertEquals(
      enriched.graph.edges.filter((edge) => edge.relation === "supersedes"),
      incomingSupersedes,
    );
    assertEquals(
      enriched.graph.edges.some((edge) =>
        edge.relation === "supersedes" &&
        ((edge.from.id === cameraR1.artifact.id &&
          edge.to.id === cameraR3.artifact.id) ||
          (edge.from.id === cameraR3.artifact.id &&
            edge.to.id === cameraR1.artifact.id))
      ),
      false,
    );
  },
);

Deno.test(
  "verification case enricher fails closed on duplicate family/id/revision with a divergent digest",
  async () => {
    const first = await sealedProof(
      proofCaseWith({
        id: "id01-camera-bracket-bench",
        revision: 1,
        scope: `${PROOF_CASE.scope} First divergent declaration.`,
      }),
      "run.seal.dup-a",
    );
    const second = await sealedProof(
      proofCaseWith({
        id: "id01-camera-bracket-bench",
        revision: 1,
        scope: `${PROOF_CASE.scope} Second divergent declaration.`,
      }),
      "run.seal.dup-b",
    );
    const snapshot = workbenchFor([first, second]);
    const captureByDigest = new Map([
      [first.captureFingerprint, first.captureText],
      [second.captureFingerprint, second.captureText],
    ]);

    const enriched = await enrichThreadWorkbenchWithEngineeringCases(
      snapshot,
      caseReaders({
        mechanicalProof: {
          read: (fingerprint) =>
            Promise.resolve(captureByDigest.get(fingerprint.digest)),
        },
      }),
      CASE_CONTEXT,
    );

    const firstKey = verificationCaseKey("mechanical-proof", first.proofDigest);
    const secondKey = verificationCaseKey(
      "mechanical-proof",
      second.proofDigest,
    );
    assertEquals(enriched.engineeringCases.status, "unresolved");
    assertEquals(
      new Set(enriched.engineeringCases.cases.map((item) => item.key)),
      new Set([firstKey, secondKey]),
    );
    assertEquals(enriched.engineeringCases.current, []);
    assertEquals(
      enriched.engineeringCases.issues,
      [
        currentIssue(first.artifact.id),
        currentIssue(second.artifact.id),
      ].toSorted(compareEngineeringCaseIssues),
    );
    assertEquals(
      nodeByRef(enriched, `artifact:${first.artifact.id}`)
        ?.engineeringCaseRefs,
      [firstKey],
    );
    assertEquals(
      nodeByRef(enriched, `artifact:${second.artifact.id}`)
        ?.engineeringCaseRefs,
      [secondKey],
    );
  },
);

Deno.test(
  "verification case enricher fails closed on the same case id with incompatible targets",
  async () => {
    const camera = await sealedProof(
      proofCaseWith({
        id: "id01-camera-bracket-bench",
        revision: 1,
      }),
      "run.seal.target-a",
    );
    const otherTarget = await sealedProof(
      proofCaseWith({
        id: "id01-camera-bracket-bench",
        revision: 3,
        target: {
          id: "RadialArm",
          modelElementId: "444df600-019b-45d5-ac36-617ff0a0f791",
        },
      }),
      "run.seal.target-b",
    );
    const snapshot = workbenchFor([camera, otherTarget]);
    snapshot.graph.nodes.push(
      graphNode(
        "part-definition",
        PROOF_CASE.target.modelElementId,
        "Display text must not carry identity",
        "syson",
      ),
      graphNode(
        "part-definition",
        "444df600-019b-45d5-ac36-617ff0a0f791",
        "Display text must not carry identity",
        "syson",
      ),
    );
    const captureByDigest = new Map([
      [camera.captureFingerprint, camera.captureText],
      [otherTarget.captureFingerprint, otherTarget.captureText],
    ]);

    const enriched = await enrichThreadWorkbenchWithEngineeringCases(
      snapshot,
      caseReaders({
        mechanicalProof: {
          read: (fingerprint) =>
            Promise.resolve(captureByDigest.get(fingerprint.digest)),
        },
      }),
      CASE_CONTEXT,
    );

    const cameraKey = verificationCaseKey(
      "mechanical-proof",
      camera.proofDigest,
    );
    const otherKey = verificationCaseKey(
      "mechanical-proof",
      otherTarget.proofDigest,
    );
    assertEquals(enriched.engineeringCases.status, "unresolved");
    assertEquals(
      new Set(enriched.engineeringCases.cases.map((item) => item.key)),
      new Set([cameraKey, otherKey]),
    );
    assertEquals(enriched.engineeringCases.current, []);
    assertEquals(
      enriched.engineeringCases.issues,
      [
        currentIssue(camera.artifact.id),
        currentIssue(otherTarget.artifact.id),
      ].toSorted(compareEngineeringCaseIssues),
    );
    assertEquals(
      nodeByRef(enriched, `artifact:${camera.artifact.id}`)
        ?.engineeringCaseRefs,
      [cameraKey],
    );
    assertEquals(
      nodeByRef(enriched, `artifact:${otherTarget.artifact.id}`)
        ?.engineeringCaseRefs,
      [otherKey],
    );
    assertEquals(
      enriched.graph.nodes.some((node) =>
        node.engineeringCaseRefs?.includes(cameraKey) === true
      ),
      true,
    );
    assertEquals(
      enriched.graph.nodes.some((node) =>
        node.engineeringCaseRefs?.includes(otherKey) === true
      ),
      true,
    );
    assertEquals(
      enriched.graph.edges.filter((edge) => edge.relation === "verified_by")
        .map((edge) => edge.id)
        .toSorted((left, right) => left < right ? -1 : left > right ? 1 : 0),
      [
        `structure:verified-by:${PROOF_CASE.target.modelElementId}:${camera.artifact.id}`,
        `structure:verified-by:444df600-019b-45d5-ac36-617ff0a0f791:${otherTarget.artifact.id}`,
      ].toSorted((left, right) => left < right ? -1 : left > right ? 1 : 0),
    );
  },
);

Deno.test(
  "verification case enricher keeps RadialArm when a disjoint Camera group fail-closes",
  async () => {
    const cameraA = await sealedProof(
      proofCaseWith({
        id: "id01-camera-bracket-bench",
        revision: 1,
        scope: `${PROOF_CASE.scope} Camera duplicate A.`,
      }),
      "run.seal.camera-dup-a",
    );
    const cameraB = await sealedProof(
      proofCaseWith({
        id: "id01-camera-bracket-bench",
        revision: 1,
        scope: `${PROOF_CASE.scope} Camera duplicate B.`,
      }),
      "run.seal.camera-dup-b",
    );
    const radial = await sealedProof(
      proofCaseWith({
        id: "id01-radial-arm-bench",
        revision: 2,
        target: {
          id: "RadialArm",
          modelElementId: "444df600-019b-45d5-ac36-617ff0a0f791",
        },
      }),
      "run.seal.radial-r2",
    );
    const snapshot = workbenchFor([cameraA, cameraB, radial]);
    snapshot.graph.nodes.push(
      graphNode(
        "part-definition",
        PROOF_CASE.target.modelElementId,
        "Display text must not carry identity",
        "syson",
      ),
      graphNode(
        "part-definition",
        "444df600-019b-45d5-ac36-617ff0a0f791",
        "Display text must not carry identity",
        "syson",
      ),
    );
    const incomingSupersedes = snapshot.graph.edges.filter((edge) =>
      edge.relation === "supersedes"
    );
    const captureByDigest = new Map([
      [cameraA.captureFingerprint, cameraA.captureText],
      [cameraB.captureFingerprint, cameraB.captureText],
      [radial.captureFingerprint, radial.captureText],
    ]);

    const enriched = await enrichThreadWorkbenchWithEngineeringCases(
      snapshot,
      caseReaders({
        mechanicalProof: {
          read: (fingerprint) =>
            Promise.resolve(captureByDigest.get(fingerprint.digest)),
        },
      }),
      CASE_CONTEXT,
    );

    const cameraAKey = verificationCaseKey(
      "mechanical-proof",
      cameraA.proofDigest,
    );
    const cameraBKey = verificationCaseKey(
      "mechanical-proof",
      cameraB.proofDigest,
    );
    const radialKey = verificationCaseKey(
      "mechanical-proof",
      radial.proofDigest,
    );
    assertEquals(enriched.engineeringCases.status, "unresolved");
    assertEquals(
      new Set(enriched.engineeringCases.cases.map((item) => item.key)),
      new Set([cameraAKey, cameraBKey, radialKey]),
    );
    assertEquals(enriched.engineeringCases.current, [{
      family: "mechanical-proof",
      id: "id01-radial-arm-bench",
      currentCaseKey: radialKey,
      revision: 2,
    }]);
    assertEquals(
      enriched.engineeringCases.issues,
      [
        currentIssue(cameraA.artifact.id),
        currentIssue(cameraB.artifact.id),
      ].toSorted(compareEngineeringCaseIssues),
    );
    assertEquals(
      nodeByRef(enriched, `artifact:${radial.artifact.id}`)
        ?.engineeringCaseRefs,
      [radialKey],
    );
    assertEquals(
      nodeByRef(enriched, `artifact:${cameraA.artifact.id}`)
        ?.engineeringCaseRefs,
      [cameraAKey],
    );
    assertEquals(
      nodeByRef(enriched, `artifact:${cameraB.artifact.id}`)
        ?.engineeringCaseRefs,
      [cameraBKey],
    );
    assertEquals(
      nodeByRef(enriched, "artifact:result")?.engineeringCaseRefs,
      [cameraAKey, cameraBKey, radialKey].toSorted((left, right) =>
        left < right ? -1 : left > right ? 1 : 0
      ),
    );
    assertEquals(
      enriched.graph.nodes.some((node) =>
        node.engineeringCaseRefs?.includes(cameraAKey) === true
      ),
      true,
    );
    assertEquals(
      enriched.graph.edges.filter((edge) => edge.relation === "verified_by")
        .map((edge) => edge.id)
        .toSorted((left, right) => left < right ? -1 : left > right ? 1 : 0),
      [
        `structure:verified-by:${PROOF_CASE.target.modelElementId}:${cameraA.artifact.id}`,
        `structure:verified-by:${PROOF_CASE.target.modelElementId}:${cameraB.artifact.id}`,
        `structure:verified-by:444df600-019b-45d5-ac36-617ff0a0f791:${radial.artifact.id}`,
      ].toSorted((left, right) => left < right ? -1 : left > right ? 1 : 0),
    );
    assertEquals(
      enriched.graph.edges.filter((edge) => edge.relation === "supersedes"),
      incomingSupersedes,
    );
  },
);

Deno.test(
  "verification case enricher omits Camera current when r1 is duplicated and keeps exact cases",
  async () => {
    const cameraR1a = await sealedProof(
      proofCaseWith({
        id: "id01-camera-bracket-bench",
        revision: 1,
        scope: `${PROOF_CASE.scope} Camera r1 first declaration.`,
      }),
      "run.seal.camera-r1a",
    );
    const cameraR1b = await sealedProof(
      proofCaseWith({
        id: "id01-camera-bracket-bench",
        revision: 1,
        scope: `${PROOF_CASE.scope} Camera r1 second declaration.`,
      }),
      "run.seal.camera-r1b",
    );
    const cameraR3 = await sealedProof(
      proofCaseWith({
        id: "id01-camera-bracket-bench",
        revision: 3,
      }),
      "run.seal.camera-r3",
    );
    const snapshot = workbenchFor([cameraR1a, cameraR1b, cameraR3]);
    snapshot.graph.nodes.push(
      graphNode(
        "part-definition",
        PROOF_CASE.target.modelElementId,
        "Display text must not carry identity",
        "syson",
      ),
    );
    const captureByDigest = new Map([
      [cameraR1a.captureFingerprint, cameraR1a.captureText],
      [cameraR1b.captureFingerprint, cameraR1b.captureText],
      [cameraR3.captureFingerprint, cameraR3.captureText],
    ]);

    const enriched = await enrichThreadWorkbenchWithEngineeringCases(
      snapshot,
      caseReaders({
        mechanicalProof: {
          read: (fingerprint) =>
            Promise.resolve(captureByDigest.get(fingerprint.digest)),
        },
      }),
      CASE_CONTEXT,
    );

    const cameraR1aKey = verificationCaseKey(
      "mechanical-proof",
      cameraR1a.proofDigest,
    );
    const cameraR1bKey = verificationCaseKey(
      "mechanical-proof",
      cameraR1b.proofDigest,
    );
    const cameraR3Key = verificationCaseKey(
      "mechanical-proof",
      cameraR3.proofDigest,
    );
    assertEquals(enriched.engineeringCases.status, "unresolved");
    assertEquals(
      new Set(enriched.engineeringCases.cases.map((item) => item.key)),
      new Set([cameraR1aKey, cameraR1bKey, cameraR3Key]),
    );
    assertEquals(enriched.engineeringCases.current, []);
    assertEquals(
      enriched.engineeringCases.issues,
      [
        currentIssue(cameraR1a.artifact.id),
        currentIssue(cameraR1b.artifact.id),
        currentIssue(cameraR3.artifact.id),
      ].toSorted(compareEngineeringCaseIssues),
    );
    assertEquals(
      nodeByRef(enriched, `artifact:${cameraR3.artifact.id}`)
        ?.engineeringCaseRefs,
      [cameraR3Key],
    );
    assertEquals(
      nodeByRef(enriched, "artifact:result")?.engineeringCaseRefs,
      [cameraR1aKey, cameraR1bKey, cameraR3Key].toSorted((left, right) =>
        left < right ? -1 : left > right ? 1 : 0
      ),
    );
    assertEquals(
      enriched.graph.nodes.some((node) =>
        node.engineeringCaseRefs?.includes(cameraR3Key) === true
      ),
      true,
    );
    assertEquals(
      enriched.graph.edges.filter((edge) => edge.relation === "verified_by")
        .length,
      3,
    );
  },
);

Deno.test(
  "verification case enricher retains the exact FEA target and links the PartDefinition without a label join",
  async () => {
    const proof = await sealedProof(PROOF_CASE, "run.seal.target");
    const snapshot = workbenchFor([proof]);
    snapshot.graph.nodes.push(
      graphNode(
        "part-definition",
        PROOF_CASE.target.modelElementId,
        "Display text must not carry identity",
        "syson",
      ),
    );

    const enriched = await enrichThreadWorkbenchWithEngineeringCases(
      snapshot,
      caseReaders({
        mechanicalProof: { read: () => Promise.resolve(proof.captureText) },
      }),
      CASE_CONTEXT,
    );

    const mechanical = enriched.engineeringCases.cases[0];
    assertEquals(mechanical?.family, "mechanical-proof");
    assertEquals(
      mechanical?.family === "mechanical-proof"
        ? mechanical.target?.modelElementId
        : undefined,
      PROOF_CASE.target.modelElementId,
    );
    const link = enriched.graph.edges.find((edge) =>
      edge.relation === "verified_by" &&
      edge.from.kind === "part-definition" &&
      edge.from.id === PROOF_CASE.target.modelElementId &&
      edge.to.kind === "artifact" &&
      edge.to.id === proof.artifact.id
    );
    assertEquals(link?.origin, "structure");
    const distractor = enriched.graph.edges.find((edge) =>
      edge.relation === "verified_by" &&
      edge.from.id !== PROOF_CASE.target.modelElementId
    );
    assertEquals(distractor, undefined);
  },
);

Deno.test(
  "verification case enricher reopens a sensitivity case without treating it as a proof verdict",
  async () => {
    const studyCase = sensitivityStudyCase();
    const caseDigest = (await sha256Fingerprint(studyCase)).digest;
    const capture = {
      schemaVersion: SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA,
      operation: ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
      trustedRunId: "run.sensitivity.seal",
      caseDigest,
      canonicalCaseText: deterministicJson(studyCase),
      studyCase,
      admissionArtifact: {
        id: "geometry",
        fingerprint: {
          algorithm: "sha256" as const,
          digest: "1".repeat(64),
        },
      },
      sealedAt: "2026-08-20T00:00:00.000Z",
    };
    const captureText = deterministicJson(capture);
    const captureDigest = (await sha256Fingerprint(capture)).digest;
    const snapshot = workbenchFor([]);
    const authorityId = `sensitivity-case-${caseDigest}`;
    snapshot.artifacts.push({
      id: authorityId,
      label: "Display text must not carry identity",
      kind: "document",
      system: "digital-thread",
      revision: caseDigest,
      freshness: "fresh",
      fingerprint: `sha256:${captureDigest}`,
      uri: `${SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX}${captureDigest}`,
      producedBy:
        `${ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.id}@${ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.version}`,
      producerRunId: capture.trustedRunId,
      dependsOn: ["geometry"],
    });
    snapshot.graph.nodes.push(
      graphNode(
        "artifact",
        authorityId,
        "Irrelevant presentation",
        "digital-thread",
      ),
    );
    snapshot.graph.edges.push(
      edge("input_to", "artifact", "geometry", "artifact", authorityId),
      edge("input_to", "artifact", authorityId, "artifact", "result"),
    );

    const enriched = await enrichThreadWorkbenchWithEngineeringCases(
      snapshot,
      caseReaders({
        mechanicalProof: { read: () => Promise.resolve(undefined) },
        sensitivityStudy: {
          read: (fingerprint) =>
            Promise.resolve(
              fingerprint.digest === captureDigest ? captureText : undefined,
            ),
        },
      }),
      CASE_CONTEXT,
    );

    assertEquals(enriched.engineeringCases.status, "observed");
    const studyKey = verificationCaseKey("sensitivity-study", caseDigest);
    assertEquals(enriched.engineeringCases.cases, [{
      key: studyKey,
      family: "sensitivity-study",
      caseSchemaVersion: "sensitivity-study-case/3.0",
      id: studyCase.id,
      revision: studyCase.revision,
      scope: studyCase.scope,
      caseDigest,
      authorityArtifactIds: [authorityId],
    }]);
    assertEquals(enriched.engineeringCases.current, [{
      family: "sensitivity-study",
      id: studyCase.id,
      currentCaseKey: studyKey,
      revision: studyCase.revision,
    }]);
    assertEquals(
      nodeByRef(enriched, "artifact:result")?.engineeringCaseRefs,
      [studyKey],
    );
  },
);

Deno.test(
  "verification case enricher reports a corrupt known seal instead of hiding the trace gap",
  async () => {
    const proof = await sealedProof(PROOF_CASE, "run.seal.corrupt");
    const snapshot = workbenchFor([proof]);
    const enriched = await enrichThreadWorkbenchWithEngineeringCases(
      snapshot,
      caseReaders({
        mechanicalProof: { read: () => Promise.resolve("{") },
        sensitivityStudy: { read: () => Promise.resolve(undefined) },
      }),
      CASE_CONTEXT,
    );

    assertEquals(enriched.engineeringCases.status, "unresolved");
    assertEquals(enriched.engineeringCases.cases, []);
    assertEquals(enriched.engineeringCases.current, []);
    assertEquals(enriched.engineeringCases.issues, [{
      family: "mechanical-proof",
      authorityArtifactId: proof.artifact.id,
      status: "error",
      reason: "capture-invalid",
    }]);
    assertEquals(
      enriched.graph.nodes.every((node) => node.engineeringCaseRefs === undefined),
      true,
    );
  },
);

Deno.test(
  "verification case enricher keeps a known seal unresolved when its reader is unavailable",
  async () => {
    const proof = await sealedProof(PROOF_CASE, "run.seal.unavailable");
    const enriched = await enrichThreadWorkbenchWithEngineeringCases(
      workbenchFor([proof]),
      {},
      CASE_CONTEXT,
    );

    assertEquals(enriched.engineeringCases.status, "unresolved");
    assertEquals(enriched.engineeringCases.issues, [{
      family: "mechanical-proof",
      authorityArtifactId: proof.artifact.id,
      status: "unavailable",
      reason: "capture-reader-unavailable",
    }]);
  },
);

Deno.test(
  "engineering case enricher reports a family artifact whose URI is missing as artifact-binding-invalid",
  async () => {
    const proof = await sealedProof(PROOF_CASE, "run.seal.corrupt-uri");
    const snapshot = workbenchFor([proof]);
    const corrupt = snapshot.artifacts.find((artifact) =>
      artifact.id === proof.artifact.id
    )!;
    delete corrupt.uri;

    const enriched = await enrichThreadWorkbenchWithEngineeringCases(
      snapshot,
      caseReaders({
        mechanicalProof: { read: () => Promise.resolve(proof.captureText) },
      }),
      CASE_CONTEXT,
    );

    assertEquals(enriched.engineeringCases.cases, []);
    assertEquals(enriched.engineeringCases.issues, [{
      family: "mechanical-proof",
      authorityArtifactId: proof.artifact.id,
      status: "error",
      reason: "artifact-binding-invalid",
    }]);
  },
);

Deno.test(
  "verification case enricher ignores another document emitted by the proof operation",
  async () => {
    const proof = await sealedProof(PROOF_CASE, "run.seal.with-offer");
    const snapshot = workbenchFor([proof]);
    snapshot.artifacts.push({
      id: `sensitivity-catalog-offer-${"9".repeat(64)}`,
      label: "Sensitivity catalog offer",
      kind: "document",
      system: "digital-thread",
      revision: "8".repeat(64),
      freshness: "fresh",
      fingerprint: `sha256:${"9".repeat(64)}`,
      uri: `casys://sensitivity-catalog-offer-capture/sha256/${"9".repeat(64)}`,
      producedBy: "verify.seal-proof-case@1",
      dependsOn: [proof.artifact.id],
    });
    let reads = 0;
    const enriched = await enrichThreadWorkbenchWithEngineeringCases(
      snapshot,
      caseReaders({
        mechanicalProof: {
          read: () => {
            reads += 1;
            return Promise.resolve(proof.captureText);
          },
        },
        sensitivityStudy: { read: () => Promise.resolve(undefined) },
      }),
      CASE_CONTEXT,
    );

    assertEquals(reads, 1);
    assertEquals(enriched.engineeringCases.status, "observed");
    assertEquals(enriched.engineeringCases.issues, []);
  },
);

Deno.test(
  "verification case enricher reports a case whose canonical id diverges from its exact URI",
  async () => {
    const proof = await sealedProof(PROOF_CASE, "run.seal.bad-id");
    const divergent = {
      ...proof,
      artifact: { ...proof.artifact, id: "tampered-proof-id" },
    };
    const enriched = await enrichThreadWorkbenchWithEngineeringCases(
      workbenchFor([divergent]),
      caseReaders({
        mechanicalProof: { read: () => Promise.resolve(proof.captureText) },
        sensitivityStudy: { read: () => Promise.resolve(undefined) },
      }),
      CASE_CONTEXT,
    );

    assertEquals(enriched.engineeringCases.status, "unresolved");
    assertEquals(enriched.engineeringCases.issues, [{
      family: "mechanical-proof",
      authorityArtifactId: "tampered-proof-id",
      status: "error",
      reason: "case-binding-divergent",
    }]);
  },
);

Deno.test(
  "verification case enricher cross-binds project, authority run, and FEA input runs",
  async () => {
    const proof = await sealedProof(PROOF_CASE, "run.seal.bound");
    const mutations: Array<{
      name: string;
      snapshot: ThreadWorkbenchSnapshot;
      context: { projectId: string };
    }> = [
      {
        name: "foreign project",
        snapshot: workbenchFor([proof]),
        context: { projectId: "another-project" },
      },
      {
        name: "foreign authority run",
        snapshot: (() => {
          const candidate = workbenchFor([proof]);
          candidate.artifacts.find((artifact) => artifact.id === proof.artifact.id)!
            .producerRunId = "run.seal.other";
          return candidate;
        })(),
        context: CASE_CONTEXT,
      },
      {
        name: "foreign input run",
        snapshot: (() => {
          const candidate = workbenchFor([proof]);
          candidate.artifacts.find((artifact) => artifact.id === "geometry")!
            .producerRunId = "run.geometry.other";
          return candidate;
        })(),
        context: CASE_CONTEXT,
      },
    ];

    for (const mutation of mutations) {
      const enriched = await enrichThreadWorkbenchWithEngineeringCases(
        mutation.snapshot,
        caseReaders({
          mechanicalProof: { read: () => Promise.resolve(proof.captureText) },
          sensitivityStudy: { read: () => Promise.resolve(undefined) },
        }),
        mutation.context,
      );
      assertEquals(enriched.engineeringCases.cases, [], mutation.name);
      assertEquals(enriched.engineeringCases.issues, [{
        family: "mechanical-proof",
        authorityArtifactId: proof.artifact.id,
        status: "error",
        reason: "case-binding-divergent",
      }], mutation.name);
    }
  },
);

Deno.test(
  "engineering case enricher reopens printability, print-estimate and DFM seals",
  async () => {
    const printability = await sealedMakeCase({
      family: "printability-check",
      schemaVersion: PRINTABILITY_CASE_CAPTURE_SCHEMA,
      operation: INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION,
      caseObject: printabilityCase(),
      caseField: "printabilityCase",
      artifactPrefix: "printability-case",
      uriPrefix: PRINTABILITY_CASE_CAPTURE_URI_PREFIX,
      trustedRunId: "run.printability.seal",
    });
    const estimate = await sealedMakeCase({
      family: "print-estimate",
      schemaVersion: PRINT_ESTIMATE_CASE_CAPTURE_SCHEMA,
      operation: INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION,
      caseObject: printEstimateCase(),
      caseField: "printEstimateCase",
      artifactPrefix: "print-estimate-case",
      uriPrefix: PRINT_ESTIMATE_CASE_CAPTURE_URI_PREFIX,
      trustedRunId: "run.print-estimate.seal",
    });
    const dfm = await sealedMakeCase({
      family: "dfm-check",
      schemaVersion: DFM_CASE_CAPTURE_SCHEMA,
      operation: INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
      caseObject: dfmCase(),
      caseField: "dfmCase",
      artifactPrefix: "dfm-case",
      uriPrefix: DFM_CASE_CAPTURE_URI_PREFIX,
      trustedRunId: "run.dfm.seal",
    });
    const snapshot = workbenchFor([]);
    const captures = new Map([
      [printability.captureFingerprint, printability.captureText],
      [estimate.captureFingerprint, estimate.captureText],
      [dfm.captureFingerprint, dfm.captureText],
    ]);
    for (const sealed of [printability, estimate, dfm]) {
      snapshot.artifacts.push(sealed.artifact);
      snapshot.graph.nodes.push(
        graphNode(
          "artifact",
          sealed.artifact.id,
          "Irrelevant presentation",
          "digital-thread",
        ),
      );
    }

    const enriched = await enrichThreadWorkbenchWithEngineeringCases(
      snapshot,
      caseReaders({
        printabilityCheck: {
          read: (fingerprint) => Promise.resolve(captures.get(fingerprint.digest)),
        },
        printEstimate: {
          read: (fingerprint) => Promise.resolve(captures.get(fingerprint.digest)),
        },
        dfmCheck: {
          read: (fingerprint) => Promise.resolve(captures.get(fingerprint.digest)),
        },
      }),
      CASE_CONTEXT,
    );

    assertEquals(enriched.engineeringCases.status, "observed");
    assertEquals(enriched.engineeringCases.issues, []);
    assertEquals(
      enriched.engineeringCases.cases.map((item) => item.family),
      ["dfm-check", "print-estimate", "printability-check"],
    );
    assertEquals(
      enriched.engineeringCases.current.map((item) => item.family),
      ["dfm-check", "print-estimate", "printability-check"],
    );
    assertEquals(
      enriched.engineeringCases.current.map((item) => item.revision),
      enriched.engineeringCases.cases.map((item) => item.revision),
    );
    assertEquals(
      enriched.engineeringCases.coverage.map((item) => item.family),
      [
        "mechanical-proof",
        "sensitivity-study",
        "printability-check",
        "print-estimate",
        "dfm-check",
      ],
    );
  },
);

interface SealedProof {
  readonly proofCase: MechanicalProofCase;
  readonly proofDigest: string;
  readonly captureFingerprint: string;
  readonly captureText: string;
  readonly artifact: ThreadArtifact;
}

function proofCaseWith(
  overrides: {
    readonly id?: string;
    readonly revision?: number;
    readonly scope?: string;
    readonly target?: MechanicalProofCase["target"];
  },
): MechanicalProofCase {
  return validateMechanicalProofCase({
    ...PROOF_CASE,
    ...overrides,
  });
}

async function sealedProof(
  proofCase: MechanicalProofCase,
  trustedRunId: string,
): Promise<SealedProof> {
  const proofDigest = (await sha256Fingerprint(proofCase)).digest;
  const capture = {
    schemaVersion: FEA_PROOF_CASE_CAPTURE_SCHEMA,
    operation: VERIFY_SEAL_PROOF_CASE_OPERATION,
    trustedRunId,
    proofDigest,
    canonicalProofText: canonicalProofText(proofCase),
    geometryArtifact: artifactRef("geometry", "1"),
    requirementsArtifact: artifactRef("requirements", "2"),
    stepArtifact: {
      ...artifactRef("step", "3"),
      bytes: 42,
    },
    requirementsElementId: proofCase.requirementsSource.elementId,
    seedIdentity: {
      editingContextId: proofCase.requirementsSource.editingContextId,
      elementId: proofCase.requirementsSource.elementId,
    },
    sealedAt: "2026-08-20T00:00:00.000Z",
  };
  const captureText = deterministicJson(capture);
  const captureFingerprint = (await sha256Fingerprint(capture)).digest;
  return {
    proofCase,
    proofDigest,
    captureFingerprint,
    captureText,
    artifact: {
      id: `fea-proof-${captureFingerprint}`,
      label: "This display label is deliberately irrelevant",
      kind: "document",
      system: "digital-thread",
      revision: proofDigest,
      freshness: "fresh",
      fingerprint: `sha256:${captureFingerprint}`,
      uri: `casys://fea-proof-case-capture/sha256/${captureFingerprint}`,
      producedBy: "verify.seal-proof-case@1",
      producerRunId: trustedRunId,
      dependsOn: ["geometry", "requirements", "step"],
    },
  };
}

function artifactRef(id: string, digit: string) {
  return {
    id,
    fingerprint: { algorithm: "sha256" as const, digest: digit.repeat(64) },
    producerRunId: `run.${id}`,
  };
}

function workbenchFor(proofs: readonly SealedProof[]): ThreadWorkbenchSnapshot {
  const artifacts: ThreadArtifact[] = [
    inputArtifact("geometry", "1"),
    inputArtifact("requirements", "2"),
    inputArtifact("step", "3"),
    ...proofs.map((proof) => proof.artifact),
    {
      id: "result",
      label: "Result",
      kind: "solver-result",
      system: "calculix",
      revision: "1",
      freshness: "fresh",
      fingerprint: `sha256:${"4".repeat(64)}`,
      producerRunId: "run.result",
      dependsOn: proofs.map((proof) => proof.artifact.id),
    },
    inputArtifact("unrelated", "5"),
  ];
  const nodes: ThreadGraphNode[] = [
    ...artifacts.map((artifact) =>
      graphNode("artifact", artifact.id, artifact.label, artifact.system)
    ),
    graphNode("observation", "observation", "Observation", "calculix"),
    graphNode("requirement", "requirement", "Requirement", "digital-thread"),
    graphNode("evaluation", "evaluation", "Evaluation", "digital-thread"),
    graphNode("violation", "violation", "Violation", "digital-thread"),
  ];
  const edges: ThreadGraphEdge[] = [];
  for (const proof of proofs) {
    for (const input of ["geometry", "requirements", "step"]) {
      edges.push(edge("input_to", "artifact", input, "artifact", proof.artifact.id));
    }
    edges.push(edge(
      "input_to",
      "artifact",
      proof.artifact.id,
      "artifact",
      "result",
    ));
  }
  edges.push(
    edge("source_of", "artifact", "result", "observation", "observation"),
    edge("uses", "observation", "observation", "evaluation", "evaluation"),
    edge("evaluates", "requirement", "requirement", "evaluation", "evaluation"),
    edge("caused_by", "evaluation", "evaluation", "violation", "violation"),
  );

  return {
    schemaVersion: "thread-workbench/0.2",
    id: "snapshot",
    subject: {
      id: PROOF_CASE.project.subjectId,
      label: "Subject",
      program: "Test",
    },
    generatedAt: "2026-08-20T00:00:00.000Z",
    source: "observed",
    sourceLabel: "Test",
    change: {
      id: "change",
      title: "Change",
      summary: "Change",
      author: "Test",
      revision: "1",
      changedAt: "2026-08-20T00:00:00.000Z",
      status: "evaluated",
      files: [],
    },
    engineeringCases: unavailableEngineeringCaseCatalog(),
    graph: { nodes, edges },
    evidenceFamilyGraph: {
      schemaVersion: "thread-evidence-family-graph/1.0",
      asOf: { snapshotId: "snapshot", revision: 1 },
      families: [],
      edges: [],
      omittedSelfLoops: [],
      omittedCycleEdges: [],
    },
    flow: [],
    artifacts,
    observations: [],
    requirements: [],
    violations: [],
    actions: [],
  };
}

function inputArtifact(id: string, digit: string): ThreadArtifact {
  return {
    id,
    label: id,
    kind: id === "step" ? "step" : "document",
    system: "digital-thread",
    revision: "1",
    freshness: "fresh",
    fingerprint: `sha256:${digit.repeat(64)}`,
    producerRunId: `run.${id}`,
    dependsOn: [],
  };
}

function graphNode(
  kind: ThreadGraphNode["entityKind"],
  id: string,
  label: string,
  system: string,
): ThreadGraphNode {
  return {
    id: `graph:${kind}:${id}`,
    ref: { kind, id },
    entityKind: kind,
    ...(kind === "artifact" ? { artifactKind: "document" } : {}),
    label,
    system,
    freshness: "fresh",
    summary: label,
  };
}

function edge(
  relation: ThreadGraphEdge["relation"],
  fromKind: ThreadGraphNode["entityKind"],
  fromId: string,
  toKind: ThreadGraphNode["entityKind"],
  toId: string,
): ThreadGraphEdge {
  return {
    id: `${relation}:${fromKind}:${fromId}:${toKind}:${toId}`,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    relation,
    rationale: "Recorded test relation",
    origin: relation === "input_to" || relation === "source_of"
      ? "structure"
      : "provenance",
  };
}

function sensitivityStudyCase(): SensitivityStudyCaseV3 {
  return validateSensitivityStudyCaseV3({
    schemaVersion: "sensitivity-study-case/3.0",
    id: "dl05-arm-thickness-sensitivity",
    revision: 1,
    scope: "mechanical-structural",
    evidenceBoundary: "fea-static",
    project: {
      id: "desk-lamp-dl05",
      subjectId: PROOF_CASE.project.subjectId,
    },
    target: { componentKey: "arm", semanticKey: "arm_thickness" },
    cadSource: {
      artifactUri: "thread-artifact://desk-lamp-dl05/geometry",
      sha256: "1".repeat(64),
    },
    baseValue: { value: 10, unit: "mm" },
    step: { value: 1, unit: "mm" },
    metrics: [{ id: "assembly_max_displacement", unit: "mm" }],
    method: {
      mesh: { kind: "tetrahedral-volume", targetSizeMm: 3 },
      material: {
        model: "isotropic-linear-elastic",
        eMpa: 69_000,
        nu: 0.33,
        basis: "reviewed aluminium declaration",
      },
      supports: [{
        id: "base-fixed",
        kind: "fixed",
        selection: {
          name: "FIXED",
          box: {
            min: [0, 0, 0],
            max: [1, 1, 1],
            unit: "mm",
          },
        },
      }],
      loads: [{
        id: "tip-load",
        kind: "force",
        selection: {
          name: "LOADED",
          box: {
            min: [10, 10, 10],
            max: [11, 11, 11],
            unit: "mm",
          },
        },
        force: { value: [0, 0, -10], unit: "N" },
      }],
    },
    domain: {
      approximationOrder: "first-order-forward",
      remeshingVariationIncluded: true,
      localValidityNote: "Valid for arm_thickness in [10, 11] mm.",
      limitations: ["Local study only."],
    },
  });
}

function currentIssue(authorityArtifactId: string) {
  return {
    family: "mechanical-proof" as const,
    authorityArtifactId,
    status: "error" as const,
    reason: "case-current-divergent" as const,
  };
}

function nodeByRef(
  snapshot: ThreadWorkbenchSnapshot,
  reference: string,
): ThreadGraphNode | undefined {
  return snapshot.graph.nodes.find((node) =>
    `${node.ref.kind}:${node.ref.id}` === reference
  );
}

async function sealedMakeCase(input: {
  readonly family: "printability-check" | "print-estimate" | "dfm-check";
  readonly schemaVersion: string;
  readonly operation: { readonly id: string; readonly version: string };
  readonly caseObject: unknown;
  readonly caseField: "printabilityCase" | "printEstimateCase" | "dfmCase";
  readonly artifactPrefix: string;
  readonly uriPrefix: string;
  readonly trustedRunId: string;
}): Promise<{
  readonly captureFingerprint: string;
  readonly captureText: string;
  readonly artifact: ThreadArtifact;
}> {
  const caseDigest = (await sha256Fingerprint(input.caseObject)).digest;
  const capture = {
    schemaVersion: input.schemaVersion,
    operation: input.operation,
    trustedRunId: input.trustedRunId,
    caseDigest,
    canonicalCaseText: deterministicJson(input.caseObject),
    [input.caseField]: input.caseObject,
    sealedAt: "2026-08-20T00:00:00.000Z",
  };
  const captureText = deterministicJson(capture);
  const captureFingerprint = (await sha256Fingerprint(capture)).digest;
  return {
    captureFingerprint,
    captureText,
    artifact: {
      id: `${input.artifactPrefix}-${caseDigest}`,
      label: "Display text must not carry identity",
      kind: "document",
      system: "digital-thread",
      revision: caseDigest,
      freshness: "fresh",
      fingerprint: `sha256:${captureFingerprint}`,
      uri: `${input.uriPrefix}${captureFingerprint}`,
      producedBy: `${input.operation.id}@${input.operation.version}`,
      producerRunId: input.trustedRunId,
      dependsOn: [],
    },
  };
}

function printabilityCase() {
  return validatePrintabilityCheckCase({
    schemaVersion: "printability-check-case/1.0",
    id: "generic-product-v1-support-bracket-fdm-v1",
    revision: 2,
    scope: "FDM printability check for the isolated support bracket.",
    evidenceBoundary: "Observations only; not a verdict or certification.",
    project: {
      id: PROOF_CASE.project.id,
      subjectId: PROOF_CASE.project.subjectId,
    },
    target: { componentKey: "support-bracket" },
    thresholds: {
      minWallThicknessMm: { value: 1.2, unit: "mm" },
      maxOverhangAngleDeg: { value: 45.0, unit: "deg" },
      maxUnsupportedAreaMm2: { value: 600.0, unit: "mm2" },
    },
    meshSizeMm: { value: 2.0, unit: "mm" },
    buildDirection: [0, 0, 1],
    provider: {
      build123dTool: "build123d_export",
      thicknessTool: "dfm_check_min_thickness",
      overhangTool: "dfm_check_overhangs",
    },
    limitations: [
      "Thresholds are provisional FDM candidate values, not confirmed manufacturer data.",
    ],
    provenance: {
      status: "provisional",
      note: "Thresholds sourced from typical FDM desktop-printer guidelines.",
    },
  });
}

function printEstimateCase() {
  return validatePrintEstimateCase({
    schemaVersion: "print-estimate-case/1.0",
    id: "reviewed-fff-estimate-v1",
    revision: 1,
    scope: "FFF print-time-and-material estimate for the isolated component.",
    evidenceBoundary: "Observations only; not a cost quote, verdict, or certification.",
    project: {
      id: PROOF_CASE.project.id,
      subjectId: PROOF_CASE.project.subjectId,
    },
    target: { componentKey: "support-bracket" },
    profile: {
      repoPath: "config/print-estimate-cases/reviewed-fff-0.2-pla.ini",
      exportName: "reviewed-fff-0.2-pla",
      sha256: "a".repeat(64),
      layerHeightMm: { value: 0.2, unit: "mm" },
      nozzleDiameterMm: { value: 0.4, unit: "mm" },
      material: "PLA",
    },
    provider: {
      build123dTool: "build123d_export",
      prusaslicerTool: "prusaslicer_estimate_fff",
    },
    limitations: ["Profile parameters are provisional engineering candidates."],
    provenance: {
      status: "provisional",
      note: "Profile parameters are reviewed candidates, not supplier data.",
    },
  });
}

function dfmCase() {
  return validateDfmCheckCase({
    schemaVersion: "dfm-check-case/1.0",
    id: "generic-product-v1-support-bracket-dfm-v1",
    revision: 1,
    scope: "Measured DFM checks for the isolated support bracket.",
    evidenceBoundary:
      "Measured provider verdicts against the sealed case; a fail is a named violation, not a certification.",
    project: {
      id: PROOF_CASE.project.id,
      subjectId: PROOF_CASE.project.subjectId,
    },
    target: {
      componentKey: "support-bracket",
      artifactUri: "thread-artifact://generic-product-v1/geometry-step-support-bracket",
      sha256: "a".repeat(64),
      mediaType: "model/step",
    },
    buildVolumeMm: {
      x: { value: 250, unit: "mm" },
      y: { value: 210, unit: "mm" },
      z: { value: 200, unit: "mm" },
    },
    minThicknessMm: { value: 2, unit: "mm" },
    maxOverhangAngleDeg: { value: 45, unit: "deg" },
    meshSizeMm: { value: 2, unit: "mm" },
    buildDirection: [0, 0, 1],
    zMinFilter: {
      enabled: true,
      planeZMm: { value: -3, unit: "mm" },
      toleranceMm: { value: 0.1, unit: "mm" },
    },
    provider: {
      envelopeTool: "dfm_check_envelope",
      thicknessTool: "dfm_check_min_thickness",
      overhangTool: "dfm_check_overhangs",
    },
    limitations: ["Measured DFM is not a certification."],
    provenance: {
      status: "provisional",
      note: "Thresholds are reviewed candidates, not supplier data.",
    },
  });
}
