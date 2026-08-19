/**
 * Parser-backed frontend for the qualified build123d source subset.
 *
 * This adapter never imports or executes Python/build123d.  It first applies
 * the existing D4 execution-surface validator, then proves a deliberately
 * smaller AST subset:
 *
 * - named imports of Box, Cylinder, Cone, Sphere, Torus, Ellipsoid, Wedge,
 *   Rectangle, Circle, Ellipse, RegularPolygon, Pos, Rot, Compound, scale,
 *   fillet, chamfer, extrude, offset and revolve (aliases allowed; two
 *   aliases for the same imported name stay ambiguous); plus named imports
 *   of Plane and Axis used only by the reviewed member tables;
 * - unique module-level parameter assignments made only of finite decimal
 *   numbers, unary/binary arithmetic, earlier parameters, the imported math
 *   scalars `pi` / `e` / `tau`, and flat lists;
 * - unique module-level placement assignments: a Pos/Rot call, a product of
 *   those placements, a name of an earlier placement, or
 *   Plane.XY|XZ|YZ|YX|ZX|ZY;
 * - unique module-level shape assignments, each carrying an explicit
 *   geometry kind `solid` or `sketch`: a Box/Cylinder/Cone/Sphere/Torus/
 *   Ellipsoid/Wedge call, a Rectangle/Circle/Ellipse/RegularPolygon call,
 *   a Pos/Rot/named-placement/named-Plane product times a qualified solid
 *   or sketch (kind preserved; Pos * sketch and Rot * sketch are both
 *   sketches), a same-kind +/−, a
 *   `scale(<qualified-solid>, <scalar>)`, a
 *   `fillet(<qualified-solid>, <scalar>)` or
 *   `fillet(<qualified-solid>.edges(), radius=<scalar> or positional
 *   <scalar>)`, a
 *   `chamfer(<qualified-solid>, <scalar>)` or
 *   `chamfer(<qualified-solid>.edges(), <scalar>)`, an
 *   `extrude(<qualified-sketch>, amount=<scalar> or positional <scalar>,
 *   optional taper=<scalar>)`, an
 *   `offset(<qualified-solid>, amount=<scalar> or positional <scalar>)`, a
 *   `revolve(<qualified-sketch>, Axis.X|Y|Z or axis=Axis.X|Y|Z)`,
 *   a name of an earlier same-kind shape, or `Compound(children=[...])`
 *   over earlier solid names;
 * - one module-level `result` that is itself one of those solids.  A sketch
 *   is never a valid result.
 *
 * Anything D4 considers dangerous is rejected.  Syntax that D4 allows but
 * this frontend cannot prove is recorded as unresolved, so it can never yield
 * a fully qualified compilation by omission.  Every geometry-kind mix is
 * labelled with the expected kind and the received kind.
 *
 * QUALIFIED_BUILD123D_CALLS below is a hand table for analyzer 1.6.0. It is
 * not the closed language. `config/build123d-api/inventory-0.11.1.json` is
 * the introspected ground truth; no module imports it yet. F1 (RFC
 * build123d-full-compilation-plan) replaces this Map with generated tables
 * and analyzer 2.0.0. Do not add a 1.7.0 idiom lot here.
 *
 * `Ellipsoid` is listed because D4 still admits the import. It is absent
 * from the 0.11.1 inventory (G6 phantom). F1 drops it from the generated
 * table. `shell` is not a 0.11.1 algebra function.
 */

import { parser } from "@lezer/python";
import type {
  SourceAnalysisFrontend,
  SourceAnalysisFrontendInput,
} from "../../../domain/compile/source/source-analysis-frontend.ts";
import {
  SOURCE_ANALYSIS_SCHEMA,
  type SourceAnalysisBundle,
  type SourceAnalysisDependency,
  type SourceAnalysisLocation,
  type SourceAnalysisSpan,
  type SourceAnalysisSymbol,
  type SourceAnalysisUnresolvedConstruct,
  validateSourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import {
  isQualifiedUnsignedDecimalLiteral,
} from "../../../domain/sensitivity/study/sensitivity-source-substitution.ts";
import {
  GeometryScriptValidationError,
  validateGeometryScript,
} from "../../../domain/cad/source/geometry-script-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";

export const QUALIFIED_BUILD123D_SOURCE_ANALYZER_ID =
  "build123d-qualified-lezer" as const;

/**
 * Named Pos/Rot placement bindings, Plane.XY|XZ|YZ|YX|ZX|ZY * shape,
 * offset(solid, amount), revolve(sketch, Axis.X|Y|Z), and extrude
 * taper=scalar reuse the 1.2/1.3/1.4/1.5 identity scheme
 * (build123d-ast-identity/1.0). Previously qualified bundles stay
 * bit-identical. shell is not a 0.11.1 algebra function; D4 still
 * admits the import name. Same-kind & is parsed here but D4 rejects
 * the token.
 */
export const QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION = "1.6.0" as const;
export const QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE =
  "build123d-closed-subset-v1" as const;

/**
 * Hand table for 1.6.0 — not the inventory. F1 generates the replacement
 * from `config/build123d-api/inventory-0.11.1.json` plus type methods.
 * D4 remains authoritative for reachability; this set only states which
 * calls the frontend can currently qualify semantically.
 */
const QUALIFIED_BUILD123D_CALLS = new Map(
  [
    ["Box", { role: "solid", positionalArguments: 3 }],
    ["Cylinder", { role: "solid", positionalArguments: 2 }],
    ["Cone", { role: "solid", positionalArguments: 3 }],
    ["Sphere", { role: "solid", positionalArguments: 1 }],
    ["Torus", { role: "solid", positionalArguments: 2 }],
    ["Ellipsoid", { role: "solid", positionalArguments: 3 }],
    ["Wedge", { role: "solid", positionalArguments: 7 }],
    ["Rectangle", { role: "sketch", positionalArguments: 2 }],
    ["Circle", { role: "sketch", positionalArguments: 1 }],
    ["Ellipse", { role: "sketch", positionalArguments: 2 }],
    ["RegularPolygon", { role: "sketch", positionalArguments: 2 }],
    ["Pos", { role: "placement", positionalArguments: 3 }],
    ["Rot", { role: "placement", positionalArguments: 3 }],
    ["Compound", { role: "assembly", positionalArguments: 0 }],
    ["scale", { role: "transform", positionalArguments: 2 }],
    ["fillet", { role: "transform", positionalArguments: 1 }],
    ["chamfer", { role: "transform", positionalArguments: 1 }],
    ["extrude", { role: "transform", positionalArguments: 1 }],
    ["offset", { role: "transform", positionalArguments: 1 }],
    ["revolve", { role: "transform", positionalArguments: 1 }],
  ] as const,
);

const QUALIFIED_MATH_SCALARS = new Set(["pi", "e", "tau"]);
const QUALIFIED_BUILD123D_ENUMS = new Set(["Plane", "Axis"]);
const QUALIFIED_PLANE_NAMES = new Set(["XY", "XZ", "YZ", "YX", "ZX", "ZY"]);
const QUALIFIED_AXIS_NAMES = new Set(["X", "Y", "Z"]);
const PLACEMENT_LEFT_OPERAND_SENTENCE =
  "The left operand of * must be a Pos or Rot call, a product of those placements, a name bound to one of those placements, or Plane.XY|XZ|YZ|YX|ZX|ZY.";

const QUALIFIED_IMPORT_SENTENCE =
  "Only an explicit named import from build123d, or from math of pi, e, or tau, is qualified in v1.";

type GeometryKind = "solid" | "sketch";
type QualifiedBuild123dCallName =
  | "Box"
  | "Cylinder"
  | "Cone"
  | "Sphere"
  | "Torus"
  | "Ellipsoid"
  | "Wedge"
  | "Rectangle"
  | "Circle"
  | "Ellipse"
  | "RegularPolygon"
  | "Pos"
  | "Rot"
  | "Compound"
  | "scale"
  | "fillet"
  | "chamfer"
  | "extrude"
  | "offset"
  | "revolve";
type PositionalBuild123dCallName = Exclude<
  QualifiedBuild123dCallName,
  "Compound" | "scale" | "fillet" | "chamfer" | "extrude" | "offset" | "revolve"
>;

interface ParsedNode {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly isError: boolean;
  readonly children: readonly ParsedNode[];
}

type AddUnresolved = (
  kind: string,
  message: string,
  node: ParsedNode,
) => void;

interface SimpleAssignment {
  readonly name: string;
  readonly nameNode: ParsedNode;
  readonly rhs: ParsedNode;
  readonly assignment: ParsedNode;
}

interface ImportedName {
  readonly imported: string;
  readonly local: string;
  readonly node: ParsedNode;
}

interface SupportedParameter {
  readonly assignment: SimpleAssignment;
  readonly shape: "scalar" | "list";
  readonly references: readonly SupportedParameter[];
  readonly symbol: SourceAnalysisSymbol;
}

interface SupportedShape {
  readonly assignment: SimpleAssignment;
  readonly symbol: SourceAnalysisSymbol;
  readonly geometry: GeometryKind;
  readonly parameterReferences: readonly SupportedParameter[];
  readonly shapeReferences: readonly SupportedShape[];
  readonly placementReferences: readonly SupportedPlacement[];
}

interface SupportedPlacement {
  readonly assignment: SimpleAssignment;
  readonly symbol: SourceAnalysisSymbol;
  readonly parameterReferences: readonly SupportedParameter[];
  readonly placementReferences: readonly SupportedPlacement[];
}

interface ShapeExpression {
  readonly geometry: GeometryKind;
  readonly parameterReferences: readonly SupportedParameter[];
  readonly shapeReferences: readonly SupportedShape[];
  readonly placementReferences: readonly SupportedPlacement[];
}

interface PlacementExpression {
  readonly parameterReferences: readonly SupportedParameter[];
  readonly placementReferences: readonly SupportedPlacement[];
}

interface StaticExpression {
  readonly shape: "scalar" | "list";
  readonly references: readonly SupportedParameter[];
}

interface UnresolvedCandidate {
  readonly kind: string;
  readonly message: string;
  readonly node: ParsedNode;
}

/** Pure, provider-free build123d closed-subset analyzer. */
export class QualifiedBuild123dSourceAnalyzer implements SourceAnalysisFrontend {
  async analyze(
    input: SourceAnalysisFrontendInput,
  ): Promise<SourceAnalysisBundle> {
    if (input.role !== "cad-script" || input.language !== "python") {
      throw new TypeError(
        "QualifiedBuild123dSourceAnalyzer only accepts cad-script/python sources.",
      );
    }
    if (typeof input.sourceText !== "string") {
      throw new TypeError("Qualified build123d sourceText must be a string.");
    }

    const fingerprint = await fingerprintText(input.sourceText);
    try {
      validateGeometryScript(input.sourceText);
    } catch (error) {
      if (error instanceof GeometryScriptValidationError) {
        return rejectedByD4(input, fingerprint, error);
      }
      throw error;
    }

    const root = materialize(parser.parse(input.sourceText));
    bindNodeText(root, input.sourceText);
    const positions = new Utf16Positions(input.sourceText);
    const syntaxErrors = collectNodes(root, (node) => node.isError);
    if (syntaxErrors.length > 0) {
      return rejectedSyntax(input, fingerprint, positions, syntaxErrors);
    }

    const unresolvedCandidates: UnresolvedCandidate[] = [];
    const unresolvedKeys = new Set<string>();
    const addUnresolved = (
      kind: string,
      message: string,
      node: ParsedNode,
    ): void => {
      const key = `${kind}:${node.from}:${node.to}`;
      if (unresolvedKeys.has(key)) return;
      unresolvedKeys.add(key);
      unresolvedCandidates.push({ kind, message, node });
    };

    const importedCalls = new Map<string, ImportedName>();
    const mathScalars = new Map<string, ImportedName>();
    for (
      const node of root.children.filter((child) => child.name === "ImportStatement")
    ) {
      const imported = parseNamedImport(node);
      if (imported === undefined) {
        addUnresolved(
          "python-import-not-qualified",
          QUALIFIED_IMPORT_SENTENCE,
          node,
        );
        continue;
      }
      if (imported.module === "build123d") {
        for (const name of imported.names) {
          if (
            !QUALIFIED_BUILD123D_CALLS.has(
              name.imported as QualifiedBuild123dCallName,
            ) &&
            !QUALIFIED_BUILD123D_ENUMS.has(name.imported)
          ) {
            addUnresolved(
              "build123d-call-not-qualified",
              `build123d name ${name.imported} is admitted by D4 but not qualified by this frontend version.`,
              name.node,
            );
            continue;
          }
          if (importedCalls.has(name.local) || mathScalars.has(name.local)) {
            addUnresolved(
              "python-import-alias-ambiguous",
              `Import alias ${name.local} is declared more than once.`,
              node,
            );
            importedCalls.delete(name.local);
            mathScalars.delete(name.local);
            continue;
          }
          importedCalls.set(name.local, name);
        }
        continue;
      }
      if (imported.module === "math") {
        for (const name of imported.names) {
          if (!QUALIFIED_MATH_SCALARS.has(name.imported)) {
            addUnresolved(
              "math-name-not-qualified",
              `math name ${name.imported} is admitted by D4 but not qualified by this frontend version.`,
              name.node,
            );
            continue;
          }
          if (importedCalls.has(name.local) || mathScalars.has(name.local)) {
            addUnresolved(
              "python-import-alias-ambiguous",
              `Import alias ${name.local} is declared more than once.`,
              node,
            );
            importedCalls.delete(name.local);
            mathScalars.delete(name.local);
            continue;
          }
          mathScalars.set(name.local, name);
        }
        continue;
      }
      addUnresolved(
        "python-import-not-qualified",
        QUALIFIED_IMPORT_SENTENCE,
        node,
      );
    }
    const aliasesByImported = new Map<string, ImportedName[]>();
    for (const name of importedCalls.values()) {
      const aliases = aliasesByImported.get(name.imported) ?? [];
      aliases.push(name);
      aliasesByImported.set(name.imported, aliases);
    }
    for (const aliases of aliasesByImported.values()) {
      if (aliases.length < 2) continue;
      for (const alias of aliases) {
        addUnresolved(
          "build123d-import-ambiguous",
          `Imported name ${alias.imported} has more than one local binding.`,
          alias.node,
        );
        importedCalls.delete(alias.local);
      }
    }
    const mathAliasesByImported = new Map<string, ImportedName[]>();
    for (const name of mathScalars.values()) {
      const aliases = mathAliasesByImported.get(name.imported) ?? [];
      aliases.push(name);
      mathAliasesByImported.set(name.imported, aliases);
    }
    for (const aliases of mathAliasesByImported.values()) {
      if (aliases.length < 2) continue;
      for (const alias of aliases) {
        addUnresolved(
          "math-import-ambiguous",
          `Imported name ${alias.imported} has more than one local binding.`,
          alias.node,
        );
        mathScalars.delete(alias.local);
      }
    }

    const assignments = root.children
      .filter((node) => node.name === "AssignStatement")
      .map((node) => simpleAssignment(node));
    const simpleAssignments = assignments.filter(
      (assignment): assignment is SimpleAssignment => assignment !== undefined,
    );
    const assignmentCounts = new Map<string, number>();
    for (const assignment of simpleAssignments) {
      assignmentCounts.set(
        assignment.name,
        (assignmentCounts.get(assignment.name) ?? 0) + 1,
      );
    }

    const parameterByName = new Map<string, SupportedParameter>();
    const parameters: SupportedParameter[] = [];
    const placementByName = new Map<string, SupportedPlacement>();
    const placements: SupportedPlacement[] = [];
    const shapeByName = new Map<string, SupportedShape>();
    const shapes: SupportedShape[] = [];
    for (const node of root.children) {
      if (node.name === "ImportStatement") continue;
      if (node.name !== "AssignStatement") {
        addTopLevelUnresolved(node, addUnresolved);
        continue;
      }

      const assignment = simpleAssignment(node);
      if (assignment === undefined) {
        addExpressionUnresolved(node, addUnresolved);
        addUnresolved(
          "python-assignment-not-qualified",
          "Only a unique module-level assignment to one simple name is qualified in v1.",
          node,
        );
        continue;
      }
      if (assignment.name === "result") continue;
      if ((assignmentCounts.get(assignment.name) ?? 0) !== 1) {
        addUnresolved(
          "python-reassignment",
          `Name ${assignment.name} is assigned more than once.`,
          node,
        );
        continue;
      }
      if (importedCalls.has(assignment.name)) {
        importedCalls.delete(assignment.name);
        addUnresolved(
          "python-import-shadowing",
          `Assignment ${assignment.name} shadows a qualified build123d import.`,
          node,
        );
        continue;
      }
      if (mathScalars.has(assignment.name)) {
        mathScalars.delete(assignment.name);
        addUnresolved(
          "python-import-shadowing",
          `Assignment ${assignment.name} shadows a qualified math import.`,
          node,
        );
        continue;
      }

      const numeric = parseStaticExpression(
        assignment.rhs,
        parameterByName,
        mathScalars,
      );
      if (numeric !== undefined) {
        const symbol: SourceAnalysisSymbol = {
          id: await astStableId(
            "parameter",
            input.sourceId,
            assignment.assignment,
          ),
          kind: "parameter",
          name: assignment.name,
          span: positions.span(assignment.nameNode.from, assignment.nameNode.to),
        };
        const parameter: SupportedParameter = {
          assignment,
          shape: numeric.shape,
          references: uniqueParameters(numeric.references),
          symbol,
        };
        parameters.push(parameter);
        parameterByName.set(assignment.name, parameter);
        continue;
      }

      const shapeExpression = parseShapeExpression(
        assignment.rhs,
        importedCalls,
        parameterByName,
        shapeByName,
        placementByName,
        mathScalars,
        assignment.assignment.from,
        addUnresolved,
      );
      if (shapeExpression !== undefined) {
        const symbol: SourceAnalysisSymbol = {
          id: await astStableId(
            "variable",
            input.sourceId,
            assignment.assignment,
          ),
          kind: "variable",
          name: assignment.name,
          span: positions.span(assignment.nameNode.from, assignment.nameNode.to),
        };
        const shape: SupportedShape = {
          assignment,
          symbol,
          geometry: shapeExpression.geometry,
          parameterReferences: uniqueParameters(shapeExpression.parameterReferences),
          shapeReferences: uniqueShapes(shapeExpression.shapeReferences),
          placementReferences: uniquePlacements(shapeExpression.placementReferences),
        };
        shapes.push(shape);
        shapeByName.set(assignment.name, shape);
        continue;
      }

      const placementExpression = parsePlacementExpression(
        assignment.rhs,
        importedCalls,
        parameterByName,
        placementByName,
        mathScalars,
        assignment.assignment.from,
      );
      if (placementExpression !== undefined) {
        const symbol: SourceAnalysisSymbol = {
          id: await astStableId(
            "variable",
            input.sourceId,
            assignment.assignment,
          ),
          kind: "variable",
          name: assignment.name,
          span: positions.span(assignment.nameNode.from, assignment.nameNode.to),
        };
        const placement: SupportedPlacement = {
          assignment,
          symbol,
          parameterReferences: uniqueParameters(
            placementExpression.parameterReferences,
          ),
          placementReferences: uniquePlacements(
            placementExpression.placementReferences,
          ),
        };
        placements.push(placement);
        placementByName.set(assignment.name, placement);
        continue;
      }

      addExpressionUnresolved(assignment.rhs, addUnresolved);
      addUnresolved(
        "python-parameter-expression-not-qualified",
        `Assignment ${assignment.name} is not a closed qualified numeric expression, solid, sketch, or placement.`,
        assignment.rhs,
      );
    }

    const resultAssignments = simpleAssignments.filter((assignment) =>
      assignment.name === "result"
    );
    const resultAssignment = resultAssignments[0];
    if (resultAssignment === undefined || resultAssignments.length !== 1) {
      // D4 already required it. A disagreement between the lexical guard and
      // the parser is a rejection, never an empty-unresolved success.
      return rejectedParserBoundary(input, fingerprint, positions);
    }

    const resultSymbol: SourceAnalysisSymbol = {
      id: await astStableId(
        "artifact",
        input.sourceId,
        resultAssignment.assignment,
      ),
      kind: "artifact",
      name: "result",
      span: positions.span(
        resultAssignment.nameNode.from,
        resultAssignment.nameNode.to,
      ),
    };

    const resultShape = parseShapeExpression(
      resultAssignment.rhs,
      importedCalls,
      new Map(
        [...parameterByName].filter(([, parameter]) =>
          parameter.assignment.assignment.from < resultAssignment.assignment.from
        ),
      ),
      new Map(
        [...shapeByName].filter(([, shape]) =>
          shape.assignment.assignment.from < resultAssignment.assignment.from
        ),
      ),
      new Map(
        [...placementByName].filter(([, placement]) =>
          placement.assignment.assignment.from < resultAssignment.assignment.from
        ),
      ),
      mathScalars,
      resultAssignment.assignment.from,
      addUnresolved,
    );
    const resultSolid = resultShape?.geometry === "solid" ? resultShape : undefined;
    if (resultSolid === undefined) {
      if (resultShape !== undefined) {
        addGeometryKindMismatch(
          addUnresolved,
          "result",
          "solid",
          resultShape.geometry,
          resultAssignment.rhs,
        );
      } else {
        addExpressionUnresolved(resultAssignment.rhs, addUnresolved);
      }
      addUnresolved(
        "build123d-result-not-qualified",
        "result must be one qualified solid: Box/Cylinder/Cone/Sphere/Torus/Ellipsoid/Wedge, Pos/Rot/named-placement/Plane.XY|XZ|YZ|YX|ZX|ZY * solid or sketch then extrude or revolve, solid +/− solid, scale(solid, scalar), fillet(solid, scalar) or fillet(solid.edges(), radius=scalar or positional scalar), chamfer(solid, scalar) or chamfer(solid.edges(), scalar), extrude(sketch, amount=scalar or positional scalar, optional taper=scalar), offset(solid, amount=scalar or positional scalar), revolve(sketch, Axis.X|Y|Z), or Compound(children=[...]). A sketch is never a valid result.",
        resultAssignment.rhs,
      );
    }

    const dependencies: SourceAnalysisDependency[] = [];
    for (const parameter of parameters) {
      for (const reference of parameter.references) {
        dependencies.push(
          await dependency(
            "static-value-flow",
            input.sourceId,
            reference.symbol.id,
            parameter.symbol.id,
            parameter.assignment.rhs,
            positions,
          ),
        );
      }
    }
    for (const placement of placements) {
      for (const reference of placement.parameterReferences) {
        dependencies.push(
          await dependency(
            "static-value-flow",
            input.sourceId,
            reference.symbol.id,
            placement.symbol.id,
            placement.assignment.rhs,
            positions,
          ),
        );
      }
      for (const reference of placement.placementReferences) {
        dependencies.push(
          await dependency(
            "structural-incidence",
            input.sourceId,
            reference.symbol.id,
            placement.symbol.id,
            placement.assignment.rhs,
            positions,
          ),
        );
      }
    }
    for (const shape of shapes) {
      for (const reference of shape.parameterReferences) {
        dependencies.push(
          await dependency(
            "static-value-flow",
            input.sourceId,
            reference.symbol.id,
            shape.symbol.id,
            shape.assignment.rhs,
            positions,
          ),
        );
      }
      for (const reference of shape.shapeReferences) {
        dependencies.push(
          await dependency(
            "structural-incidence",
            input.sourceId,
            reference.symbol.id,
            shape.symbol.id,
            shape.assignment.rhs,
            positions,
          ),
        );
      }
      for (const reference of shape.placementReferences) {
        dependencies.push(
          await dependency(
            "structural-incidence",
            input.sourceId,
            reference.symbol.id,
            shape.symbol.id,
            shape.assignment.rhs,
            positions,
          ),
        );
      }
    }
    if (resultSolid !== undefined) {
      for (const reference of uniqueParameters(resultSolid.parameterReferences)) {
        dependencies.push(
          await dependency(
            "structural-incidence",
            input.sourceId,
            reference.symbol.id,
            resultSymbol.id,
            resultAssignment.rhs,
            positions,
          ),
        );
      }
      for (const reference of uniqueShapes(resultSolid.shapeReferences)) {
        dependencies.push(
          await dependency(
            "structural-incidence",
            input.sourceId,
            reference.symbol.id,
            resultSymbol.id,
            resultAssignment.rhs,
            positions,
          ),
        );
      }
      for (const reference of uniquePlacements(resultSolid.placementReferences)) {
        dependencies.push(
          await dependency(
            "structural-incidence",
            input.sourceId,
            reference.symbol.id,
            resultSymbol.id,
            resultAssignment.rhs,
            positions,
          ),
        );
      }
    }

    const unresolvedOccurrences = new Map<string, number>();
    const unresolvedWithOrdinals = unresolvedCandidates.map((candidate) => {
      const key = deterministicJson({
        kind: candidate.kind,
        ast: canonicalAst(candidate.node),
      });
      const ordinal = unresolvedOccurrences.get(key) ?? 0;
      unresolvedOccurrences.set(key, ordinal + 1);
      return { candidate, ordinal };
    });
    const unresolved = await Promise.all(
      unresolvedWithOrdinals.map(async ({ candidate, ordinal }) => ({
        id: await astStableId(
          "unresolved",
          input.sourceId,
          candidate.node,
          `${candidate.kind}:${ordinal}`,
        ),
        kind: candidate.kind,
        message: candidate.message,
        span: positions.span(candidate.node.from, candidate.node.to),
      } satisfies SourceAnalysisUnresolvedConstruct)),
    );

    return validateSourceAnalysisBundle({
      schemaVersion: SOURCE_ANALYSIS_SCHEMA,
      source: {
        id: input.sourceId,
        role: input.role,
        language: input.language,
        fingerprint,
      },
      analyzer: {
        id: QUALIFIED_BUILD123D_SOURCE_ANALYZER_ID,
        version: QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION,
      },
      policy: {
        profile: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
        status: "passed",
        findings: [],
      },
      symbols: [
        ...parameters.map((parameter) => parameter.symbol),
        ...placements.map((placement) => placement.symbol),
        ...shapes.map((shape) => shape.symbol),
        resultSymbol,
      ],
      dependencies: deduplicateDependencies(dependencies),
      unresolvedConstructs: unresolved,
    });
  }
}

function parseShapeExpression(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  shapes: ReadonlyMap<string, SupportedShape>,
  placements: ReadonlyMap<string, SupportedPlacement>,
  mathScalars: ReadonlyMap<string, ImportedName>,
  before: number,
  addUnresolved: AddUnresolved,
): ShapeExpression | undefined {
  if (node.name === "ParenthesizedExpression") {
    const inner = node.children.find(isStaticExpressionNode);
    return inner === undefined ? undefined : parseShapeExpression(
      inner,
      importedCalls,
      parameters,
      shapes,
      placements,
      mathScalars,
      before,
      addUnresolved,
    );
  }
  if (node.name === "VariableName") {
    const shape = shapes.get(currentText(node));
    if (shape === undefined || shape.assignment.assignment.from >= before) {
      return undefined;
    }
    return {
      geometry: shape.geometry,
      parameterReferences: [],
      shapeReferences: [shape],
      placementReferences: [],
    };
  }
  const positionalSolid = parsePositionalSolidCall(
    node,
    importedCalls,
    parameters,
    mathScalars,
    before,
  );
  if (positionalSolid !== undefined) return positionalSolid;
  const positionalSketch = parsePositionalSketchCall(
    node,
    importedCalls,
    parameters,
    mathScalars,
    before,
  );
  if (positionalSketch !== undefined) return positionalSketch;
  const compound = parseCompoundCall(
    node,
    importedCalls,
    shapes,
    before,
    addUnresolved,
  );
  if (compound !== undefined) return compound;
  const scaled = parseScaleCall(
    node,
    importedCalls,
    parameters,
    shapes,
    placements,
    mathScalars,
    before,
    addUnresolved,
  );
  if (scaled !== undefined) return scaled;
  const filleted = parseFilletCall(
    node,
    importedCalls,
    parameters,
    shapes,
    placements,
    mathScalars,
    before,
    addUnresolved,
  );
  if (filleted !== undefined) return filleted;
  const chamfered = parseChamferCall(
    node,
    importedCalls,
    parameters,
    shapes,
    placements,
    mathScalars,
    before,
    addUnresolved,
  );
  if (chamfered !== undefined) return chamfered;
  const extruded = parseExtrudeCall(
    node,
    importedCalls,
    parameters,
    shapes,
    placements,
    mathScalars,
    before,
    addUnresolved,
  );
  if (extruded !== undefined) return extruded;
  const offset = parseOffsetCall(
    node,
    importedCalls,
    parameters,
    shapes,
    placements,
    mathScalars,
    before,
    addUnresolved,
  );
  if (offset !== undefined) return offset;
  const revolved = parseRevolveCall(
    node,
    importedCalls,
    parameters,
    shapes,
    placements,
    mathScalars,
    before,
    addUnresolved,
  );
  if (revolved !== undefined) return revolved;
  if (node.name !== "BinaryExpression" || node.children.length !== 3) {
    return undefined;
  }
  const [left, operator, right] = node.children;
  if (left === undefined || right === undefined) {
    return undefined;
  }
  const operatorText = currentText(operator);
  if (operator?.name === "ArithOp" && operatorText === "*") {
    return parsePlacementTimesShape(
      node,
      left,
      right,
      importedCalls,
      parameters,
      shapes,
      placements,
      mathScalars,
      before,
      addUnresolved,
    );
  }
  // BitOp "&" is parsed so a later D4 ALLOWED_OPS admission does not need
  // a second frontend pass. Today D4 rejects "&" as unrecognized_token
  // before analyze() reaches this branch.
  if (
    !(
      (operator?.name === "ArithOp" &&
        (operatorText === "+" || operatorText === "-")) ||
      (operator?.name === "BitOp" && operatorText === "&")
    )
  ) {
    return undefined;
  }
  const leftShape = parseShapeExpression(
    left,
    importedCalls,
    parameters,
    shapes,
    placements,
    mathScalars,
    before,
    addUnresolved,
  );
  const rightShape = parseShapeExpression(
    right,
    importedCalls,
    parameters,
    shapes,
    placements,
    mathScalars,
    before,
    addUnresolved,
  );
  if (leftShape === undefined || rightShape === undefined) return undefined;
  if (leftShape.geometry !== rightShape.geometry) {
    addGeometryKindMismatch(
      addUnresolved,
      operatorText,
      leftShape.geometry,
      rightShape.geometry,
      right,
    );
    return undefined;
  }
  return {
    geometry: leftShape.geometry,
    parameterReferences: [
      ...leftShape.parameterReferences,
      ...rightShape.parameterReferences,
    ],
    shapeReferences: [
      ...leftShape.shapeReferences,
      ...rightShape.shapeReferences,
    ],
    placementReferences: [
      ...leftShape.placementReferences,
      ...rightShape.placementReferences,
    ],
  };
}

function parsePlacementExpression(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  placements: ReadonlyMap<string, SupportedPlacement>,
  mathScalars: ReadonlyMap<string, ImportedName>,
  before: number,
): PlacementExpression | undefined {
  if (node.name === "ParenthesizedExpression") {
    const inner = node.children.find(isStaticExpressionNode);
    return inner === undefined ? undefined : parsePlacementExpression(
      inner,
      importedCalls,
      parameters,
      placements,
      mathScalars,
      before,
    );
  }
  if (node.name === "VariableName") {
    const placement = placements.get(currentText(node));
    if (placement === undefined || placement.assignment.assignment.from >= before) {
      return undefined;
    }
    return {
      parameterReferences: [],
      placementReferences: [placement],
    };
  }
  const plane = parseNamedPlane(node, importedCalls);
  if (plane !== undefined) return plane;
  const pos = parsePositionalCall(
    node,
    importedCalls,
    parameters,
    mathScalars,
    before,
    "Pos",
  );
  if (pos !== undefined) return pos;
  const rot = parsePositionalCall(
    node,
    importedCalls,
    parameters,
    mathScalars,
    before,
    "Rot",
  );
  if (rot !== undefined) return rot;
  if (node.name !== "BinaryExpression" || node.children.length !== 3) {
    return undefined;
  }
  const [left, operator, right] = node.children;
  if (left === undefined || right === undefined || operator?.name !== "ArithOp") {
    return undefined;
  }
  if (currentText(operator) !== "*") return undefined;
  const leftPlacement = parsePlacementExpression(
    left,
    importedCalls,
    parameters,
    placements,
    mathScalars,
    before,
  );
  const rightPlacement = parsePlacementExpression(
    right,
    importedCalls,
    parameters,
    placements,
    mathScalars,
    before,
  );
  if (leftPlacement === undefined || rightPlacement === undefined) {
    return undefined;
  }
  return {
    parameterReferences: [
      ...leftPlacement.parameterReferences,
      ...rightPlacement.parameterReferences,
    ],
    placementReferences: [
      ...leftPlacement.placementReferences,
      ...rightPlacement.placementReferences,
    ],
  };
}

function parseNamedPlane(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
): PlacementExpression | undefined {
  if (node.name !== "MemberExpression" || node.children.length !== 3) {
    return undefined;
  }
  const [object, dot, property] = node.children;
  if (
    object?.name !== "VariableName" ||
    importedCalls.get(currentText(object))?.imported !== "Plane" ||
    currentText(dot) !== "." ||
    property?.name !== "PropertyName" ||
    !QUALIFIED_PLANE_NAMES.has(currentText(property))
  ) {
    return undefined;
  }
  return { parameterReferences: [], placementReferences: [] };
}

function parseNamedAxis(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
): boolean {
  if (node.name === "ParenthesizedExpression") {
    const inner = node.children.find(isStaticExpressionNode);
    return inner === undefined ? false : parseNamedAxis(inner, importedCalls);
  }
  if (node.name !== "MemberExpression" || node.children.length !== 3) {
    return false;
  }
  const [object, dot, property] = node.children;
  return object?.name === "VariableName" &&
    importedCalls.get(currentText(object))?.imported === "Axis" &&
    currentText(dot) === "." &&
    property?.name === "PropertyName" &&
    QUALIFIED_AXIS_NAMES.has(currentText(property));
}

function unreviewedPlaneProperty(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
): string | undefined {
  if (node.name !== "MemberExpression" || node.children.length !== 3) {
    return undefined;
  }
  const [object, dot, property] = node.children;
  if (
    object?.name !== "VariableName" ||
    importedCalls.get(currentText(object))?.imported !== "Plane" ||
    currentText(dot) !== "." ||
    property?.name !== "PropertyName"
  ) {
    return undefined;
  }
  const name = currentText(property);
  return QUALIFIED_PLANE_NAMES.has(name) ? undefined : name;
}

function unreviewedAxisProperty(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
): string | undefined {
  if (node.name === "ParenthesizedExpression") {
    const inner = node.children.find(isStaticExpressionNode);
    return inner === undefined
      ? undefined
      : unreviewedAxisProperty(inner, importedCalls);
  }
  if (node.name !== "MemberExpression" || node.children.length !== 3) {
    return undefined;
  }
  const [object, dot, property] = node.children;
  if (
    object?.name !== "VariableName" ||
    importedCalls.get(currentText(object))?.imported !== "Axis" ||
    currentText(dot) !== "." ||
    property?.name !== "PropertyName"
  ) {
    return undefined;
  }
  const name = currentText(property);
  return QUALIFIED_AXIS_NAMES.has(name) ? undefined : name;
}

function parsePlacementTimesShape(
  _node: ParsedNode,
  left: ParsedNode,
  right: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  shapes: ReadonlyMap<string, SupportedShape>,
  placements: ReadonlyMap<string, SupportedPlacement>,
  mathScalars: ReadonlyMap<string, ImportedName>,
  before: number,
  addUnresolved: AddUnresolved,
): ShapeExpression | undefined {
  const shape = parseShapeExpression(
    right,
    importedCalls,
    parameters,
    shapes,
    placements,
    mathScalars,
    before,
    addUnresolved,
  );
  if (shape === undefined) return undefined;
  const place = parsePlacementExpression(
    left,
    importedCalls,
    parameters,
    placements,
    mathScalars,
    before,
  );
  if (place === undefined) {
    const planeName = unreviewedPlaneProperty(left, importedCalls);
    if (planeName !== undefined) {
      addUnresolved(
        "build123d-plane-not-qualified",
        `Plane.${planeName} is not a reviewed plane; reviewed planes are Plane.XY, Plane.XZ, Plane.YZ, Plane.YX, Plane.ZX, and Plane.ZY.`,
        left,
      );
    }
    addUnresolved(
      "build123d-placement-not-qualified",
      PLACEMENT_LEFT_OPERAND_SENTENCE,
      left,
    );
    return undefined;
  }
  return {
    geometry: shape.geometry,
    parameterReferences: [
      ...place.parameterReferences,
      ...shape.parameterReferences,
    ],
    shapeReferences: shape.shapeReferences,
    placementReferences: [
      ...place.placementReferences,
      ...shape.placementReferences,
    ],
  };
}

function parsePositionalSolidCall(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  mathScalars: ReadonlyMap<string, ImportedName>,
  before: number,
): ShapeExpression | undefined {
  for (
    const imported of [
      "Box",
      "Cylinder",
      "Cone",
      "Sphere",
      "Torus",
      "Ellipsoid",
      "Wedge",
    ] as const
  ) {
    const parsed = parsePositionalCall(
      node,
      importedCalls,
      parameters,
      mathScalars,
      before,
      imported,
    );
    if (parsed !== undefined) {
      return {
        ...parsed,
        geometry: "solid",
        shapeReferences: [],
        placementReferences: parsed.placementReferences,
      };
    }
  }
  return undefined;
}

function parsePositionalSketchCall(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  mathScalars: ReadonlyMap<string, ImportedName>,
  before: number,
): ShapeExpression | undefined {
  for (
    const imported of ["Rectangle", "Circle", "Ellipse", "RegularPolygon"] as const
  ) {
    const parsed = parsePositionalCall(
      node,
      importedCalls,
      parameters,
      mathScalars,
      before,
      imported,
    );
    if (parsed !== undefined) {
      return {
        ...parsed,
        geometry: "sketch",
        shapeReferences: [],
        placementReferences: parsed.placementReferences,
      };
    }
  }
  return undefined;
}

function parsePositionalCall(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  mathScalars: ReadonlyMap<string, ImportedName>,
  before: number,
  importedName: PositionalBuild123dCallName,
): PlacementExpression | undefined {
  if (node.name !== "CallExpression" || node.children.length !== 2) {
    return undefined;
  }
  const [callee, argList] = node.children;
  if (callee?.name !== "VariableName" || argList?.name !== "ArgList") {
    return undefined;
  }
  const imported = importedCalls.get(currentText(callee));
  if (imported?.imported !== importedName || imported.node.from >= before) {
    return undefined;
  }
  const policy = QUALIFIED_BUILD123D_CALLS.get(importedName)!;
  const expressions = argList.children.filter(isArgumentExpression);
  if (
    expressions.length !== policy.positionalArguments ||
    argList.children.some((child) =>
      child.name === "AssignOp" || ["*", "**"].includes(currentText(child))
    )
  ) {
    return undefined;
  }
  const parameterReferences: SupportedParameter[] = [];
  for (const expressionNode of expressions) {
    const expression = parseStaticExpression(
      expressionNode,
      parameters,
      mathScalars,
    );
    if (expression === undefined || expression.shape !== "scalar") return undefined;
    parameterReferences.push(...expression.references);
  }
  return { parameterReferences, placementReferences: [] };
}

/**
 * Only the reviewed algebraic form `scale(<qualified-solid>, <scalar>)`.
 * Keyword `by=`/`about=`/`mode=`, a lone argument, or a list/tuple factor
 * stay unproven.  This is not the `Scale` location class.
 */
function parseScaleCall(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  shapes: ReadonlyMap<string, SupportedShape>,
  placements: ReadonlyMap<string, SupportedPlacement>,
  mathScalars: ReadonlyMap<string, ImportedName>,
  before: number,
  addUnresolved: AddUnresolved,
): ShapeExpression | undefined {
  if (node.name !== "CallExpression" || node.children.length !== 2) {
    return undefined;
  }
  const [callee, argList] = node.children;
  if (callee?.name !== "VariableName" || argList?.name !== "ArgList") {
    return undefined;
  }
  const imported = importedCalls.get(currentText(callee));
  if (imported?.imported !== "scale" || imported.node.from >= before) {
    return undefined;
  }
  if (
    argList.children.some((child) =>
      child.name === "AssignOp" || ["*", "**"].includes(currentText(child))
    )
  ) {
    return undefined;
  }
  const expressions = argList.children.filter(isArgumentExpression);
  if (expressions.length !== 2) return undefined;
  const [solidNode, factorNode] = expressions;
  if (solidNode === undefined || factorNode === undefined) return undefined;
  const solid = parseShapeExpression(
    solidNode,
    importedCalls,
    parameters,
    shapes,
    placements,
    mathScalars,
    before,
    addUnresolved,
  );
  const factor = parseStaticExpression(factorNode, parameters, mathScalars);
  if (solid === undefined || factor === undefined || factor.shape !== "scalar") {
    return undefined;
  }
  if (solid.geometry !== "solid") {
    addGeometryKindMismatch(
      addUnresolved,
      "scale",
      "solid",
      solid.geometry,
      solidNode,
    );
    return undefined;
  }
  return {
    geometry: "solid",
    parameterReferences: [
      ...solid.parameterReferences,
      ...factor.references,
    ],
    shapeReferences: solid.shapeReferences,
    placementReferences: solid.placementReferences,
  };
}

/**
 * Reviewed forms: `fillet(solid, scalar)`, `fillet(solid.edges(), scalar)`,
 * and `fillet(solid.edges(), radius=scalar)`.  Method form, `.faces()`,
 * `filter_by`, extra kwargs, and `fillet(solid, radius=scalar)` stay
 * unproven.  This does not qualify general MemberExpression — only the
 * empty `.edges()` pattern inside a reviewed fillet call.
 */
function parseFilletCall(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  shapes: ReadonlyMap<string, SupportedShape>,
  placements: ReadonlyMap<string, SupportedPlacement>,
  mathScalars: ReadonlyMap<string, ImportedName>,
  before: number,
  addUnresolved: AddUnresolved,
): ShapeExpression | undefined {
  if (node.name !== "CallExpression" || node.children.length !== 2) {
    return undefined;
  }
  const [callee, argList] = node.children;
  if (callee?.name !== "VariableName" || argList?.name !== "ArgList") {
    return undefined;
  }
  const imported = importedCalls.get(currentText(callee));
  if (imported?.imported !== "fillet" || imported.node.from >= before) {
    return undefined;
  }
  if (argList.children.some((child) => ["*", "**"].includes(currentText(child)))) {
    return undefined;
  }
  const keywordNames = extrudeKeywordNames(argList);
  const expressions = argList.children.filter(isArgumentExpression);
  const hasAssign = argList.children.some((child) => child.name === "AssignOp");

  if (expressions.length === 4) {
    const [edgesNode, keyword, assign, radiusNode] = expressions;
    if (
      edgesNode !== undefined &&
      keyword?.name === "VariableName" && currentText(keyword) === "radius" &&
      assign?.name === "AssignOp" && currentText(assign) === "=" &&
      radiusNode !== undefined
    ) {
      const solid = parseEmptyEdgesSelector(
        edgesNode,
        importedCalls,
        parameters,
        shapes,
        placements,
        mathScalars,
        before,
        addUnresolved,
      );
      const radius = parseStaticExpression(radiusNode, parameters, mathScalars);
      if (solid !== undefined && radius !== undefined && radius.shape === "scalar") {
        return qualifyFilletOrChamferSolid(
          "fillet",
          solid,
          radius,
          edgesNode,
          addUnresolved,
        );
      }
    }
  }

  if (expressions.length === 2 && !hasAssign) {
    const [first, radiusNode] = expressions;
    if (first !== undefined && radiusNode !== undefined) {
      const radius = parseStaticExpression(radiusNode, parameters, mathScalars);
      if (radius !== undefined && radius.shape === "scalar") {
        const edges = parseEmptyEdgesSelector(
          first,
          importedCalls,
          parameters,
          shapes,
          placements,
          mathScalars,
          before,
          addUnresolved,
        );
        if (edges !== undefined) {
          return qualifyFilletOrChamferSolid(
            "fillet",
            edges,
            radius,
            first,
            addUnresolved,
          );
        }
        const solid = parseShapeExpression(
          first,
          importedCalls,
          parameters,
          shapes,
          placements,
          mathScalars,
          before,
          addUnresolved,
        );
        if (solid !== undefined) {
          return qualifyFilletOrChamferSolid(
            "fillet",
            solid,
            radius,
            first,
            addUnresolved,
          );
        }
      }
    }
  }

  if (keywordNames.length > 0) {
    for (const keyword of keywordNames) {
      addUnresolved(
        "build123d-fillet-argument-not-qualified",
        `fillet keyword ${keyword}= is not qualified; reviewed forms are fillet(solid, scalar), fillet(solid.edges(), scalar), and fillet(solid.edges(), radius=scalar).`,
        node,
      );
    }
    return undefined;
  }
  addUnresolved(
    "build123d-fillet-argument-not-qualified",
    "fillet arguments are not a reviewed form; reviewed forms are fillet(solid, scalar), fillet(solid.edges(), scalar), and fillet(solid.edges(), radius=scalar).",
    node,
  );
  return undefined;
}

/**
 * Reviewed forms: `chamfer(solid, scalar)` and
 * `chamfer(solid.edges(), scalar)`.  Keyword `length=`, `length2=`, `face=`,
 * `angle=`, `.faces()`, extra arguments, and the method form stay unproven.
 * This does not open general MemberExpression — only the already-qualified
 * empty `.edges()` pattern inside a reviewed chamfer call.
 */
function parseChamferCall(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  shapes: ReadonlyMap<string, SupportedShape>,
  placements: ReadonlyMap<string, SupportedPlacement>,
  mathScalars: ReadonlyMap<string, ImportedName>,
  before: number,
  addUnresolved: AddUnresolved,
): ShapeExpression | undefined {
  if (node.name !== "CallExpression" || node.children.length !== 2) {
    return undefined;
  }
  const [callee, argList] = node.children;
  if (callee?.name !== "VariableName" || argList?.name !== "ArgList") {
    return undefined;
  }
  const imported = importedCalls.get(currentText(callee));
  if (imported?.imported !== "chamfer" || imported.node.from >= before) {
    return undefined;
  }
  if (argList.children.some((child) => ["*", "**"].includes(currentText(child)))) {
    return undefined;
  }
  const keywordNames = extrudeKeywordNames(argList);
  const expressions = argList.children.filter(isArgumentExpression);
  const hasAssign = argList.children.some((child) => child.name === "AssignOp");

  if (expressions.length === 2 && !hasAssign) {
    const [first, lengthNode] = expressions;
    if (first !== undefined && lengthNode !== undefined) {
      const length = parseStaticExpression(lengthNode, parameters, mathScalars);
      if (length !== undefined && length.shape === "scalar") {
        const edges = parseEmptyEdgesSelector(
          first,
          importedCalls,
          parameters,
          shapes,
          placements,
          mathScalars,
          before,
          addUnresolved,
        );
        if (edges !== undefined) {
          return qualifyFilletOrChamferSolid(
            "chamfer",
            edges,
            length,
            first,
            addUnresolved,
          );
        }
        const solid = parseShapeExpression(
          first,
          importedCalls,
          parameters,
          shapes,
          placements,
          mathScalars,
          before,
          addUnresolved,
        );
        if (solid !== undefined) {
          return qualifyFilletOrChamferSolid(
            "chamfer",
            solid,
            length,
            first,
            addUnresolved,
          );
        }
      }
    }
  }

  if (keywordNames.length > 0) {
    for (const keyword of keywordNames) {
      addUnresolved(
        "build123d-chamfer-argument-not-qualified",
        `chamfer keyword ${keyword}= is not qualified; reviewed forms are chamfer(solid, scalar) and chamfer(solid.edges(), scalar).`,
        node,
      );
    }
    return undefined;
  }
  addUnresolved(
    "build123d-chamfer-argument-not-qualified",
    "chamfer arguments are not a reviewed form; reviewed forms are chamfer(solid, scalar) and chamfer(solid.edges(), scalar).",
    node,
  );
  return undefined;
}

function qualifyFilletOrChamferSolid(
  operation: "fillet" | "chamfer",
  solid: ShapeExpression,
  scalar: StaticExpression,
  spanNode: ParsedNode,
  addUnresolved: AddUnresolved,
): ShapeExpression | undefined {
  if (solid.geometry !== "solid") {
    addGeometryKindMismatch(
      addUnresolved,
      operation,
      "solid",
      solid.geometry,
      spanNode,
    );
    return undefined;
  }
  return {
    geometry: "solid",
    parameterReferences: [
      ...solid.parameterReferences,
      ...scalar.references,
    ],
    shapeReferences: solid.shapeReferences,
    placementReferences: solid.placementReferences,
  };
}

/** Empty `.edges()` on a qualified shape. Not a general MemberExpression lock. */
function parseEmptyEdgesSelector(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  shapes: ReadonlyMap<string, SupportedShape>,
  placements: ReadonlyMap<string, SupportedPlacement>,
  mathScalars: ReadonlyMap<string, ImportedName>,
  before: number,
  addUnresolved: AddUnresolved,
): ShapeExpression | undefined {
  if (node.name !== "CallExpression" || node.children.length !== 2) {
    return undefined;
  }
  const [callee, argList] = node.children;
  if (callee?.name !== "MemberExpression" || argList?.name !== "ArgList") {
    return undefined;
  }
  if (argList.children.filter(isArgumentExpression).length !== 0) {
    return undefined;
  }
  if (callee.children.length !== 3) return undefined;
  const [object, dot, property] = callee.children;
  if (
    object === undefined ||
    currentText(dot) !== "." ||
    property?.name !== "PropertyName" ||
    currentText(property) !== "edges"
  ) {
    return undefined;
  }
  return parseShapeExpression(
    object,
    importedCalls,
    parameters,
    shapes,
    placements,
    mathScalars,
    before,
    addUnresolved,
  );
}

/**
 * Reviewed forms: `extrude(<qualified-sketch>, amount=<scalar>)`,
 * `extrude(<qualified-sketch>, <scalar>)`, and the same with optional
 * `taper=<scalar>`.  `both=`, `dir=`, `until=`, extra arguments, splat,
 * and extrude of a solid stay unproven.
 */
function parseExtrudeCall(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  shapes: ReadonlyMap<string, SupportedShape>,
  placements: ReadonlyMap<string, SupportedPlacement>,
  mathScalars: ReadonlyMap<string, ImportedName>,
  before: number,
  addUnresolved: AddUnresolved,
): ShapeExpression | undefined {
  if (node.name !== "CallExpression" || node.children.length !== 2) {
    return undefined;
  }
  const [callee, argList] = node.children;
  if (callee?.name !== "VariableName" || argList?.name !== "ArgList") {
    return undefined;
  }
  const imported = importedCalls.get(currentText(callee));
  if (imported?.imported !== "extrude" || imported.node.from >= before) {
    return undefined;
  }
  if (argList.children.some((child) => ["*", "**"].includes(currentText(child)))) {
    return undefined;
  }
  const keywordNames = extrudeKeywordNames(argList);
  let hasUnreviewedKeyword = false;
  for (const keyword of keywordNames) {
    if (keyword === "amount" || keyword === "taper") continue;
    hasUnreviewedKeyword = true;
    addUnresolved(
      "build123d-extrude-argument-not-qualified",
      `extrude keyword ${keyword}= is not qualified; only amount= and taper= are reviewed.`,
      node,
    );
  }
  if (hasUnreviewedKeyword) return undefined;

  const keywordValues = keywordValueNodes(argList);
  const positionals = positionalArgumentNodes(argList);
  const amountKeyword = keywordValues.get("amount");
  const taperNode = keywordValues.get("taper");
  const sketchNode = positionals[0];
  const positionalAmount = positionals.length === 2 ? positionals[1] : undefined;
  const amountNode = amountKeyword ?? positionalAmount;

  if (
    sketchNode === undefined ||
    positionals.length > 2 ||
    (positionals.length === 2 && amountKeyword !== undefined)
  ) {
    return undefined;
  }
  if (amountNode === undefined) {
    addUnresolved(
      "build123d-extrude-argument-not-qualified",
      "extrude requires amount= or a positional amount.",
      node,
    );
    return undefined;
  }
  return qualifyExtrude(
    sketchNode,
    amountNode,
    taperNode,
    importedCalls,
    parameters,
    shapes,
    placements,
    mathScalars,
    before,
    addUnresolved,
  );
}

function qualifyExtrude(
  sketchNode: ParsedNode,
  amountNode: ParsedNode,
  taperNode: ParsedNode | undefined,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  shapes: ReadonlyMap<string, SupportedShape>,
  placements: ReadonlyMap<string, SupportedPlacement>,
  mathScalars: ReadonlyMap<string, ImportedName>,
  before: number,
  addUnresolved: AddUnresolved,
): ShapeExpression | undefined {
  const sketch = parseShapeExpression(
    sketchNode,
    importedCalls,
    parameters,
    shapes,
    placements,
    mathScalars,
    before,
    addUnresolved,
  );
  const amount = parseStaticExpression(amountNode, parameters, mathScalars);
  const taper = taperNode === undefined
    ? undefined
    : parseStaticExpression(taperNode, parameters, mathScalars);
  if (
    sketch === undefined || amount === undefined || amount.shape !== "scalar" ||
    (taperNode !== undefined && (taper === undefined || taper.shape !== "scalar"))
  ) {
    return undefined;
  }
  if (sketch.geometry !== "sketch") {
    addGeometryKindMismatch(
      addUnresolved,
      "extrude",
      "sketch",
      sketch.geometry,
      sketchNode,
    );
    return undefined;
  }
  return {
    geometry: "solid",
    parameterReferences: [
      ...sketch.parameterReferences,
      ...amount.references,
      ...(taper?.references ?? []),
    ],
    shapeReferences: sketch.shapeReferences,
    placementReferences: sketch.placementReferences,
  };
}

function extrudeKeywordNames(argList: ParsedNode): readonly string[] {
  const names: string[] = [];
  for (let index = 0; index < argList.children.length - 1; index++) {
    const child = argList.children[index];
    const next = argList.children[index + 1];
    if (child?.name === "VariableName" && next?.name === "AssignOp") {
      names.push(currentText(child));
    }
  }
  return names;
}

function keywordValueNodes(argList: ParsedNode): ReadonlyMap<string, ParsedNode> {
  const values = new Map<string, ParsedNode>();
  for (let index = 0; index < argList.children.length - 2; index++) {
    const name = argList.children[index];
    const assign = argList.children[index + 1];
    const value = argList.children[index + 2];
    if (
      name?.name === "VariableName" &&
      assign?.name === "AssignOp" &&
      value !== undefined &&
      isArgumentExpression(value)
    ) {
      values.set(currentText(name), value);
    }
  }
  return values;
}

function positionalArgumentNodes(argList: ParsedNode): readonly ParsedNode[] {
  const owned = new Set<ParsedNode>();
  for (let index = 0; index < argList.children.length - 2; index++) {
    const name = argList.children[index];
    const assign = argList.children[index + 1];
    const value = argList.children[index + 2];
    if (name?.name === "VariableName" && assign?.name === "AssignOp") {
      owned.add(name);
      owned.add(assign);
      if (value !== undefined) owned.add(value);
    }
  }
  return argList.children.filter((child) =>
    isArgumentExpression(child) && !owned.has(child)
  );
}

/**
 * Reviewed forms: `offset(solid, scalar)` and `offset(solid, amount=scalar)`.
 * `openings=`, `kind=`, `side=`, a lone argument, sketch offset, and the
 * method form stay unproven.
 */
function parseOffsetCall(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  shapes: ReadonlyMap<string, SupportedShape>,
  placements: ReadonlyMap<string, SupportedPlacement>,
  mathScalars: ReadonlyMap<string, ImportedName>,
  before: number,
  addUnresolved: AddUnresolved,
): ShapeExpression | undefined {
  if (node.name !== "CallExpression" || node.children.length !== 2) {
    return undefined;
  }
  const [callee, argList] = node.children;
  if (callee?.name !== "VariableName" || argList?.name !== "ArgList") {
    return undefined;
  }
  const imported = importedCalls.get(currentText(callee));
  if (imported?.imported !== "offset" || imported.node.from >= before) {
    return undefined;
  }
  if (argList.children.some((child) => ["*", "**"].includes(currentText(child)))) {
    return undefined;
  }
  const keywordNames = extrudeKeywordNames(argList);
  const expressions = argList.children.filter(isArgumentExpression);
  const hasAssign = argList.children.some((child) => child.name === "AssignOp");

  if (expressions.length === 2 && !hasAssign) {
    const [solidNode, amountNode] = expressions;
    if (solidNode !== undefined && amountNode !== undefined) {
      const qualified = qualifyOffset(
        solidNode,
        amountNode,
        importedCalls,
        parameters,
        shapes,
        placements,
        mathScalars,
        before,
        addUnresolved,
      );
      if (qualified !== undefined) return qualified;
    }
  }

  if (expressions.length === 4) {
    const [solidNode, keyword, assign, amountNode] = expressions;
    if (
      solidNode !== undefined &&
      keyword?.name === "VariableName" && currentText(keyword) === "amount" &&
      assign?.name === "AssignOp" && currentText(assign) === "=" &&
      amountNode !== undefined
    ) {
      const qualified = qualifyOffset(
        solidNode,
        amountNode,
        importedCalls,
        parameters,
        shapes,
        placements,
        mathScalars,
        before,
        addUnresolved,
      );
      if (qualified !== undefined) return qualified;
    }
  }

  if (keywordNames.length > 0) {
    for (const keyword of keywordNames) {
      addUnresolved(
        "build123d-offset-argument-not-qualified",
        `offset keyword ${keyword}= is not qualified; reviewed forms are offset(solid, scalar) and offset(solid, amount=scalar).`,
        node,
      );
    }
    return undefined;
  }
  addUnresolved(
    "build123d-offset-argument-not-qualified",
    "offset arguments are not a reviewed form; reviewed forms are offset(solid, scalar) and offset(solid, amount=scalar).",
    node,
  );
  return undefined;
}

function qualifyOffset(
  solidNode: ParsedNode,
  amountNode: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  shapes: ReadonlyMap<string, SupportedShape>,
  placements: ReadonlyMap<string, SupportedPlacement>,
  mathScalars: ReadonlyMap<string, ImportedName>,
  before: number,
  addUnresolved: AddUnresolved,
): ShapeExpression | undefined {
  const solid = parseShapeExpression(
    solidNode,
    importedCalls,
    parameters,
    shapes,
    placements,
    mathScalars,
    before,
    addUnresolved,
  );
  const amount = parseStaticExpression(amountNode, parameters, mathScalars);
  if (solid === undefined || amount === undefined || amount.shape !== "scalar") {
    return undefined;
  }
  if (solid.geometry !== "solid") {
    addGeometryKindMismatch(
      addUnresolved,
      "offset",
      "solid",
      solid.geometry,
      solidNode,
    );
    return undefined;
  }
  return {
    geometry: "solid",
    parameterReferences: [
      ...solid.parameterReferences,
      ...amount.references,
    ],
    shapeReferences: solid.shapeReferences,
    placementReferences: solid.placementReferences,
  };
}

/**
 * Reviewed forms: `revolve(sketch, Axis.X|Y|Z)` and
 * `revolve(sketch, axis=Axis.X|Y|Z)`.  Default axis, `revolution_arc=`,
 * named Axis bindings, and the method form stay unproven.
 */
function parseRevolveCall(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  shapes: ReadonlyMap<string, SupportedShape>,
  placements: ReadonlyMap<string, SupportedPlacement>,
  mathScalars: ReadonlyMap<string, ImportedName>,
  before: number,
  addUnresolved: AddUnresolved,
): ShapeExpression | undefined {
  if (node.name !== "CallExpression" || node.children.length !== 2) {
    return undefined;
  }
  const [callee, argList] = node.children;
  if (callee?.name !== "VariableName" || argList?.name !== "ArgList") {
    return undefined;
  }
  const imported = importedCalls.get(currentText(callee));
  if (imported?.imported !== "revolve" || imported.node.from >= before) {
    return undefined;
  }
  if (argList.children.some((child) => ["*", "**"].includes(currentText(child)))) {
    return undefined;
  }
  const keywordNames = extrudeKeywordNames(argList);
  const expressions = argList.children.filter(isArgumentExpression);
  const hasAssign = argList.children.some((child) => child.name === "AssignOp");

  if (expressions.length === 2 && !hasAssign) {
    const [sketchNode, axisNode] = expressions;
    if (sketchNode !== undefined && axisNode !== undefined) {
      if (parseNamedAxis(axisNode, importedCalls)) {
        const qualified = qualifyRevolve(
          sketchNode,
          importedCalls,
          parameters,
          shapes,
          placements,
          mathScalars,
          before,
          addUnresolved,
        );
        if (qualified !== undefined) return qualified;
      }
    }
  }

  if (expressions.length === 4) {
    const [sketchNode, keyword, assign, axisNode] = expressions;
    if (
      sketchNode !== undefined &&
      keyword?.name === "VariableName" && currentText(keyword) === "axis" &&
      assign?.name === "AssignOp" && currentText(assign) === "=" &&
      axisNode !== undefined &&
      parseNamedAxis(axisNode, importedCalls)
    ) {
      const qualified = qualifyRevolve(
        sketchNode,
        importedCalls,
        parameters,
        shapes,
        placements,
        mathScalars,
        before,
        addUnresolved,
      );
      if (qualified !== undefined) return qualified;
    }
  }

  const axisCandidate = expressions.length === 2 && !hasAssign
    ? expressions[1]
    : expressions.length === 4 &&
        expressions[1]?.name === "VariableName" &&
        currentText(expressions[1]) === "axis"
    ? expressions[3]
    : undefined;
  if (axisCandidate !== undefined) {
    const axisName = unreviewedAxisProperty(axisCandidate, importedCalls);
    if (axisName !== undefined) {
      addUnresolved(
        "build123d-axis-not-qualified",
        `Axis.${axisName} is not a reviewed axis; reviewed axes are Axis.X, Axis.Y, and Axis.Z.`,
        axisCandidate,
      );
    }
  }

  if (keywordNames.length > 0) {
    for (const keyword of keywordNames) {
      addUnresolved(
        "build123d-revolve-argument-not-qualified",
        `revolve keyword ${keyword}= is not qualified; reviewed forms are revolve(sketch, Axis.X|Y|Z) and revolve(sketch, axis=Axis.X|Y|Z).`,
        node,
      );
    }
    return undefined;
  }
  addUnresolved(
    "build123d-revolve-argument-not-qualified",
    "revolve arguments are not a reviewed form; reviewed forms are revolve(sketch, Axis.X|Y|Z) and revolve(sketch, axis=Axis.X|Y|Z).",
    node,
  );
  return undefined;
}

function qualifyRevolve(
  sketchNode: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  shapes: ReadonlyMap<string, SupportedShape>,
  placements: ReadonlyMap<string, SupportedPlacement>,
  mathScalars: ReadonlyMap<string, ImportedName>,
  before: number,
  addUnresolved: AddUnresolved,
): ShapeExpression | undefined {
  const sketch = parseShapeExpression(
    sketchNode,
    importedCalls,
    parameters,
    shapes,
    placements,
    mathScalars,
    before,
    addUnresolved,
  );
  if (sketch === undefined) return undefined;
  if (sketch.geometry !== "sketch") {
    addGeometryKindMismatch(
      addUnresolved,
      "revolve",
      "sketch",
      sketch.geometry,
      sketchNode,
    );
    return undefined;
  }
  return {
    geometry: "solid",
    parameterReferences: sketch.parameterReferences,
    shapeReferences: sketch.shapeReferences,
    placementReferences: sketch.placementReferences,
  };
}

function parseCompoundCall(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  shapes: ReadonlyMap<string, SupportedShape>,
  before: number,
  addUnresolved: AddUnresolved,
): ShapeExpression | undefined {
  if (node.name !== "CallExpression" || node.children.length !== 2) {
    return undefined;
  }
  const [callee, argList] = node.children;
  if (callee?.name !== "VariableName" || argList?.name !== "ArgList") {
    return undefined;
  }
  const imported = importedCalls.get(currentText(callee));
  if (imported?.imported !== "Compound" || imported.node.from >= before) {
    return undefined;
  }
  const meaningful = argList.children.filter(isArgumentExpression);
  if (meaningful.length !== 3) return undefined;
  const [keyword, assign, value] = meaningful;
  if (
    keyword?.name !== "VariableName" || currentText(keyword) !== "children" ||
    assign?.name !== "AssignOp" || currentText(assign) !== "=" ||
    value?.name !== "ArrayExpression"
  ) {
    return undefined;
  }
  const shapeReferences: SupportedShape[] = [];
  let mismatched = false;
  for (const element of value.children.filter(isArrayElement)) {
    if (element.name !== "VariableName") return undefined;
    const shape = shapes.get(currentText(element));
    if (shape === undefined || shape.assignment.assignment.from >= before) {
      return undefined;
    }
    if (shape.geometry !== "solid") {
      addGeometryKindMismatch(
        addUnresolved,
        "Compound",
        "solid",
        shape.geometry,
        element,
      );
      mismatched = true;
      continue;
    }
    shapeReferences.push(shape);
  }
  if (mismatched || shapeReferences.length === 0) return undefined;
  return {
    geometry: "solid",
    parameterReferences: [],
    shapeReferences,
    placementReferences: [],
  };
}

function parseStaticExpression(
  node: ParsedNode,
  parameters: ReadonlyMap<string, SupportedParameter>,
  mathScalars: ReadonlyMap<string, ImportedName>,
): StaticExpression | undefined {
  if (node.name === "Number") {
    return isQualifiedUnsignedDecimalLiteral(currentText(node))
      ? { shape: "scalar", references: [] }
      : undefined;
  }
  if (node.name === "VariableName") {
    const name = currentText(node);
    const parameter = parameters.get(name);
    if (parameter !== undefined) {
      return { shape: parameter.shape, references: [parameter] };
    }
    return mathScalars.has(name) ? { shape: "scalar", references: [] } : undefined;
  }
  if (node.name === "ParenthesizedExpression") {
    const inner = node.children.find(isStaticExpressionNode);
    return inner === undefined
      ? undefined
      : parseStaticExpression(inner, parameters, mathScalars);
  }
  if (node.name === "UnaryExpression") {
    const [operator, operand] = node.children;
    if (
      operator?.name !== "ArithOp" ||
      !["+", "-"].includes(currentText(operator)) || operand === undefined
    ) return undefined;
    const parsed = parseStaticExpression(operand, parameters, mathScalars);
    return parsed?.shape === "scalar" ? parsed : undefined;
  }
  if (node.name === "BinaryExpression") {
    const [left, operator, right] = node.children;
    if (
      left === undefined || right === undefined || operator?.name !== "ArithOp" ||
      !["+", "-", "*", "/", "//", "**", "%"].includes(currentText(operator))
    ) return undefined;
    const leftValue = parseStaticExpression(left, parameters, mathScalars);
    const rightValue = parseStaticExpression(right, parameters, mathScalars);
    if (leftValue?.shape !== "scalar" || rightValue?.shape !== "scalar") {
      return undefined;
    }
    return {
      shape: "scalar",
      references: [...leftValue.references, ...rightValue.references],
    };
  }
  if (node.name === "ArrayExpression") {
    const elements = node.children.filter(isArrayElement);
    const references: SupportedParameter[] = [];
    for (const element of elements) {
      const value = parseStaticExpression(element, parameters, mathScalars);
      if (value?.shape !== "scalar") return undefined;
      references.push(...value.references);
    }
    return { shape: "list", references };
  }
  return undefined;
}

function parseNamedImport(
  node: ParsedNode,
): { readonly module: string; readonly names: readonly ImportedName[] } | undefined {
  const children = node.children;
  if (
    currentText(children[0]!) !== "from" || children[1]?.name !== "VariableName" ||
    currentText(children[2]!) !== "import"
  ) return undefined;
  const module = currentText(children[1]!);
  const names: ImportedName[] = [];
  let index = 3;
  while (index < children.length) {
    const importedNode = children[index];
    if (importedNode?.name !== "VariableName") return undefined;
    const imported = currentText(importedNode);
    let local = imported;
    index++;
    if (currentText(children[index]!) === "as") {
      const alias = children[index + 1];
      if (alias?.name !== "VariableName") return undefined;
      local = currentText(alias);
      index += 2;
    }
    names.push({ imported, local, node: importedNode });
    if (index === children.length) break;
    if (currentText(children[index]!) !== ",") return undefined;
    index++;
    if (index === children.length) return undefined;
  }
  return names.length === 0 ? undefined : { module, names };
}

function simpleAssignment(node: ParsedNode): SimpleAssignment | undefined {
  const [nameNode, operator, rhs] = node.children;
  if (
    node.children.length !== 3 || nameNode?.name !== "VariableName" ||
    operator?.name !== "AssignOp" || currentText(operator) !== "=" ||
    rhs === undefined
  ) return undefined;
  return {
    name: currentText(nameNode),
    nameNode,
    rhs,
    assignment: node,
  };
}

function addTopLevelUnresolved(
  node: ParsedNode,
  add: (kind: string, message: string, node: ParsedNode) => void,
): void {
  const mapped = new Map<string, [string, string]>([
    ["IfStatement", ["python-branch", "Conditional branches are not qualified in v1."]],
    ["ForStatement", ["python-control-flow", "For loops are not qualified in v1."]],
    ["WhileStatement", ["python-control-flow", "While loops are not qualified in v1."]],
    ["FunctionDefinition", [
      "python-function-definition",
      "Functions are not qualified in v1.",
    ]],
    ["ClassDefinition", [
      "python-class-definition",
      "Classes are not qualified in v1.",
    ]],
    ["TryStatement", [
      "python-exception-flow",
      "Exception flow is not qualified in v1.",
    ]],
    ["UpdateStatement", [
      "python-mutation",
      "Update assignments are not qualified in v1.",
    ]],
  ]);
  const entry = mapped.get(node.name);
  add(
    entry?.[0] ?? `python-${kebab(node.name)}`,
    entry?.[1] ?? `Top-level ${node.name} is not qualified in v1.`,
    node,
  );
  addExpressionUnresolved(node, add);
}

function addExpressionUnresolved(
  node: ParsedNode,
  add: (kind: string, message: string, node: ParsedNode) => void,
): void {
  for (const candidate of collectNodes(node, () => true)) {
    if (candidate.name === "MemberExpression") {
      add(
        "python-dynamic-attribute",
        "Attribute and subscript lookup is not qualified in v1.",
        candidate,
      );
    } else if (
      candidate.name === "ArrayComprehensionExpression" ||
      candidate.name === "ComprehensionExpression"
    ) {
      add(
        "python-comprehension",
        "Comprehensions are not qualified in v1.",
        candidate,
      );
    } else if (candidate.name === "CallExpression") {
      add(
        "python-dynamic-call",
        "Only reviewed direct Box, Cylinder, Cone, Sphere, Torus, Ellipsoid, Wedge, Rectangle, Circle, Ellipse, RegularPolygon, Pos, Rot, Compound, scale, fillet, chamfer, extrude, offset, or revolve calls are qualified.",
        candidate,
      );
    }
  }
}

async function dependency(
  kind: "static-value-flow" | "structural-incidence",
  sourceId: string,
  fromSymbolId: string,
  toSymbolId: string,
  node: ParsedNode,
  positions: Utf16Positions,
): Promise<SourceAnalysisDependency> {
  const id = await astStableId(
    "dependency",
    sourceId,
    node,
    `${kind}:${fromSymbolId}:${toSymbolId}`,
  );
  return {
    id,
    kind,
    fromSymbolId,
    toSymbolId,
    span: positions.span(node.from, node.to),
  };
}

function rejectedByD4(
  input: SourceAnalysisFrontendInput,
  fingerprint: ContentFingerprint,
  error: GeometryScriptValidationError,
): SourceAnalysisBundle {
  return rejectedBundle(input, fingerprint, {
    id: "finding:d4-rejection",
    code: `geometry-script-${error.code.replaceAll("_", "-")}`,
    severity: "error",
    message: "The server-owned geometry source policy rejected this script.",
  });
}

function rejectedSyntax(
  input: SourceAnalysisFrontendInput,
  fingerprint: ContentFingerprint,
  positions: Utf16Positions,
  errors: readonly ParsedNode[],
): SourceAnalysisBundle {
  return validateSourceAnalysisBundle({
    ...bundleBase(input, fingerprint),
    policy: {
      profile: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      status: "rejected",
      findings: errors.map((error, index) => ({
        id: `finding:syntax:${index}`,
        code: "python-syntax-error",
        severity: "error" as const,
        message: "Lezer could not form a complete Python syntax tree.",
        span: positions.span(error.from, error.to),
      })),
    },
    symbols: [],
    dependencies: [],
    unresolvedConstructs: [],
  });
}

function rejectedParserBoundary(
  input: SourceAnalysisFrontendInput,
  fingerprint: ContentFingerprint,
  positions: Utf16Positions,
): SourceAnalysisBundle {
  return rejectedBundle(input, fingerprint, {
    id: "finding:result-parser-boundary",
    code: "python-result-assignment-not-recognized",
    severity: "error",
    message: "The required module-level result assignment was not recognized.",
    span: positions.span(0, 0),
  });
}

function rejectedBundle(
  input: SourceAnalysisFrontendInput,
  fingerprint: ContentFingerprint,
  finding: Record<string, unknown>,
): SourceAnalysisBundle {
  return validateSourceAnalysisBundle({
    ...bundleBase(input, fingerprint),
    policy: {
      profile: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      status: "rejected",
      findings: [finding],
    },
    symbols: [],
    dependencies: [],
    unresolvedConstructs: [],
  });
}

function bundleBase(
  input: SourceAnalysisFrontendInput,
  fingerprint: ContentFingerprint,
): Pick<SourceAnalysisBundle, "schemaVersion" | "source" | "analyzer"> {
  return {
    schemaVersion: SOURCE_ANALYSIS_SCHEMA,
    source: {
      id: input.sourceId,
      role: input.role,
      language: input.language,
      fingerprint,
    },
    analyzer: {
      id: QUALIFIED_BUILD123D_SOURCE_ANALYZER_ID,
      version: QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION,
    },
  };
}

async function astStableId(
  prefix: "parameter" | "artifact" | "variable" | "dependency" | "unresolved",
  sourceId: string,
  node: ParsedNode,
  discriminator = "",
): Promise<string> {
  const fingerprint = await sha256Fingerprint({
    schemaVersion: "build123d-ast-identity/1.0",
    sourceId,
    prefix,
    discriminator,
    ast: canonicalAst(node),
  });
  return `${prefix}:${fingerprint.digest}`;
}

function canonicalAst(node: ParsedNode): unknown {
  return node.children.length === 0
    ? { kind: node.name, text: currentText(node) }
    : { kind: node.name, children: node.children.map(canonicalAst) };
}

function materialize(tree: ReturnType<typeof parser.parse>): ParsedNode {
  const cursor = tree.cursor();
  const visit = (): ParsedNode => {
    const children: ParsedNode[] = [];
    if (cursor.firstChild()) {
      do children.push(visit()); while (cursor.nextSibling());
      cursor.parent();
    }
    return {
      name: cursor.name,
      from: cursor.from,
      to: cursor.to,
      isError: cursor.type.isError,
      children,
    };
  };
  return visit();
}

function collectNodes(
  root: ParsedNode,
  predicate: (node: ParsedNode) => boolean,
): ParsedNode[] {
  const result: ParsedNode[] = [];
  const visit = (node: ParsedNode): void => {
    if (predicate(node)) result.push(node);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return result;
}

const nodeText = new WeakMap<ParsedNode, string>();

function bindNodeText(root: ParsedNode, sourceText: string): void {
  for (const node of collectNodes(root, () => true)) {
    nodeText.set(node, sourceText.slice(node.from, node.to));
  }
}

function currentText(node: ParsedNode | undefined): string {
  return node === undefined ? "" : nodeText.get(node) ?? "";
}

function isArgumentExpression(node: ParsedNode): boolean {
  return !["(", ")", ","].includes(node.name) &&
    !["(", ")", ","].includes(currentText(node));
}

function isArrayElement(node: ParsedNode): boolean {
  return !["[", "]", ","].includes(node.name) &&
    !["[", "]", ","].includes(currentText(node));
}

function isStaticExpressionNode(node: ParsedNode): boolean {
  return !["(", ")"].includes(node.name) &&
    !["(", ")"].includes(currentText(node));
}

function addGeometryKindMismatch(
  addUnresolved: AddUnresolved,
  operation: string,
  expected: GeometryKind,
  received: GeometryKind,
  node: ParsedNode,
): void {
  addUnresolved(
    "build123d-geometry-kind-mismatch",
    `${operation} expects a ${expected}, received a ${received}.`,
    node,
  );
}

function uniqueParameters(
  parameters: readonly SupportedParameter[],
): readonly SupportedParameter[] {
  const byId = new Map<string, SupportedParameter>();
  for (const parameter of parameters) byId.set(parameter.symbol.id, parameter);
  return [...byId.values()];
}

function uniqueShapes(
  shapes: readonly SupportedShape[],
): readonly SupportedShape[] {
  const byId = new Map<string, SupportedShape>();
  for (const shape of shapes) byId.set(shape.symbol.id, shape);
  return [...byId.values()];
}

function uniquePlacements(
  placements: readonly SupportedPlacement[],
): readonly SupportedPlacement[] {
  const byId = new Map<string, SupportedPlacement>();
  for (const placement of placements) byId.set(placement.symbol.id, placement);
  return [...byId.values()];
}

function deduplicateDependencies(
  dependencies: readonly SourceAnalysisDependency[],
): readonly SourceAnalysisDependency[] {
  const byId = new Map<string, SourceAnalysisDependency>();
  for (const item of dependencies) byId.set(item.id, item);
  return [...byId.values()];
}

function kebab(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

class Utf16Positions {
  readonly #lineStarts: readonly number[];

  constructor(sourceText: string) {
    const starts = [0];
    for (let index = 0; index < sourceText.length; index++) {
      if (sourceText[index] === "\n") starts.push(index + 1);
    }
    this.#lineStarts = starts;
  }

  span(from: number, to: number): SourceAnalysisSpan {
    return { start: this.location(from), end: this.location(to) };
  }

  location(offset: number): SourceAnalysisLocation {
    let low = 0;
    let high = this.#lineStarts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (this.#lineStarts[middle]! <= offset) low = middle;
      else high = middle;
    }
    return { line: low + 1, column: offset - this.#lineStarts[low]! };
  }
}

async function fingerprintText(sourceText: string): Promise<ContentFingerprint> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(sourceText),
  );
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  };
}
