declare module 'cloudflare:workers' {
  export function waitUntil(promise: Promise<unknown>): void;
  export const env: {
    STATION?: KVNamespace;
    MASTER?: import('../lib/runtime').D1Like | string;
    ADMIN_PASSWORD?: string;
    PUBLIC_STREAM_URL?: string;
    LIVE365_STATION_ID?: string;
    PUBLIC_CF_BEACON_TOKEN?: string;
    PUBLIC_GA_MEASUREMENT_ID?: string;
    RESEND_API_KEY?: string;
    NOTIFY_TO?: string;
    NOTIFY_FROM?: string;
  };
}
