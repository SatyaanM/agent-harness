'use client';

export interface CouncilCreatedEvent {
  type: 'council_created';
  roomId: string;
  purpose: string;
  members: string[];
  timestamp: number;
}

export interface CouncilMessageEvent {
  type: 'council_message';
  roomId: string;
  taskId: string;
  content: string;
  timestamp: number;
}

export interface CouncilDissolvedEvent {
  type: 'council_dissolved';
  roomId: string;
  summary: string;
  timestamp: number;
}

type CouncilEvent = CouncilCreatedEvent | CouncilMessageEvent | CouncilDissolvedEvent;

interface CouncilCardProps {
  event: CouncilEvent;
}

export function CouncilCard({ event }: CouncilCardProps) {
  if (event.type === 'council_created') {
    return (
      <div className="my-2 rounded-lg border border-purple-200 bg-purple-50 p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-purple-900">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          Council Created
        </div>
        <div className="mt-2 text-xs text-purple-700">
          <div><span className="font-medium">Room:</span> {event.roomId}</div>
          <div><span className="font-medium">Purpose:</span> {event.purpose}</div>
          <div><span className="font-medium">Members:</span> {event.members.join(', ')}</div>
        </div>
      </div>
    );
  }

  if (event.type === 'council_message') {
    return (
      <div className="my-2 rounded-lg border border-purple-200 bg-purple-50 p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-purple-900">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          Council Message
        </div>
        <div className="mt-2 text-xs text-purple-700">
          <div><span className="font-medium">From:</span> {event.taskId}</div>
          <div className="mt-1 whitespace-pre-wrap">{event.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
        Council Dissolved
      </div>
      <div className="mt-2 text-xs text-gray-700">
        <div><span className="font-medium">Room:</span> {event.roomId}</div>
        <div className="mt-1"><span className="font-medium">Summary:</span> {event.summary}</div>
      </div>
    </div>
  );
}
