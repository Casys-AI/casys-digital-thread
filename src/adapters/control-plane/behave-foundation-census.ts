import { parse as parseYaml } from "@std/yaml";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  rejectDuplicates,
} from "../../domain/kernel/case-validation.ts";
import {
  MICROSANDBOX_LOCAL_RUNTIME_REF,
  pinnedOciImageReference,
} from "../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  BEHAVE_FOUNDATION_CENSUS_SCHEMA_VERSION,
  type BehaveFoundationCapabilityCensus,
  type BehaveFoundationCensusBlocker,
  type BehaveFoundationCensusMaterial,
  type BehaveFoundationCensusReviewEvidence,
} from "../../application/control-plane/read-model/behave-foundation-census.ts";
import {
  GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY,
  MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY,
  MODEL_AUTHOR_SYSTEM_CAPABILITY,
  MODEL_EVALUATE_REQUIREMENT_CAPABILITY,
} from "../../application/control-plane/read-model/capability-demand.ts";
import {
  CAPABILITY_PACK_SCHEMA_VERSION,
  type CapabilityBindingClaim,
  type CapabilityPackManifest,
  type RuntimePlatform,
} from "../../application/control-plane/read-model/capability-pack.ts";
import type {
  DesiredServer,
  FleetManifest,
} from "../../application/control-plane/read-model/fleet-manifest.ts";
import { BEHAVE_FOUNDATION_CAPABILITY_REQUIREMENTS } from "../../orchestration/operations/behave-capability-requirements.ts";
import { loadFleetManifest } from "./manifest.ts";
import { validateCapabilityPackManifest } from "./capability-pack-manifest.ts";
import { loadBehaveFoundationCandidateReview } from "./behave-foundation-review.ts";

const PACK_ID = "casys.behave-foundation" as const;
const PACK_VERSION = "0.1.0" as const;
const CALCULIX_WORKER_ID = "calculix-worker" as const;
const SHA256_HEX = /^[a-f0-9]{64}$/;

const BINDING_CLAIMS = deepFreeze(
  [
    {
      id: "casys.syson.author-system",
      version: "0.1.0",
      capability: MODEL_AUTHOR_SYSTEM_CAPABILITY,
      materialIds: ["mcp-syson"],
    },
    {
      id: "casys.syson.evaluate-requirement",
      version: "0.1.0",
      capability: MODEL_EVALUATE_REQUIREMENT_CAPABILITY,
      materialIds: ["mcp-syson"],
    },
    {
      id: "casys.build123d.export-admitted-source",
      version: "0.1.0",
      capability: GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY,
      materialIds: ["mcp-build123d-sandbox"],
    },
    {
      id: "casys.calculix.solve-static-structural",
      version: "0.1.0",
      capability: MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY,
      materialIds: [CALCULIX_WORKER_ID],
    },
  ] satisfies readonly CapabilityBindingClaim[],
);

const FLEET_ROOT_IDS = ["syson", "build123d-sandbox"] as const;

export interface BehaveFoundationLocalCalculixProfile {
  readonly imageReference: string;
  readonly policyFingerprint: ContentFingerprint;
}

export interface InspectBehaveFoundationCensusOptions {
  readonly fleet: FleetManifest;
  readonly compose: unknown;
  readonly calculix: BehaveFoundationLocalCalculixProfile;
  readonly platformsByMaterialId?: Readonly<Record<string, readonly RuntimePlatform[]>>;
  readonly reviewEvidence?: Partial<BehaveFoundationCensusReviewEvidence>;
}

export interface LoadWorkspaceBehaveFoundationCensusOptions {
  readonly calculix: BehaveFoundationLocalCalculixProfile;
  readonly fleetPath?: string;
  readonly composePath?: string;
  /** `null` is reserved for focused tests that supply review inputs directly. */
  readonly reviewPath?: string | null;
  readonly readTextFile?: (path: string) => Promise<string>;
  readonly platformsByMaterialId?: Readonly<Record<string, readonly RuntimePlatform[]>>;
  readonly reviewEvidence?: Partial<BehaveFoundationCensusReviewEvidence>;
}

export async function loadWorkspaceBehaveFoundationCensus(
  options: LoadWorkspaceBehaveFoundationCensusOptions,
): Promise<BehaveFoundationCapabilityCensus> {
  const fleetPath = options.fleetPath ?? "config/mcp-fleet.json";
  const composePath = options.composePath ?? "docker-compose.yml";
  const readTextFile = options.readTextFile ?? Deno.readTextFile;
  const review = options.reviewPath === null
    ? undefined
    : await loadBehaveFoundationCandidateReview({
      path: options.reviewPath,
      readTextFile,
    });
  const [fleet, composeSource] = await Promise.all([
    loadFleetManifest(fleetPath, { readTextFile }),
    readTextFile(composePath),
  ]);
  let compose: unknown;
  try {
    compose = parseYaml(composeSource);
  } catch (error) {
    throw new TypeError(
      `Invalid YAML in ${composePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return inspectBehaveFoundationCensus({
    fleet,
    compose,
    calculix: options.calculix,
    platformsByMaterialId: options.platformsByMaterialId ??
      review?.platformsByMaterialId,
    reviewEvidence: options.reviewEvidence ?? review?.reviewEvidence,
  });
}

/**
 * Census repository declarations only. It performs no Docker, registry, network,
 * filesystem mutation, provider discovery, qualification or project dispatch.
 */
export function inspectBehaveFoundationCensus(
  options: InspectBehaveFoundationCensusOptions,
): BehaveFoundationCapabilityCensus {
  const blockers: BehaveFoundationCensusBlocker[] = [];
  const platformsByMaterialId = options.platformsByMaterialId ?? {};
  const compose = record(options.compose, "$compose");
  const services = record(compose.services, "$compose.services");
  const fleetRoots = FLEET_ROOT_IDS.map((id) => requireFleetServer(options.fleet, id));
  assertCapabilityBindingsCoverDemand();

  const rootServiceNames = fleetRoots.map((server) => server.serviceName);
  const orderedServiceNames = composeServiceClosure(services, rootServiceNames);
  const fleetByService = new Map(
    fleetRoots.map((server) => [server.serviceName, server]),
  );
  const composeMaterials = orderedServiceNames.map((serviceName) => {
    const service = record(
      services[serviceName],
      `$compose.services.${serviceName}`,
    );
    const image = composeImageDefault(
      service.image,
      `$compose.services.${serviceName}.image`,
    );
    const imagePinned = isPinnedImage(image);
    if (!imagePinned) {
      blockers.push({
        code: "runtime.image-not-digest-pinned",
        subject: serviceName,
        detail: `${serviceName} resolves to mutable image ${image}.`,
      });
    }
    if (service.build !== undefined) {
      blockers.push({
        code: "runtime.local-build-present",
        subject: serviceName,
        detail: `${serviceName} still declares a local Compose build context.`,
      });
    }
    const exposure = composeExposure(service.ports, serviceName);
    if (exposure === "public") {
      blockers.push({
        code: "runtime.public-exposure",
        subject: serviceName,
        detail:
          `${serviceName} has a port mapping that is not explicitly loopback-only.`,
      });
    }
    const fleetServer = fleetByService.get(serviceName);
    if (fleetServer && fleetServer.image !== image) {
      blockers.push({
        code: "runtime.fleet-compose-image-drift",
        subject: serviceName,
        detail:
          `Fleet image ${fleetServer.image} differs from Compose default ${image}.`,
      });
    }
    if (
      fleetServer?.network?.exposure !== undefined &&
      !["loopback", "loopback-only"].includes(fleetServer.network.exposure)
    ) {
      blockers.push({
        code: "runtime.public-exposure",
        subject: serviceName,
        detail: `Fleet exposure ${fleetServer.network.exposure} is not local-only.`,
      });
    }
    const platforms = platformsFor(
      platformsByMaterialId,
      serviceName,
      blockers,
    );
    return deepFreeze({
      id: serviceName,
      kind: "compose-service" as const,
      image,
      imagePinned,
      platforms,
      dependsOn: composeDependencies(service, serviceName),
      source: `docker-compose.yml#services.${serviceName}`,
      packRole: packRole(fleetServer, serviceName),
      serviceName,
      exposure,
    });
  });

  const calculixImagePinned = isPinnedImage(options.calculix.imageReference);
  if (!calculixImagePinned) {
    blockers.push({
      code: "runtime.image-not-digest-pinned",
      subject: CALCULIX_WORKER_ID,
      detail:
        `${CALCULIX_WORKER_ID} resolves to mutable image ${options.calculix.imageReference}.`,
    });
  }
  const microvmMaterial = deepFreeze({
    id: CALCULIX_WORKER_ID,
    kind: "microvm-image" as const,
    image: options.calculix.imageReference,
    imagePinned: calculixImagePinned,
    platforms: platformsFor(
      platformsByMaterialId,
      CALCULIX_WORKER_ID,
      blockers,
    ),
    dependsOn: [],
    source: "src/adapters/fea/isolated-v3/local-calculix-isolated-execution-options.ts",
    packRole: packRole(undefined, CALCULIX_WORKER_ID),
    runner: MICROSANDBOX_LOCAL_RUNTIME_REF,
    policyFingerprint: fingerprint(
      options.calculix.policyFingerprint,
      "$census.calculix.policyFingerprint",
    ),
    network: "deny-all" as const,
  });
  const materials: readonly BehaveFoundationCensusMaterial[] = [
    ...composeMaterials,
    microvmMaterial,
  ];
  const materialIds = new Set(materials.map((material) => material.id));
  for (const materialId of Object.keys(platformsByMaterialId)) {
    if (!materialIds.has(materialId)) {
      throw new TypeError(
        `$census.platformsByMaterialId contains unknown material ${materialId}.`,
      );
    }
  }

  const reviewEvidence = parseReviewEvidence(options.reviewEvidence);
  for (
    const [review, code] of [
      ["licences", "review.licences-missing"],
      ["volumes", "review.volumes-missing"],
      ["security", "review.security-missing"],
    ] as const
  ) {
    if (reviewEvidence[review] === null) {
      blockers.push({
        code,
        subject: PACK_ID,
        detail: `No exact ${review} review evidence is attached to the candidate.`,
      });
    }
  }

  const candidateManifest = blockers.length === 0
    ? buildCandidateManifest(materials)
    : null;
  return deepFreeze({
    schemaVersion: BEHAVE_FOUNDATION_CENSUS_SCHEMA_VERSION,
    mutatesRuntime: false,
    pack: { id: PACK_ID, version: PACK_VERSION },
    status: candidateManifest ? "candidate-ready" : "blocked",
    evidenceLevel: "declared" as const,
    verticalQualification: "not-observed" as const,
    productionEligible: false,
    capabilityRequirements: BEHAVE_FOUNDATION_CAPABILITY_REQUIREMENTS,
    materials,
    hostPrerequisites: [
      {
        id: "docker-compose-local",
        version: null,
        requiredByMaterialIds: composeMaterials.map((material) => material.id),
        installableByPack: false,
      },
      {
        id: "microsandbox-local",
        version: MICROSANDBOX_LOCAL_RUNTIME_REF.version,
        requiredByMaterialIds: [CALCULIX_WORKER_ID],
        installableByPack: false,
      },
    ],
    excludedRuntimes: excludedRuntimes(options.fleet),
    reviewEvidence,
    blockers,
    candidateManifest,
  });
}

function packRole(
  fleetServer: DesiredServer | undefined,
  materialId: string,
): {
  readonly fleetRequired: boolean | null;
  readonly memberOfPack: true;
  readonly requiredForOperation: boolean;
  readonly qualifiedForPack: false;
} {
  return deepFreeze({
    fleetRequired: fleetServer?.required ?? null,
    memberOfPack: true,
    requiredForOperation: BINDING_CLAIMS.some((claim) =>
      claim.materialIds.some((claimedMaterialId) => claimedMaterialId === materialId)
    ),
    qualifiedForPack: false,
  });
}

function assertCapabilityBindingsCoverDemand(): void {
  const required = new Set(
    BEHAVE_FOUNDATION_CAPABILITY_REQUIREMENTS.entries.flatMap((entry) =>
      entry.capabilities.map((capability) => `${capability.id}@${capability.version}`)
    ),
  );
  const claims = new Map<string, number>();
  for (const claim of BINDING_CLAIMS) {
    const key = `${claim.capability.id}@${claim.capability.version}`;
    claims.set(key, (claims.get(key) ?? 0) + 1);
  }
  for (const capability of required) {
    if (claims.get(capability) !== 1) {
      throw new TypeError(
        `Behave census requires exactly one candidate binding claim for ${capability}.`,
      );
    }
  }
}

function requireFleetServer(fleet: FleetManifest, id: string): DesiredServer {
  const matches = fleet.servers.filter((server) => server.id === id);
  if (matches.length !== 1) {
    throw new TypeError(
      `Fleet must contain exactly one ${id} server; found ${matches.length}.`,
    );
  }
  return matches[0]!;
}

function composeServiceClosure(
  services: Record<string, unknown>,
  roots: readonly string[],
): string[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const result: string[] = [];
  const visit = (serviceName: string): void => {
    if (visited.has(serviceName)) return;
    if (visiting.has(serviceName)) {
      throw new TypeError(`Compose dependency cycle contains ${serviceName}.`);
    }
    const service = record(
      services[serviceName],
      `$compose.services.${serviceName}`,
    );
    visiting.add(serviceName);
    for (const dependency of composeDependencies(service, serviceName)) {
      visit(dependency);
    }
    visiting.delete(serviceName);
    visited.add(serviceName);
    result.push(serviceName);
  };
  for (const root of roots) visit(root);
  return result;
}

function composeDependencies(
  service: Record<string, unknown>,
  serviceName: string,
): string[] {
  if (service.depends_on === undefined) return [];
  const path = `$compose.services.${serviceName}.depends_on`;
  const dependencies = Array.isArray(service.depends_on)
    ? arrayOf(service.depends_on, path).map((value, index) =>
      nonEmptyString(value, `${path}[${index}]`)
    )
    : Object.keys(record(service.depends_on, path));
  rejectDuplicates(dependencies, path);
  return dependencies;
}

function composeImageDefault(value: unknown, path: string): string {
  const image = nonEmptyString(value, path);
  const interpolation = image.match(/^\$\{[A-Z_][A-Z0-9_]*:-([^}]+)\}$/);
  if (image.startsWith("${") && !interpolation) {
    throw new TypeError(
      `${path} must use one simple \${VARIABLE:-default} expression.`,
    );
  }
  return interpolation?.[1] ?? image;
}

function composeExposure(
  value: unknown,
  serviceName: string,
): "internal" | "loopback-only" | "public" {
  if (value === undefined) return "internal";
  const ports = arrayOf(value, `$compose.services.${serviceName}.ports`);
  if (ports.length === 0) return "internal";
  for (let index = 0; index < ports.length; index++) {
    const port = ports[index];
    if (typeof port === "string") {
      if (!port.startsWith("127.0.0.1:") && !port.startsWith("localhost:")) {
        return "public";
      }
      continue;
    }
    const mapping = record(port, `$compose.services.${serviceName}.ports[${index}]`);
    if (mapping.host_ip !== "127.0.0.1" && mapping.host_ip !== "localhost") {
      return "public";
    }
  }
  return "loopback-only";
}

function platformsFor(
  claims: Readonly<Record<string, readonly RuntimePlatform[]>>,
  materialId: string,
  blockers: BehaveFoundationCensusBlocker[],
): RuntimePlatform[] {
  const platforms = [...(claims[materialId] ?? [])];
  for (let index = 0; index < platforms.length; index++) {
    if (!["linux/amd64", "linux/arm64"].includes(platforms[index])) {
      throw new TypeError(
        `$census.platformsByMaterialId.${materialId}[${index}] is unsupported.`,
      );
    }
  }
  rejectDuplicates(platforms, `$census.platformsByMaterialId.${materialId}`);
  if (platforms.length === 0) {
    blockers.push({
      code: "runtime.platforms-unverified",
      subject: materialId,
      detail: `No reviewed OCI platform claim is available for ${materialId}.`,
    });
  }
  return platforms;
}

function parseReviewEvidence(
  input: Partial<BehaveFoundationCensusReviewEvidence> | undefined,
): BehaveFoundationCensusReviewEvidence {
  return deepFreeze({
    licences: optionalFingerprint(input?.licences, "$census.reviewEvidence.licences"),
    volumes: optionalFingerprint(input?.volumes, "$census.reviewEvidence.volumes"),
    security: optionalFingerprint(input?.security, "$census.reviewEvidence.security"),
  });
}

function optionalFingerprint(
  value: ContentFingerprint | null | undefined,
  path: string,
): ContentFingerprint | null {
  return value === undefined || value === null ? null : fingerprint(value, path);
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  if (typeof root.digest !== "string" || !SHA256_HEX.test(root.digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return deepFreeze({ algorithm: "sha256", digest: root.digest });
}

function buildCandidateManifest(
  materials: readonly BehaveFoundationCensusMaterial[],
): CapabilityPackManifest {
  return validateCapabilityPackManifest({
    schemaVersion: CAPABILITY_PACK_SCHEMA_VERSION,
    id: PACK_ID,
    version: PACK_VERSION,
    bindingClaims: BINDING_CLAIMS,
    materials: materials.map((material) => {
      if (material.kind === "compose-service") {
        if (material.exposure === "public") {
          throw new TypeError(`Cannot render public material ${material.id}.`);
        }
        return {
          id: material.id,
          kind: material.kind,
          image: material.image,
          platforms: material.platforms,
          dependsOn: material.dependsOn,
          serviceName: material.serviceName,
          exposure: material.exposure,
        };
      }
      return {
        id: material.id,
        kind: material.kind,
        image: material.image,
        platforms: material.platforms,
        dependsOn: material.dependsOn,
        runner: material.runner,
        policyFingerprint: material.policyFingerprint,
        network: material.network,
      };
    }),
  });
}

function excludedRuntimes(fleet: FleetManifest) {
  const selected = new Set(FLEET_ROOT_IDS);
  const reasons: Record<string, string> = {
    build123d:
      "Regular Build123d/OCCT observation belongs to optional assembly-integrity, not admitted canonical export.",
    calculix:
      "The HTTP CalculiX provider belongs to optional sensitivity; product FEA @3 uses the local microVM worker.",
    erpnext: "Buy/ERP is outside the Behave judgement branch.",
    dfm: "Make/DFM is outside the Behave judgement branch.",
    tolerance: "Make/tolerance is outside the Behave judgement branch.",
    prusaslicer: "Make/print estimation is outside the Behave judgement branch.",
    spice: "Circuit-only SPICE is an optional admitted-source vertical.",
  };
  return [
    ...fleet.servers.filter((server) =>
      !selected.has(server.id as typeof FLEET_ROOT_IDS[number])
    )
      .map((server) => ({
        id: server.serviceName,
        reason: reasons[server.id] ??
          "Not selected by the Behave foundation demand candidate.",
      })),
    {
      id: "build123d-microsandbox-worker",
      reason:
        "Isolated Build123d draft execution is not required by the mandatory canonical path.",
    },
    {
      id: "build123d-module-assembler-worker",
      reason:
        "Geometry-module assembly is not required by the current from-zero single-part proof.",
    },
    {
      id: "modelica-microsandbox-worker",
      reason:
        "Modelica is an optional product vertical, not mandatory Behave foundation.",
    },
    {
      id: "spice-microsandbox-worker",
      reason: "SPICE is an optional product vertical, not mandatory Behave foundation.",
    },
  ];
}

function isPinnedImage(value: string): boolean {
  try {
    pinnedOciImageReference(value, "$census.image");
    return true;
  } catch {
    return false;
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${path} must be a non-empty string without edge whitespace.`);
  }
  return value;
}
