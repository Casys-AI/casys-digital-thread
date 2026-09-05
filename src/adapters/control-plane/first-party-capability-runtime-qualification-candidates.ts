/** Code-owned qualification candidate catalogue; it is not an MCP surface. */

import {
  type CapabilityRuntimeQualificationCandidate,
  createCapabilityRuntimeQualificationCandidate,
} from "../../domain/capability/runtime/capability-runtime-qualification-candidate.ts";
import {
  fingerprintPrescribedKinematicsCaseSource,
  validatePrescribedKinematicsCaseSource,
} from "../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-case-source.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import {
  firstPartyChronoLaunchGroupReference,
} from "./first-party-capability-runtime-launch-groups.ts";
import { MCP_CHRONO_032_IMAGE_REFERENCE } from "./first-party-capability-runtime-identities.ts";

export const CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID =
  "chrono-arm64-emulation-v1" as const;

/**
 * The one intentionally small contract probe: fixed base plus one revolute
 * body. It exercises start, exact lowering/submission/readback and stop, but
 * makes no product, collision, force or safety claim.
 */
export async function createFirstPartyCapabilityRuntimeQualificationCandidates(): Promise<
  readonly CapabilityRuntimeQualificationCandidate[]
> {
  const [catalog, launchGroup] = await Promise.all([
    createFirstPartyCapabilityRuntimeCatalog(),
    firstPartyChronoLaunchGroupReference(),
  ]);
  const binding = exactlyOne(
    catalog.bindings.filter((value) => value.id === "chrono-prescribed-kinematics"),
    "Chrono runtime binding",
  );
  const unit = exactlyOne(
    catalog.units.filter((value) => value.id === "casys.mcp-chrono"),
    "Chrono runtime unit",
  );
  const material = exactlyOne(unit.materials, "Chrono runtime material");
  const expectedDigest = MCP_CHRONO_032_IMAGE_REFERENCE.slice(
    MCP_CHRONO_032_IMAGE_REFERENCE.lastIndexOf("@sha256:") + "@sha256:".length,
  );
  if (
    binding.version !== "1" ||
    binding.adapter.id !== "chrono-prescribed-kinematics-adapter" ||
    binding.adapter.version !== "0.3.2" ||
    binding.unitIds.length !== 1 || binding.unitIds[0] !== unit.id ||
    unit.version !== "0.3.2" || material.id !== "mcp-chrono-image" ||
    material.imageReference !== MCP_CHRONO_032_IMAGE_REFERENCE ||
    launchGroup.id !== "casys-chrono" || launchGroup.version !== "1.0.0"
  ) {
    throw new TypeError("The first-party Chrono qualification candidate drifted.");
  }
  const source = canonicalTwoBodyOneHingeQualificationSource();
  return Object.freeze([
    await createCapabilityRuntimeQualificationCandidate({
      schemaVersion: "capability-runtime-qualification-candidate/1.0",
      id: CHRONO_ARM64_EMULATION_QUALIFICATION_CANDIDATE_ID,
      version: "1",
      binding: { id: binding.id, version: binding.version },
      selector: {
        capability: {
          id: binding.capability.id,
          version: binding.capability.version,
        },
        use: binding.use,
      },
      contract: binding.adapter,
      profile: binding.profile,
      unit: {
        id: unit.id,
        version: unit.version,
        manifestFingerprint: unit.manifestFingerprint,
      },
      material: {
        unitId: unit.id,
        materialId: material.id,
        imageDigest: expectedDigest,
      },
      launchGroup,
      observedHostPlatform: "linux/arm64",
      targetPlatform: "linux/amd64",
      mode: "emulated",
      fixture: {
        id: "chrono-two-body-one-hinge-v2",
        source,
        sourceFingerprint: await fingerprintPrescribedKinematicsCaseSource(source),
      },
    }),
  ]);
}

function canonicalTwoBodyOneHingeQualificationSource() {
  const pose = {
    positionM: [0, 0, 0] as const,
    orientationWxyz: [1, 0, 0, 0] as const,
  };
  return validatePrescribedKinematicsCaseSource({
    schemaVersion: "prescribed-kinematics-case-source/1.0",
    id: "chrono-runtime-qualification-two-body-hinge",
    revision: 2,
    scope: "Fixed runtime qualification fixture with one prescribed revolute hinge.",
    evidenceBoundary:
      "Operational provider contract only; no product, collision, clearance, force, strength or safety claim.",
    project: {
      id: "capability-runtime-qualification",
      subjectId: "chrono-two-body-one-hinge",
    },
    assembly: { elementId: "qualification-assembly", elementKind: "PartUsage" },
    units: { length: "m", angle: "rad", time: "s" },
    durationS: 1,
    groundBodyId: "base",
    bodies: [
      { bodyId: "base", partUsageElementId: "base-usage", zeroPose: pose },
      {
        bodyId: "link",
        partUsageElementId: "link-usage",
        zeroPose: { ...pose, positionM: [0, 0, 1] as const },
      },
    ],
    joints: [{
      jointId: "hinge",
      kind: "revolute",
      parentBodyId: "base",
      childBodyId: "link",
      parentFrame: { ...pose, axis: [0, 0, 1] as const },
      childFrame: { ...pose, axis: [0, 0, 1] as const },
      limitRad: { minimum: -1, maximum: 1 },
      ramp: {
        kind: "linear",
        startTimeS: 0,
        endTimeS: 1,
        initialAngleRad: 0,
        finalAngleRad: 0.5,
      },
    }],
    sampling: { timeStepS: 1 / 64 },
  });
}

function exactlyOne<T>(values: readonly T[], label: string): T {
  if (values.length !== 1 || values[0] === undefined) {
    throw new TypeError(`${label} must resolve exactly once.`);
  }
  return values[0];
}
