import type { TaskId } from "../agent/types.js";

export interface CouncilMessage {
  taskId: TaskId;
  content: string;
  timestamp: string;
}

export class Council {
  readonly roomId: string;
  readonly purpose: string;
  private members = new Set<TaskId>();
  private log: CouncilMessage[] = [];

  constructor(roomId: string, purpose: string) {
    this.roomId = roomId;
    this.purpose = purpose;
  }

  join(taskId: TaskId): void {
    this.members.add(taskId);
  }

  leave(taskId: TaskId): void {
    this.members.delete(taskId);
  }

  hasMember(taskId: TaskId): boolean {
    return this.members.has(taskId);
  }

  getMembers(): TaskId[] {
    return [...this.members];
  }

  speak(taskId: TaskId, content: string): void {
    if (!this.members.has(taskId)) {
      throw new Error(`Task ${taskId} is not a member of council ${this.roomId}`);
    }
    this.log.push({ taskId, content, timestamp: new Date().toISOString() });
  }

  readLog(): CouncilMessage[] {
    return [...this.log];
  }
}

export class CouncilManager {
  private councils = new Map<string, Council>();

  createCouncil(roomId: string, purpose: string): Council {
    if (this.councils.has(roomId)) {
      throw new Error(`Council ${roomId} already exists`);
    }
    const council = new Council(roomId, purpose);
    this.councils.set(roomId, council);
    return council;
  }

  getCouncil(roomId: string): Council {
    const council = this.councils.get(roomId);
    if (!council) {
      throw new Error(`Council ${roomId} not found`);
    }
    return council;
  }

  joinCouncil(roomId: string, taskId: TaskId): void {
    this.getCouncil(roomId).join(taskId);
  }

  leaveCouncil(roomId: string, taskId: TaskId): void {
    this.getCouncil(roomId).leave(taskId);
  }

  speakInCouncil(roomId: string, taskId: TaskId, content: string): void {
    this.getCouncil(roomId).speak(taskId, content);
  }

  readCouncilLog(roomId: string): CouncilMessage[] {
    return this.getCouncil(roomId).readLog();
  }

  dissolveCouncil(roomId: string): void {
    if (!this.councils.has(roomId)) {
      throw new Error(`Council ${roomId} not found`);
    }
    this.councils.delete(roomId);
  }

  hasCouncil(roomId: string): boolean {
    return this.councils.has(roomId);
  }

  listCouncils(): string[] {
    return [...this.councils.keys()];
  }
}
