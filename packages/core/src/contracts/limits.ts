/** Maximum serialized size of one durable session transcript. */
export const MAX_SESSION_TRANSCRIPT_BYTES = 25_000_000;

/** Maximum raw size of one inbox file returned through the JSON API. */
export const MAX_INBOX_FILE_BYTES = 10_000_000;

const MAX_JSON_BYTES_PER_SOURCE_BYTE = 6;
const MAX_RESPONSE_ENVELOPE_BYTES = 64_000;
const MAX_BASE64_CONTENT_BYTES = 4 * Math.ceil(MAX_INBOX_FILE_BYTES / 3);

/**
 * Maximum serialized inbox-file response. Text can require six JSON escape
 * bytes per source byte; binary content expands by four-thirds in base64.
 */
export const MAX_INBOX_FILE_RESPONSE_BYTES =
  Math.max(MAX_INBOX_FILE_BYTES * MAX_JSON_BYTES_PER_SOURCE_BYTE, MAX_BASE64_CONTENT_BYTES) +
  MAX_RESPONSE_ENVELOPE_BYTES;
