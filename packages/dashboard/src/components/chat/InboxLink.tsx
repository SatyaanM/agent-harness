'use client';

import Link from 'next/link';

export interface InboxLinkEvent {
  type: 'inbox_link';
  itemId: string;
  itemName: string;
  itemType: string;
  action: 'created' | 'updated';
  timestamp: number;
}

interface InboxLinkProps {
  event: InboxLinkEvent;
}

export function InboxLink({ event }: InboxLinkProps) {
  return (
    <div className="my-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        Inbox {event.action === 'created' ? 'Item Created' : 'Item Updated'}
      </div>
      <div className="mt-2 text-xs text-amber-700">
        <Link 
          href={`/inbox/${event.itemId}`}
          className="font-medium text-amber-800 underline hover:text-amber-900"
        >
          {event.itemName}
        </Link>
        <span className="ml-2 text-amber-600">({event.itemType})</span>
      </div>
    </div>
  );
}
