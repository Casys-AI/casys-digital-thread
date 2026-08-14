/**
 * Parser-backed frontend for the qualified build123d source subset.
 *
 * This adapter never imports or executes Python/build123d.  It first applies
 * the existing D4 execution-surface validator, then proves a deliberately
 * smaller AST subset:
 *
 * - named imports of Box, Cylinder, Cone, Sphere, Pos, Rot and Compound
 *   (aliases allowed; two aliases for the same imported name stay ambiguous);
 * - unique module-level parameter assignments made only of finite decimal
 *   numbers, unary/binary arithmetic, earlier parameters, and flat lists;
 * - unique module-level solid assignments: a Box/Cylinder/Cone/Sphere call,
 *   a Pos/Rot * solid, a solid + solid, a name of an earlier solid, or
 *   `Compound(children=[...])` over earlier solid names;
 * - one module-level `result` that is itself one of those solids.
 *
 * Anything D4 considers dangerous is rejected.  Syntax that D4 allows but
 * this frontend cannot prove is recorded as unresolved, so it can never yield
 * a fully qualified compilation by omission.
 */

import { parser } from "@lezer/python";
import type {
  SourceAnalysisFrontend,
  SourceAnalysisFrontendInput,
} from "../../domain/analysis/source-analysis-frontend.ts";
import {
  SOURCE_ANALYSIS_SCHEMA,
  type SourceAnalysisBundle,
  type SourceAnalysisDependency,
  type SourceAnalysisLocation,
  type SourceAnalysisSpan,
  type SourceAnalysisSymbol,
  type SourceAnalysisUnresolvedConstruct,
  validateSourceAnalysisBundle,
} from "../../domain/analysis/source-analysis.ts";
import {
  GeometryScriptValidationError,
  validateGeometryScript,
} from "../../domain/engineering/geometry-script-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";

export const QUALIFIED_BUILD123D_SOURCE_ANALYZER_ID =
  "build123d-qualified-lezer" as const;

/**
 * Cone, Sphere and Rot reuse the 1.1 positional-call and placement * solid
 * identity scheme (`build123d-ast-identity/1.0`).  Previously qualified
 * Box/Cylinder/Pos/Compound bundles stay bit-identical, so the public
 * analysis identity does not change.
 */
export const QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION = "1.1.0" as const;
export const QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE =
  "build123d-closed-subset-v1" as const;

/**
 * A reviewed subset of the D4 build123d import allowlist.  The D4 validator is
 * still authoritative for reachability; this set only states which calls the
 * frontend can currently qualify semantically.
 */
const QUALIFIED_BUILD123D_CALLS = new Map(
  [
    ["Box", { role: "solid", positionalArguments: 3 }],
    ["Cylinder", { role: "solid", positionalArguments: 2 }],
    ["Cone", { role: "solid", positionalArguments: 3 }],
    ["Sphere", { role: "solid", positionalArguments: 1 }],
    ["Pos", { role: "placement", positionalArguments: 3 }],
    ["Rot", { role: "placement", positionalArguments: 3 }],
    ["Compound", { role: "assembly", positionalArguments: 0 }],
  ] as const,
);

type QualifiedBuild123dCallName =
  | "Box"
  | "Cylinder"
  | "Cone"
  | "Sphere"
  | "Pos"
  | "Rot"
  | "Compound";
type PositionalBuild123dCallName = Exclude<QualifiedBuild123dCallName, "Compound">;

interface ParsedNode {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly isError: boolean;
  readonly children: readonly ParsedNode[];
}

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
  readonly parameterReferences: readonly SupportedParameter[];
  readonly shapeReferences: readonly SupportedShape[];
}

interface ShapeExpression {
  readonly parameterReferences: readonly SupportedParameter[];
  readonly shapeReferences: readonly SupportedShape[];
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
    for (
      const node of root.children.filter((child) => child.name === "ImportStatement")
    ) {
      const imported = parseNamedImport(node);
      if (imported === undefined || imported.module !== "build123d") {
        addUnresolved(
          "python-import-not-qualified",
          "Only an explicit named import from build123d is qualified in v1.",
          node,
        );
        continue;
      }
      for (const name of imported.names) {
        if (
          !QUALIFIED_BUILD123D_CALLS.has(
            name.imported as QualifiedBuild123dCallName,
          )
        ) {
          addUnresolved(
            "build123d-call-not-qualified",
            `build123d name ${name.imported} is admitted by D4 but not qualified by the v1.1 frontend.`,
            name.node,
          );
          continue;
        }
        if (importedCalls.has(name.local)) {
          addUnresolved(
            "python-import-alias-ambiguous",
            `Import alias ${name.local} is declared more than once.`,
            node,
          );
          importedCalls.delete(name.local);
          continue;
        }
        importedCalls.set(name.local, name);
      }
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

      const numeric = parseStaticExpression(assignment.rhs, parameterByName);
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

      const solid = parseShapeExpression(
        assignment.rhs,
        importedCalls,
        parameterByName,
        shapeByName,
        assignment.assignment.from,
      );
      if (solid !== undefined) {
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
          parameterReferences: uniqueParameters(solid.parameterReferences),
          shapeReferences: uniqueShapes(solid.shapeReferences),
        };
        shapes.push(shape);
        shapeByName.set(assignment.name, shape);
        continue;
      }

      addExpressionUnresolved(assignment.rhs, addUnresolved);
      addUnresolved(
        "python-parameter-expression-not-qualified",
        `Assignment ${assignment.name} is not a closed v1.1 numeric expression or solid.`,
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

    const resultSolid = parseShapeExpression(
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
      resultAssignment.assignment.from,
    );
    if (resultSolid === undefined) {
      addExpressionUnresolved(resultAssignment.rhs, addUnresolved);
      addUnresolved(
        "build123d-result-not-qualified",
        "result must be one qualified solid: Box/Cylinder/Cone/Sphere, Pos/Rot * solid, solid + solid, or Compound(children=[...]).",
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
  before: number,
): ShapeExpression | undefined {
  if (node.name === "ParenthesizedExpression") {
    const inner = node.children.find(isStaticExpressionNode);
    return inner === undefined ? undefined : parseShapeExpression(
      inner,
      importedCalls,
      parameters,
      shapes,
      before,
    );
  }
  if (node.name === "VariableName") {
    const shape = shapes.get(currentText(node));
    if (shape === undefined || shape.assignment.assignment.from >= before) {
      return undefined;
    }
    return { parameterReferences: [], shapeReferences: [shape] };
  }
  const positionalSolid = parsePositionalSolidCall(
    node,
    importedCalls,
    parameters,
    before,
  );
  if (positionalSolid !== undefined) return positionalSolid;
  const compound = parseCompoundCall(node, importedCalls, shapes, before);
  if (compound !== undefined) return compound;
  if (node.name !== "BinaryExpression" || node.children.length !== 3) {
    return undefined;
  }
  const [left, operator, right] = node.children;
  if (left === undefined || right === undefined || operator?.name !== "ArithOp") {
    return undefined;
  }
  const operatorText = currentText(operator);
  if (operatorText === "*") {
    const placement = parsePlacementCall(
      left,
      importedCalls,
      parameters,
      before,
    );
    const solid = parseShapeExpression(
      right,
      importedCalls,
      parameters,
      shapes,
      before,
    );
    if (placement === undefined || solid === undefined) return undefined;
    return {
      parameterReferences: [
        ...placement.parameterReferences,
        ...solid.parameterReferences,
      ],
      shapeReferences: solid.shapeReferences,
    };
  }
  if (operatorText !== "+") return undefined;
  const leftSolid = parseShapeExpression(
    left,
    importedCalls,
    parameters,
    shapes,
    before,
  );
  const rightSolid = parseShapeExpression(
    right,
    importedCalls,
    parameters,
    shapes,
    before,
  );
  if (leftSolid === undefined || rightSolid === undefined) return undefined;
  return {
    parameterReferences: [
      ...leftSolid.parameterReferences,
      ...rightSolid.parameterReferences,
    ],
    shapeReferences: [
      ...leftSolid.shapeReferences,
      ...rightSolid.shapeReferences,
    ],
  };
}

function parsePositionalSolidCall(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  before: number,
): ShapeExpression | undefined {
  for (const imported of ["Box", "Cylinder", "Cone", "Sphere"] as const) {
    const parsed = parsePositionalCall(
      node,
      importedCalls,
      parameters,
      before,
      imported,
    );
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function parsePlacementCall(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  before: number,
): ShapeExpression | undefined {
  for (const imported of ["Pos", "Rot"] as const) {
    const parsed = parsePositionalCall(
      node,
      importedCalls,
      parameters,
      before,
      imported,
    );
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function parsePositionalCall(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  parameters: ReadonlyMap<string, SupportedParameter>,
  before: number,
  importedName: PositionalBuild123dCallName,
): ShapeExpression | undefined {
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
    const expression = parseStaticExpression(expressionNode, parameters);
    if (expression === undefined || expression.shape !== "scalar") return undefined;
    parameterReferences.push(...expression.references);
  }
  return { parameterReferences, shapeReferences: [] };
}

function parseCompoundCall(
  node: ParsedNode,
  importedCalls: ReadonlyMap<string, ImportedName>,
  shapes: ReadonlyMap<string, SupportedShape>,
  before: number,
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
  for (const element of value.children.filter(isArrayElement)) {
    if (element.name !== "VariableName") return undefined;
    const shape = shapes.get(currentText(element));
    if (shape === undefined || shape.assignment.assignment.from >= before) {
      return undefined;
    }
    shapeReferences.push(shape);
  }
  return shapeReferences.length === 0
    ? undefined
    : { parameterReferences: [], shapeReferences };
}

function parseStaticExpression(
  node: ParsedNode,
  parameters: ReadonlyMap<string, SupportedParameter>,
): StaticExpression | undefined {
  if (node.name === "Number") {
    return isQualifiedDecimalLiteral(currentText(node))
      ? { shape: "scalar", references: [] }
      : undefined;
  }
  if (node.name === "VariableName") {
    const parameter = parameters.get(currentText(node));
    return parameter === undefined
      ? undefined
      : { shape: parameter.shape, references: [parameter] };
  }
  if (node.name === "ParenthesizedExpression") {
    const inner = node.children.find(isStaticExpressionNode);
    return inner === undefined ? undefined : parseStaticExpression(inner, parameters);
  }
  if (node.name === "UnaryExpression") {
    const [operator, operand] = node.children;
    if (
      operator?.name !== "ArithOp" ||
      !["+", "-"].includes(currentText(operator)) || operand === undefined
    ) return undefined;
    const parsed = parseStaticExpression(operand, parameters);
    return parsed?.shape === "scalar" ? parsed : undefined;
  }
  if (node.name === "BinaryExpression") {
    const [left, operator, right] = node.children;
    if (
      left === undefined || right === undefined || operator?.name !== "ArithOp" ||
      !["+", "-", "*", "/", "//", "**", "%"].includes(currentText(operator))
    ) return undefined;
    const leftValue = parseStaticExpression(left, parameters);
    const rightValue = parseStaticExpression(right, parameters);
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
      const value = parseStaticExpression(element, parameters);
      if (value?.shape !== "scalar") return undefined;
      references.push(...value.references);
    }
    return { shape: "list", references };
  }
  return undefined;
}

/**
 * Lezer intentionally recovers some malformed Python numbers as `Number`
 * nodes, and D4 is a reachability guard rather than a CPython lexer.  The
 * qualified subset therefore applies its own closed decimal grammar.  A
 * leading sign is represented by `UnaryExpression`, never by this token.
 */
function isQualifiedDecimalLiteral(text: string): boolean {
  const digits = String.raw`[0-9](?:_?[0-9])*`;
  const integer = String.raw`(?:0|[1-9](?:_?[0-9])*)`;
  const exponent = String.raw`[eE][+-]?${digits}`;
  const decimal = new RegExp(
    String
      .raw`^(?:${integer}(?:\.${digits}?)?(?:${exponent})?|\.${digits}(?:${exponent})?)$`,
  );
  return decimal.test(text) && Number.isFinite(Number(text.replaceAll("_", "")));
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
        "Only reviewed direct Box, Cylinder, Cone, Sphere, Pos, Rot, or Compound calls are qualified.",
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
