/**
 * ProjectSourceWorkspace adapter for product-navigation authoring attachments.
 *
 * Lists active attachment heads for one exact SysML target. Detached identities
 * are omitted. source-removed heads stay visible. No Thread evidence, no
 * represented_by edge, no admission. Public nextCursor is an HMAC-sealed
 * envelope over project, exact target, workspace revision, the application
 * inspect binding, and the domain sort key. The domain attachment-list
 * cursor is never accepted on this surface.
 */

import type {
  ProductNavigationAuthoringAttachmentPage,
  ProductNavigationAuthoringAttachmentQuery,
  ProductNavigationAuthoringAttachmentReader,
} from "../../application/ports/out/product-navigation/product-navigation-authoring-attachment-reader.ts";
import type { ProjectSourceWorkspaceEventStore } from "../../application/ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import { closedRecord, literalValue } from "../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { projectSourceWorkspaceAttachmentList } from "../../domain/project-source-workspace/reads.ts";
import {
  PROJECT_SOURCE_WORKSPACE_BOUNDS,
  type ProjectSourceAttachmentTarget,
  ProjectSourceWorkspaceError,
} from "../../domain/project-source-workspace/types.ts";
import {
  parseAttachmentTarget,
  parseBoundedText,
  parsePageSize,
  parseProjectId,
  parseWorkspaceRevision,
} from "../../domain/project-source-workspace/validation.ts";

export const PRODUCT_NAVIGATION_AUTHORING_CURSOR_SCHEMA =
  "product-navigation-authoring-attachments-cursor/2.0" as const;

const CURSOR_PREFIX = "pn-aa2";
const HMAC_KEY_BYTES = 32;
const MAX_CURSOR_BINDING_LENGTH = 128;

export interface ProjectSourceWorkspaceAuthoringAttachmentReaderOptions {
  /** Test-only 32-byte HMAC key. Production generates an ephemeral random key. */
  readonly hmacKey?: Uint8Array;
}

export class ProjectSourceWorkspaceAuthoringAttachmentReader
  implements ProductNavigationAuthoringAttachmentReader {
  readonly #workspace: Pick<
    ProjectSourceWorkspaceEventStore,
    "load" | "loadAtFresh"
  >;
  readonly #hmacKey: Uint8Array;
  #cryptoKey: Promise<CryptoKey> | undefined;

  constructor(
    workspace: Pick<ProjectSourceWorkspaceEventStore, "load" | "loadAtFresh">,
    options: ProjectSourceWorkspaceAuthoringAttachmentReaderOptions = {},
  ) {
    this.#workspace = workspace;
    this.#hmacKey = copyHmacKey(options.hmacKey);
  }

  async listActiveHeads(
    query: ProductNavigationAuthoringAttachmentQuery,
  ): Promise<ProductNavigationAuthoringAttachmentPage> {
    const projectId = parseProjectId(query.projectId, "$query.projectId");
    const target = parseAttachmentTarget(query.target, "$query.target");
    const cursorBinding = parseBoundedText(
      query.cursorBinding,
      "$query.cursorBinding",
      MAX_CURSOR_BINDING_LENGTH,
    );
    const pageSize = parsePageSize(query.pageSize, "$query.pageSize");
    const publicCursor = query.cursor === undefined ? undefined : parseBoundedText(
      query.cursor,
      "$query.cursor",
      PROJECT_SOURCE_WORKSPACE_BOUNDS.maxCursorLength,
    );
    let workspaceRevision: number;
    let inner: string | undefined;
    if (publicCursor === undefined) {
      const head = await this.#workspace.load(projectId);
      workspaceRevision = head.workspaceRevision;
    } else {
      const sealed = await this.openSealedCursor(publicCursor);
      if (sealed.projectId !== projectId) {
        throw new ProjectSourceWorkspaceError(
          "cursor_mismatch",
          "Attachment list cursor does not match the requested project.",
        );
      }
      if (deterministicJson(sealed.target) !== deterministicJson(target)) {
        throw new ProjectSourceWorkspaceError(
          "cursor_mismatch",
          "Attachment list cursor does not match the requested exact target.",
        );
      }
      if (sealed.cursorBinding !== cursorBinding) {
        throw new ProjectSourceWorkspaceError(
          "cursor_mismatch",
          "Attachment list cursor does not match the requested inspect binding.",
        );
      }
      workspaceRevision = sealed.workspaceRevision;
      inner = sealed.inner;
    }
    const state = await this.#workspace.loadAtFresh(projectId, workspaceRevision);
    const page = projectSourceWorkspaceAttachmentList(state, {
      workspaceRevision,
      target,
      pageSize,
      ...(inner === undefined ? {} : { cursor: inner }),
    });
    return {
      workspaceRevision: page.workspaceRevision,
      ...(state.lastEventFingerprint
        ? {
          workspaceEventFingerprint:
            `${state.lastEventFingerprint.algorithm}:${state.lastEventFingerprint.digest}`,
        }
        : {}),
      attachments: page.entries.map((entry) => ({
        attachmentId: entry.attachmentId,
        attachmentRevision: entry.attachmentRevision,
        fingerprint: entry.fingerprint,
        fileId: entry.fileId,
        fileHeadRevision: entry.fileHeadRevision,
        sourceStatus: entry.sourceStatus,
        role: entry.role,
        target: entry.target,
        declaredAgainst: entry.declaredAgainst,
      })),
      nextCursor: page.nextCursor === null ? null : await this.sealCursor({
        projectId,
        target,
        workspaceRevision: page.workspaceRevision,
        cursorBinding,
        inner: page.nextCursor,
      }),
    };
  }

  private cryptoKey(): Promise<CryptoKey> {
    this.#cryptoKey ??= crypto.subtle.importKey(
      "raw",
      bytesBuffer(this.#hmacKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    return this.#cryptoKey;
  }

  private async sealCursor(value: {
    readonly projectId: string;
    readonly target: ProjectSourceAttachmentTarget;
    readonly workspaceRevision: number;
    readonly cursorBinding: string;
    readonly inner: string;
  }): Promise<string> {
    const payload = deterministicJson({
      schemaVersion: PRODUCT_NAVIGATION_AUTHORING_CURSOR_SCHEMA,
      projectId: value.projectId,
      target: value.target,
      workspaceRevision: value.workspaceRevision,
      cursorBinding: value.cursorBinding,
      inner: value.inner,
    });
    const payloadBytes = new TextEncoder().encode(payload);
    const mac = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await this.cryptoKey(),
        bytesBuffer(payloadBytes),
      ),
    );
    return `${CURSOR_PREFIX}.${encodeBase64Url(payloadBytes)}.${encodeBase64Url(mac)}`;
  }

  private async openSealedCursor(cursor: string): Promise<{
    readonly projectId: string;
    readonly target: ProjectSourceAttachmentTarget;
    readonly workspaceRevision: number;
    readonly cursorBinding: string;
    readonly inner: string;
  }> {
    const parts = cursor.split(".");
    if (parts.length !== 3 || parts[0] !== CURSOR_PREFIX) {
      throw new ProjectSourceWorkspaceError(
        "cursor_mismatch",
        "Workspace page cursor is not a valid opaque cursor.",
      );
    }
    const payloadPart = parts[1]!;
    const macPart = parts[2]!;
    let payloadBytes: Uint8Array;
    let macBytes: Uint8Array;
    try {
      payloadBytes = decodeBase64Url(payloadPart);
      macBytes = decodeBase64Url(macPart);
    } catch {
      throw new ProjectSourceWorkspaceError(
        "cursor_mismatch",
        "Workspace page cursor is not a valid opaque cursor.",
      );
    }
    let valid = false;
    try {
      valid = await crypto.subtle.verify(
        "HMAC",
        await this.cryptoKey(),
        bytesBuffer(macBytes),
        bytesBuffer(payloadBytes),
      );
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new ProjectSourceWorkspaceError(
        "cursor_mismatch",
        "Workspace page cursor is not a valid opaque cursor.",
      );
    }
    try {
      const rec = closedRecord(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes)),
        [
          "schemaVersion",
          "projectId",
          "target",
          "workspaceRevision",
          "cursorBinding",
          "inner",
        ],
        [
          "schemaVersion",
          "projectId",
          "target",
          "workspaceRevision",
          "cursorBinding",
          "inner",
        ],
        "$cursor",
      );
      literalValue(
        rec.schemaVersion,
        PRODUCT_NAVIGATION_AUTHORING_CURSOR_SCHEMA,
        "$cursor.schemaVersion",
      );
      return {
        projectId: parseProjectId(rec.projectId, "$cursor.projectId"),
        target: parseAttachmentTarget(rec.target, "$cursor.target"),
        workspaceRevision: parseWorkspaceRevision(
          rec.workspaceRevision,
          "$cursor.workspaceRevision",
        ),
        cursorBinding: parseBoundedText(
          rec.cursorBinding,
          "$cursor.cursorBinding",
          MAX_CURSOR_BINDING_LENGTH,
        ),
        inner: parseBoundedText(
          rec.inner,
          "$cursor.inner",
          PROJECT_SOURCE_WORKSPACE_BOUNDS.maxCursorLength,
        ),
      };
    } catch (cause) {
      if (cause instanceof ProjectSourceWorkspaceError) {
        throw new ProjectSourceWorkspaceError("cursor_mismatch", cause.message);
      }
      throw new ProjectSourceWorkspaceError(
        "cursor_mismatch",
        "Workspace page cursor is not a valid opaque cursor.",
      );
    }
  }
}

function copyHmacKey(value: Uint8Array | undefined): Uint8Array {
  if (value === undefined) {
    const generated = new Uint8Array(HMAC_KEY_BYTES);
    crypto.getRandomValues(generated);
    return generated;
  }
  if (value.byteLength !== HMAC_KEY_BYTES) {
    throw new TypeError(
      "Authoring attachment cursor HMAC key must be exactly 32 bytes.",
    );
  }
  return Uint8Array.from(value);
}

function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

function decodeBase64Url(value: string): Uint8Array {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("invalid base64url");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
