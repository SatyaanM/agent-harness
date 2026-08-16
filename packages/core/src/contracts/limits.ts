/** Maximum serialized size of one durable session transcript. */
export const MAX_SESSION_TRANSCRIPT_BYTES = 25_000_000;

/** Maximum serialized size of one durable session mailbox log. */
export const MAX_SESSION_MAILBOX_BYTES = 25_000_000;

const MAX_RESPONSE_ENVELOPE_BYTES = 64_000;

/** Maximum serialized session response after the separate mailbox is merged. */
export const MAX_SESSION_RESPONSE_BYTES =
  MAX_SESSION_TRANSCRIPT_BYTES + MAX_SESSION_MAILBOX_BYTES + MAX_RESPONSE_ENVELOPE_BYTES;

/** Maximum serialized metadata collection derived from the bounded index. */
export const MAX_SESSION_METADATA_RESPONSE_BYTES = 10_000_000 + MAX_RESPONSE_ENVELOPE_BYTES;

/** Maximum raw size of one inbox file returned through the JSON API. */
export const MAX_INBOX_FILE_BYTES = 10_000_000;

const MAX_JSON_BYTES_PER_SOURCE_BYTE = 6;
const MAX_BASE64_CONTENT_BYTES = 4 * Math.ceil(MAX_INBOX_FILE_BYTES / 3);

/** Maximum serialized inbox mutation containing a maximally escaped text file. */
export const MAX_INBOX_FILE_REQUEST_BYTES =
  MAX_INBOX_FILE_BYTES * MAX_JSON_BYTES_PER_SOURCE_BYTE + MAX_RESPONSE_ENVELOPE_BYTES;

/**
 * Maximum serialized inbox-file response. Text can require six JSON escape
 * bytes per source byte; binary content expands by four-thirds in base64.
 */
export const MAX_INBOX_FILE_RESPONSE_BYTES =
  Math.max(MAX_INBOX_FILE_BYTES * MAX_JSON_BYTES_PER_SOURCE_BYTE, MAX_BASE64_CONTENT_BYTES) +
  MAX_RESPONSE_ENVELOPE_BYTES;
