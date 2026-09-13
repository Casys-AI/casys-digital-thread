/**
 * Report documentation freshness headers on `docs/reference` Markdown pages.
 *
 * Warn/report mode only: never fails. Candidate paths come from the Git index
 * (plus untracked, non-ignored files), matching `verify-doc-links.ts`. The
 * gate uses only built-in APIs.
 */

interface FreshnessHeader {
  readonly sha: string;
  readonly date: string;
}

interface MissingHeader {
  readonly path: string;
}

interface UnknownSha {
  readonly path: string;
  readonly sha: string;
}

interface StalePage {
  readonly path: string;
  readonly sha: string;
  readonly headerDate: string;
  readonly commitTimestampMs: number;
}

const REPOSITORY_URL = new URL("../../", import.meta.url);
const REPOSITORY_PATH = fileUrlPath(REPOSITORY_URL);
const REFERENCE_PREFIX = "docs/reference/";
const HEADER_PATTERN =
  /^>\s*Verified-Against:\s+([0-9a-fA-F]{7,40})\s+\((\d{4}-\d{2}-\d{2})\)\.?\s*$/u;
const STALE_AFTER_MS = 8 * 7 * 24 * 60 * 60 * 1000;

try {
  await reportDocFreshness();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`Documentation freshness report could not complete: ${message}`);
  console.log("Warn mode: exiting 0.");
}
Deno.exit(0);

async function reportDocFreshness(): Promise<void> {
  const nowMs = Date.now();
  const repositoryPaths = await existingPaths(await gitCandidatePaths());
  const referencePages = repositoryPaths.filter((path) =>
    path.startsWith(REFERENCE_PREFIX) && path.endsWith(".md")
  );
  const commitTimestamps = new Map<string, number | undefined>();
  const missing: MissingHeader[] = [];
  const unknown: UnknownSha[] = [];
  const stale: StalePage[] = [];

  for (const path of referencePages) {
    const body = await readRepositoryText(path);
    const header = parseVerifiedAgainst(body);
    if (header === undefined) {
      missing.push({ path });
      continue;
    }

    const commitTimestampMs = await commitTimestamp(
      header.sha,
      commitTimestamps,
    );
    if (commitTimestampMs === undefined) {
      unknown.push({ path, sha: header.sha });
      continue;
    }

    if (nowMs - commitTimestampMs > STALE_AFTER_MS) {
      stale.push({
        path,
        sha: header.sha,
        headerDate: header.date,
        commitTimestampMs,
      });
    }
  }

  console.log("Documentation freshness report (warn mode; always exits 0)");
  console.log(`Scanned ${referencePages.length} docs/reference Markdown pages.`);
  printSection(
    "Missing Verified-Against header",
    missing.map((item) => `  ${item.path}`),
  );
  printSection(
    "Unknown commit SHA",
    unknown.map((item) => `  ${item.path}: ${item.sha}`),
  );
  printSection(
    "SHA older than 8 weeks",
    stale.map((item) => {
      const commitDate = isoDateUtc(item.commitTimestampMs);
      const ageDays = Math.floor((nowMs - item.commitTimestampMs) / 86_400_000);
      return `  ${item.path}: ${item.sha} (header ${item.headerDate}; commit ${commitDate}; ${ageDays}d)`;
    }),
  );
  console.log(
    `Summary: ${missing.length} missing, ${unknown.length} unknown, ` +
      `${stale.length} stale of ${referencePages.length} pages.`,
  );
}

function parseVerifiedAgainst(body: string): FreshnessHeader | undefined {
  const lines = body.split("\n");
  if (lines.length < 2) return undefined;
  if (!/^\s{0,3}#{1,6}\s+\S/u.test(lines[0] ?? "")) return undefined;
  const match = (lines[1] ?? "").match(HEADER_PATTERN);
  if (!match) return undefined;
  return { sha: match[1]!.toLowerCase(), date: match[2]! };
}

function printSection(title: string, lines: readonly string[]): void {
  console.log("");
  console.log(`${title}: ${lines.length}`);
  for (const line of lines) console.log(line);
}

function isoDateUtc(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

async function commitTimestamp(
  sha: string,
  cache: Map<string, number | undefined>,
): Promise<number | undefined> {
  if (cache.has(sha)) return cache.get(sha);
  const output = await git(["log", "-1", "--format=%ct", sha]);
  if (!output.success) {
    cache.set(sha, undefined);
    return undefined;
  }
  const seconds = Number.parseInt(
    new TextDecoder().decode(output.stdout).trim(),
    10,
  );
  if (!Number.isFinite(seconds)) {
    cache.set(sha, undefined);
    return undefined;
  }
  const timestampMs = seconds * 1000;
  cache.set(sha, timestampMs);
  return timestampMs;
}

async function gitCandidatePaths(): Promise<readonly string[]> {
  const output = await git([
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  if (!output.success) {
    throw new Error(
      `git ls-files failed: ${new TextDecoder().decode(output.stderr).trim()}`,
    );
  }
  return new TextDecoder().decode(output.stdout).split("\0").filter(Boolean)
    .sort();
}

async function git(
  args: readonly string[],
): Promise<Deno.CommandOutput> {
  return await new Deno.Command("git", {
    args: [...args],
    cwd: REPOSITORY_PATH,
    stdout: "piped",
    stderr: "piped",
  }).output();
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

async function readRepositoryText(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, REPOSITORY_URL));
}

function fileUrlPath(url: URL): string {
  const path = decodeURIComponent(url.pathname);
  return /^\/[A-Za-z]:\//u.test(path) ? path.slice(1) : path;
}
