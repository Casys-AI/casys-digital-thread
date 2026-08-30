import { assertEquals } from "@std/assert";
import {
  authoringSourceSelectionsForComponent,
  HttpProductAuthoringSourceClient,
  mergeAuthoringSourcePages,
  type ProductAuthoringSourceAttachment,
  type ProductAuthoringSourcePage,
} from "./src/thread/product-authoring-sources.ts";
import type { ThreadComponent } from "./src/thread/types.ts";

function attachment(
  attachmentId: string,
  attachmentRevision: number,
  fileId: string,
  target: { elementKind: "PartDefinition" | "PartUsage"; elementId: string },
): ProductAuthoringSourceAttachment {
  return {
    attachmentId,
    attachmentRevision,
    fileId,
    fileHeadRevision: 2,
    sourceStatus: "active",
    role: { id: "design-source", version: 1 },
    target,
    basisStatus: "different-basis",
  };
}

Deno.test("authoring-source client reads exact attachments with uncached GET pages", async () => {
  const requests: Array<{
    input: string;
    method?: string;
    cache?: RequestCache;
  }> = [];
  const pages = [
    {
      schemaVersion: "product-inspect/1.0",
      status: "observed",
      authoringAttachments: {
        workspaceRevision: 26,
        attachments: [attachment("att.definition", 1, "base-plate.py", {
          elementKind: "PartDefinition",
          elementId: "definition-1",
        })],
        nextCursor: "next-page",
      },
    },
    {
      schemaVersion: "product-inspect/1.0",
      status: "observed",
      authoringAttachments: {
        workspaceRevision: 26,
        attachments: [attachment("att.definition-extra", 2, "base-plate.py", {
          elementKind: "PartDefinition",
          elementId: "definition-1",
        })],
        nextCursor: null,
      },
    },
  ];
  const client = new HttpProductAuthoringSourceClient(
    "/api/thread/product-navigation",
    (input, init) => {
      requests.push({
        input: String(input),
        method: init?.method,
        cache: init?.cache,
      });
      return Promise.resolve(Response.json(pages.shift()));
    },
  );

  const result = await client.load({
    kind: "part-definition",
    id: "definition-1",
  });

  assertEquals(result.status, "observed");
  assertEquals(result.attachments.map((item) => item.attachmentId), [
    "att.definition",
    "att.definition-extra",
  ]);
  assertEquals(requests, [
    {
      input:
        "/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=definition-1&pageSize=50",
      method: "GET",
      cache: "no-store",
    },
    {
      input:
        "/api/thread/product-navigation?view=authoring-attachments&kind=part-definition&id=definition-1&pageSize=50&cursor=next-page",
      method: "GET",
      cache: "no-store",
    },
  ]);
});

Deno.test("authoring sources keep exact definition and usage identities", () => {
  const component: ThreadComponent = {
    id: "base-plate",
    label: "A label is not an attachment key",
    kind: "part",
    quantity: 1,
    bindings: [
      {
        provider: "syson",
        kind: "part-definition",
        id: "definition-1",
        label: "Base plate",
        evidenceArtifactId: "evidence-1",
        status: "verified",
      },
      {
        provider: "syson",
        kind: "part-usage",
        id: "usage-1",
        label: "Base plate",
        evidenceArtifactId: "evidence-2",
        status: "verified",
      },
    ],
  };
  assertEquals(authoringSourceSelectionsForComponent(component), [
    { kind: "part-definition", id: "definition-1" },
    { kind: "part-usage", id: "usage-1" },
  ]);

  const definition: ProductAuthoringSourcePage = {
    status: "observed",
    attachments: [attachment("att.definition", 1, "same-file", {
      elementKind: "PartDefinition",
      elementId: "definition-1",
    })],
  };
  const usage: ProductAuthoringSourcePage = {
    status: "observed",
    attachments: [
      attachment("att.usage", 1, "same-file", {
        elementKind: "PartUsage",
        elementId: "usage-1",
      }),
      attachment("att.definition", 1, "renamed-file", {
        elementKind: "PartDefinition",
        elementId: "definition-1",
      }),
    ],
  };
  assertEquals(
    mergeAuthoringSourcePages([definition, usage]).map((item) => ({
      identity: `${item.attachmentId}@${item.attachmentRevision}`,
      fileId: item.fileId,
    })),
    [
      { identity: "att.definition@1", fileId: "same-file" },
      { identity: "att.usage@1", fileId: "same-file" },
    ],
  );
});
