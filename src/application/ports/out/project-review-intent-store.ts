import type {
  ProjectReviewIntent,
  ProjectReviewIntentAcknowledgement,
  ProjectReviewIntentRecord,
} from "../../../domain/project/project-review-intent.ts";

/** Durable outbound port for Workbench review intents and agent receipts. */
export interface ProjectReviewIntentStore {
  append(intent: ProjectReviewIntent): Promise<ProjectReviewIntentRecord>;
  list(projectId: string): Promise<ProjectReviewIntentRecord[]>;
  /** Complete durable outbox, used to recover MCP review work after reconnect. */
  listAll(): Promise<ProjectReviewIntentRecord[]>;
  acknowledge(
    acknowledgement: ProjectReviewIntentAcknowledgement,
  ): Promise<ProjectReviewIntentRecord>;
}
