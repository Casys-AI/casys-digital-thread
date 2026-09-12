/**
 * Verify `*.ts:<line>` locators in every repository-candidate Markdown file.
 *
 * The gate deliberately uses only built-in APIs. It checks the Git index rather
 * than the working tree alone, matching `verify-doc-links.ts`: new non-ignored
 * files are included, deleted files are not, and a locator into gitignored
 * local evidence fails even when that file happens to exist on disk.
 *
 * Resolution:
 * - A path containing `/` is repo-root-relative.
 * - A bare filename must match exactly one candidate `*.ts` basename. Zero
 *   matches fail; two or more are warnings, never failures.
 *
 * Skip locators inside fenced blocks that are clearly illustrative shell
 * output. A fence counts as shell output when its info-string language is one
 * of: bash, sh, shell, zsh, console, terminal, text, output, powershell, pwsh,
 * cmd, fish. Other fences (TypeScript, Python, JSON, unlabeled) stay in scope.
 *
 * `--mode=strict` exits 1 on unresolvable locators. `--mode=warn` prints the
 * same `source:line -> target` records and exits 0. Ambiguous basenames are
 * warnings in both modes.
 */

interface CodeRefFailure {
  readonly source: string;
  readonly line: number;
  readonly target: string;
  readonly reason: string;
}

interface CodeRefWarning {
  readonly source: string;
  readonly line: number;
  readonly target: string;
  readonly reason: string;
}

interface CodeRef {
  readonly line: number;
  readonly target: string;
  readonly path: string;
  readonly locators: readonly LineSpan[];
}

interface LineSpan {
  readonly start: number;
  readonly end: number;
}

type ResolveResult =
  | { readonly kind: "resolved"; readonly path: string }
  | { readonly kind: "missing" }
  | { readonly kind: "escaped" }
  | { readonly kind: "ambiguous"; readonly candidates: readonly string[] };

const REPOSITORY_URL = new URL("../../", import.meta.url);
const REPOSITORY_PATH = fileUrlPath(REPOSITORY_URL);

const ILLUSTRATIVE_SHELL_FENCE_LANGUAGES = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "console",
  "terminal",
  "text",
  "output",
  "powershell",
  "pwsh",
  "cmd",
  "fish",
]);

const CODE_REF_PATTERN =
  /(?<![A-Za-z0-9._/-])((?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.ts):(\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*)/gu;

const mode = parseMode(Deno.args);
const repositoryPaths = await existingPaths(await gitCandidatePaths());
const repositoryFiles = new Set(repositoryPaths);
const filesByBasename = indexByBasename(
  repositoryPaths.filter((path) => path.endsWith(".ts")),
);
const markdownPaths = repositoryPaths.filter((path) => path.endsWith(".md"));
const lineCounts = new Map<string, number>();
const failures: CodeRefFailure[] = [];
const warnings: CodeRefWarning[] = [];
let checkedRefs = 0;

for (const source of markdownPaths) {
  const body = await readRepositoryText(source);
  for (const ref of markdownCodeRefs(body)) {
    checkedRefs += 1;
    const resolved = resolveCodeRefPath(
      ref.path,
      filesByBasename,
      repositoryFiles,
    );
    if (resolved.kind === "ambiguous") {
      warnings.push({
        source,
        line: ref.line,
        target: ref.target,
        reason: `ambiguous basename (${resolved.candidates.join(", ")})`,
      });
      continue;
    }
    if (resolved.kind === "escaped") {
      failures.push({
        source,
        line: ref.line,
        target: ref.target,
        reason: "path escapes the repository or is an absolute local path",
      });
      continue;
    }
    if (resolved.kind === "missing") {
      failures.push({
        source,
        line: ref.line,
        target: ref.target,
        reason: "target is missing from the repository candidate",
      });
      continue;
    }

    const count = await cachedLineCount(resolved.path, lineCounts);
    const outOfRange = ref.locators.find((span) => !lineSpanInRange(span, count));
    if (outOfRange !== undefined) {
      failures.push({
        source,
        line: ref.line,
        target: ref.target,
        reason: `line ${formatSpan(outOfRange)} is out of range (${count} lines)`,
      });
    }
  }
}

failures.sort(compareRecord);
warnings.sort(compareRecord);

for (const warning of warnings) {
  console.error(
    `warning: ${warning.source}:${warning.line} -> ${warning.target} — ${warning.reason}`,
  );
}
for (const failure of failures) {
  console.error(
    `${failure.source}:${failure.line} -> ${failure.target} — ${failure.reason}`,
  );
}

if (mode === "strict" && failures.length > 0) {
  console.error(
    `Documentation code-reference verification failed (${failures.length} error(s)).`,
  );
  Deno.exit(1);
}

const warningPart = warnings.length === 0
  ? ""
  : ` (${warnings.length} ambiguous basename warning(s))`;
if (mode === "warn" && failures.length > 0) {
  console.log(
    `Checked ${checkedRefs} code references across ${markdownPaths.length} Markdown files; ` +
      `${failures.length} unresolvable, ${warnings.length} ambiguous (warn mode).`,
  );
} else {
  console.log(
    `Verified ${checkedRefs} code references across ${markdownPaths.length} Markdown files` +
      warningPart +
      ".",
  );
}

function parseMode(args: readonly string[]): "strict" | "warn" {
  let mode: "strict" | "warn" = "strict";
  for (const arg of args) {
    if (arg === "--mode=strict") {
      mode = "strict";
      continue;
    }
    if (arg === "--mode=warn") {
      mode = "warn";
      continue;
    }
    console.error(`unknown argument: ${arg}`);
    Deno.exit(1);
  }
  return mode;
}

async function gitCandidatePaths(): Promise<readonly string[]> {
  const output = await new Deno.Command("git", {
    args: ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    cwd: REPOSITORY_PATH,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `git ls-files failed: ${new TextDecoder().decode(output.stderr).trim()}`,
    );
  }
  return new TextDecoder().decode(output.stdout).split("\0").filter(Boolean)
    .sort();
}

async function existingPaths(
  paths: readonly string[],
): Promise<readonly string[]> {
  const existing: string[] = [];
  for (const path of paths) {
    try {
      await Deno.lstat(new URL(path, REPOSITORY_URL));
      existing.push(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return existing;
}

function markdownCodeRefs(body: string): readonly CodeRef[] {
  const refs: CodeRef[] = [];
  let fenced = false;
  let skipFence = false;

  for (const [index, line] of body.split("\n").entries()) {
    const fence = line.match(/^\s*(```|~~~)(.*)$/u);
    if (fence) {
      if (!fenced) {
        fenced = true;
        skipFence = isIllustrativeShellFence(fence[2] ?? "");
      } else {
        fenced = false;
        skipFence = false;
      }
      continue;
    }
    if (fenced && skipFence) continue;

    for (const match of line.matchAll(CODE_REF_PATTERN)) {
      const path = match[1]!;
      const locatorText = match[2]!;
      refs.push({
        line: index + 1,
        target: `${path}:${locatorText}`,
        path,
        locators: parseLocators(locatorText),
      });
    }
  }
  return refs;
}

function isIllustrativeShellFence(infoString: string): boolean {
  const lang = infoString.trim().split(/\s+/u)[0]?.toLowerCase() ?? "";
  return ILLUSTRATIVE_SHELL_FENCE_LANGUAGES.has(lang);
}

function parseLocators(raw: string): readonly LineSpan[] {
  return raw.split(/\s*,\s*/u).map((part) => {
    const dash = part.indexOf("-");
    if (dash === -1) {
      const line = Number(part);
      return { start: line, end: line };
    }
    return {
      start: Number(part.slice(0, dash)),
      end: Number(part.slice(dash + 1)),
    };
  });
}

function resolveCodeRefPath(
  path: string,
  filesByBasename: ReadonlyMap<string, readonly string[]>,
  repositoryFiles: ReadonlySet<string>,
): ResolveResult {
  if (path.includes("/")) {
    const normalized = normalizeRepoPath(path);
    if (normalized === undefined) return { kind: "escaped" };
    if (!repositoryFiles.has(normalized)) return { kind: "missing" };
    return { kind: "resolved", path: normalized };
  }
  const matches = filesByBasename.get(path) ?? [];
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length > 1) {
    return { kind: "ambiguous", candidates: matches };
  }
  return { kind: "resolved", path: matches[0]! };
}

function normalizeRepoPath(target: string): string | undefined {
  if (target.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(target)) {
    return undefined;
  }
  const normalized: string[] = [];
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (normalized.length === 0) return undefined;
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }
  return normalized.join("/");
}

function indexByBasename(
  paths: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, string[]>();
  for (const path of paths) {
    const base = path.slice(path.lastIndexOf("/") + 1);
    const list = map.get(base);
    if (list) list.push(path);
    else map.set(base, [path]);
  }
  for (const list of map.values()) list.sort();
  return map;
}

function lineSpanInRange(span: LineSpan, lineCount: number): boolean {
  return span.start >= 1 && span.end >= span.start && span.end <= lineCount;
}

function formatSpan(span: LineSpan): string {
  return span.start === span.end ? String(span.start) : `${span.start}-${span.end}`;
}

async function cachedLineCount(
  path: string,
  cache: Map<string, number>,
): Promise<number> {
  const hit = cache.get(path);
  if (hit !== undefined) return hit;
  const count = countLines(await readRepositoryText(path));
  cache.set(path, count);
  return count;
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 && i < text.length - 1) count += 1;
  }
  return count;
}

function compareRecord(
  left: { readonly source: string; readonly line: number; readonly target: string },
  right: { readonly source: string; readonly line: number; readonly target: string },
): number {
  return left.source.localeCompare(right.source) ||
    left.line - right.line ||
    left.target.localeCompare(right.target);
}

async function readRepositoryText(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, REPOSITORY_URL));
}

function fileUrlPath(url: URL): string {
  const path = decodeURIComponent(url.pathname);
  return /^\/[A-Za-z]:\//u.test(path) ? path.slice(1) : path;
}
