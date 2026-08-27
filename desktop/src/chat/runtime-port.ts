export type RuntimePermissionDecision =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always"
  | "cancel";

export interface RuntimePermissionRequest {
  readonly sessionId: string;
  readonly inferredKind?: string;
  readonly raw: {
    readonly toolCall: {
      readonly toolCallId: string;
      readonly title?: string | null;
      readonly kind?: string | null;
    };
    readonly options: readonly {
      readonly name: string;
      readonly kind: string;
    }[];
  };
}

export interface RuntimeElicitationContext {
  readonly requestId: string | number;
  readonly signal: AbortSignal;
}

export interface RuntimeElicitationRequest {
  readonly mode: string;
  readonly message: string;
  readonly sessionId: string;
  readonly requestId?: string;
  readonly toolCallId?: string | null;
  readonly elicitationId?: string;
  readonly url?: string;
  readonly requestedSchema?: unknown;
}

export type RuntimeElicitationResponse =
  | {
    readonly action: "accept";
    readonly content?: Readonly<Record<string, string | number | boolean | string[]>>;
  }
  | { readonly action: "decline" }
  | { readonly action: "cancel" };

export interface RuntimeHandle {
  readonly sessionKey: string;
  readonly backend: string;
  readonly runtimeSessionName: string;
  readonly backendSessionId?: string;
  readonly agentSessionId?: string;
}

export type RuntimeEvent =
  | {
    readonly type: "text_delta";
    readonly text: string;
    readonly stream?: "output" | "thought";
  }
  | {
    readonly type: "status";
    readonly text: string;
  }
  | {
    readonly type: "tool_call";
    readonly text: string;
    readonly title?: string;
    readonly status?: string;
    readonly kind?: string;
  };

export type RuntimeTurnResult =
  | { readonly status: "completed"; readonly stopReason?: string }
  | { readonly status: "cancelled"; readonly stopReason?: string }
  | {
    readonly status: "failed";
    readonly error: { readonly message: string; readonly retryable?: boolean };
  };

export interface RuntimeTurn {
  readonly events: AsyncIterable<RuntimeEvent>;
  readonly result: Promise<RuntimeTurnResult>;
  cancel(input?: { reason?: string }): Promise<void>;
  closeStream(input?: { reason?: string }): Promise<void>;
}

export interface ChatRuntimePort {
  ensureSession(input: {
    readonly sessionKey: string;
    readonly agent: string;
    readonly mode: "persistent";
    readonly cwd: string;
    readonly sessionOptions: {
      readonly systemPrompt: string;
    };
  }): Promise<RuntimeHandle>;
  startTurn(input: {
    readonly handle: RuntimeHandle;
    readonly text: string;
    readonly mode: "prompt";
    readonly requestId: string;
    readonly signal: AbortSignal;
    readonly onElicitation: (
      request: RuntimeElicitationRequest,
      context: RuntimeElicitationContext,
    ) => Promise<RuntimeElicitationResponse>;
  }): RuntimeTurn;
  cancel(
    input: { readonly handle: RuntimeHandle; readonly reason?: string },
  ): Promise<void>;
  close(input: {
    readonly handle: RuntimeHandle;
    readonly reason: string;
    readonly discardPersistentState?: boolean;
  }): Promise<void>;
}

export interface RuntimeInteractionSink {
  requestPermission(
    request: RuntimePermissionRequest,
    signal: AbortSignal,
  ): Promise<{ readonly outcome: RuntimePermissionDecision } | undefined>;
}

export interface ChatRuntimeAdapter {
  readonly runtime: ChatRuntimePort;
  setInteractionSink(sink: RuntimeInteractionSink): void;
  close(): Promise<void>;
}
