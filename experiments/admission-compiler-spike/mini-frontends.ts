/**
 * Deliberately tiny, fixture-only native source frontends for the spike.
 *
 * They prove that Modelica and CalculiX native bytes can cross the same
 * SourceAnalysisBundle boundary. They are not complete or qualified parsers.
 */

import type {
  SourceAnalysisFrontend,
  SourceAnalysisFrontendInput,
} from "../../src/domain/compile/source/source-analysis-frontend.ts";
import {
  SOURCE_ANALYSIS_SCHEMA,
  type SourceAnalysisBundle,
  type SourceAnalysisDependency,
  type SourceAnalysisSymbol,
  validateSourceAnalysisBundle,
} from "../../src/domain/compile/source/source-analysis.ts";
import { safeId } from "../../src/domain/kernel/case-validation.ts";
import type { ContentFingerprint } from "../../src/domain/kernel/primitives.ts";

export const SPIKE_MODELICA_ANALYZER_ID = "spike-modelica-subset" as const;
export const SPIKE_CALCULIX_ANALYZER_ID = "spike-calculix-subset" as const;
export const SPIKE_MINI_FRONTEND_VERSION = "0.1.0" as const;

const CALCULIX_SPIKE_SEQUENCE = [
  "HEADING",
  "NODE",
  "ELEMENT",
  "MATERIAL",
  "ELASTIC",
  "STEP",
  "STATIC",
  "BOUNDARY",
  "CLOAD",
  "END STEP",
] as const;

export class SpikeModelicaFrontend implements SourceAnalysisFrontend {
  async analyze(input: SourceAnalysisFrontendInput): Promise<SourceAnalysisBundle> {
    assertInput(input, "modelica-model", "modelica");
    const fingerprint = await fingerprintUtf8(input.sourceText);
    try {
      return parseModelica(input, fingerprint);
    } catch (error) {
      return rejectedBundle(
        input,
        fingerprint,
        SPIKE_MODELICA_ANALYZER_ID,
        "spike-modelica-bounded-v0",
        error,
      );
    }
  }
}

export class SpikeCalculixFrontend implements SourceAnalysisFrontend {
  async analyze(input: SourceAnalysisFrontendInput): Promise<SourceAnalysisBundle> {
    assertInput(input, "calculix-input", "calculix-inp");
    const fingerprint = await fingerprintUtf8(input.sourceText);
    try {
      return parseCalculix(input, fingerprint);
    } catch (error) {
      return rejectedBundle(
        input,
        fingerprint,
        SPIKE_CALCULIX_ANALYZER_ID,
        "spike-calculix-bounded-v0",
        error,
      );
    }
  }
}

function parseModelica(
  input: SourceAnalysisFrontendInput,
  fingerprint: ContentFingerprint,
): SourceAnalysisBundle {
  const lines = input.sourceText.split(/\r?\n/);
  const header = lines[0]?.match(/^model ([A-Za-z][A-Za-z0-9_]*)$/);
  if (!header) {
    throw new TypeError("The bounded Modelica subset requires `model Name`.");
  }
  const modelName = header[1]!;
  const endIndex = lines.findIndex((line) => line === `end ${modelName};`);
  if (endIndex < 0 || lines.slice(endIndex + 1).some((line) => line.trim() !== "")) {
    throw new TypeError("The bounded Modelica subset requires one exact matching end.");
  }

  const symbols: SourceAnalysisSymbol[] = [{
    id: `model:${modelName}`,
    kind: "artifact",
    name: modelName,
  }];
  const symbolByName = new Map<string, SourceAnalysisSymbol>();
  const equationLines: Array<{ line: number; lhs: string; rhs: string }> = [];
  let inEquations = false;
  for (let index = 1; index < endIndex; index++) {
    const text = lines[index]!.trim();
    if (text === "") continue;
    if (text === "equation") {
      if (inEquations) throw new TypeError("Only one equation section is accepted.");
      inEquations = true;
      continue;
    }
    if (!inEquations) {
      const parameter = text.match(
        /^parameter (?:Real|Integer) ([A-Za-z][A-Za-z0-9_]*)(?: = [-+]?[0-9]+(?:\.[0-9]+)?)?;$/,
      );
      const variable = text.match(/^(?:Real|Integer) ([A-Za-z][A-Za-z0-9_]*);$/);
      const match = parameter ?? variable;
      if (!match) {
        throw new TypeError(`Unsupported Modelica declaration on line ${index + 1}.`);
      }
      const name = match[1]!;
      if (symbolByName.has(name)) throw new TypeError(`Duplicate declaration ${name}.`);
      const symbol: SourceAnalysisSymbol = {
        id: `${parameter ? "parameter" : "variable"}:${name}`,
        kind: parameter ? "parameter" : "variable",
        name,
      };
      symbolByName.set(name, symbol);
      symbols.push(symbol);
      continue;
    }
    const equation = text.match(
      /^([A-Za-z][A-Za-z0-9_]*) = ([A-Za-z0-9_ +*/().-]+);$/,
    );
    if (!equation) {
      throw new TypeError(`Unsupported Modelica equation on line ${index + 1}.`);
    }
    equationLines.push({ line: index + 1, lhs: equation[1]!, rhs: equation[2]! });
  }
  if (equationLines.length === 0) {
    throw new TypeError("The bounded Modelica subset requires at least one equation.");
  }

  const dependencies: SourceAnalysisDependency[] = [];
  for (const equation of equationLines) {
    if (!symbolByName.has(equation.lhs)) {
      throw new TypeError(`Equation target ${equation.lhs} is not declared.`);
    }
    const equationSymbol: SourceAnalysisSymbol = {
      id: `equation:line-${equation.line}`,
      kind: "equation",
      name: `${equation.lhs}@${equation.line}`,
    };
    symbols.push(equationSymbol);
    const references = [...equation.rhs.matchAll(/[A-Za-z][A-Za-z0-9_]*/g)]
      .map((match) => match[0]);
    for (const name of [...new Set(references)].sort()) {
      const source = symbolByName.get(name);
      if (!source) throw new TypeError(`Equation reference ${name} is not declared.`);
      dependencies.push({
        id: `incidence:${source.id}:${equationSymbol.id}`,
        kind: "structural-incidence",
        fromSymbolId: source.id,
        toSymbolId: equationSymbol.id,
      });
    }
  }

  return validateSourceAnalysisBundle({
    schemaVersion: SOURCE_ANALYSIS_SCHEMA,
    source: {
      id: input.sourceId,
      role: "modelica-model",
      language: "modelica",
      fingerprint,
    },
    analyzer: {
      id: SPIKE_MODELICA_ANALYZER_ID,
      version: SPIKE_MINI_FRONTEND_VERSION,
    },
    policy: {
      profile: "spike-modelica-bounded-v0",
      status: "passed",
      findings: [],
    },
    symbols,
    dependencies,
    unresolvedConstructs: [],
  });
}

function parseCalculix(
  input: SourceAnalysisFrontendInput,
  fingerprint: ContentFingerprint,
): SourceAnalysisBundle {
  const symbols: SourceAnalysisSymbol[] = [{
    id: "deck:root",
    kind: "artifact",
    name: input.sourceId,
  }];
  const dependencies: SourceAnalysisDependency[] = [];
  const seen = new Set<string>();
  const acceptedDirectives = new Set<string>(CALCULIX_SPIKE_SEQUENCE);
  const lines = input.sourceText.split(/\r?\n/);
  let activeDirective: string | undefined;
  let activeDataLines = 0;
  let directiveOrdinal = 0;
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("**")) continue;
    if (!line.startsWith("*")) {
      if (!activeDirective) {
        throw new TypeError(`CalculiX data has no directive on line ${index + 1}.`);
      }
      validateCalculixDataLine(activeDirective, line, index + 1, activeDataLines);
      activeDataLines++;
      continue;
    }
    const fields = line.slice(1).split(",").map((field) => field.trim());
    const directive = fields[0]!.toUpperCase();
    if (!acceptedDirectives.has(directive)) {
      throw new TypeError(
        `Unsupported CalculiX directive ${directive} on line ${index + 1}.`,
      );
    }
    if (activeDirective) {
      validateCalculixSectionCompleteness(activeDirective, activeDataLines);
    }
    const expectedDirective = CALCULIX_SPIKE_SEQUENCE[directiveOrdinal];
    if (directive !== expectedDirective) {
      throw new TypeError(
        `CalculiX linkage subset expected ${
          expectedDirective ?? "end of source"
        } but found ${directive} on line ${index + 1}.`,
      );
    }
    directiveOrdinal++;
    validateCalculixDirectiveFields(directive, fields.slice(1), index + 1);
    activeDirective = directive;
    activeDataLines = 0;
    for (const field of fields.slice(1)) {
      const match = field.match(/^(NSET|ELSET|NAME)=([A-Za-z][A-Za-z0-9_.:-]*)$/i);
      if (!match) continue;
      const category = match[1]!.toLowerCase();
      const name = safeId(match[2]!, `CalculiX ${category}`);
      const id = `${category}:${name}`;
      if (seen.has(id)) continue;
      seen.add(id);
      symbols.push({ id, kind: "component", name });
      dependencies.push({
        id: `incidence:${id}:deck:root`,
        kind: "structural-incidence",
        fromSymbolId: id,
        toSymbolId: "deck:root",
      });
    }
  }
  if (activeDirective) {
    validateCalculixSectionCompleteness(activeDirective, activeDataLines);
  }
  if (directiveOrdinal !== CALCULIX_SPIKE_SEQUENCE.length) {
    throw new TypeError(
      `CalculiX linkage subset is incomplete; expected ${
        CALCULIX_SPIKE_SEQUENCE[directiveOrdinal]
      }.`,
    );
  }
  if (!seen.size) {
    throw new TypeError(
      "The bounded CalculiX subset requires a named set or material.",
    );
  }
  return validateSourceAnalysisBundle({
    schemaVersion: SOURCE_ANALYSIS_SCHEMA,
    source: {
      id: input.sourceId,
      role: "calculix-input",
      language: "calculix-inp",
      fingerprint,
    },
    analyzer: {
      id: SPIKE_CALCULIX_ANALYZER_ID,
      version: SPIKE_MINI_FRONTEND_VERSION,
    },
    policy: {
      profile: "spike-calculix-bounded-v0",
      status: "passed",
      findings: [],
    },
    symbols,
    dependencies,
    unresolvedConstructs: [],
  });
}

function validateCalculixDirectiveFields(
  directive: string,
  fields: readonly string[],
  lineNumber: number,
): void {
  const allowed = directive === "NODE"
    ? [/^NSET=[A-Za-z][A-Za-z0-9_.:-]*$/i]
    : directive === "ELEMENT"
    ? [
      /^TYPE=C3D4$/i,
      /^ELSET=[A-Za-z][A-Za-z0-9_.:-]*$/i,
    ]
    : directive === "MATERIAL"
    ? [/^NAME=[A-Za-z][A-Za-z0-9_.:-]*$/i]
    : [];
  for (const field of fields) {
    if (!allowed.some((pattern) => pattern.test(field))) {
      throw new TypeError(
        `Unsupported ${directive} parameter ${field} on line ${lineNumber}.`,
      );
    }
  }
  const requiredPatterns = directive === "NODE"
    ? [/^NSET=/i]
    : directive === "ELEMENT"
    ? [/^TYPE=C3D4$/i, /^ELSET=/i]
    : directive === "MATERIAL"
    ? [/^NAME=/i]
    : [];
  for (const required of requiredPatterns) {
    if (!fields.some((field) => required.test(field))) {
      throw new TypeError(
        `${directive} on line ${lineNumber} lacks a required bounded-subset parameter.`,
      );
    }
  }
}

function validateCalculixSectionCompleteness(
  directive: string,
  dataLines: number,
): void {
  const bounds: Readonly<Record<string, readonly [number, number]>> = {
    HEADING: [1, 1],
    NODE: [4, Number.POSITIVE_INFINITY],
    ELEMENT: [1, Number.POSITIVE_INFINITY],
    MATERIAL: [0, 0],
    ELASTIC: [1, 1],
    STEP: [0, 0],
    STATIC: [0, 1],
    BOUNDARY: [1, Number.POSITIVE_INFINITY],
    CLOAD: [1, Number.POSITIVE_INFINITY],
    "END STEP": [0, 0],
  };
  const [minimum, maximum] = bounds[directive]!;
  if (dataLines < minimum || dataLines > maximum) {
    throw new TypeError(
      `${directive} requires ${
        minimum === maximum ? minimum : `${minimum}..${maximum}`
      } data lines in the bounded linkage subset; observed ${dataLines}.`,
    );
  }
}

function validateCalculixDataLine(
  directive: string,
  line: string,
  lineNumber: number,
  priorDataLines: number,
): void {
  const integer = "[-+]?[0-9]+";
  const number = "[-+]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[Ee][-+]?[0-9]+)?";
  const setOrNode = "(?:[A-Za-z][A-Za-z0-9_.:-]*|[-+]?[0-9]+)";
  const patterns: Readonly<Record<string, RegExp | undefined>> = {
    HEADING: /^[\x20-\x7e]{1,120}$/,
    NODE: new RegExp(`^${integer},${number},${number},${number}$`),
    ELEMENT: new RegExp(`^${integer}(?:,${integer}){4}$`),
    ELASTIC: new RegExp(`^${number},${number}$`),
    BOUNDARY: new RegExp(`^${setOrNode},${integer},${integer},${number}$`),
    CLOAD: new RegExp(`^${setOrNode},${integer},${number}$`),
    STATIC: new RegExp(`^${number}(?:,${number}){0,3}$`),
    MATERIAL: undefined,
    STEP: undefined,
    "END STEP": undefined,
  };
  const pattern = patterns[directive];
  if (
    !pattern || !pattern.test(line) || (directive === "HEADING" && priorDataLines > 0)
  ) {
    throw new TypeError(
      `Unsupported ${directive} data payload on line ${lineNumber}.`,
    );
  }
}

function rejectedBundle(
  input: SourceAnalysisFrontendInput,
  fingerprint: ContentFingerprint,
  analyzerId: string,
  profile: string,
  error: unknown,
): SourceAnalysisBundle {
  return validateSourceAnalysisBundle({
    schemaVersion: SOURCE_ANALYSIS_SCHEMA,
    source: {
      id: input.sourceId,
      role: input.role,
      language: input.language,
      fingerprint,
    },
    analyzer: { id: analyzerId, version: SPIKE_MINI_FRONTEND_VERSION },
    policy: {
      profile,
      status: "rejected",
      findings: [{
        id: "finding:unsupported-native-source",
        code: "unsupported-native-source",
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
      }],
    },
    symbols: [],
    dependencies: [],
    unresolvedConstructs: [],
  });
}

function assertInput(
  input: SourceAnalysisFrontendInput,
  role: SourceAnalysisFrontendInput["role"],
  language: SourceAnalysisFrontendInput["language"],
): void {
  if (input.role !== role || input.language !== language) {
    throw new TypeError(`Frontend accepts only ${role}/${language}.`);
  }
  safeId(input.sourceId, "$input.sourceId");
  if (typeof input.sourceText !== "string" || input.sourceText.length === 0) {
    throw new TypeError("$input.sourceText must be a non-empty string.");
  }
}

async function fingerprintUtf8(text: string): Promise<ContentFingerprint> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  };
}
