import type { IsoDateTime } from "../../../domain/kernel/primitives.ts";
import type { Availability } from "./status.ts";

export interface ObservedTool {
  name: string;
  description?: string;
  resourceUri?: string;
}

export interface ObservedMcp {
  reachable: boolean;
  protocolVersion?: string;
  serverName?: string;
  serverVersion?: string;
  tools: ObservedTool[];
  resourceUris: string[];
  viewerUris: string[];
  error?: string;
}

export interface ObservedContainer {
  runtimeAvailable: boolean;
  present: boolean;
  name?: string;
  id?: string;
  state?: string;
  health?: string;
  image?: string;
  imageId?: string;
  repoDigests?: string[];
  error?: string;
}

export interface ObservedServer {
  checkedAt: IsoDateTime;
  status: Availability;
  latencyMs?: number;
  httpStatus?: number;
  mcp: ObservedMcp;
  container: ObservedContainer;
  error?: string;
}
