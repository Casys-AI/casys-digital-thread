import { assert, assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import {
  type BriefCapabilityIntentOperationRegistryView,
  compileProjectCapabilityIntent,
} from "./compile-project-capability-intent.ts";
import type {
  CapabilityReference,
  RequiredEngineeringCapability,
} from "../../domain/capability/engineering-capability.ts";
import {
  ELECTRONICS_RUN_ADMITTED_SPICE_CAPABILITY,
  GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY,
  GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY,
  GEOMETRY_OBSERVE_ASSEMBLY_INTEGRITY_CAPABILITY,
  MECHANICS_OBSERVE_PRESCRIBED_KINEMATICS_CAPABILITY,
  MECHANICS_OBSERVE_STATIC_STRUCTURAL_SENSITIVITY_CAPABILITY,
  MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY,
  MODEL_AUTHOR_SYSTEM_CAPABILITY,
  MODEL_EVALUATE_REQUIREMENT_CAPABILITY,
  MODEL_INSPECT_SYSTEM_CAPABILITY,
  SIMULATION_RUN_ADMITTED_MODELICA_CAPABILITY,
} from "../../domain/capability/engineering-capability.ts";
import type {
  ProjectBriefItem,
  ProjectBriefRevision,
  ProjectBriefSourceRef,
} from "../../domain/project/project-brief.ts";
import type {
  BriefCapabilityIntentRoute,
  BriefCapabilityIntentRouteTable,
} from "../../orchestration/operations/brief-capability-intent-routes.ts";
import {
  ADMITTED_MODELICA_THERMAL_VERIFICATION_AUTHORITY,
  ADMITTED_SPICE_ELECTRICAL_VERIFICATION_AUTHORITY,
  PRESCRIBED_KINEMATICS_VERIFICATION_AUTHORITY,
  STATIC_STRUCTURAL_FEA_SENSITIVITY_VERIFICATION_AUTHORITY,
  STATIC_STRUCTURAL_FEA_VERIFICATION_AUTHORITY,
} from "../../orchestration/operations/brief-capability-intent-routes.ts";
import { engineeringOperationRegistry } from "../../orchestration/operations/registry.ts";
import type { RuntimePreparationPrerequisiteRegistryEntry } from "../../orchestration/operations/runtime-preparation-prerequisite-closure.ts";

const MODEL: CapabilityReference = { id: "model.author-system", version: "1" };
const GEOMETRY: CapabilityReference = {
  id: "geometry.observe-assembly-integrity",
  version: "1",
};
const ASSEMBLY = { id: "assembly-integrity", version: "1.0" } as const;
const THERMAL = { id: "thermal-observation", version: "1.0" } as const;

Deno.test(
  "brief capability intent ignores prose, sources, item IDs, and item order",
  async () => {
    const registry = registryOf([
      operation("verify.assembly", [qualified(GEOMETRY)]),
      operation("verify.thermal", [qualified(MODEL)]),
    ]);
    const routes = routesOf([
      route(ASSEMBLY, ["verify.assembly"]),
      route(THERMAL, ["verify.thermal"]),
    ]);
    const initial = await compileProjectCapabilityIntent(
      briefOf([
        verification("gate-assembly", "Inspect exact mating faces.", ASSEMBLY),
        verification("gate-thermal", "Observe lamp temperature.", THERMAL),
      ]),
      registry,
      routes,
    );
    const edited = await compileProjectCapabilityIntent(
      briefOf([
        verification(
          "renamed-thermal-gate",
          "Entirely rewritten editorial explanation.",
          THERMAL,
          { kind: "document", reference: "document:revised" },
        ),
        verification(
          "renamed-assembly-gate",
          "Different human wording with no operational effect.",
          ASSEMBLY,
          { kind: "expert", reference: "expert:reviewed" },
        ),
      ]),
      registry,
      routes,
    );

    assertEquals(edited, initial);
    const serialized = JSON.stringify(initial);
    for (
      const forbidden of [
        "statement",
        "sourceRefs",
        "provider",
        "image",
        "endpoint",
        "tool",
        "args",
      ]
    ) {
      assert(!serialized.includes(`\"${forbidden}\"`), forbidden);
    }
    assert(!serialized.includes("Inspect exact mating faces."));
    assert(!serialized.includes("conversation:fixture"));
  },
);

Deno.test("the closed assembly-integrity route resolves through its exact upstream runtime demands", async () => {
  const intent = await compileProjectCapabilityIntent(
    briefOf([verification("gate-assembly", "Assembly", ASSEMBLY)]),
    registryOf([
      operation(
        "architecture.seed-syson-model",
        [
          qualified(MODEL_AUTHOR_SYSTEM_CAPABILITY),
        ],
        [],
        "2",
      ),
      operation("model.write-architecture", [
        qualified(MODEL_AUTHOR_SYSTEM_CAPABILITY),
      ]),
      operation("model.capture-part-definitions", [
        qualified(MODEL_INSPECT_SYSTEM_CAPABILITY),
      ]),
      operation(
        "design.write-geometry",
        [qualified(GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY, "preparation")],
      ),
      operation("verify.observe-assembly-integrity", [qualified(GEOMETRY)]),
    ]),
  );

  assertEquals(intent.status, "resolved");
  assertEquals(intent.capabilityRequirements, [
    qualified(GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY, "preparation"),
    qualified(GEOMETRY),
    qualified(MODEL_AUTHOR_SYSTEM_CAPABILITY),
    qualified(MODEL_INSPECT_SYSTEM_CAPABILITY),
  ]);
  assertEquals(intent.authorities, [{
    authority: ASSEMBLY,
    resolution: "resolved",
    operations: [
      { id: "architecture.seed-syson-model", version: "2" },
      { id: "design.write-geometry", version: "1" },
      { id: "model.capture-part-definitions", version: "1" },
      { id: "model.write-architecture", version: "1" },
      { id: "verify.observe-assembly-integrity", version: "1" },
    ],
  }]);
});

Deno.test("intent closes and deduplicates hidden preparation prerequisites", async () => {
  const intent = await compileProjectCapabilityIntent(
    briefOf([verification("gate-assembly", "Assembly", ASSEMBLY)]),
    registryOf([
      operation("verify.first", [qualified(GEOMETRY)], [{
        id: "design.prepare-module",
        version: "1",
      }]),
      operation("verify.second", [qualified(GEOMETRY)], [{
        id: "design.prepare-module",
        version: "1",
      }]),
      preparation(
        "design.prepare-module",
        qualified(GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY, "preparation"),
      ),
    ]),
    routesOf([route(ASSEMBLY, ["verify.first", "verify.second"])]),
  );

  assertEquals(intent.status, "resolved");
  assertEquals(intent.authorities, [{
    authority: ASSEMBLY,
    resolution: "resolved",
    operations: [
      { id: "verify.first", version: "1" },
      { id: "verify.second", version: "1" },
    ],
  }]);
  assertEquals(intent.capabilityRequirements, [
    qualified(GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY, "preparation"),
    qualified(GEOMETRY),
  ]);
});

Deno.test("intent refuses absent, cyclic, and malformed runtime preparation prerequisites", async () => {
  const brief = briefOf([verification("gate-assembly", "Assembly", ASSEMBLY)]);
  const routes = routesOf([route(ASSEMBLY, ["verify.assembly"])]);

  await assertRejects(
    () =>
      compileProjectCapabilityIntent(
        brief,
        registryOf([
          operation("verify.assembly", [qualified(GEOMETRY)], [{
            id: "design.prepare-missing",
            version: "1",
          }]),
        ]),
        routes,
      ),
    TypeError,
    "absent runtime preparation prerequisite",
  );
  await assertRejects(
    () =>
      compileProjectCapabilityIntent(
        brief,
        registryOf([
          operation("verify.assembly", [qualified(GEOMETRY)], [{
            id: "design.prepare-a",
            version: "1",
          }]),
          preparation("design.prepare-a", qualified(GEOMETRY, "preparation"), [{
            id: "design.prepare-b",
            version: "1",
          }]),
          preparation("design.prepare-b", qualified(GEOMETRY, "preparation"), [{
            id: "design.prepare-a",
            version: "1",
          }]),
        ]),
        routes,
      ),
    TypeError,
    "prerequisite cycle",
  );
  await assertRejects(
    () =>
      compileProjectCapabilityIntent(
        brief,
        registryOf([
          operation("verify.assembly", [qualified(GEOMETRY)], [{
            id: "design.not-planning-only",
            version: "1",
          }]),
          operation("design.not-planning-only", [qualified(GEOMETRY)]),
        ]),
        routes,
      ),
    TypeError,
    "must be planning-only and prerequisite-only",
  );
  await assertRejects(
    () =>
      compileProjectCapabilityIntent(
        brief,
        registryOf([
          operation("verify.assembly", [qualified(GEOMETRY)], [{
            id: "design.not-preparation",
            version: "1",
          }]),
          preparation("design.not-preparation", qualified(GEOMETRY)),
        ]),
        routes,
      ),
    TypeError,
    "exactly one preparation capability",
  );
});

Deno.test("the real route table and registry forecast the complete admitted lamp vertical", async () => {
  const intent = await compileProjectCapabilityIntent(
    briefOf([
      verification(
        "verify-static-fea",
        "Check the static mechanical proof.",
        STATIC_STRUCTURAL_FEA_VERIFICATION_AUTHORITY,
      ),
      verification(
        "verify-lamp-thermal",
        "Evaluate admitted thermal observations.",
        ADMITTED_MODELICA_THERMAL_VERIFICATION_AUTHORITY,
      ),
      verification(
        "verify-led-electrical",
        "Observe admitted LED-driver electrical behavior.",
        ADMITTED_SPICE_ELECTRICAL_VERIFICATION_AUTHORITY,
      ),
      verification("verify-assembly", "Observe assembly integrity.", ASSEMBLY),
    ]),
    engineeringOperationRegistry,
  );

  assertEquals(intent.status, "resolved");
  assertEquals(intent.capabilityRequirements, [
    qualified(ELECTRONICS_RUN_ADMITTED_SPICE_CAPABILITY),
    qualified(GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY, "preparation"),
    qualified(GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY, "preparation"),
    qualified(GEOMETRY_OBSERVE_ASSEMBLY_INTEGRITY_CAPABILITY),
    qualified(MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY),
    qualified(MODEL_AUTHOR_SYSTEM_CAPABILITY),
    qualified(MODEL_EVALUATE_REQUIREMENT_CAPABILITY),
    qualified(MODEL_INSPECT_SYSTEM_CAPABILITY),
    qualified(SIMULATION_RUN_ADMITTED_MODELICA_CAPABILITY),
  ]);
  assertEquals(intent.authorities, [
    {
      authority: ADMITTED_MODELICA_THERMAL_VERIFICATION_AUTHORITY,
      resolution: "resolved",
      operations: [
        { id: "simulate.run-admitted-modelica", version: "1" },
        { id: "verify.evaluate-admitted-modelica-observations", version: "1" },
      ],
    },
    {
      authority: ADMITTED_SPICE_ELECTRICAL_VERIFICATION_AUTHORITY,
      resolution: "resolved",
      operations: [{ id: "simulate.run-admitted-spice", version: "1" }],
    },
    {
      authority: ASSEMBLY,
      resolution: "resolved",
      operations: [
        { id: "architecture.seed-syson-model", version: "2" },
        { id: "design.write-geometry", version: "1" },
        { id: "model.capture-part-definitions", version: "1" },
        { id: "model.write-architecture", version: "1" },
        { id: "verify.observe-assembly-integrity", version: "1" },
      ],
    },
    {
      authority: STATIC_STRUCTURAL_FEA_VERIFICATION_AUTHORITY,
      resolution: "resolved",
      operations: [
        { id: "design.write-geometry", version: "1" },
        { id: "verify.run-fea-static-proof", version: "3" },
      ],
    },
  ]);
});

Deno.test("assembly, prescribed kinematics, and admitted SPICE forecast only their exact operational union", async () => {
  const intent = await compileProjectCapabilityIntent(
    briefOf([
      verification("verify-assembly", "Observe assembly integrity.", ASSEMBLY),
      verification(
        "verify-prescribed-kinematics",
        "Observe prescribed mechanism poses.",
        PRESCRIBED_KINEMATICS_VERIFICATION_AUTHORITY,
      ),
      verification(
        "verify-led-electrical",
        "Observe admitted LED-driver electrical behavior.",
        ADMITTED_SPICE_ELECTRICAL_VERIFICATION_AUTHORITY,
      ),
    ]),
    engineeringOperationRegistry,
  );

  assertEquals(intent.status, "resolved");
  assertEquals(intent.capabilityRequirements, [
    qualified(ELECTRONICS_RUN_ADMITTED_SPICE_CAPABILITY),
    qualified(GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY, "preparation"),
    qualified(GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY, "preparation"),
    qualified(GEOMETRY_OBSERVE_ASSEMBLY_INTEGRITY_CAPABILITY),
    qualified(MECHANICS_OBSERVE_PRESCRIBED_KINEMATICS_CAPABILITY),
    qualified(MODEL_AUTHOR_SYSTEM_CAPABILITY),
    qualified(MODEL_INSPECT_SYSTEM_CAPABILITY),
  ]);
  assertEquals(
    intent.capabilityRequirements.some((requirement) =>
      requirement.id === MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY.id ||
      requirement.id === SIMULATION_RUN_ADMITTED_MODELICA_CAPABILITY.id ||
      requirement.id === MODEL_EVALUATE_REQUIREMENT_CAPABILITY.id
    ),
    false,
  );
});

Deno.test("sensitivity is an explicit brief authority and static FEA does not imply it", async () => {
  const ordinaryStatic = await compileProjectCapabilityIntent(
    briefOf([
      verification(
        "verify-static-fea",
        "Check the static mechanical proof.",
        STATIC_STRUCTURAL_FEA_VERIFICATION_AUTHORITY,
      ),
    ]),
    engineeringOperationRegistry,
  );
  assertEquals(
    ordinaryStatic.capabilityRequirements.some((requirement) =>
      requirement.id === MECHANICS_OBSERVE_STATIC_STRUCTURAL_SENSITIVITY_CAPABILITY.id
    ),
    false,
  );

  const sensitivity = await compileProjectCapabilityIntent(
    briefOf([
      verification(
        "observe-static-sensitivity",
        "Observe the admitted finite-difference structural sensitivity.",
        STATIC_STRUCTURAL_FEA_SENSITIVITY_VERIFICATION_AUTHORITY,
      ),
    ]),
    engineeringOperationRegistry,
  );
  assertEquals(sensitivity.status, "resolved");
  assertEquals(
    sensitivity.capabilityRequirements.some((requirement) =>
      requirement.id ===
        MECHANICS_OBSERVE_STATIC_STRUCTURAL_SENSITIVITY_CAPABILITY.id &&
      requirement.version ===
        MECHANICS_OBSERVE_STATIC_STRUCTURAL_SENSITIVITY_CAPABILITY.version
    ),
    true,
  );
  assertEquals(sensitivity.authorities, [{
    authority: STATIC_STRUCTURAL_FEA_SENSITIVITY_VERIFICATION_AUTHORITY,
    resolution: "resolved",
    operations: [{ id: "analyze.run-fea-sensitivity", version: "1" }],
  }]);
});

Deno.test("brief capability intent changes for an authority or routed capability change", async () => {
  const registry = registryOf([
    operation("verify.assembly", [qualified(GEOMETRY)]),
    operation("verify.thermal", [qualified(MODEL)]),
  ]);
  const routes = routesOf([
    route(ASSEMBLY, ["verify.assembly"]),
    route(THERMAL, ["verify.thermal"]),
  ]);
  const assembly = await compileProjectCapabilityIntent(
    briefOf([verification("gate-a", "Assembly", ASSEMBLY)]),
    registry,
    routes,
  );
  const thermal = await compileProjectCapabilityIntent(
    briefOf([verification("gate-t", "Thermal", THERMAL)]),
    registry,
    routes,
  );

  assertNotEquals(thermal.capabilityRequirements, assembly.capabilityRequirements);
  assertNotEquals(
    thermal.capabilityIntentFingerprint,
    assembly.capabilityIntentFingerprint,
  );
  assertEquals(thermal.authorities, [{
    authority: THERMAL,
    resolution: "resolved",
    operations: [{ id: "verify.thermal", version: "1" }],
  }]);

  const rerouted = await compileProjectCapabilityIntent(
    briefOf([verification("gate-a", "Assembly", ASSEMBLY)]),
    registry,
    routesOf([route(ASSEMBLY, ["verify.thermal"])]),
  );
  const changedRegistry = await compileProjectCapabilityIntent(
    briefOf([verification("gate-a", "Assembly", ASSEMBLY)]),
    registryOf([operation("verify.assembly", [qualified(MODEL)])]),
    routesOf([route(ASSEMBLY, ["verify.assembly"])]),
  );

  assertNotEquals(rerouted.capabilityRequirements, assembly.capabilityRequirements);
  assertNotEquals(
    rerouted.capabilityIntentFingerprint,
    assembly.capabilityIntentFingerprint,
  );
  assertNotEquals(
    changedRegistry.capabilityRequirements,
    assembly.capabilityRequirements,
  );
  assertNotEquals(
    changedRegistry.capabilityIntentFingerprint,
    assembly.capabilityIntentFingerprint,
  );
});

Deno.test("unknown brief authority remains a literal unresolved blocker", async () => {
  const intent = await compileProjectCapabilityIntent(
    briefOf([
      verification("gate-unknown", "Unknown method", {
        id: "other-method",
        version: "1.0",
      }),
    ]),
    registryOf([]),
    routesOf([]),
  );

  assertEquals(intent.status, "unresolved");
  assertEquals(intent.capabilityRequirements, []);
  assertEquals(intent.authorities, [{
    authority: { id: "other-method", version: "1.0" },
    resolution: "unresolved",
    reason: "authority-unrouted",
  }]);
});

Deno.test("a route without an exact operation remains unresolved", async () => {
  const intent = await compileProjectCapabilityIntent(
    briefOf([verification("gate-assembly", "Assembly", ASSEMBLY)]),
    registryOf([]),
    routesOf([{ authority: ASSEMBLY, operations: [] }]),
  );

  assertEquals(intent.status, "unresolved");
  assertEquals(intent.authorities, [{
    authority: ASSEMBLY,
    resolution: "unresolved",
    reason: "route-operation-missing",
  }]);
});

Deno.test("a route to an unregistered operation remains unresolved", async () => {
  const intent = await compileProjectCapabilityIntent(
    briefOf([verification("gate-assembly", "Assembly", ASSEMBLY)]),
    registryOf([operation("verify.other", [qualified(GEOMETRY)])]),
    routesOf([route(ASSEMBLY, ["verify.assembly"])]),
  );

  assertEquals(intent.status, "unresolved");
  assertEquals(intent.authorities, [{
    authority: ASSEMBLY,
    resolution: "unresolved",
    reason: "operation-unregistered",
    operations: [{ id: "verify.assembly", version: "1" }],
  }]);
});

Deno.test("every unregistered operation in one route remains a literal blocker", async () => {
  const intent = await compileProjectCapabilityIntent(
    briefOf([verification("gate-assembly", "Assembly", ASSEMBLY)]),
    registryOf([]),
    routesOf([route(ASSEMBLY, ["verify.zeta", "verify.alpha"])]),
  );

  assertEquals(intent.status, "unresolved");
  assertEquals(intent.authorities, [{
    authority: ASSEMBLY,
    resolution: "unresolved",
    reason: "operation-unregistered",
    operations: [
      { id: "verify.alpha", version: "1" },
      { id: "verify.zeta", version: "1" },
    ],
  }]);
  assert(
    JSON.stringify(intent.capabilityIntentFingerprint) !==
      JSON.stringify(
        (await compileProjectCapabilityIntent(
          briefOf([verification("gate-assembly", "Assembly", ASSEMBLY)]),
          registryOf([]),
          routesOf([route(ASSEMBLY, ["verify.alpha"])]),
        )).capabilityIntentFingerprint,
      ),
  );
});

Deno.test("brief capability intent flattens qualification per exact capability use", async () => {
  const intent = await compileProjectCapabilityIntent(
    briefOf([verification("gate-assembly", "Assembly", ASSEMBLY)]),
    registryOf([
      operation("verify.compatible", [compatible(GEOMETRY)]),
      operation("verify.qualified", [qualified(GEOMETRY)]),
      operation("verify.prepare", [qualified(GEOMETRY, "preparation")]),
    ]),
    routesOf([
      route(ASSEMBLY, [
        "verify.prepare",
        "verify.compatible",
        "verify.qualified",
      ]),
    ]),
  );

  assertEquals(intent.capabilityRequirements, [
    qualified(GEOMETRY),
    qualified(GEOMETRY, "preparation"),
  ]);
});

Deno.test("a SysML-only brief forecasts no CAD, FEA, Modelica, SPICE, or Chrono runtime", async () => {
  const intent = await compileProjectCapabilityIntent(
    briefOf([{
      id: "criterion-system-model",
      kind: "success-criterion",
      statement: "System model reviewed.",
      sourceRefs: [{ kind: "intent", reference: "conversation:fixture" }],
      dependsOnItemIds: [],
    }]),
    engineeringOperationRegistry,
  );

  assertEquals(intent.status, "resolved");
  assertEquals(intent.authorities, []);
  assertEquals(intent.capabilityRequirements, []);
});

Deno.test("a prescribed-kinematics brief authority proposes only the provider-neutral mechanics capability", async () => {
  const intent = await compileProjectCapabilityIntent(
    briefOf([
      verification(
        "verify-prescribed-kinematics",
        "Observe prescribed mechanism poses.",
        PRESCRIBED_KINEMATICS_VERIFICATION_AUTHORITY,
      ),
    ]),
    engineeringOperationRegistry,
  );

  assertEquals(intent.status, "resolved");
  assertEquals(intent.capabilityRequirements, [
    qualified(MECHANICS_OBSERVE_PRESCRIBED_KINEMATICS_CAPABILITY),
  ]);
  assertEquals(intent.authorities, [{
    authority: PRESCRIBED_KINEMATICS_VERIFICATION_AUTHORITY,
    resolution: "resolved",
    operations: [{ id: "verify.run-prescribed-kinematics", version: "1" }],
  }]);
  const serialised = JSON.stringify(intent);
  for (const forbidden of ["chrono", "image", "endpoint", "tool", "args"]) {
    assertEquals(serialised.includes(forbidden), false, forbidden);
  }
});

function briefOf(items: readonly ProjectBriefItem[]): ProjectBriefRevision {
  return {
    contractVersion: "2.0",
    briefId: "brief:capability-intent",
    id: "brief:capability-intent:r1",
    revision: 1,
    items,
    proposedAt: "2026-08-29T00:00:00.000Z",
    proposedBy: { id: "agent:fixture", origin: "agent" },
  };
}

function verification(
  id: string,
  statement: string,
  verificationAuthority: { readonly id: string; readonly version: string },
  source: ProjectBriefSourceRef = {
    kind: "intent",
    reference: "conversation:fixture",
  },
): ProjectBriefItem {
  return {
    id,
    kind: "verification-activity",
    statement,
    sourceRefs: [source],
    dependsOnItemIds: [],
    verificationAuthority,
  };
}

function routesOf(
  values: readonly BriefCapabilityIntentRoute[],
): BriefCapabilityIntentRouteTable {
  return { list: () => values };
}

function registryOf(
  entries: readonly RuntimePreparationPrerequisiteRegistryEntry[],
): BriefCapabilityIntentOperationRegistryView {
  return { list: () => entries };
}

function route(
  authority: { readonly id: string; readonly version: string },
  operationIds: readonly string[],
): BriefCapabilityIntentRoute {
  return {
    authority,
    operations: operationIds.map((id) => ({ id, version: "1" })),
  };
}

function operation(
  id: string,
  capabilities: readonly RequiredEngineeringCapability[],
  runtimePreparationPrerequisites: readonly {
    readonly id: string;
    readonly version: string;
  }[] = [],
  version = "1",
): RuntimePreparationPrerequisiteRegistryEntry {
  return {
    id,
    version,
    execution: "trusted",
    runtimeDemand: { kind: "required" as const, capabilities },
    ...(runtimePreparationPrerequisites.length === 0
      ? {}
      : { runtimePreparationPrerequisites }),
  };
}

function preparation(
  id: string,
  capability: RequiredEngineeringCapability,
  runtimePreparationPrerequisites: readonly {
    readonly id: string;
    readonly version: string;
  }[] = [],
): RuntimePreparationPrerequisiteRegistryEntry {
  return {
    id,
    version: "1",
    execution: "planning-only",
    prerequisiteOnly: true,
    runtimeDemand: { kind: "required", capabilities: [capability] },
    ...(runtimePreparationPrerequisites.length === 0
      ? {}
      : { runtimePreparationPrerequisites }),
  };
}

function qualified(
  capability: CapabilityReference,
  use: "preparation" | "execution" = "execution",
) {
  return {
    ...capability,
    minimumQualification: "qualified" as const,
    use,
  };
}

function compatible(
  capability: CapabilityReference,
  use: "preparation" | "execution" = "execution",
) {
  return {
    ...capability,
    minimumQualification: "compatible" as const,
    use,
  };
}
