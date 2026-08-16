import type { TaskId } from "../agent/types.js";
import type { MessageBus } from "./message-bus.js";

export interface SupervisorRequest {
  roomId: string;
  question: string;
  from: TaskId;
  timestamp: string;
}

export interface SupervisorResponse {
  decision: "join" | "advise" | "ignore";
  message?: string;
  requestId: string;
}

export function callSupervisor(
  messageBus: MessageBus,
  orchestratorId: TaskId,
  roomId: string,
  question: string,
  from: TaskId,
): SupervisorRequest {
  const request: SupervisorRequest = {
    roomId,
    question,
    from,
    timestamp: new Date().toISOString(),
  };

  messageBus.message(orchestratorId, request, from);

  return request;
}
