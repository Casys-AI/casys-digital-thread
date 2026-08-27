import type {
  ContentFingerprint,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../domain/thread/thread-snapshot-validation.ts";

export interface AttestedMechanicalRun {
  schemaVersion: "attested-mechanical-run/1.0";
  capturedAt: string;
  source: string;
  subject: string;
  providers: {
    build123d: ProviderCapture;
    calculix: ProviderCapture;
  };
  cad: {
    tool: string;
    artifact: {
      format: "step";
      path: string;
      bytes: number;
      sha256: string;
    };
    metrics: {
      volume_mm3: number;
      area_mm2: number;
      density_kg_m3: number;
      mass_kg: number;
    };
  };
  fea: {
    tool: string;
    expectedStepSha256: string;
    inputArtifact: {
      path: string;
      sourcePath: string;
      sha256: string;
      bytes: number;
    };
    metrics: {
      maxDisplacement: { value: number; unit: string; nodeId: number };
      maxVonMises: { value: number; unit: string; elementId: number };
    };
  };
  artifactAttestation: {
    status: "verified";
    producerSha256: string;
    consumerSha256: string;
    equal: true;
  };
  negativeControl: {
    expectedSha256: string;
    status: "rejected-before-solve";
    message: string;
  };
  limitations: string[];
}

interface ProviderCapture {
  endpoint: string;
  sourceRevision: string;
  dirty: boolean;
  containerId: string;
}

export interface AttestedMechanicalMaterializationOptions {
  sourceUri?: string;
}

/**
 * Test fixture: convert one captured bracket proof into a canonical snapshot.
 * It performs no computation and never manufactures a requirement.
 */
export async function materializeAttestedMechanicalRun(
  value: unknown,
  options: AttestedMechanicalMaterializationOptions = {},
): Promise<ThreadSnapshot> {
  const capture = parseAttestedMechanicalRun(value);
  const stepFingerprint = fingerprint(capture.cad.artifact.sha256);
  const feaFingerprint = fingerprint(await sha256(canonicalJson(capture.fea)));
  const stamp = compactTimestamp(capture.capturedAt);
  const cadOperation: ThreadOperationRef = {
    serverId: "build123d",
    tool: capture.cad.tool,
    runId: `observed-${stamp}-${
      capture.providers.build123d.sourceRevision.slice(0, 12)
    }`,
  };
  const feaOperation: ThreadOperationRef = {
    serverId: "calculix",
    tool: capture.fea.tool,
    runId: `observed-${stamp}-${
      capture.providers.calculix.sourceRevision.slice(0, 12)
    }`,
  };
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capture.capturedAt,
    invalidatedByChangeIds: [],
  };
  const stepId = `step-support-bracket-${capture.cad.artifact.sha256.slice(0, 12)}`;
  const feaId = `calculix-evidence-${feaFingerprint.digest.slice(0, 12)}`;
  const changeId = `capture-attested-run-${stamp}`;
  const sourceUri = options.sourceUri ??
    "state/local/attested-mechanical-run.json";

  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: `attested-support-${stamp}`,
    revision: 1,
    generatedAt: capture.capturedAt,
    subject: {
      id: "attested-support-bracket",
      name: capture.subject,
      kind: "part",
      version: capture.cad.artifact.sha256.slice(0, 12),
      modelArtifactId: stepId,
    },
    freshness,
    changeSet: {
      id: `capture-${stamp}`,
      name: "Import attested local mechanical evidence",
      status: "applied",
      createdAt: capture.capturedAt,
      appliedAt: capture.capturedAt,
      changes: [{
        id: changeId,
        kind: "created",
        target: { kind: "artifact", id: stepId },
        summary:
          "Captured a content-addressed STEP export and its verified CalculiX consumption.",
        afterFingerprint: stepFingerprint,
      }],
    },
    artifacts: [
      {
        id: stepId,
        name: "Generic product support bracket STEP",
        kind: "step",
        version: capture.cad.artifact.sha256.slice(0, 12),
        fingerprint: stepFingerprint,
        uri: capture.cad.artifact.path,
        mediaType: "model/step",
        producer: cadOperation,
        inputArtifactIds: [],
        freshness,
      },
      {
        id: feaId,
        name: "Captured CalculiX static result",
        kind: "evidence",
        version: feaFingerprint.digest.slice(0, 12),
        fingerprint: feaFingerprint,
        uri: `${sourceUri}#fea`,
        mediaType: "application/json",
        producer: feaOperation,
        inputArtifactIds: [stepId],
        freshness,
      },
    ],
    consumptions: [{
      id: `consume-${stepId}-by-${feaId}`,
      artifactId: stepId,
      consumer: feaOperation,
      observedFingerprint: fingerprint(capture.fea.inputArtifact.sha256),
      verifiedAt: capture.capturedAt,
      status: "verified",
    }],
    observations: [
      observation(
        "obs-support-mass",
        "Support bracket mass",
        "mass",
        capture.cad.metrics.mass_kg,
        "kg",
        cadOperation,
        stepId,
        capture.capturedAt,
        freshness,
      ),
      observation(
        "obs-max-displacement",
        "Maximum displacement",
        "max_displacement",
        capture.fea.metrics.maxDisplacement.value,
        capture.fea.metrics.maxDisplacement.unit,
        feaOperation,
        feaId,
        capture.capturedAt,
        freshness,
      ),
      observation(
        "obs-max-von-mises",
        "Maximum von Mises stress",
        "max_von_mises_stress",
        capture.fea.metrics.maxVonMises.value,
        capture.fea.metrics.maxVonMises.unit,
        feaOperation,
        feaId,
        capture.capturedAt,
        freshness,
      ),
    ],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      {
        id: `link-${changeId}-${stepId}`,
        relation: "changes",
        from: { kind: "change", id: changeId },
        to: { kind: "artifact", id: stepId },
        rationale: "The capture records this exact STEP fingerprint.",
      },
      {
        id: `link-consume-${stepId}`,
        relation: "uses",
        from: { kind: "consumption", id: `consume-${stepId}-by-${feaId}` },
        to: { kind: "artifact", id: stepId },
        rationale: "CalculiX independently observed the producer STEP fingerprint.",
      },
      {
        id: `link-${feaId}-${stepId}`,
        relation: "derived_from",
        from: { kind: "artifact", id: feaId },
        to: { kind: "artifact", id: stepId },
        rationale: "The static result was produced from the attested STEP bytes.",
      },
      derivedObservation("obs-support-mass", stepId),
      derivedObservation("obs-max-displacement", feaId),
      derivedObservation("obs-max-von-mises", feaId),
    ],
    proposedActions: [{
      id: "define-mechanical-verification-basis",
      name: "Define the mechanical verification basis in SysON",
      kind: "review",
      readiness: "blocked",
      rationale:
        "The observed stress and displacement need a model-owned criterion before they can produce a product verdict.",
      targets: [{ kind: "observation", id: "obs-max-von-mises" }],
      addressesViolationIds: [],
      dependsOnActionIds: [],
      blockedReason:
        "No mechanical ConstraintUsage with an approved limit is present in the generic product model.",
    }],
  });
}

export function parseAttestedMechanicalRun(value: unknown): AttestedMechanicalRun {
  const root = object(value, "$"), providers = object(root.providers, "$.providers");
  const cad = object(root.cad, "$.cad"),
    artifact = object(cad.artifact, "$.cad.artifact");
  const cadMetrics = object(cad.metrics, "$.cad.metrics");
  const fea = object(root.fea, "$.fea"),
    input = object(fea.inputArtifact, "$.fea.inputArtifact");
  const metrics = object(fea.metrics, "$.fea.metrics");
  const displacement = object(metrics.maxDisplacement, "$.fea.metrics.maxDisplacement");
  const stress = object(metrics.maxVonMises, "$.fea.metrics.maxVonMises");
  const attestation = object(root.artifactAttestation, "$.artifactAttestation");
  const negative = object(root.negativeControl, "$.negativeControl");
  const capturedAt = isoDate(root.capturedAt, "$.capturedAt");
  const cadSha = sha(
    string(artifact.sha256, "$.cad.artifact.sha256"),
    "$.cad.artifact.sha256",
  );
  const inputSha = sha(
    string(input.sha256, "$.fea.inputArtifact.sha256"),
    "$.fea.inputArtifact.sha256",
  );
  const expectedSha = sha(
    string(fea.expectedStepSha256, "$.fea.expectedStepSha256"),
    "$.fea.expectedStepSha256",
  );
  const producerSha = sha(
    string(attestation.producerSha256, "$.artifactAttestation.producerSha256"),
    "$.artifactAttestation.producerSha256",
  );
  const consumerSha = sha(
    string(attestation.consumerSha256, "$.artifactAttestation.consumerSha256"),
    "$.artifactAttestation.consumerSha256",
  );
  if (new Set([cadSha, inputSha, expectedSha, producerSha, consumerSha]).size !== 1) {
    throw new Error(
      "Attested mechanical run does not prove one identical STEP fingerprint.",
    );
  }
  exact(attestation.status, "verified", "$.artifactAttestation.status");
  exact(attestation.equal, true, "$.artifactAttestation.equal");
  exact(negative.status, "rejected-before-solve", "$.negativeControl.status");
  const negativeSha = sha(
    string(negative.expectedSha256, "$.negativeControl.expectedSha256"),
    "$.negativeControl.expectedSha256",
  );
  if (negativeSha === cadSha) {
    throw new Error("Negative control must use a different STEP fingerprint.");
  }
  exact(artifact.format, "step", "$.cad.artifact.format");
  exact(root.schemaVersion, "attested-mechanical-run/1.0", "$.schemaVersion");

  return {
    schemaVersion: "attested-mechanical-run/1.0",
    capturedAt,
    source: string(root.source, "$.source"),
    subject: string(root.subject, "$.subject"),
    providers: {
      build123d: provider(providers.build123d, "$.providers.build123d"),
      calculix: provider(providers.calculix, "$.providers.calculix"),
    },
    cad: {
      tool: string(cad.tool, "$.cad.tool"),
      artifact: {
        format: "step",
        path: string(artifact.path, "$.cad.artifact.path"),
        bytes: positiveInteger(artifact.bytes, "$.cad.artifact.bytes"),
        sha256: cadSha,
      },
      metrics: {
        volume_mm3: finite(cadMetrics.volume_mm3, "$.cad.metrics.volume_mm3"),
        area_mm2: finite(cadMetrics.area_mm2, "$.cad.metrics.area_mm2"),
        density_kg_m3: finite(cadMetrics.density_kg_m3, "$.cad.metrics.density_kg_m3"),
        mass_kg: finite(cadMetrics.mass_kg, "$.cad.metrics.mass_kg"),
      },
    },
    fea: {
      tool: string(fea.tool, "$.fea.tool"),
      expectedStepSha256: expectedSha,
      inputArtifact: {
        path: string(input.path, "$.fea.inputArtifact.path"),
        sourcePath: string(input.sourcePath, "$.fea.inputArtifact.sourcePath"),
        sha256: inputSha,
        bytes: positiveInteger(input.bytes, "$.fea.inputArtifact.bytes"),
      },
      metrics: {
        maxDisplacement: {
          value: finite(displacement.value, "$.fea.metrics.maxDisplacement.value"),
          unit: string(displacement.unit, "$.fea.metrics.maxDisplacement.unit"),
          nodeId: positiveInteger(
            displacement.nodeId,
            "$.fea.metrics.maxDisplacement.nodeId",
          ),
        },
        maxVonMises: {
          value: finite(stress.value, "$.fea.metrics.maxVonMises.value"),
          unit: string(stress.unit, "$.fea.metrics.maxVonMises.unit"),
          elementId: positiveInteger(
            stress.elementId,
            "$.fea.metrics.maxVonMises.elementId",
          ),
        },
      },
    },
    artifactAttestation: {
      status: "verified",
      producerSha256: producerSha,
      consumerSha256: consumerSha,
      equal: true,
    },
    negativeControl: {
      expectedSha256: negativeSha,
      status: "rejected-before-solve",
      message: string(negative.message, "$.negativeControl.message"),
    },
    limitations: strings(root.limitations, "$.limitations"),
  };
}

function observation(
  id: string,
  name: string,
  metric: string,
  value: number,
  unit: string,
  operation: ThreadOperationRef,
  artifactId: string,
  capturedAt: string,
  freshness: ThreadFreshness,
) {
  return {
    id,
    name,
    metric,
    quantity: { value, unit },
    source: { operation, artifactIds: [artifactId], capturedAt },
    freshness,
  };
}

function derivedObservation(observationId: string, artifactId: string) {
  return {
    id: `link-${observationId}-${artifactId}`,
    relation: "derived_from" as const,
    from: { kind: "observation" as const, id: observationId },
    to: { kind: "artifact" as const, id: artifactId },
    rationale: "The observation was read from this captured artifact.",
  };
}

function provider(value: unknown, path: string): ProviderCapture {
  const input = object(value, path);
  return {
    endpoint: string(input.endpoint, `${path}.endpoint`),
    sourceRevision: string(input.sourceRevision, `${path}.sourceRevision`),
    dirty: boolean(input.dirty, `${path}.dirty`),
    containerId: string(input.containerId, `${path}.containerId`),
  };
}

function fingerprint(digest: string): ContentFingerprint {
  return { algorithm: "sha256", digest };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return `{${
      Object.keys(input).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(input[key])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function compactTimestamp(value: string): string {
  return value.replace(/[-:.]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean.`);
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  const result = finite(value, path);
  if (!Number.isInteger(result) || result <= 0) {
    throw new Error(`${path} must be a positive integer.`);
  }
  return result;
}

function strings(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value.map((item, index) => string(item, `${path}[${index}]`));
}

function isoDate(value: unknown, path: string): string {
  const result = string(value, path);
  if (Number.isNaN(Date.parse(result))) throw new Error(`${path} must be ISO-8601.`);
  return result;
}

function sha(value: string, path: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${path} must be SHA-256 hex.`);
  return value;
}

function exact(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) throw new Error(`${path} must equal ${String(expected)}.`);
}
