import { deterministicJson } from "../domain/kernel/deterministic-json.ts";
import type { MechanicalProofCaseSource } from "../domain/fea/seal-case/mechanical-proof-case-source.ts";

const SOURCE: MechanicalProofCaseSource = {
  schemaVersion: "mechanical-proof-case-source/1.0",
  id: "bracket-br01-static",
  revision: 1,
  scope: "Isolated rectangular bracket in its local frame.",
  evidenceBoundary: "Concept verification only. Not a certification.",
  project: {
    id: "bracket-br01",
    subjectId: "project:bracket-br01",
  },
  target: {
    id: "br01-bracket",
    modelElementId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  },
  requirementsSource: {
    editingContextId: "11111111-2222-3333-4444-555555555555",
    elementId: "66666666-7777-8888-9999-aaaaaaaaaaaa",
  },
  analysis: {
    kind: "linear-static",
    material: {
      model: "isotropic-linear-elastic",
      basis: "Aluminium 6061 assumption declared in the brief.",
      youngModulus: { value: 69000, unit: "MPa" },
      poissonRatio: { value: 0.33, unit: "1" },
    },
    mesh: {
      kind: "tetrahedral-volume",
      targetSize: { value: 4, unit: "mm" },
    },
    supports: [{
      id: "root-fixed",
      kind: "fixed",
      selection: {
        name: "FIXED",
        box: { min: [-1, -11, -6], max: [1, 11, 6], unit: "mm" },
      },
    }],
    loads: [{
      id: "tip-load",
      kind: "force",
      selection: {
        name: "LOADED",
        box: { min: [99, -11, -6], max: [101, 11, 6], unit: "mm" },
      },
      force: { value: [0, 0, -25], unit: "N" },
    }],
  },
  requirements: [{
    id: "br01-deflection",
    name: "maxDisplacement",
    metric: "maximum-displacement",
    feature: "maxDisplacement",
    operator: "<=",
    limit: { value: 2, unit: "mm" },
  }, {
    id: "br01-stress",
    name: "maxVonMises",
    metric: "maximum-von-mises-stress",
    feature: "maxVonMises",
    operator: "<=",
    limit: { value: 80000000, unit: "Pa" },
  }],
};

export function mechanicalProofCaseSourceFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...structuredClone(SOURCE) as unknown as Record<string, unknown>,
    ...overrides,
  };
}

export function mechanicalProofCaseSourceText(
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify(mechanicalProofCaseSourceFixture(overrides));
}

export function canonicalMechanicalProofCaseSourceFixture(): MechanicalProofCaseSource {
  return structuredClone(SOURCE);
}

export function dl06LikeSourceText(options: {
  readonly projectId?: string;
  readonly subjectId?: string;
  readonly id?: string;
  readonly targetId?: string;
  readonly modelElementId?: string;
  readonly editingContextId?: string;
  readonly elementId?: string;
  readonly cadScriptHash?: string;
} = {}): string {
  return deterministicJson({
    schemaVersion: "mechanical-proof-case-source/1.0",
    id: options.id ?? "desk-lamp-dl06-arm-cantilever",
    revision: 1,
    scope: "Isolated rectangular-section cantilever arm.",
    evidenceBoundary: "Concept verification only.",
    project: {
      id: options.projectId ?? "desk-lamp-dl06",
      subjectId: options.subjectId ?? "project:desk-lamp-dl06",
    },
    target: {
      id: options.targetId ?? "dl06-heron-arm",
      modelElementId: options.modelElementId ??
        "7dda85d1-764e-4329-95ea-09052355cc47",
    },
    requirementsSource: {
      editingContextId: options.editingContextId ??
        "3ff2ec86-436f-432c-b279-4c4b78d87ebe",
      elementId: options.elementId ?? "120b79be-d9c5-4248-8d63-f1745824e57d",
    },
    analysis: {
      kind: "linear-static",
      material: {
        model: "isotropic-linear-elastic",
        basis: "Aluminium 6061 assumption.",
        youngModulus: { value: 69000, unit: "MPa" },
        poissonRatio: { value: 0.33, unit: "1" },
      },
      mesh: {
        kind: "tetrahedral-volume",
        targetSize: { value: 3, unit: "mm" },
      },
      supports: [{
        id: "arm-root-fixed",
        kind: "fixed",
        selection: {
          name: "FIXED",
          box: { min: [-111, -11, -6], max: [-109, 11, 6], unit: "mm" },
        },
      }],
      loads: [{
        id: "tip-load-10n",
        kind: "force",
        selection: {
          name: "LOADED",
          box: { min: [104, -11, -6], max: [111, 11, 6], unit: "mm" },
        },
        force: { value: [0, 0, -10], unit: "N" },
      }],
    },
    requirements: [{
      id: "dl06-arm-deflection",
      name: "maxDisplacement",
      metric: "maximum-displacement",
      feature: "maxDisplacement",
      operator: "<=",
      limit: { value: 1, unit: "mm" },
    }, {
      id: "dl06-arm-stress",
      name: "maxVonMises",
      metric: "maximum-von-mises-stress",
      feature: "maxVonMises",
      operator: "<=",
      limit: { value: 60000000, unit: "Pa" },
    }],
  });
}
