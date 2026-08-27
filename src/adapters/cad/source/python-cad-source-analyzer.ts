/**
 * Conservative Python/build123d source-analysis frontend.
 *
 * This adapter parses text only. It does not execute Python, inspect build123d,
 * call MCP, or rewrite the agent's source. The existing D4 validator remains
 * the execution-surface boundary and is deliberately run before parsing.
 *
 * V1 promotes only facts with a defined syntactic meaning:
 * - module-level simple assignment bindings are variables;
 * - the one D4-required `result` binding is an artifact;
 * - a static-value-flow is emitted only for an entirely numeric expression
 *   built from literals, arithmetic operators and earlier unique bindings;
 * - a stable binding directly named inside result's RHS structurally affects
 *   that artifact, even when the reference is nested in a call.
 *
 * Calls, imports, branches, functions, classes, comprehensions, attributes,
 * subscripts, updates and reassignments are reported as unresolved rather than
 * interpreted. That conservatism is intentional: this is a source frontend,
 * not a Python evaluator or a build123d semantic model.
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
import { validateGeometryScript } from "../../../domain/cad/source/geometry-script-validation.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";

export const PYTHON_CAD_SOURCE_ANALYZER_ID = "python-cad-lezer" as const;
export const PYTHON_CAD_SOURCE_ANALYZER_VERSION = "1.0.0" as const;
export const PYTHON_CAD_SOURCE_ANALYSIS_PROFILE = "python-cad-conservative-v1" as const;

interface ParsedNode {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly isError: boolean;
  readonly children: readonly ParsedNode[];
}

interface Binding {
  readonly name: string;
  readonly symbol: SourceAnalysisSymbol;
  readonly rhs: ParsedNode;
  readonly assignment: ParsedNode;
}

/** Lezer adapter for D4-admitted Python CAD source. */
export class PythonCadSourceAnalyzer implements SourceAnalysisFrontend {
  async analyze(input: SourceAnalysisFrontendInput): Promise<SourceAnalysisBundle> {
    if (input.role !== "cad-script" || input.language !== "python") {
      throw new TypeError(
        "PythonCadSourceAnalyzer only accepts source role cad-script and language python.",
      );
    }
    if (typeof input.sourceText !== "string") {
      throw new TypeError("Python CAD sourceText must be a string.");
    }

    // D4 must be evaluated before the AST. A script rejected here has no
    // analysis result because it must never reach a geometry provider.
    validateGeometryScript(input.sourceText);

    const fingerprint = await fingerprintText(input.sourceText);
    const root = materialize(parser.parse(input.sourceText));
    bindNodeText(root, input.sourceText);
    const positions = new Utf16Positions(input.sourceText);
    const errors = collectNodes(root, (node) => node.isError);
    if (errors.length > 0) {
      return validateSourceAnalysisBundle({
        schemaVersion: SOURCE_ANALYSIS_SCHEMA,
        source: {
          id: input.sourceId,
          role: input.role,
          language: input.language,
          fingerprint,
        },
        analyzer: {
          id: PYTHON_CAD_SOURCE_ANALYZER_ID,
          version: PYTHON_CAD_SOURCE_ANALYZER_VERSION,
        },
        policy: {
          profile: PYTHON_CAD_SOURCE_ANALYSIS_PROFILE,
          status: "rejected",
          findings: errors.map((node, index) => ({
            id: `finding:syntax:${index}`,
            code: "python-syntax-error",
            severity: "error" as const,
            message: "Lezer could not form a complete Python syntax tree.",
            span: positions.span(node.from, node.to),
          })),
        },
        symbols: [],
        dependencies: [],
        unresolvedConstructs: [],
      });
    }

    const topLevel = root.children;
    const assignmentNodes = topLevel.filter((node) => node.name === "AssignStatement");
    const bindingCandidates = assignmentNodes
      .map((node) => simpleAssignment(node))
      .filter((binding): binding is NonNullable<typeof binding> =>
        binding !== undefined
      );
    const assignmentCount = new Map<string, number>();
    for (const binding of bindingCandidates) {
      assignmentCount.set(binding.name, (assignmentCount.get(binding.name) ?? 0) + 1);
    }

    const symbols: SourceAnalysisSymbol[] = [];
    const bindings: Binding[] = [];
    const unresolved: SourceAnalysisUnresolvedConstruct[] = [];
    const seenUnresolved = new Set<string>();
    const addUnresolved = (kind: string, message: string, node: ParsedNode): void => {
      const id = `unresolved:${kind}:${node.from}:${node.to}`;
      if (seenUnresolved.has(id)) return;
      seenUnresolved.add(id);
      unresolved.push({ id, kind, message, span: positions.span(node.from, node.to) });
    };

    for (const node of topLevel) {
      if (node.name === "AssignStatement") {
        const simple = simpleAssignment(node);
        if (!simple) {
          addUnsupportedExpressionConstructs(node, addUnresolved);
          addUnresolved(
            "python-mutation-or-composite-assignment",
            "Only a top-level assignment to one simple variable is analyzable in v1.",
            node,
          );
          continue;
        }
        if (simple.name === "result") continue;
        const symbol: SourceAnalysisSymbol = {
          id: `variable:${simple.nameStart}`,
          kind: "variable",
          name: simple.name,
          span: positions.span(simple.nameStart, simple.nameEnd),
        };
        symbols.push(symbol);
        bindings.push({ name: simple.name, symbol, rhs: simple.rhs, assignment: node });
      } else if (node.name === "UpdateStatement") {
        addUnresolved(
          "python-mutation",
          "Update assignments are not stable bindings in v1.",
          node,
        );
      } else if (node.name === "ImportStatement") {
        addUnresolved(
          "python-import",
          "Imports are execution validation facts, not semantic source relations in v1.",
          node,
        );
      } else {
        addUnresolved(
          `python-${kebab(node.name)}`,
          `Top-level ${node.name} is deliberately not interpreted in v1.`,
          node,
        );
      }
    }

    const resultAssignment = assignmentNodes
      .map((node) => simpleAssignment(node))
      .find((candidate) => candidate?.name === "result");
    // D4 guarantees this assignment, but retain an explicit failure rather than
    // treating a parser mismatch as a relation-bearing successful analysis.
    if (!resultAssignment) {
      return rejectedResultAssignment(input, fingerprint, positions);
    }
    const resultSymbol: SourceAnalysisSymbol = {
      id: "artifact:result",
      kind: "artifact",
      name: "result",
      span: positions.span(resultAssignment.nameStart, resultAssignment.nameEnd),
    };
    symbols.push(resultSymbol);

    const dependencies: SourceAnalysisDependency[] = [];
    const uniqueBindings = new Map<string, Binding>();
    for (const binding of bindings) {
      if (assignmentCount.get(binding.name) === 1) {
        uniqueBindings.set(binding.name, binding);
      }
    }

    for (const binding of bindings) {
      if (assignmentCount.get(binding.name)! > 1) {
        addUnresolved(
          "python-reassignment",
          `Binding ${binding.name} is assigned more than once and is not stable.`,
          binding.assignment,
        );
        continue;
      }
      const staticNames = pureNumericReferences(
        binding.rhs,
        uniqueBindings,
        binding.assignment.from,
      );
      if (!staticNames) {
        addUnsupportedExpressionConstructs(binding.rhs, addUnresolved);
        addUnresolved(
          "python-non-numeric-binding",
          `Binding ${binding.name} is not a v1 pure numeric expression.`,
          binding.rhs,
        );
        continue;
      }
      for (const nameNode of staticNames) {
        const source = uniqueBindings.get(nameNode.text);
        if (!source || source.assignment.from >= binding.assignment.from) continue;
        dependencies.push({
          id: `dependency:static:${source.symbol.id}:${binding.symbol.id}`,
          kind: "static-value-flow",
          fromSymbolId: source.symbol.id,
          toSymbolId: binding.symbol.id,
          span: positions.span(nameNode.from, nameNode.to),
        });
      }
    }

    addUnsupportedExpressionConstructs(resultAssignment.rhs, addUnresolved);
    const resultNames = referencedVariableNames(resultAssignment.rhs);
    for (const reference of resultNames) {
      const binding = uniqueBindings.get(reference.text);
      if (!binding) continue;
      dependencies.push({
        id: `dependency:structural:${binding.symbol.id}:artifact:result`,
        kind: "structural-incidence",
        fromSymbolId: binding.symbol.id,
        toSymbolId: resultSymbol.id,
        span: positions.span(reference.from, reference.to),
      });
    }

    return validateSourceAnalysisBundle({
      schemaVersion: SOURCE_ANALYSIS_SCHEMA,
      source: {
        id: input.sourceId,
        role: input.role,
        language: input.language,
        fingerprint,
      },
      analyzer: {
        id: PYTHON_CAD_SOURCE_ANALYZER_ID,
        version: PYTHON_CAD_SOURCE_ANALYZER_VERSION,
      },
      policy: {
        profile: PYTHON_CAD_SOURCE_ANALYSIS_PROFILE,
        status: "passed",
        findings: [],
      },
      symbols,
      dependencies: deduplicateDependencies(dependencies),
      unresolvedConstructs: unresolved,
    });
  }
}

function rejectedResultAssignment(
  input: SourceAnalysisFrontendInput,
  fingerprint: ContentFingerprint,
  positions: Utf16Positions,
): SourceAnalysisBundle {
  return validateSourceAnalysisBundle({
    schemaVersion: SOURCE_ANALYSIS_SCHEMA,
    source: {
      id: input.sourceId,
      role: input.role,
      language: input.language,
      fingerprint,
    },
    analyzer: {
      id: PYTHON_CAD_SOURCE_ANALYZER_ID,
      version: PYTHON_CAD_SOURCE_ANALYZER_VERSION,
    },
    policy: {
      profile: PYTHON_CAD_SOURCE_ANALYSIS_PROFILE,
      status: "rejected",
      findings: [{
        id: "finding:result-assignment",
        code: "python-result-assignment-not-recognized",
        severity: "error",
        message:
          "The D4-required result assignment was not recognized as a simple AST binding.",
        span: positions.span(0, 0),
      }],
    },
    symbols: [],
    dependencies: [],
    unresolvedConstructs: [],
  });
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

function simpleAssignment(node: ParsedNode):
  | {
    readonly name: string;
    readonly nameStart: number;
    readonly nameEnd: number;
    readonly rhs: ParsedNode;
  }
  | undefined {
  const assignIndex = node.children.findIndex((child) => child.name === "AssignOp");
  if (assignIndex !== 1 || node.children[0]?.name !== "VariableName") return undefined;
  const target = node.children[0]!;
  const rhs = node.children[2];
  if (!rhs || node.children.length !== 3) return undefined;
  return {
    name: currentText(target),
    nameStart: target.from,
    nameEnd: target.to,
    rhs,
  };
}

function pureNumericReferences(
  node: ParsedNode,
  bindings: ReadonlyMap<string, Binding>,
  assignmentStart: number,
):
  | Array<{ readonly text: string; readonly from: number; readonly to: number }>
  | undefined {
  const visit = (
    current: ParsedNode,
  ):
    | Array<{ readonly text: string; readonly from: number; readonly to: number }>
    | undefined => {
    if (current.name === "Number") return [];
    if (current.name === "VariableName") {
      const text = currentText(current);
      const binding = bindings.get(text);
      return binding && binding.assignment.from < assignmentStart
        ? [{ text, from: current.from, to: current.to }]
        : undefined;
    }
    if (current.name === "ParenthesizedExpression") {
      const inner = current.children.find((child) => isExpression(child));
      return inner ? visit(inner) : undefined;
    }
    if (current.name === "UnaryExpression") {
      const operator = current.children.find((child) => child.name === "ArithOp");
      const operand = current.children.find((child) => isExpression(child));
      return operator && ["+", "-"].includes(currentText(operator)) && operand
        ? visit(operand)
        : undefined;
    }
    if (current.name === "BinaryExpression") {
      const [left, operator, right] = current.children;
      if (
        !left || !operator || !right || operator.name !== "ArithOp" ||
        !["+", "-", "*", "/", "//", "**"].includes(currentText(operator))
      ) return undefined;
      const leftReferences = visit(left);
      const rightReferences = visit(right);
      return leftReferences && rightReferences
        ? [...leftReferences, ...rightReferences]
        : undefined;
    }
    return undefined;
  };
  return visit(node);
}

function referencedVariableNames(
  node: ParsedNode,
): ReadonlyArray<
  { readonly text: string; readonly from: number; readonly to: number }
> {
  return collectNodes(node, (candidate) => candidate.name === "VariableName")
    .map((candidate) => ({
      text: currentText(candidate),
      from: candidate.from,
      to: candidate.to,
    }));
}

function addUnsupportedExpressionConstructs(
  node: ParsedNode,
  add: (kind: string, message: string, node: ParsedNode) => void,
): void {
  for (const candidate of collectNodes(node, () => true)) {
    if (candidate.name === "CallExpression") {
      add(
        "python-call-expression",
        "Calls are not semantically evaluated in v1.",
        candidate,
      );
    }
    if (
      candidate.name === "ArrayComprehensionExpression" ||
      candidate.name === "ComprehensionExpression"
    ) {
      add(
        "python-comprehension",
        "Comprehensions are not interpreted in v1.",
        candidate,
      );
    }
    if (candidate.name === "MemberExpression") {
      const kind = candidate.children.some((child) => currentText(child) === ".")
        ? "python-attribute"
        : "python-subscript";
      add(
        kind,
        "Attribute and subscript expressions are not interpreted in v1.",
        candidate,
      );
    }
  }
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

function isExpression(node: ParsedNode): boolean {
  return !["(", ")", "ArithOp"].includes(node.name);
}

function currentText(node: ParsedNode): string {
  // Source text is bound once, before any semantic walk. Keeping it outside the
  // exported bundle makes the parser tree implementation detail stay local.
  return nodeText.get(node) ?? "";
}

const nodeText = new WeakMap<ParsedNode, string>();

function bindNodeText(root: ParsedNode, sourceText: string): void {
  for (const node of collectNodes(root, () => true)) {
    nodeText.set(node, sourceText.slice(node.from, node.to));
  }
}

function deduplicateDependencies(
  dependencies: readonly SourceAnalysisDependency[],
): readonly SourceAnalysisDependency[] {
  const seen = new Set<string>();
  return dependencies.filter((dependency) => {
    if (seen.has(dependency.id)) return false;
    seen.add(dependency.id);
    return true;
  });
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
