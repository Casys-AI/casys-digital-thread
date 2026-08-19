/**
 * Domain module for the product `architecture.author-inspection-drone@3`
 * operation.
 *
 * Pure: no I/O, no Deno.*, no fetch. This is not generic
 * `model.write-architecture@1`.
 */

export const INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION = {
  id: "architecture.author-inspection-drone",
  version: "3",
} as const;

/** Fixed server-owned SysML; it intentionally has no numeric technical claim. */
export const INSPECTION_DRONE_V4_ARCHITECTURE_SYSML = [
  "package InspectionDroneArchitecture {",
  "  part def InspectionDrone {",
  "    part airframe: Airframe;",
  "    part energySystem: EnergySystem;",
  "    part propulsionSystem: PropulsionSystem;",
  "    part avionicsAndFlightControl: AvionicsAndFlightControl;",
  "    part inspectionCameraPayload: InspectionCameraPayload;",
  "  }",
  "  part def Airframe;",
  "  part def EnergySystem;",
  "  part def PropulsionSystem;",
  "  part def AvionicsAndFlightControl;",
  "  part def InspectionCameraPayload;",
  "  requirement def ControlledOutdoorInspection {",
  "    doc /* Qualitative scope only: a first visual inspection mission is considered on a controlled outdoor site with a lightweight camera. TBD before any test: site scenario, route, altitude, obstacles, weather limits and separation from people. */",
  "  }",
  "  requirement def CameraPayloadIntegration {",
  "    doc /* The initial payload is a lightweight camera. TBD before any mass budget, energy sizing or structural verification: camera mass, power, dimensions, fixation and integration constraints. */",
  "  }",
  "  requirement def ExplicitOperationalTbd {",
  "    doc /* TBD: autonomy, admissible wind and battery reserve are not fixed; derive and review them from the mission scenario, site, characterised payload and an explicit reserve policy. */",
  "  }",
  "  requirement def TraceableEngineeringEvidence {",
  "    doc /* Maintain traceable links between the approved brief, SysML model, CAD, physical calculations, named requirements and manufacturing dossier through exact artifacts and consumptions, with visible assumptions and gaps. This is not a certification or authorization verdict. */",
  "  }",
  "}",
].join("\n");

export const INSPECTION_DRONE_V4_PART_DEFINITION_CONTRACT = [
  "InspectionDrone",
  "Airframe",
  "EnergySystem",
  "PropulsionSystem",
  "AvionicsAndFlightControl",
  "InspectionCameraPayload",
] as const;

export const INSPECTION_DRONE_V4_PART_USAGE_CONTRACT = [
  { label: "airframe", type: "Airframe" },
  { label: "energySystem", type: "EnergySystem" },
  { label: "propulsionSystem", type: "PropulsionSystem" },
  {
    label: "avionicsAndFlightControl",
    type: "AvionicsAndFlightControl",
  },
  {
    label: "inspectionCameraPayload",
    type: "InspectionCameraPayload",
  },
] as const;

export const INSPECTION_DRONE_V4_REQUIREMENT_CONTRACT = [
  {
    label: "ControlledOutdoorInspection",
    documentation:
      "Qualitative scope only: a first visual inspection mission is considered on a controlled outdoor site with a lightweight camera. TBD before any test: site scenario, route, altitude, obstacles, weather limits and separation from people.",
  },
  {
    label: "CameraPayloadIntegration",
    documentation:
      "The initial payload is a lightweight camera. TBD before any mass budget, energy sizing or structural verification: camera mass, power, dimensions, fixation and integration constraints.",
  },
  {
    label: "ExplicitOperationalTbd",
    documentation:
      "TBD: autonomy, admissible wind and battery reserve are not fixed; derive and review them from the mission scenario, site, characterised payload and an explicit reserve policy.",
  },
  {
    label: "TraceableEngineeringEvidence",
    documentation:
      "Maintain traceable links between the approved brief, SysML model, CAD, physical calculations, named requirements and manufacturing dossier through exact artifacts and consumptions, with visible assumptions and gaps. This is not a certification or authorization verdict.",
  },
] as const;
