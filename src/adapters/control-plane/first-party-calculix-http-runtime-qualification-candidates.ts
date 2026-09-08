/** Code-owned CalculiX HTTP qualification candidate. Not yet a host workflow. */

import { fingerprintResourceBytes } from "../../domain/compile/source/provider-resource-reader.ts";
import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { SensitivityStaticStructuralMethod } from "../../domain/sensitivity/study/sensitivity-study.ts";
import { lowerRecordedCalculixStaticRequest } from "../sensitivity/live-fea/mcp-calculix-sensitivity-solver.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import { MCP_CALCULIX_082_IMAGE_REFERENCE } from "./first-party-capability-runtime-identities.ts";
import { firstPartyCalculixLaunchGroupReference } from "./first-party-capability-runtime-launch-groups.ts";

export const CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_CANDIDATE_ID =
  "calculix-http-arm64-native-v1" as const;
export const CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_REQUEST_ID =
  "calculix-http-arm64-native-v1" as const;
export const CALCULIX_HTTP_RUNTIME_QUALIFICATION_CANDIDATE_SCHEMA =
  "calculix-http-runtime-qualification-candidate/1.0" as const;

const BRACKET_STEP_FIXTURE = new URL(
  "../../../examples/bracket/bracket.step",
  import.meta.url,
);

export interface CalculixHttpRuntimeQualificationCandidate {
  readonly schemaVersion: typeof CALCULIX_HTTP_RUNTIME_QUALIFICATION_CANDIDATE_SCHEMA;
  readonly kind: "calculix-http-static-sensitivity";
  readonly id: typeof CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_CANDIDATE_ID;
  readonly version: "1";
  readonly binding: {
    readonly id: "calculix-http-static-sensitivity";
    readonly version: "1.0.0";
  };
  readonly selector: {
    readonly capability: {
      readonly id: "mechanics.observe-static-structural-sensitivity";
      readonly version: "1";
    };
    readonly use: "execution";
  };
  readonly contract: {
    readonly id: "calculix-http-static-sensitivity-adapter";
    readonly version: "1.0.0";
    readonly source:
      "src/adapters/sensitivity/live-fea/mcp-calculix-sensitivity-solver.ts";
  };
  readonly profile: null;
  readonly unit: {
    readonly id: "casys.mcp-calculix";
    readonly version: "0.8.2";
    readonly manifestFingerprint: ContentFingerprint;
  };
  readonly material: {
    readonly unitId: "casys.mcp-calculix";
    readonly materialId: "mcp-calculix-image";
    readonly imageDigest: string;
  };
  readonly launchGroup: {
    readonly id: "casys-mcp-calculix";
    readonly version: "0.8.2";
    readonly fingerprint: ContentFingerprint;
  };
  readonly observedHostPlatform: "linux/arm64";
  readonly targetPlatform: "linux/arm64";
  readonly mode: "native";
  readonly fixture: {
    readonly id: "calculix-http-qualification-bracket-v1";
    readonly step: { readonly byteCount: number; readonly sha256: string };
    readonly sourceFingerprint: ContentFingerprint;
    readonly methodFingerprint: ContentFingerprint;
    readonly case: {
      readonly requestId: typeof CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_REQUEST_ID;
      readonly fingerprint: ContentFingerprint;
    };
    readonly method: SensitivityStaticStructuralMethod;
  };
  readonly fingerprint: ContentFingerprint;
}

export async function createFirstPartyCalculixHttpRuntimeQualificationCandidates(): Promise<
  readonly CalculixHttpRuntimeQualificationCandidate[]
> {
  const [catalog, launchGroup, stepBytes] = await Promise.all([
    createFirstPartyCapabilityRuntimeCatalog(),
    firstPartyCalculixLaunchGroupReference(),
    Deno.readFile(BRACKET_STEP_FIXTURE),
  ]);
  const binding = exactlyOne(
    catalog.bindings.filter((value) => value.id === "calculix-http-static-sensitivity"),
    "CalculiX HTTP sensitivity binding",
  );
  const unit = exactlyOne(
    catalog.units.filter((value) => value.id === "casys.mcp-calculix"),
    "CalculiX HTTP runtime unit",
  );
  const material = exactlyOne(unit.materials, "CalculiX HTTP runtime material");
  if (
    binding.version !== "1.0.0" ||
    binding.capability.id !== "mechanics.observe-static-structural-sensitivity" ||
    binding.capability.version !== "1" || binding.use !== "execution" ||
    binding.adapter.id !== "calculix-http-static-sensitivity-adapter" ||
    binding.adapter.version !== "1.0.0" || binding.profile !== null ||
    binding.unitIds.length !== 1 || binding.unitIds[0] !== unit.id ||
    unit.version !== "0.8.2" || material.id !== "mcp-calculix-image" ||
    material.imageReference !== MCP_CALCULIX_082_IMAGE_REFERENCE ||
    launchGroup.id !== "casys-mcp-calculix" || launchGroup.version !== "0.8.2"
  ) {
    throw new TypeError(
      "The first-party CalculiX HTTP qualification candidate drifted.",
    );
  }
  const method = qualificationMethod();
  const stepSha256 = await fingerprintResourceBytes(stepBytes);
  const sourceFingerprint = await sha256Fingerprint({
    schemaVersion: "calculix-http-qualification-fixture-source/1.0",
    id: "calculix-http-qualification-bracket-v1",
    step: { sha256: stepSha256, byteCount: stepBytes.byteLength },
    method,
    boundary:
      "Host runtime contract fixture only; no product, Thread, requirement, safety, or engineering verdict.",
  });
  const methodFingerprint = await sha256Fingerprint(method);
  const request = lowerRecordedCalculixStaticRequest({
    requestId: CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_REQUEST_ID,
    stepSha256,
    stagedPath: `/inputs/fea-${stepSha256}.step`,
    method,
  });
  const caseFingerprint = await sha256Fingerprint(request);
  const body = {
    schemaVersion: CALCULIX_HTTP_RUNTIME_QUALIFICATION_CANDIDATE_SCHEMA,
    kind: "calculix-http-static-sensitivity" as const,
    id: CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_CANDIDATE_ID,
    version: "1" as const,
    binding: { id: binding.id, version: binding.version } as const,
    selector: {
      capability: { id: binding.capability.id, version: binding.capability.version },
      use: binding.use,
    } as const,
    contract: binding.adapter,
    profile: null,
    unit: {
      id: unit.id,
      version: unit.version,
      manifestFingerprint: unit.manifestFingerprint,
    } as const,
    material: {
      unitId: unit.id,
      materialId: material.id,
      imageDigest: imageDigest(MCP_CALCULIX_082_IMAGE_REFERENCE),
    } as const,
    launchGroup,
    observedHostPlatform: "linux/arm64" as const,
    targetPlatform: "linux/arm64" as const,
    mode: "native" as const,
    fixture: {
      id: "calculix-http-qualification-bracket-v1" as const,
      step: { byteCount: stepBytes.byteLength, sha256: stepSha256 },
      sourceFingerprint,
      methodFingerprint,
      case: {
        requestId: CALCULIX_HTTP_ARM64_NATIVE_QUALIFICATION_REQUEST_ID,
        fingerprint: caseFingerprint,
      },
      method,
    },
  };
  return Object.freeze([
    deepFreeze({
      ...body,
      fingerprint: await sha256Fingerprint(body),
    }) as CalculixHttpRuntimeQualificationCandidate,
  ]);
}

/** The candidate is closed: no caller may alter its provider identity or fixture. */
export async function validateCalculixHttpRuntimeQualificationCandidate(
  value: unknown,
): Promise<CalculixHttpRuntimeQualificationCandidate> {
  const candidate =
    (await createFirstPartyCalculixHttpRuntimeQualificationCandidates())[0]!;
  if (deterministicJson(value) !== deterministicJson(candidate)) {
    throw new TypeError(
      "CalculiX HTTP runtime qualification candidate is not canonical.",
    );
  }
  return candidate;
}

export async function canonicalCalculixHttpRuntimeQualificationCandidateText(
  value: unknown,
): Promise<string> {
  return deterministicJson(
    await validateCalculixHttpRuntimeQualificationCandidate(value),
  );
}

/**
 * Reopens only the fixed repository fixture.  It deliberately takes no path,
 * bytes, digest, or provider input from a caller.
 */
export async function readCalculixHttpRuntimeQualificationFixtureStepBytes(
  candidate: CalculixHttpRuntimeQualificationCandidate,
): Promise<Uint8Array> {
  await validateCalculixHttpRuntimeQualificationCandidate(candidate);
  const bytes = await Deno.readFile(BRACKET_STEP_FIXTURE);
  if (
    bytes.byteLength !== candidate.fixture.step.byteCount ||
    await fingerprintResourceBytes(bytes) !== candidate.fixture.step.sha256
  ) {
    throw new TypeError("CalculiX qualification STEP fixture drifted.");
  }
  return bytes;
}

function qualificationMethod(): SensitivityStaticStructuralMethod {
  return deepFreeze({
    mesh: { kind: "tetrahedral-volume", targetSizeMm: 3 },
    material: {
      model: "isotropic-linear-elastic",
      eMpa: 70_000,
      nu: 0.33,
      basis: "fixture",
    },
    supports: [{
      id: "root-fixed",
      kind: "fixed",
      selection: {
        name: "FIXED",
        box: { min: [-31, -21, -3.1], max: [31, 21, -2.4], unit: "mm" },
      },
    }],
    loads: [{
      id: "tip-load",
      kind: "force",
      selection: {
        name: "LOADED",
        box: { min: [-31, -21, 49.4], max: [-24, 21, 50.1], unit: "mm" },
      },
      force: { value: [0, 0, -500], unit: "N" },
    }],
  });
}

function imageDigest(reference: string): string {
  const digest = reference.slice(reference.lastIndexOf("@sha256:") + "@sha256:".length);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError("CalculiX image must be SHA-256 pinned.");
  }
  return digest;
}

function exactlyOne<T>(values: readonly T[], label: string): T {
  if (values.length !== 1 || values[0] === undefined) {
    throw new TypeError(`${label} must resolve exactly once.`);
  }
  return values[0];
}
