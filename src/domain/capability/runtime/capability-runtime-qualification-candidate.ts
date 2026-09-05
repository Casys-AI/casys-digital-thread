/**
 * Code-owned contract for one local runtime qualification probe.
 *
 * A candidate binds a semantic capability to one exact local material, host
 * platform and deterministic fixture. It is not a project authorization,
 * provider request, engineering method, result, or agent-facing selection.
 */

import {
  deepFreeze,
  exactRecord,
  exactVersionToken,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  fingerprintPrescribedKinematicsCaseSource,
  type PrescribedKinematicsCaseSource,
  validatePrescribedKinematicsCaseSource,
} from "../../mechanism/prescribed-kinematics/prescribed-kinematics-case-source.ts";
import {
  type CapabilityRuntimeLaunchGroupReference,
  validateCapabilityRuntimeLaunchGroupReference,
} from "./capability-runtime-launch-group.ts";
import type { CapabilityRuntimeMaterialIdentity } from "./capability-runtime-material.ts";

export const CAPABILITY_RUNTIME_QUALIFICATION_CANDIDATE_SCHEMA_VERSION =
  "capability-runtime-qualification-candidate/1.0" as const;

export type CapabilityRuntimeQualificationCandidatePlatform =
  | "linux/amd64"
  | "linux/arm64";
export type CapabilityRuntimeQualificationCandidateMode = "native" | "emulated";

/**
 * The fixture remains server code. Its source is deliberately closed before
 * the fixed Chrono lowerer derives any private provider case bytes.
 */
export interface CapabilityRuntimeQualificationFixture {
  readonly id: string;
  readonly source: PrescribedKinematicsCaseSource;
  readonly sourceFingerprint: ContentFingerprint;
}

export interface CapabilityRuntimeQualificationCandidate {
  readonly schemaVersion:
    typeof CAPABILITY_RUNTIME_QUALIFICATION_CANDIDATE_SCHEMA_VERSION;
  readonly id: string;
  readonly version: string;
  readonly binding: { readonly id: string; readonly version: string };
  readonly selector: {
    readonly capability: { readonly id: string; readonly version: string };
    readonly use: "preparation" | "execution";
  };
  readonly contract: {
    readonly id: string;
    readonly version: string;
    readonly source: string;
  };
  readonly profile: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint | null;
  } | null;
  readonly unit: {
    readonly id: string;
    readonly version: string;
    readonly manifestFingerprint: ContentFingerprint;
  };
  readonly material: CapabilityRuntimeMaterialIdentity;
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
  readonly observedHostPlatform: CapabilityRuntimeQualificationCandidatePlatform;
  readonly targetPlatform: CapabilityRuntimeQualificationCandidatePlatform;
  readonly mode: CapabilityRuntimeQualificationCandidateMode;
  readonly fixture: CapabilityRuntimeQualificationFixture;
  readonly fingerprint: ContentFingerprint;
}

export function capabilityRuntimeQualificationCandidateManifest(
  value: Omit<CapabilityRuntimeQualificationCandidate, "fingerprint">,
): Omit<CapabilityRuntimeQualificationCandidate, "fingerprint"> {
  return {
    schemaVersion: value.schemaVersion,
    id: value.id,
    version: value.version,
    binding: value.binding,
    selector: value.selector,
    contract: value.contract,
    profile: value.profile,
    unit: value.unit,
    material: value.material,
    launchGroup: value.launchGroup,
    observedHostPlatform: value.observedHostPlatform,
    targetPlatform: value.targetPlatform,
    mode: value.mode,
    fixture: value.fixture,
  };
}

export function fingerprintCapabilityRuntimeQualificationCandidate(
  value: Omit<CapabilityRuntimeQualificationCandidate, "fingerprint">,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(capabilityRuntimeQualificationCandidateManifest(value));
}

export async function createCapabilityRuntimeQualificationCandidate(
  value: Omit<CapabilityRuntimeQualificationCandidate, "fingerprint">,
): Promise<CapabilityRuntimeQualificationCandidate> {
  const parsed = await parseCandidate(value);
  return deepFreeze({
    ...parsed,
    fingerprint: await fingerprintCapabilityRuntimeQualificationCandidate(parsed),
  });
}

export async function validateCapabilityRuntimeQualificationCandidate(
  value: unknown,
  path = "$capabilityRuntimeQualificationCandidate",
): Promise<CapabilityRuntimeQualificationCandidate> {
  const root = exactRecord(value, [
    "schemaVersion",
    "id",
    "version",
    "binding",
    "selector",
    "contract",
    "profile",
    "unit",
    "material",
    "launchGroup",
    "observedHostPlatform",
    "targetPlatform",
    "mode",
    "fixture",
    "fingerprint",
  ], path);
  const parsed = await parseCandidate(root, path);
  const fingerprint = parseFingerprint(root.fingerprint, `${path}.fingerprint`);
  const expected = await fingerprintCapabilityRuntimeQualificationCandidate(parsed);
  if (!fingerprintsEqual(fingerprint, expected)) {
    throw new TypeError(`${path}.fingerprint does not match the canonical body.`);
  }
  return deepFreeze({ ...parsed, fingerprint });
}

export async function canonicalCapabilityRuntimeQualificationCandidateText(
  value: unknown,
): Promise<string> {
  return deterministicJson(
    await validateCapabilityRuntimeQualificationCandidate(value),
  );
}

async function parseCandidate(
  value: unknown,
  path = "$capabilityRuntimeQualificationCandidate",
): Promise<Omit<CapabilityRuntimeQualificationCandidate, "fingerprint">> {
  const root = exactRecord(value, [
    "schemaVersion",
    "id",
    "version",
    "binding",
    "selector",
    "contract",
    "profile",
    "unit",
    "material",
    "launchGroup",
    "observedHostPlatform",
    "targetPlatform",
    "mode",
    "fixture",
  ], path);
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_QUALIFICATION_CANDIDATE_SCHEMA_VERSION,
    `${path}.schemaVersion`,
  );
  const observedHostPlatform = platform(
    root.observedHostPlatform,
    `${path}.observedHostPlatform`,
  );
  const targetPlatform = platform(root.targetPlatform, `${path}.targetPlatform`);
  const mode = candidateMode(root.mode, `${path}.mode`);
  if (mode === "native" && observedHostPlatform !== targetPlatform) {
    throw new TypeError(`${path}.mode native requires its observed host platform.`);
  }
  if (mode === "emulated" && observedHostPlatform === targetPlatform) {
    throw new TypeError(`${path}.mode emulated requires a distinct target platform.`);
  }
  const unit = parseUnit(root.unit, `${path}.unit`);
  const material = parseMaterial(root.material, `${path}.material`);
  if (material.unitId !== unit.id) {
    throw new TypeError(`${path}.material.unitId must equal ${path}.unit.id.`);
  }
  const fixture = await parseFixture(root.fixture, `${path}.fixture`);
  assertTwoBodyOneHingeFixture(fixture.source, `${path}.fixture.source`);
  return deepFreeze({
    schemaVersion: CAPABILITY_RUNTIME_QUALIFICATION_CANDIDATE_SCHEMA_VERSION,
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    binding: parseBinding(root.binding, `${path}.binding`),
    selector: parseSelector(root.selector, `${path}.selector`),
    contract: parseContract(root.contract, `${path}.contract`),
    profile: root.profile === null
      ? null
      : parseProfile(root.profile, `${path}.profile`),
    unit,
    material,
    launchGroup: validateCapabilityRuntimeLaunchGroupReference(
      root.launchGroup,
      `${path}.launchGroup`,
    ),
    observedHostPlatform,
    targetPlatform,
    mode,
    fixture,
  });
}

function parseBinding(value: unknown, path: string) {
  const root = exactRecord(value, ["id", "version"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
  });
}

function parseSelector(value: unknown, path: string) {
  const root = exactRecord(value, ["capability", "use"], path);
  const capability = exactRecord(
    root.capability,
    ["id", "version"],
    `${path}.capability`,
  );
  const use: "preparation" | "execution" = root.use === "preparation" ||
      root.use === "execution"
    ? root.use
    : (() => {
      throw new TypeError(`${path}.use is unsupported.`);
    })();
  return deepFreeze({
    capability: {
      id: safeId(capability.id, `${path}.capability.id`),
      version: exactVersionToken(capability.version, `${path}.capability.version`),
    },
    use,
  });
}

function parseContract(value: unknown, path: string) {
  const root = exactRecord(value, ["id", "version", "source"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    source: nonEmptyText(root.source, `${path}.source`),
  });
}

function parseProfile(value: unknown, path: string) {
  const root = exactRecord(value, ["id", "version", "fingerprint"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    fingerprint: root.fingerprint === null
      ? null
      : parseFingerprint(root.fingerprint, `${path}.fingerprint`),
  });
}

function parseUnit(value: unknown, path: string) {
  const root = exactRecord(value, ["id", "version", "manifestFingerprint"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    manifestFingerprint: parseFingerprint(
      root.manifestFingerprint,
      `${path}.manifestFingerprint`,
    ),
  });
}

function parseMaterial(
  value: unknown,
  path: string,
): CapabilityRuntimeMaterialIdentity {
  const root = exactRecord(value, ["unitId", "materialId", "imageDigest"], path);
  const imageDigest = nonEmptyText(root.imageDigest, `${path}.imageDigest`);
  if (!/^[a-f0-9]{64}$/.test(imageDigest)) {
    throw new TypeError(`${path}.imageDigest must be lowercase SHA-256.`);
  }
  return deepFreeze({
    unitId: safeId(root.unitId, `${path}.unitId`),
    materialId: safeId(root.materialId, `${path}.materialId`),
    imageDigest,
  });
}

async function parseFixture(
  value: unknown,
  path: string,
): Promise<CapabilityRuntimeQualificationFixture> {
  const root = exactRecord(value, ["id", "source", "sourceFingerprint"], path);
  const source = validatePrescribedKinematicsCaseSource(root.source, `${path}.source`);
  const sourceFingerprint = parseFingerprint(
    root.sourceFingerprint,
    `${path}.sourceFingerprint`,
  );
  const expected = await fingerprintPrescribedKinematicsCaseSource(source);
  if (!fingerprintsEqual(sourceFingerprint, expected)) {
    throw new TypeError(`${path}.sourceFingerprint does not bind its exact fixture.`);
  }
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    source,
    sourceFingerprint,
  });
}

function assertTwoBodyOneHingeFixture(
  source: PrescribedKinematicsCaseSource,
  path: string,
): void {
  if (source.bodies.length !== 2 || source.joints.length !== 1) {
    throw new TypeError(`${path} must contain exactly two bodies and one hinge.`);
  }
  const [joint] = source.joints;
  if (
    joint === undefined || joint.kind !== "revolute" ||
    joint.parentBodyId !== source.groundBodyId ||
    joint.childBodyId === source.groundBodyId
  ) {
    throw new TypeError(`${path} must form one grounded revolute hinge.`);
  }
}

function platform(
  value: unknown,
  path: string,
): CapabilityRuntimeQualificationCandidatePlatform {
  if (value === "linux/amd64" || value === "linux/arm64") return value;
  throw new TypeError(`${path} is unsupported.`);
}

function candidateMode(
  value: unknown,
  path: string,
): CapabilityRuntimeQualificationCandidateMode {
  if (value === "native" || value === "emulated") return value;
  throw new TypeError(`${path} is unsupported.`);
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  const digest = nonEmptyText(root.digest, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be lowercase SHA-256.`);
  }
  return deepFreeze({ algorithm: "sha256" as const, digest });
}
