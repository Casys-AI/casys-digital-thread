import { assertEquals } from "@std/assert";

type ImportKind = "runtime" | "type-only";

interface ModuleImport {
  readonly source: string;
  readonly target: string;
  readonly kind: ImportKind;
  readonly specifier: string;
}

interface ParsedImport {
  readonly kind: ImportKind;
  readonly specifier: string;
}

interface ArchitectureCycleAllowance {
  readonly members: readonly string[];
  readonly rationale: string;
}

const SCAN_ROOTS = ["server.ts", "src", "scripts", "desktop"] as const;
const EXCLUDED_DIRECTORY_NAMES = new Set([
  "dist",
  "node_modules",
  "testing",
]);
const RETIRED_DIRECTORIES = [
  "src/contracts",
  "src/domain/modelica/recorded",
  "src/adapters/modelica/recorded",
  "src/domain/inspection-drone",
  "src/adapters/inspection-drone",
] as const;

/**
 * Type imports are erased, so they cannot form a runtime initialization cycle.
 * They still couple module boundaries and therefore require one explicit,
 * reviewable allowance instead of disappearing from the architecture report.
 */
const ALLOWED_TYPE_MEDIATED_CYCLES: readonly ArchitectureCycleAllowance[] = [];

/**
 * Production use cases may not import `src/orchestration/`.
 * A surviving edge must name exact source and target files and a rationale.
 */
const ALLOWED_USE_CASE_ORCHESTRATION_IMPORTS: readonly {
  readonly source: string;
  readonly target: string;
  readonly rationale: string;
}[] = [];

Deno.test("production imports preserve inward architecture boundaries and remain runtime-acyclic", async () => {
  const modules = await productionModules();
  const imports = await resolvedImports(modules);
  const unresolved = await unresolvedTypeScriptImports(modules);
  const forbiddenImports = imports.filter(isForbiddenLayerImport);
  const boundaryViolations = forbiddenImports
    .map(formatImport)
    .toSorted();
  const runtimeCycles = cycleSignatures(
    modules,
    imports.filter((dependency) => dependency.kind === "runtime"),
  );

  assertEquals(
    unresolved,
    [],
    "The architecture graph must resolve every relative TypeScript import.",
  );
  assertEquals(
    boundaryViolations,
    [],
    "Domain stays inward; application use cases do not import orchestration except an exact justified allowance; presentation read models depend only on presentation or domain; UI does not import desktop runtime; desktop does not import the web UI.",
  );
  const resurrected = [];
  for (const directory of RETIRED_DIRECTORIES) {
    if (await directoryExists(directory)) resurrected.push(directory);
  }
  assertEquals(
    resurrected,
    [],
    "Unowned contracts and recorded-Modelica islands must not reappear.",
  );
  assertEquals(
    runtimeCycles,
    [],
    "Production runtime imports must remain acyclic.",
  );
});

Deno.test("type-mediated production cycles stay explicitly bounded", async () => {
  const modules = await productionModules();
  const imports = await resolvedImports(modules);
  const runtimeImports = imports.filter((dependency) => dependency.kind === "runtime");
  const runtimeCycleMembers = new Set(
    cyclicComponents(modules, runtimeImports).flat(),
  );
  const typeMediatedCycles = cyclicComponents(modules, imports)
    .filter((members) => !members.some((member) => runtimeCycleMembers.has(member)))
    .map(cycleSignature)
    .toSorted();
  const allowed = ALLOWED_TYPE_MEDIATED_CYCLES
    .map((entry) => cycleSignature(entry.members))
    .toSorted();

  assertEquals(
    typeMediatedCycles,
    allowed,
    "A type-mediated cycle needs an explicit member list and rationale in ALLOWED_TYPE_MEDIATED_CYCLES.",
  );
  assertEquals(
    ALLOWED_TYPE_MEDIATED_CYCLES.every((entry) =>
      entry.members.length > 1 && entry.rationale.trim().length > 0
    ),
    true,
    "Every type-mediated cycle allowance must be narrow and justified.",
  );
});

Deno.test("the import scanner distinguishes erased type edges from runtime edges", () => {
  assertEquals(
    parseImports(`
      // import { Ignored } from "./comment.ts";
      import type { TypeA } from "./type-a.ts";
      export type { TypeB } from "./type-b.ts";
      import { type TypeC, type TypeD as Alias } from "./types.ts";
      import { type TypeE, runtimeValue } from "./mixed.ts";
      export * from "./barrel.ts";
      import "./side-effect.ts";
      type Lazy = readonly import("./query.ts").Query;
      const loaded = import("./dynamic.ts");
    `),
    [
      { kind: "type-only", specifier: "./type-a.ts" },
      { kind: "type-only", specifier: "./type-b.ts" },
      { kind: "type-only", specifier: "./types.ts" },
      { kind: "runtime", specifier: "./mixed.ts" },
      { kind: "runtime", specifier: "./barrel.ts" },
      { kind: "runtime", specifier: "./side-effect.ts" },
      { kind: "type-only", specifier: "./query.ts" },
      { kind: "runtime", specifier: "./dynamic.ts" },
    ],
  );
});

Deno.test("presentation remains outward of application and depends on domain by type only", () => {
  const edge = (
    source: string,
    target: string,
    kind: ImportKind,
  ): ModuleImport => ({ source, target, kind, specifier: target });

  assertEquals([
    isForbiddenLayerImport(edge(
      "src/application/control-plane/control-plane.ts",
      "src/presentation/workbench/thread/snapshot.ts",
      "type-only",
    )),
    isForbiddenLayerImport(edge(
      "src/application/control-plane/control-plane.ts",
      "src/presentation/workbench/thread/snapshot.ts",
      "runtime",
    )),
    isForbiddenLayerImport(edge(
      "src/adapters/thread/thread-workbench-projector.ts",
      "src/presentation/workbench/thread/snapshot.ts",
      "type-only",
    )),
    isForbiddenLayerImport(edge(
      "src/ui/src/thread/types.ts",
      "src/presentation/workbench/thread/snapshot.ts",
      "type-only",
    )),
    isForbiddenLayerImport(edge(
      "src/presentation/workbench/engineering/snapshot.ts",
      "src/domain/project/engineering-project.ts",
      "runtime",
    )),
    isForbiddenLayerImport(edge(
      "src/presentation/workbench/engineering/snapshot.ts",
      "src/domain/project/engineering-project.ts",
      "type-only",
    )),
    isForbiddenLayerImport(edge(
      "src/presentation/workbench/engineering/snapshot.ts",
      "src/application/control-plane/control-plane.ts",
      "runtime",
    )),
    isForbiddenLayerImport(edge(
      "src/presentation/workbench/engineering/snapshot.ts",
      "src/application/control-plane/control-plane.ts",
      "type-only",
    )),
    isForbiddenLayerImport(edge(
      "src/presentation/workbench/engineering/snapshot.ts",
      "src/tools/control-plane.ts",
      "runtime",
    )),
    isForbiddenLayerImport(edge(
      "src/presentation/workbench/engineering/snapshot.ts",
      "src/tools/control-plane.ts",
      "type-only",
    )),
  ], [true, true, false, false, true, false, true, true, true, true]);
});

Deno.test("application use cases stay inward of adapters and orchestration", () => {
  const edge = (
    source: string,
    target: string,
    kind: ImportKind,
  ): ModuleImport => ({ source, target, kind, specifier: target });

  assertEquals([
    isForbiddenLayerImport(edge(
      "src/application/use-cases/electrical/spice/evaluation/prepare-project-admitted-spice-evaluation-review.ts",
      "src/adapters/electrical/observation-method-sheet/electrical-observation-method-sheet-seal-capture.ts",
      "runtime",
    )),
    isForbiddenLayerImport(edge(
      "src/application/use-cases/electrical/spice/evaluation/prepare-project-admitted-spice-evaluation-review.ts",
      "src/domain/electrical/observation-method-sheet-seal-capture.ts",
      "runtime",
    )),
    isForbiddenLayerImport(edge(
      "src/application/use-cases/registered-project-run-executor.ts",
      "src/orchestration/operations/approved-brief-baseline.ts",
      "runtime",
    )),
    isForbiddenLayerImport(edge(
      "src/application/use-cases/registered-project-run-executor.ts",
      "src/domain/compile/brief/approved-brief-baseline.ts",
      "runtime",
    )),
  ], [true, false, true, false]);
  assertEquals(
    ALLOWED_USE_CASE_ORCHESTRATION_IMPORTS.every((entry) =>
      entry.source.startsWith("src/application/use-cases/") &&
      entry.target.startsWith("src/orchestration/") &&
      entry.rationale.trim().length > 0
    ),
    true,
    "A use-case orchestration allowance must name exact files and a rationale.",
  );
});

Deno.test("desktop chat and UI share the presentation contract without crossing runtimes", () => {
  const edge = (
    source: string,
    target: string,
    kind: ImportKind,
  ): ModuleImport => ({ source, target, kind, specifier: target });

  assertEquals([
    isForbiddenLayerImport(edge(
      "src/ui/src/thread/desktop-chat.tsx",
      "desktop/src/chat/bindings.ts",
      "runtime",
    )),
    isForbiddenLayerImport(edge(
      "src/ui/src/thread/desktop-chat.tsx",
      "src/presentation/desktop/chat/contracts.ts",
      "runtime",
    )),
    isForbiddenLayerImport(edge(
      "desktop/src/chat/bindings.ts",
      "src/presentation/desktop/chat/contracts.ts",
      "runtime",
    )),
    isForbiddenLayerImport(edge(
      "desktop/src/chat/bindings.ts",
      "src/ui/src/thread/desktop-chat.tsx",
      "runtime",
    )),
    isForbiddenLayerImport(edge(
      "src/application/use-cases/registered-project-run-executor.ts",
      "desktop/src/chat/bindings.ts",
      "runtime",
    )),
  ], [true, false, false, true, true]);
});

Deno.test("architecture census includes desktop and the shared chat contract", async () => {
  const modules = await productionModules();
  assertEquals(modules.has("desktop/src/chat/bindings.ts"), true);
  assertEquals(
    modules.has("src/presentation/desktop/chat/contracts.ts"),
    true,
  );
  assertEquals(
    resolveTypeScriptModule(
      "src/ui/src/thread/desktop-chat.tsx",
      "../../../presentation/desktop/chat/contracts.ts",
      modules,
    ),
    "src/presentation/desktop/chat/contracts.ts",
  );
  assertEquals(
    resolveTypeScriptModule(
      "desktop/src/chat/bindings.ts",
      "../../../src/presentation/desktop/chat/contracts.ts",
      modules,
    ),
    "src/presentation/desktop/chat/contracts.ts",
  );
});

Deno.test("runtime cycle detection rejects cycles while type-only back edges remain reportable", () => {
  const modules = new Set(["src/a.ts", "src/b.ts"]);
  const runtimeCycle: ModuleImport[] = [{
    source: "src/a.ts",
    target: "src/b.ts",
    kind: "runtime",
    specifier: "./b.ts",
  }, {
    source: "src/b.ts",
    target: "src/a.ts",
    kind: "runtime",
    specifier: "./a.ts",
  }];
  const typeMediatedCycle: ModuleImport[] = [runtimeCycle[0]!, {
    ...runtimeCycle[1]!,
    kind: "type-only",
  }];

  assertEquals(cycleSignatures(modules, runtimeCycle), [
    "src/a.ts <-> src/b.ts",
  ]);
  assertEquals(
    cycleSignatures(
      modules,
      typeMediatedCycle.filter((dependency) => dependency.kind === "runtime"),
    ),
    [],
  );
  assertEquals(cycleSignatures(modules, typeMediatedCycle), [
    "src/a.ts <-> src/b.ts",
  ]);
});

async function productionModules(): Promise<ReadonlySet<string>> {
  const modules = new Set<string>();
  for (const root of SCAN_ROOTS) {
    try {
      const info = await Deno.stat(root);
      if (info.isFile) {
        if (isProductionTypeScript(root)) modules.add(root);
      } else if (info.isDirectory) {
        await collectModules(root, modules);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue;
      throw error;
    }
  }
  return modules;
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

async function collectModules(
  directory: string,
  modules: Set<string>,
): Promise<void> {
  const entries = [];
  for await (const entry of Deno.readDir(directory)) entries.push(entry);
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory) {
      if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
        await collectModules(path, modules);
      }
      continue;
    }
    if (entry.isFile && isProductionTypeScript(path)) modules.add(path);
  }
}

function isProductionTypeScript(path: string): boolean {
  return /\.(?:ts|tsx)$/.test(path) &&
    !/(?:^|\/)[^/]*_(?:integration_)?test\.(?:ts|tsx)$/.test(path) &&
    !path.startsWith("experiments/");
}

async function resolvedImports(
  modules: ReadonlySet<string>,
): Promise<ModuleImport[]> {
  const imports: ModuleImport[] = [];
  for (const source of [...modules].toSorted()) {
    const parsed = parseImports(await Deno.readTextFile(source));
    for (const dependency of parsed) {
      const target = resolveTypeScriptModule(source, dependency.specifier, modules);
      if (!target) continue;
      imports.push({ source, target, ...dependency });
    }
  }
  return imports;
}

async function unresolvedTypeScriptImports(
  modules: ReadonlySet<string>,
): Promise<string[]> {
  const unresolved: string[] = [];
  for (const source of [...modules].toSorted()) {
    const parsed = parseImports(await Deno.readTextFile(source));
    for (const dependency of parsed) {
      if (!isRelativeTypeScriptSpecifier(dependency.specifier)) continue;
      if (!resolveTypeScriptModule(source, dependency.specifier, modules)) {
        unresolved.push(
          `${source} -> ${dependency.specifier} (${dependency.kind})`,
        );
      }
    }
  }
  return unresolved.toSorted();
}

function parseImports(source: string): ParsedImport[] {
  const code = maskComments(source);
  const imports: Array<ParsedImport & { index: number }> = [];
  const occupied = new Set<number>();
  const staticPattern =
    /^\s*(import|export)\s+(type\s+)?([^;]*?)\bfrom\s*(["'])([^"']+)\4[^;]*;/gm;
  for (const match of code.matchAll(staticPattern)) {
    const index = match.index ?? 0;
    occupy(occupied, index, index + match[0].length);
    imports.push({
      index,
      kind: staticImportKind(match[2], match[3] ?? ""),
      specifier: match[5]!,
    });
  }

  const sideEffectPattern = /^\s*import\s*(["'])([^"']+)\1[^;]*;/gm;
  for (const match of code.matchAll(sideEffectPattern)) {
    const index = match.index ?? 0;
    if (occupied.has(index)) continue;
    occupy(occupied, index, index + match[0].length);
    imports.push({ index, kind: "runtime", specifier: match[2]! });
  }

  const dynamicPattern =
    /\b(?:(typeof|readonly)\s+)?import\s*\(\s*(["'])([^"']+)\2\s*\)/g;
  for (const match of code.matchAll(dynamicPattern)) {
    const index = match.index ?? 0;
    if (occupied.has(index)) continue;
    imports.push({
      index,
      kind: match[1] ? "type-only" : "runtime",
      specifier: match[3]!,
    });
  }

  return imports
    .toSorted((left, right) => left.index - right.index)
    .map(({ kind, specifier }) => ({ kind, specifier }));
}

function staticImportKind(
  explicitType: string | undefined,
  clause: string,
): ImportKind {
  if (explicitType) return "type-only";
  const trimmed = clause.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return "runtime";
  const bindings = trimmed.slice(1, -1).split(",")
    .map((binding) => binding.trim())
    .filter(Boolean);
  return bindings.length > 0 &&
      bindings.every((binding) => binding.startsWith("type "))
    ? "type-only"
    : "runtime";
}

function maskComments(source: string): string {
  let result = "";
  let index = 0;
  let quote: '"' | "'" | "`" | undefined;
  while (index < source.length) {
    const char = source[index]!;
    const next = source[index + 1];
    if (quote) {
      result += char;
      if (char === "\\" && next !== undefined) {
        result += next;
        index += 2;
        continue;
      }
      if (char === quote) quote = undefined;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      result += char;
      index += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      result += "  ";
      index += 2;
      while (index < source.length && source[index] !== "\n") {
        result += " ";
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      result += "  ";
      index += 2;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        result += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      if (index < source.length) {
        result += "  ";
        index += 2;
      }
      continue;
    }
    result += char;
    index += 1;
  }
  return result;
}

function resolveTypeScriptModule(
  source: string,
  specifier: string,
  modules: ReadonlySet<string>,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = normalizePath(`${parentDirectory(source)}/${specifier}`);
  const candidates = hasTypeScriptExtension(base)
    ? [base]
    : [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find((candidate) => modules.has(candidate));
}

function isRelativeTypeScriptSpecifier(specifier: string): boolean {
  if (!specifier.startsWith(".")) return false;
  const extension = specifier.match(/\.([a-zA-Z0-9]+)$/)?.[1];
  return extension === undefined || extension === "ts" || extension === "tsx" ||
    extension === "js" || extension === "jsx";
}

function hasTypeScriptExtension(path: string): boolean {
  return /\.(?:ts|tsx)$/.test(path);
}

function parentDirectory(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "." : path.slice(0, separator);
}

function normalizePath(path: string): string {
  const normalized: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      normalized.pop();
    } else {
      normalized.push(segment);
    }
  }
  return normalized.join("/");
}

function cyclicComponents(
  modules: ReadonlySet<string>,
  imports: readonly ModuleImport[],
): string[][] {
  const adjacency = new Map(
    [...modules].map((module) => [module, new Set<string>()] as const),
  );
  for (const dependency of imports) {
    adjacency.get(dependency.source)?.add(dependency.target);
  }
  const components = stronglyConnectedComponents(adjacency);
  return components.filter((members) =>
    members.length > 1 || adjacency.get(members[0]!)?.has(members[0]!)
  );
}

function cycleSignatures(
  modules: ReadonlySet<string>,
  imports: readonly ModuleImport[],
): string[] {
  return cyclicComponents(modules, imports).map(cycleSignature).toSorted();
}

function cycleSignature(members: readonly string[]): string {
  return [...members].toSorted().join(" <-> ");
}

function stronglyConnectedComponents(
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (module: string): void => {
    indices.set(module, nextIndex);
    lowLinks.set(module, nextIndex);
    nextIndex += 1;
    stack.push(module);
    onStack.add(module);

    for (const dependency of adjacency.get(module) ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(
          module,
          Math.min(lowLinks.get(module)!, lowLinks.get(dependency)!),
        );
      } else if (onStack.has(dependency)) {
        lowLinks.set(
          module,
          Math.min(lowLinks.get(module)!, indices.get(dependency)!),
        );
      }
    }

    if (lowLinks.get(module) !== indices.get(module)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === module) break;
    }
    components.push(component.toSorted());
  };

  for (const module of [...adjacency.keys()].toSorted()) {
    if (!indices.has(module)) visit(module);
  }
  return components;
}

function occupy(occupied: Set<number>, start: number, end: number): void {
  for (let index = start; index < end; index += 1) occupied.add(index);
}

function formatImport(dependency: ModuleImport): string {
  return `${dependency.source} -> ${dependency.target} (${dependency.kind})`;
}

function isForbiddenLayerImport(dependency: ModuleImport): boolean {
  const { kind, source, target } = dependency;
  if (source.startsWith("src/domain/")) {
    return !target.startsWith("src/domain/");
  }
  if (source.startsWith("src/application/ports/")) {
    return ![
      "src/application/ports/",
      "src/domain/",
    ].some((prefix) => target.startsWith(prefix));
  }
  if (source.startsWith("src/application/use-cases/")) {
    if (target.startsWith("src/orchestration/")) {
      return !ALLOWED_USE_CASE_ORCHESTRATION_IMPORTS.some((entry) =>
        entry.source === source && entry.target === target
      );
    }
    return ![
      "src/application/ports/",
      "src/application/use-cases/",
      "src/domain/",
    ].some((prefix) => target.startsWith(prefix));
  }
  if (source.startsWith("src/application/")) {
    return [
      "src/adapters/",
      "src/presentation/",
      "src/tools/",
      "src/ui/",
      "desktop/",
    ].some((prefix) => target.startsWith(prefix));
  }
  if (source.startsWith("src/tools/")) {
    return ["src/adapters/", "src/presentation/", "src/ui/", "desktop/"].some(
      (prefix) => target.startsWith(prefix),
    );
  }
  if (source.startsWith("src/ui/")) {
    return target.startsWith("desktop/");
  }
  if (source.startsWith("desktop/")) {
    return target.startsWith("src/ui/");
  }
  if (!source.startsWith("src/presentation/")) return false;
  if (target.startsWith("src/presentation/")) return false;
  return !(kind === "type-only" && target.startsWith("src/domain/"));
}
