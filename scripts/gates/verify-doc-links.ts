/**
 * Verify local links in every repository-candidate Markdown file.
 *
 * The gate deliberately uses only built-in APIs. It checks the Git index rather
 * than the working tree alone, adds new non-ignored files, and removes deleted
 * files. A link to gitignored local evidence therefore fails even when that
 * evidence happens to exist on the current machine.
 */

interface LinkFailure {
  readonly source: string;
  readonly line: number;
  readonly target: string;
  readonly reason: string;
}

interface MarkdownLink {
  readonly line: number;
  readonly target: string;
}

const REPOSITORY_URL = new URL("../../", import.meta.url);
const REPOSITORY_PATH = fileUrlPath(REPOSITORY_URL);

const repositoryPaths = await existingPaths(await gitCandidatePaths());
const repositoryFiles = new Set(repositoryPaths);
const markdownPaths = repositoryPaths.filter((path) => path.endsWith(".md"));
const markdownAnchors = new Map<string, ReadonlySet<string>>();
const failures: LinkFailure[] = [];
let checkedLinks = 0;
let checkedAnchors = 0;

for (const source of markdownPaths) {
  const body = await readRepositoryText(source);
  markdownAnchors.set(source, githubHeadingAnchors(body));
}

for (const source of markdownPaths) {
  const body = await readRepositoryText(source);
  for (const link of markdownLinks(body)) {
    const parsed = parseLocalTarget(link.target);
    if (parsed === undefined) continue;

    checkedLinks += 1;
    const targetPath = resolveTrackedPath(source, parsed.path);
    if (targetPath === undefined) {
      failures.push({
        source,
        line: link.line,
        target: link.target,
        reason: "path escapes the repository or is an absolute local path",
      });
      continue;
    }

    const targetIsFile = repositoryFiles.has(targetPath);
    const directoryPrefix = targetPath === "" ? "" : `${targetPath}/`;
    const targetIsDirectory = repositoryPaths.some((path) =>
      path.startsWith(directoryPrefix)
    );
    if (!targetIsFile && !targetIsDirectory) {
      failures.push({
        source,
        line: link.line,
        target: link.target,
        reason: "target is missing from the repository candidate",
      });
      continue;
    }

    if (parsed.anchor === undefined) continue;
    checkedAnchors += 1;
    const anchorTarget = targetPath === "" ? source : targetPath;
    if (!anchorTarget.endsWith(".md")) {
      failures.push({
        source,
        line: link.line,
        target: link.target,
        reason: "anchor target is not Markdown",
      });
      continue;
    }

    const anchors = markdownAnchors.get(anchorTarget);
    if (!anchors?.has(parsed.anchor)) {
      failures.push({
        source,
        line: link.line,
        target: link.target,
        reason: `heading anchor #${parsed.anchor} does not exist`,
      });
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(
      `${failure.source}:${failure.line}: ${failure.target} — ${failure.reason}`,
    );
  }
  console.error(
    `Documentation link verification failed (${failures.length} error(s)).`,
  );
  Deno.exit(1);
}

console.log(
  `Verified ${checkedLinks} local links and ${checkedAnchors} anchors across ` +
    `${markdownPaths.length} Markdown files in the repository candidate.`,
);

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
  return new TextDecoder().decode(output.stdout).split("\0").filter(Boolean).sort();
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

function markdownLinks(body: string): readonly MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const inline = /!?\[[^\]]*\]\(([^)\n]+)\)/gu;
  const reference = /^\s*\[[^\]]+\]:\s*(\S+)/u;
  let fenced = false;

  for (const [index, line] of body.split("\n").entries()) {
    if (/^\s*(```|~~~)/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    for (const match of line.matchAll(inline)) {
      links.push({ line: index + 1, target: match[1]!.trim() });
    }
    const referenceMatch = line.match(reference);
    if (referenceMatch) {
      links.push({ line: index + 1, target: referenceMatch[1]!.trim() });
    }
  }
  return links;
}

function parseLocalTarget(
  rawTarget: string,
): { readonly path: string; readonly anchor?: string } | undefined {
  let target = rawTarget.trim();
  if (target.startsWith("<")) {
    const close = target.indexOf(">");
    if (close === -1) return { path: target };
    target = target.slice(1, close);
  } else {
    target = target.replace(/\s+["'].*$/u, "");
  }

  if (/^(?:https?:|mailto:|tel:|data:|javascript:)/iu.test(target)) return undefined;

  const hash = target.indexOf("#");
  const rawPath = hash === -1 ? target : target.slice(0, hash);
  const rawAnchor = hash === -1 ? undefined : target.slice(hash + 1);
  const query = rawPath.indexOf("?");
  const pathWithoutQuery = query === -1 ? rawPath : rawPath.slice(0, query);

  try {
    const path = decodeURIComponent(pathWithoutQuery);
    const anchor = rawAnchor === undefined
      ? undefined
      : decodeURIComponent(rawAnchor).toLowerCase();
    return { path, anchor };
  } catch {
    return { path: pathWithoutQuery, anchor: rawAnchor?.toLowerCase() };
  }
}

function resolveTrackedPath(source: string, target: string): string | undefined {
  if (target.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(target)) return undefined;
  const sourceDirectory = source.includes("/")
    ? source.slice(0, source.lastIndexOf("/"))
    : "";
  const segments = target === ""
    ? source.split("/")
    : `${sourceDirectory}/${target}`.split("/");
  const normalized: string[] = [];

  for (const segment of segments) {
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

function githubHeadingAnchors(body: string): ReadonlySet<string> {
  const anchors = new Set<string>();
  const occurrences = new Map<string, number>();
  let fenced = false;

  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u);
    if (!match) continue;
    const base = githubSlug(match[1]!);
    if (base === "") continue;
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    anchors.add(occurrence === 0 ? base : `${base}-${occurrence}`);
  }

  return anchors;
}

function githubSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/<[^>]*>/gu, "")
    .replace(/[`*_~]/gu, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/gu, "-");
}

async function readRepositoryText(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, REPOSITORY_URL));
}

function fileUrlPath(url: URL): string {
  const path = decodeURIComponent(url.pathname);
  return /^\/[A-Za-z]:\//u.test(path) ? path.slice(1) : path;
}
