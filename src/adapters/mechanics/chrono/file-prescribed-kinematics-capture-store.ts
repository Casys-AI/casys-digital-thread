/**
 * The prescribed-kinematics vertical owns these five immutable CAS lanes.
 * They are deliberately not a generic document framework: every read invokes
 * the corresponding domain validator before returning a value.
 */

import type {
  PrescribedKinematicsCaptureRef,
  PrescribedKinematicsCaptureStore,
  PrescribedKinematicsObservationCapture,
} from "../../../application/ports/out/mechanics/prescribed-kinematics-capture-store.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  exactRecord,
  exactVersionToken,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  type PrescribedKinematicsEvaluationCloseoutCandidate,
  validatePrescribedKinematicsEvaluationCloseoutCandidate,
} from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-evaluation-closeout.ts";
import {
  type PrescribedKinematicsEvaluation,
  validatePrescribedKinematicsEvaluation,
} from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-evaluation.ts";
import {
  type PrescribedKinematicsMethodSheet,
  validatePrescribedKinematicsMethodSheet,
} from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-method-sheet.ts";
import {
  parsePrescribedKinematicsObservation,
} from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-observation.ts";
import {
  type PrescribedKinematicsCase,
  validatePrescribedKinematicsCase,
} from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-source-closure.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import {
  parseChronoPrescribedKinematicsReceipt,
  parseChronoPrescribedKinematicsRequestReference,
} from "./chrono-prescribed-kinematics-receipt.ts";
import {
  validateCapabilityRuntimeLaunchGroupReference,
} from "../../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type {
  PrescribedKinematicsRuntimeProvenance,
} from "../../../application/ports/in/mechanics/prescribed-kinematics/run-prescribed-kinematics-observation.ts";

type Kind =
  | "prescribed-kinematics-case"
  | "prescribed-kinematics-observation"
  | "prescribed-kinematics-method"
  | "prescribed-kinematics-evaluation"
  | "prescribed-kinematics-closeout";

export class FilePrescribedKinematicsCaptureStore
  implements PrescribedKinematicsCaptureStore {
  readonly #stores: { readonly [K in Kind]: FileByteStore<K> };

  constructor(directory = "state/local/mechanics/prescribed-kinematics/captures") {
    this.#stores = {
      "prescribed-kinematics-case": store(
        "prescribed-kinematics-case",
        directory,
        "case",
      ),
      "prescribed-kinematics-observation": store(
        "prescribed-kinematics-observation",
        directory,
        "observation",
      ),
      "prescribed-kinematics-method": store(
        "prescribed-kinematics-method",
        directory,
        "method",
      ),
      "prescribed-kinematics-evaluation": store(
        "prescribed-kinematics-evaluation",
        directory,
        "evaluation",
      ),
      "prescribed-kinematics-closeout": store(
        "prescribed-kinematics-closeout",
        directory,
        "closeout",
      ),
    };
  }

  saveCase(value: PrescribedKinematicsCase): Promise<PrescribedKinematicsCaptureRef> {
    return this.#save(
      "prescribed-kinematics-case",
      value,
      validatePrescribedKinematicsCase,
    );
  }
  readCase(
    fingerprint: ContentFingerprint,
  ): Promise<PrescribedKinematicsCase | undefined> {
    return this.#read(
      "prescribed-kinematics-case",
      fingerprint,
      validatePrescribedKinematicsCase,
    );
  }
  saveObservation(
    value: PrescribedKinematicsObservationCapture,
    sealedCase: PrescribedKinematicsCase,
  ): Promise<PrescribedKinematicsCaptureRef> {
    return this.#save(
      "prescribed-kinematics-observation",
      value,
      (raw) => validateObservationCapture(raw, sealedCase),
    );
  }
  async readObservation(
    fingerprint: ContentFingerprint,
    sealedCase: PrescribedKinematicsCase,
  ): Promise<PrescribedKinematicsObservationCapture | undefined> {
    const capture = await this.#read(
      "prescribed-kinematics-observation",
      fingerprint,
      (raw) => Promise.resolve(raw),
    );
    if (!capture) return undefined;
    return await validateObservationCapture(capture, sealedCase);
  }
  saveMethod(
    value: PrescribedKinematicsMethodSheet,
  ): Promise<PrescribedKinematicsCaptureRef> {
    return this.#save(
      "prescribed-kinematics-method",
      value,
      validatePrescribedKinematicsMethodSheet,
    );
  }
  readMethod(
    fingerprint: ContentFingerprint,
  ): Promise<PrescribedKinematicsMethodSheet | undefined> {
    return this.#read(
      "prescribed-kinematics-method",
      fingerprint,
      validatePrescribedKinematicsMethodSheet,
    );
  }
  saveEvaluation(
    value: PrescribedKinematicsEvaluation,
  ): Promise<PrescribedKinematicsCaptureRef> {
    return this.#save(
      "prescribed-kinematics-evaluation",
      value,
      validatePrescribedKinematicsEvaluation,
    );
  }
  readEvaluation(
    fingerprint: ContentFingerprint,
  ): Promise<PrescribedKinematicsEvaluation | undefined> {
    return this.#read(
      "prescribed-kinematics-evaluation",
      fingerprint,
      validatePrescribedKinematicsEvaluation,
    );
  }
  saveCloseout(
    value: PrescribedKinematicsEvaluationCloseoutCandidate,
  ): Promise<PrescribedKinematicsCaptureRef> {
    return this.#save(
      "prescribed-kinematics-closeout",
      value,
      validatePrescribedKinematicsEvaluationCloseoutCandidate,
    );
  }
  readCloseout(
    fingerprint: ContentFingerprint,
  ): Promise<PrescribedKinematicsEvaluationCloseoutCandidate | undefined> {
    return this.#read(
      "prescribed-kinematics-closeout",
      fingerprint,
      validatePrescribedKinematicsEvaluationCloseoutCandidate,
    );
  }

  async #save<T>(
    kind: Kind,
    value: T,
    validate: (value: unknown) => Promise<T>,
  ): Promise<PrescribedKinematicsCaptureRef> {
    const validated = await validate(value);
    const bytes = new TextEncoder().encode(deterministicJson(validated));
    const fingerprint = await captureFingerprint(bytes);
    const receipt = await this.#stores[kind].save(fingerprint, bytes);
    return Object.freeze({ fingerprint: receipt.fingerprint, uri: receipt.uri });
  }

  async #read<T>(
    kind: Kind,
    fingerprintValue: ContentFingerprint,
    validate: (value: unknown) => Promise<T>,
  ): Promise<T | undefined> {
    const bytes = await this.#stores[kind].read(fingerprintValue);
    if (!bytes) return undefined;
    const copy = bytes.copy();
    if ((await fingerprintResourceBytes(copy)) !== fingerprintValue.digest) {
      throw new TypeError(
        "The prescribed-kinematics CAS object fingerprint diverged on readback.",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(copy));
    } catch {
      throw new TypeError(
        "The prescribed-kinematics CAS object is not valid UTF-8 JSON.",
      );
    }
    const validated = await validate(parsed);
    if (
      deterministicJson(validated) !==
        new TextDecoder("utf-8", { fatal: true }).decode(copy)
    ) {
      throw new TypeError("The prescribed-kinematics CAS object is not canonical.");
    }
    return validated;
  }
}

function store<K extends Kind>(
  kind: K,
  directory: string,
  lane: string,
): FileByteStore<K> {
  return new FileByteStore({
    kind,
    directory: `${directory.replace(/\/+$/, "")}/${lane}`,
    uriNamespace: kind,
    label: `Prescribed-kinematics ${lane} capture`,
  });
}

async function captureFingerprint(bytes: Uint8Array): Promise<ContentFingerprint> {
  return Object.freeze({
    algorithm: "sha256",
    digest: await fingerprintResourceBytes(bytes),
  });
}

async function validateObservationCapture(
  value: unknown,
  sealedCase: PrescribedKinematicsCase,
): Promise<PrescribedKinematicsObservationCapture> {
  const root = exactRecord(value, [
    "schemaVersion",
    "observation",
    "request",
    "receipt",
    "providerNotEvaluated",
    "digitalThreadLimits",
    "lowering",
    "runtime",
  ], "$prescribedKinematicsObservationCapture");
  if (
    root.schemaVersion !== "prescribed-kinematics-observation-capture/4.0" ||
    !Array.isArray(root.providerNotEvaluated)
  ) throw new TypeError("The prescribed-kinematics L3 capture is malformed.");
  const observation = await parsePrescribedKinematicsObservation(
    root.observation,
    sealedCase,
  );
  const literal = [
    "collision",
    "clearance",
    "contact",
    "forces",
    "torques",
    "dynamics",
    "strength",
    "safety",
    "product fitness",
  ] as const;
  if (JSON.stringify(root.providerNotEvaluated) !== JSON.stringify(literal)) {
    throw new TypeError(
      "The prescribed-kinematics L3 capture lost the literal provider not_evaluated boundary.",
    );
  }
  if (
    deterministicJson(root.digitalThreadLimits) !==
      deterministicJson(observation.limits)
  ) {
    throw new TypeError(
      "The prescribed-kinematics L3 capture lost its code-owned Digital Thread coverage limit.",
    );
  }
  const loweringRecord = exactRecord(
    root.lowering,
    ["sourceFingerprint", "loweringFingerprint", "requestFingerprint"],
    "$prescribedKinematicsObservationCapture.lowering",
  );
  const lowering = Object.freeze({
    sourceFingerprint: fingerprint(
      loweringRecord.sourceFingerprint,
      "$prescribedKinematicsObservationCapture.lowering.sourceFingerprint",
    ),
    loweringFingerprint: fingerprint(
      loweringRecord.loweringFingerprint,
      "$prescribedKinematicsObservationCapture.lowering.loweringFingerprint",
    ),
    requestFingerprint: fingerprint(
      loweringRecord.requestFingerprint,
      "$prescribedKinematicsObservationCapture.lowering.requestFingerprint",
    ),
  });
  if (
    !fingerprintsEqual(
      lowering.sourceFingerprint,
      sealedCase.sourceClosure.workspace.root.resourceFingerprint,
    )
  ) {
    throw new TypeError(
      "The prescribed-kinematics L3 capture lowering does not bind the sealed source resource.",
    );
  }
  const receipt = parseChronoPrescribedKinematicsReceipt(
    root.receipt,
    "$prescribedKinematicsObservationCapture.receipt",
  );
  const request = parseChronoPrescribedKinematicsRequestReference(
    root.request,
    "$prescribedKinematicsObservationCapture.request",
  );
  const runtime = parseRuntime(root.runtime);
  if (
    request.caseSha256 !== lowering.requestFingerprint.digest ||
    receipt.caseSha256 !== request.caseSha256 ||
    receipt.requestId !== request.requestId
  ) {
    throw new TypeError(
      "The prescribed-kinematics L3 receipt does not bind its exact request and lowered request fingerprint.",
    );
  }
  return Object.freeze({
    schemaVersion: "prescribed-kinematics-observation-capture/4.0",
    observation,
    request,
    receipt,
    providerNotEvaluated: literal,
    digitalThreadLimits: observation.limits,
    lowering,
    runtime,
  });
}

function parseRuntime(value: unknown): PrescribedKinematicsRuntimeProvenance {
  const root = exactRecord(value, [
    "resolvedOperationPlanFingerprint",
    "operationalCapabilityFingerprint",
    "binding",
    "adapter",
    "profile",
    "material",
    "launchGroup",
    "platformMode",
  ], "$prescribedKinematicsObservationCapture.runtime");
  const binding = exactRecord(
    root.binding,
    ["id", "version"],
    "$prescribedKinematicsObservationCapture.runtime.binding",
  );
  const adapter = exactRecord(
    root.adapter,
    ["id", "version", "source"],
    "$prescribedKinematicsObservationCapture.runtime.adapter",
  );
  const profile = root.profile === null ? null : exactRecord(
    root.profile,
    ["id", "version", "fingerprint"],
    "$prescribedKinematicsObservationCapture.runtime.profile",
  );
  const material = exactRecord(
    root.material,
    ["unitId", "materialId", "imageDigest"],
    "$prescribedKinematicsObservationCapture.runtime.material",
  );
  if (
    root.platformMode !== "native" && root.platformMode !== "emulated" &&
    root.platformMode !== "unavailable"
  ) {
    throw new TypeError(
      "The prescribed-kinematics L3 runtime platform mode is invalid.",
    );
  }
  return Object.freeze({
    resolvedOperationPlanFingerprint: fingerprint(
      root.resolvedOperationPlanFingerprint,
      "$prescribedKinematicsObservationCapture.runtime.resolvedOperationPlanFingerprint",
    ),
    operationalCapabilityFingerprint: fingerprint(
      root.operationalCapabilityFingerprint,
      "$prescribedKinematicsObservationCapture.runtime.operationalCapabilityFingerprint",
    ),
    binding: {
      id: safeId(
        binding.id,
        "$prescribedKinematicsObservationCapture.runtime.binding.id",
      ),
      version: exactVersionToken(
        binding.version,
        "$prescribedKinematicsObservationCapture.runtime.binding.version",
      ),
    },
    adapter: {
      id: safeId(
        adapter.id,
        "$prescribedKinematicsObservationCapture.runtime.adapter.id",
      ),
      version: exactVersionToken(
        adapter.version,
        "$prescribedKinematicsObservationCapture.runtime.adapter.version",
      ),
      source: sourceText(
        adapter.source,
        "$prescribedKinematicsObservationCapture.runtime.adapter.source",
      ),
    },
    profile: profile === null ? null : {
      id: safeId(
        profile.id,
        "$prescribedKinematicsObservationCapture.runtime.profile.id",
      ),
      version: exactVersionToken(
        profile.version,
        "$prescribedKinematicsObservationCapture.runtime.profile.version",
      ),
      fingerprint: profile.fingerprint === null ? null : fingerprint(
        profile.fingerprint,
        "$prescribedKinematicsObservationCapture.runtime.profile.fingerprint",
      ),
    },
    material: {
      unitId: safeId(
        material.unitId,
        "$prescribedKinematicsObservationCapture.runtime.material.unitId",
      ),
      materialId: safeId(
        material.materialId,
        "$prescribedKinematicsObservationCapture.runtime.material.materialId",
      ),
      imageDigest: digest(
        material.imageDigest,
        "$prescribedKinematicsObservationCapture.runtime.material.imageDigest",
      ),
    },
    launchGroup: validateCapabilityRuntimeLaunchGroupReference(
      root.launchGroup,
      "$prescribedKinematicsObservationCapture.runtime.launchGroup",
    ),
    platformMode: root.platformMode,
  });
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  if (
    root.algorithm !== "sha256" || typeof root.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(root.digest)
  ) {
    throw new TypeError(`${path} must be a lower-case SHA-256 fingerprint.`);
  }
  return Object.freeze({ algorithm: "sha256", digest: root.digest });
}

function digest(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${path} must be a lower-case SHA-256 digest.`);
  }
  return value;
}

function sourceText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new TypeError(`${path} must be non-empty text.`);
  }
  return value;
}
