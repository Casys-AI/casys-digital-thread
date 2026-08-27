/** Installation-private CAS, admission journal, invalidations and index. */

import { resolve } from "node:path";

import type {
  SensitivityExperienceIndex,
  SensitivityExperienceIndexEntry,
} from "../../../application/ports/out/sensitivity/experience/sensitivity-experience-index.ts";
import {
  SENSITIVITY_EXPERIENCE_ADMISSION_SCHEMA,
  SENSITIVITY_EXPERIENCE_AUDIENCE,
  SENSITIVITY_EXPERIENCE_INVALIDATION_SCHEMA,
  SENSITIVITY_EXPERIENCE_ORIGIN_AUDIENCE,
  type SensitivityExperienceAdmission,
  type SensitivityExperienceInvalidation,
  type SensitivityExperienceInvalidationReason,
  type SensitivityExperienceOriginBinding,
  type SensitivityExperienceRecord,
  type SensitivityExperienceReuseReceipt,
  type SensitivityExperienceReuseReview,
  validateSensitivityExperienceAdmission,
  validateSensitivityExperienceInvalidation,
  validateSensitivityExperienceOriginBinding,
  validateSensitivityExperienceRecord,
  validateSensitivityExperienceReuseReceipt,
  validateSensitivityExperienceReuseReview,
} from "../../../domain/sensitivity/experience/sensitivity-experience.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import {
  replaceAttemptFileDurably,
  writeNewAttemptFileDurably,
} from "../../shared/wal/durable-attempt-file-writes.ts";

export const SENSITIVITY_EXPERIENCE_INDEX_SCHEMA =
  "sensitivity-experience-index/1.0" as const;

interface SensitivityExperienceIndexSnapshot {
  readonly schemaVersion: typeof SENSITIVITY_EXPERIENCE_INDEX_SCHEMA;
  readonly audience: typeof SENSITIVITY_EXPERIENCE_ORIGIN_AUDIENCE;
  readonly entries: readonly SensitivityExperienceIndexEntry[];
}

export class FileSensitivityExperienceRepository implements SensitivityExperienceIndex {
  readonly #root: string;
  readonly #records: FileCaptureStore<"sensitivity-experience-record">;
  readonly #origins: FileCaptureStore<"sensitivity-experience-origin">;
  readonly #admissions: FileCaptureStore<"sensitivity-experience-admission">;
  readonly #invalidations: FileCaptureStore<"sensitivity-experience-invalidation">;
  readonly #reviews: FileCaptureStore<"sensitivity-experience-reuse-review">;
  readonly #receipts: FileCaptureStore<"sensitivity-experience-reuse-receipt">;

  constructor(root = "state/local/sensitivity-experience") {
    this.#root = root.replace(/\/+$/, "");
    this.#records = store(this.#root, "records", {
      kind: "sensitivity-experience-record",
      uriNamespace: "sensitivity-experience-record",
      label: "Sensitivity experience record",
    });
    this.#origins = store(this.#root, "origins", {
      kind: "sensitivity-experience-origin",
      uriNamespace: "sensitivity-experience-origin",
      label: "Sensitivity experience origin",
    });
    this.#admissions = store(this.#root, "admissions", {
      kind: "sensitivity-experience-admission",
      uriNamespace: "sensitivity-experience-admission",
      label: "Sensitivity experience admission",
    });
    this.#invalidations = store(this.#root, "invalidations", {
      kind: "sensitivity-experience-invalidation",
      uriNamespace: "sensitivity-experience-invalidation",
      label: "Sensitivity experience invalidation",
    });
    this.#reviews = store(this.#root, "reviews", {
      kind: "sensitivity-experience-reuse-review",
      uriNamespace: "sensitivity-experience-reuse-review",
      label: "Sensitivity experience reuse review",
    });
    this.#receipts = store(this.#root, "receipts", {
      kind: "sensitivity-experience-reuse-receipt",
      uriNamespace: "sensitivity-experience-reuse-receipt",
      label: "Sensitivity experience reuse receipt",
    });
  }

  async saveExperience(
    recordValue: unknown,
    originValue: unknown,
  ): Promise<{
    readonly record: SensitivityExperienceRecord;
    readonly recordFingerprint: ContentFingerprint;
    readonly origin: SensitivityExperienceOriginBinding;
    readonly originBindingFingerprint: ContentFingerprint;
  }> {
    await this.#ensurePrivateLayout(["records", "origins", "admissions"], true);
    const record = await validateSensitivityExperienceRecord(recordValue);
    const recordFingerprint = await sha256Fingerprint(record);
    const origin = validateSensitivityExperienceOriginBinding(originValue);
    if (!fingerprintsEqual(origin.recordFingerprint, recordFingerprint)) {
      throw new TypeError("Experience origin does not name the derived record.");
    }
    const originBindingFingerprint = await sha256Fingerprint(origin);
    await assertAbsentOrRegularFile(this.#records.pathFor(recordFingerprint));
    await assertAbsentOrRegularFile(this.#origins.pathFor(originBindingFingerprint));
    await saveAndReread(
      this.#records,
      recordFingerprint,
      record,
      async (value) => await validateSensitivityExperienceRecord(value),
    );
    await saveAndReread(
      this.#origins,
      originBindingFingerprint,
      origin,
      (value) => validateSensitivityExperienceOriginBinding(value),
    );
    await this.admit({
      schemaVersion: SENSITIVITY_EXPERIENCE_ADMISSION_SCHEMA,
      audience: SENSITIVITY_EXPERIENCE_ORIGIN_AUDIENCE,
      scientificKey: record.scientificKey,
      recordFingerprint,
      originBindingFingerprint,
    });
    return { record, recordFingerprint, origin, originBindingFingerprint };
  }

  async readRecord(
    fingerprint: ContentFingerprint,
  ): Promise<SensitivityExperienceRecord | undefined> {
    await this.#ensurePrivateLayout(["records"], false);
    await assertAbsentOrRegularFile(this.#records.pathFor(fingerprint));
    return await readValidated(
      this.#records,
      fingerprint,
      async (value) => await validateSensitivityExperienceRecord(value),
    );
  }

  async readOrigin(
    fingerprint: ContentFingerprint,
  ): Promise<SensitivityExperienceOriginBinding | undefined> {
    await this.#ensurePrivateLayout(["origins"], false);
    await assertAbsentOrRegularFile(this.#origins.pathFor(fingerprint));
    return await readValidated(
      this.#origins,
      fingerprint,
      (value) => validateSensitivityExperienceOriginBinding(value),
    );
  }

  async saveReview(reviewValue: unknown): Promise<{
    readonly review: SensitivityExperienceReuseReview;
    readonly fingerprint: ContentFingerprint;
    readonly uri: string;
  }> {
    await this.#ensurePrivateLayout(["reviews"], true);
    const review = validateSensitivityExperienceReuseReview(reviewValue);
    const fingerprint = await sha256Fingerprint(review);
    await assertAbsentOrRegularFile(this.#reviews.pathFor(fingerprint));
    await saveAndReread(
      this.#reviews,
      fingerprint,
      review,
      (value) => validateSensitivityExperienceReuseReview(value),
    );
    return { review, fingerprint, uri: this.#reviews.uriFor(fingerprint) };
  }

  async readReview(
    fingerprint: ContentFingerprint,
  ): Promise<SensitivityExperienceReuseReview | undefined> {
    await this.#ensurePrivateLayout(["reviews"], false);
    await assertAbsentOrRegularFile(this.#reviews.pathFor(fingerprint));
    return await readValidated(
      this.#reviews,
      fingerprint,
      (value) => validateSensitivityExperienceReuseReview(value),
    );
  }

  async saveReceipt(receiptValue: unknown): Promise<{
    readonly receipt: SensitivityExperienceReuseReceipt;
    readonly fingerprint: ContentFingerprint;
    readonly uri: string;
  }> {
    await this.#ensurePrivateLayout(["receipts"], true);
    const receipt = validateSensitivityExperienceReuseReceipt(receiptValue);
    const fingerprint = await sha256Fingerprint(receipt);
    await assertAbsentOrRegularFile(this.#receipts.pathFor(fingerprint));
    await saveAndReread(
      this.#receipts,
      fingerprint,
      receipt,
      (value) => validateSensitivityExperienceReuseReceipt(value),
    );
    return { receipt, fingerprint, uri: this.#receipts.uriFor(fingerprint) };
  }

  async readReceipt(
    fingerprint: ContentFingerprint,
  ): Promise<SensitivityExperienceReuseReceipt | undefined> {
    await this.#ensurePrivateLayout(["receipts"], false);
    await assertAbsentOrRegularFile(this.#receipts.pathFor(fingerprint));
    return await readValidated(
      this.#receipts,
      fingerprint,
      (value) => validateSensitivityExperienceReuseReceipt(value),
    );
  }

  async admit(value: SensitivityExperienceAdmission): Promise<void> {
    await this.#ensurePrivateLayout(["admissions"], true);
    const admission = validateSensitivityExperienceAdmission(value);
    const fingerprint = await sha256Fingerprint(admission);
    await assertAbsentOrRegularFile(this.#admissions.pathFor(fingerprint));
    await saveAndReread(
      this.#admissions,
      fingerprint,
      admission,
      (candidate) => validateSensitivityExperienceAdmission(candidate),
    );
    await this.rebuild();
  }

  async invalidate(value: SensitivityExperienceInvalidation): Promise<void> {
    await this.#ensurePrivateLayout(["invalidations"], true);
    const invalidation = validateSensitivityExperienceInvalidation(value);
    const fingerprint = await sha256Fingerprint(invalidation);
    await assertAbsentOrRegularFile(this.#invalidations.pathFor(fingerprint));
    await saveAndReread(
      this.#invalidations,
      fingerprint,
      invalidation,
      (candidate) => validateSensitivityExperienceInvalidation(candidate),
    );
    await this.rebuild();
  }

  async invalidateOrigin(input: {
    readonly recordFingerprint: ContentFingerprint;
    readonly originBindingFingerprint: ContentFingerprint;
    readonly reason: SensitivityExperienceInvalidationReason;
    readonly invalidatedAt: string;
  }): Promise<void> {
    await this.invalidate({
      schemaVersion: SENSITIVITY_EXPERIENCE_INVALIDATION_SCHEMA,
      audience: SENSITIVITY_EXPERIENCE_ORIGIN_AUDIENCE,
      ...input,
    });
  }

  async rebuild(): Promise<readonly SensitivityExperienceIndexEntry[]> {
    await this.#ensurePrivateLayout(["admissions", "invalidations"], false);
    const admissions = await this.#readAdmissionJournal();
    const invalidations = await this.#readInvalidationJournal();
    const invalidated = new Set(
      invalidations.map((item) =>
        `${item.recordFingerprint.digest}:${item.originBindingFingerprint.digest}`
      ),
    );
    const byKey = new Map<
      string,
      Map<string, Map<string, ContentFingerprint>>
    >();
    const keyFingerprints = new Map<string, ContentFingerprint>();
    const recordFingerprints = new Map<string, ContentFingerprint>();
    for (const admission of admissions) {
      const invalidationKey =
        `${admission.recordFingerprint.digest}:${admission.originBindingFingerprint.digest}`;
      if (invalidated.has(invalidationKey)) continue;
      const keyDigest = admission.scientificKey.digest;
      keyFingerprints.set(keyDigest, admission.scientificKey);
      recordFingerprints.set(
        admission.recordFingerprint.digest,
        admission.recordFingerprint,
      );
      const records = byKey.get(keyDigest) ?? new Map();
      const origins = records.get(admission.recordFingerprint.digest) ?? new Map();
      origins.set(
        admission.originBindingFingerprint.digest,
        admission.originBindingFingerprint,
      );
      records.set(admission.recordFingerprint.digest, origins);
      byKey.set(keyDigest, records);
    }
    const entries: SensitivityExperienceIndexEntry[] = [...byKey.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([keyDigest, records]) => ({
        scientificKey: keyFingerprints.get(keyDigest)!,
        records: [...records.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([recordDigest, origins]) => ({
            recordFingerprint: recordFingerprints.get(recordDigest)!,
            originBindingFingerprints: [...origins.values()].sort((left, right) =>
              left.digest.localeCompare(right.digest)
            ),
          })),
      }));
    await this.#writeIndex({
      schemaVersion: SENSITIVITY_EXPERIENCE_INDEX_SCHEMA,
      audience: SENSITIVITY_EXPERIENCE_ORIGIN_AUDIENCE,
      entries,
    });
    return entries;
  }

  async lookup(
    scientificKey: ContentFingerprint,
  ): Promise<SensitivityExperienceIndexEntry | undefined> {
    const key = parseSha256(scientificKey, "$scientificKey");
    return (await this.rebuild()).find((entry) =>
      fingerprintsEqual(entry.scientificKey, key)
    );
  }

  recordPath(fingerprint: ContentFingerprint): string {
    return this.#records.pathFor(fingerprint);
  }

  originPath(fingerprint: ContentFingerprint): string {
    return this.#origins.pathFor(fingerprint);
  }

  get indexPath(): string {
    return `${this.#root}/index.json`;
  }

  async #readAdmissionJournal(): Promise<readonly SensitivityExperienceAdmission[]> {
    return await readJournal(
      `${this.#root}/admissions`,
      (value) => validateSensitivityExperienceAdmission(value),
    );
  }

  async #readInvalidationJournal(): Promise<
    readonly SensitivityExperienceInvalidation[]
  > {
    return await readJournal(
      `${this.#root}/invalidations`,
      (value) => validateSensitivityExperienceInvalidation(value),
    );
  }

  async #writeIndex(snapshot: SensitivityExperienceIndexSnapshot): Promise<void> {
    const text = `${deterministicJson(snapshot)}\n`;
    await this.#ensurePrivateLayout([], true);
    await assertAbsentOrRegularFile(this.indexPath);
    try {
      const current = await Deno.readTextFile(this.indexPath);
      if (current === text) return;
      await replaceAttemptFileDurably(
        this.indexPath,
        text,
        this.#root,
        "Sensitivity experience index rewrite made no progress.",
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      try {
        await writeNewAttemptFileDurably(
          this.indexPath,
          text,
          this.#root,
          "Sensitivity experience index write made no progress.",
        );
      } catch (writeError) {
        if (!(writeError instanceof Deno.errors.AlreadyExists)) throw writeError;
        await this.#writeIndex(snapshot);
      }
    }
  }

  async #ensurePrivateLayout(
    children: readonly string[],
    create: boolean,
  ): Promise<void> {
    if (create) await Deno.mkdir(this.#root, { recursive: true });
    const rootPresent = await assertConfinedDirectory(this.#root);
    if (!rootPresent) return;
    for (const child of children) {
      const path = `${this.#root}/${child}`;
      if (create) await Deno.mkdir(path, { recursive: true });
      await assertConfinedDirectory(path);
    }
  }
}

function store<Kind extends string>(
  root: string,
  child: string,
  descriptor: {
    readonly kind: Kind;
    readonly uriNamespace: string;
    readonly label: string;
  },
): FileCaptureStore<Kind> {
  return new FileCaptureStore({
    ...descriptor,
    directory: `${root}/${child}`,
    syncBoundary: root,
  });
}

async function saveAndReread<Kind extends string, Value>(
  store: FileCaptureStore<Kind>,
  fingerprint: ContentFingerprint,
  value: Value,
  validate: (parsed: unknown) => Promise<Value> | Value,
): Promise<void> {
  const text = deterministicJson(value);
  await store.save(fingerprint, text);
  const reread = await store.read(fingerprint);
  if (reread === undefined) throw new Error("Private experience CAS reread failed.");
  const parsed = await validate(JSON.parse(reread));
  if (reread !== deterministicJson(parsed)) {
    throw new Error("Private experience CAS canonical reread diverged.");
  }
}

async function readValidated<Kind extends string, Value>(
  store: FileCaptureStore<Kind>,
  fingerprint: ContentFingerprint,
  validate: (parsed: unknown) => Promise<Value> | Value,
): Promise<Value | undefined> {
  const text = await store.read(parseSha256(fingerprint, "$fingerprint"));
  if (text === undefined) return undefined;
  const value = await validate(JSON.parse(text));
  if (text !== deterministicJson(value)) {
    throw new Error("Private experience CAS bytes are not canonical.");
  }
  const observed = await sha256Fingerprint(value);
  if (!fingerprintsEqual(observed, fingerprint)) {
    throw new Error("Private experience CAS fingerprint is divergent.");
  }
  return value;
}

async function readJournal<Value>(
  directory: string,
  validate: (parsed: unknown) => Promise<Value> | Value,
): Promise<readonly Value[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(entry.name)) continue;
      if (!entry.isFile || entry.isSymlink) {
        throw new Error(`Experience journal ${entry.name} is not a regular file.`);
      }
      names.push(entry.name);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
  names.sort();
  const values: Value[] = [];
  for (const name of names) {
    const path = `${directory}/${name}`;
    await assertAbsentOrRegularFile(path);
    const text = await Deno.readTextFile(path);
    const value = await validate(JSON.parse(text));
    if (text !== deterministicJson(value)) {
      throw new Error(`Experience journal ${name} is not canonical.`);
    }
    const fingerprint = await sha256Fingerprint(value);
    if (`${fingerprint.digest}.json` !== name) {
      throw new Error(`Experience journal ${name} has a divergent fingerprint.`);
    }
    values.push(value);
  }
  return values;
}

function parseSha256(value: ContentFingerprint, path: string): ContentFingerprint {
  if (
    value.algorithm !== "sha256" || !/^[a-f0-9]{64}$/.test(value.digest)
  ) {
    throw new TypeError(`${path} must be a SHA-256 fingerprint.`);
  }
  return { algorithm: "sha256", digest: value.digest };
}

async function assertConfinedDirectory(path: string): Promise<boolean> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
  if (
    info.isSymlink || !info.isDirectory || await Deno.realPath(path) !== resolve(path)
  ) {
    throw new Error(
      `Sensitivity experience path is not a confined directory: ${path}.`,
    );
  }
  return true;
}

async function assertAbsentOrRegularFile(path: string): Promise<void> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  if (info.isSymlink || !info.isFile || await Deno.realPath(path) !== resolve(path)) {
    throw new Error(
      `Sensitivity experience path is not a confined regular file: ${path}.`,
    );
  }
}

export function experienceReviewArtifactName(
  outcome: SensitivityExperienceReuseReview["outcome"],
): string {
  return outcome === "exact"
    ? "Exact private sensitivity reuse review"
    : "Private sensitivity reuse miss review";
}

export const INSTALLATION_PRIVATE_EXPERIENCE_AUDIENCE = SENSITIVITY_EXPERIENCE_AUDIENCE;
