import type { ThreadRef } from "./graph.ts";

export type ThreadComponentProvider =
  | "syson"
  | "erpnext"
  | "build123d"
  | "digital-thread";

export interface ThreadComponentBinding {
  provider: ThreadComponentProvider;
  kind:
    | "part-definition"
    | "part-usage"
    | "item"
    | "artifact"
    | "assembly-child";
  id: string;
  label: string;
  evidenceArtifactId: string;
  status: "verified" | "unverified";
  reason?: string;
  selection?: ThreadRef;
}

export interface ThreadComponentPreview {
  provider: "build123d";
  artifactId: string;
  mediaType: "model/stl" | "model/gltf-binary";
  url: string;
  sha256: string;
}

export interface ThreadComponentAttribute {
  id: string;
  kind: "AttributeUsage";
  label: string;
}

export interface ThreadComponent {
  id: string;
  label: string;
  kind: "assembly" | "part";
  quantity: number;
  parentId?: string;
  bindings: ThreadComponentBinding[];
  preview?: ThreadComponentPreview;
  attributes?: ThreadComponentAttribute[];
}

export interface ThreadComponentCatalog {
  schemaVersion: "thread-components/1.0";
  authority: "workspace-declared";
  subjectId: string;
  rationale: string;
  systemViews: {
    syson?: {
      projectId: string;
      editingContextId: string;
      diagramId: string;
      diagramLabel: string;
    };
    erpnext?: { bomName: string };
  };
  components: ThreadComponent[];
}
