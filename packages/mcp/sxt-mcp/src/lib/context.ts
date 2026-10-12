/**
 * Per-call context handed to tool handlers by `buildServer()`.
 *
 * `credentialSource` decides where an SXT API key may come from:
 *   - "env":     the local stdio surface. The key is the operator's own,
 *                read from SXT_API_KEY / MAKEINFINITE_API_KEY.
 *   - "request": the hosted surface. The key must arrive with the request
 *                (sealed OAuth token or X-SXT-API-Key header). Handlers must
 *                never fall back to the env key in this mode.
 */

export interface ToolContext {
  credentialSource?: "env" | "request";
  /** Caller's SXT API key (request mode). Never log this; log `principal`. */
  apiKey?: string;
  /** Non-reversible caller id for logs and rate limiting. */
  principal?: string;
  requestId?: string;
  /** Sends an MCP progress notification when the client supplied a progressToken. */
  progress?: (progress: number, message: string) => Promise<void>;
  /** False on the hosted surface: handlers must not touch the server filesystem. */
  allowFilesystem?: boolean;
  /** Aborted when the client cancels the request. */
  signal?: AbortSignal;
}
