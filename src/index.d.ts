export interface Options {
  /** Publishable ingest key (or env WT_PUBLISHABLE_KEY). Sent as `Authorization: Bearer`, never logged. */
  publishableKey?: string;
  /** Default env WT_OTLP_ENDPOINT, else http://localhost:4318. */
  endpoint?: string;
  service?: string;
  release?: string;
  environment?: string;
  tags?: Record<string, string>;
  /** Redaction hook: edit, or return null to drop. */
  beforeSend?: (event: Record<string, any>) => Record<string, any> | null;
  /** Native crash capture through Crashpad (default true). */
  crashReporter?: boolean;
  /** uncaughtException / unhandledRejection hooks (default true). */
  captureUncaught?: boolean;
  queueDir?: string;
  queueMaxBytes?: number;
}
export interface CaptureOptions {
  level?: string;
  handled?: boolean;
  process?: string;
  mechanism?: string;
  tags?: Record<string, string>;
}
export class Client {
  captureException(err: unknown, o?: CaptureOptions): void;
  flush(): Promise<void>;
}
export function init(opts?: Options): Client;
export function captureException(err: unknown, o?: CaptureOptions): void;
export function flush(): Promise<void>;
