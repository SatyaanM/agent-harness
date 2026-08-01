'use client';

import { TaskId } from '@agent-harness/core';

export interface DelegationEvent {
  type: 'delegation';
  taskId: TaskId;
  task: string;
  model: string;
  timestamp: number;
}

export interface DelegationCompleteEvent {
  type: 'delegation_complete';
  taskId: TaskId;
  summary: string;
  status: 'done' | 'error';
  timestamp: number;
}

interface DelegationCardProps {
  event: DelegationEvent | DelegationCompleteEvent;
}

export function DelegationCard({ event }: DelegationCardProps) {
  if (event.type === 'delegation') {
    return (
      <div className="my-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800/60 dark:bg-blue-950/40">
        <div className="flex items-center gap-2 text-sm font-medium text-blue-900 dark:text-blue-200">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Delegated to Worker
        </div>
        <div className="mt-2 text-xs text-blue-700 dark:text-blue-300">
          <div><span className="font-medium">Task:</span> {event.task}</div>
          <div><span className="font-medium">Model:</span> {event.model}</div>
          <div><span className="font-medium">ID:</span> {event.taskId}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`my-2 rounded-lg border p-3 ${
      event.status === 'done' 
        ? 'border-green-200 bg-green-50 dark:border-green-800/60 dark:bg-green-950/40' 
        : 'border-red-200 bg-red-50 dark:border-red-800/60 dark:bg-red-950/40'
    }`}>
      <div className={`flex items-center gap-2 text-sm font-medium ${
        event.status === 'done' ? 'text-green-900 dark:text-green-200' : 'text-red-900 dark:text-red-200'
      }`}>
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {event.status === 'done' ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          )}
        </svg>
        Worker {event.status === 'done' ? 'Completed' : 'Failed'}
      </div>
      <div className={`mt-2 text-xs ${
        event.status === 'done' ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
      }`}>
        <div><span className="font-medium">ID:</span> {event.taskId}</div>
        <div className="mt-1"><span className="font-medium">Summary:</span> {event.summary}</div>
      </div>
    </div>
  );
}
