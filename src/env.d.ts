/// <reference types="astro/client" />

declare module '*.svg?raw' {
  const src: string;
  export default src;
}

interface KVNamespace {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

interface ImportMetaEnv {
  readonly PUBLIC_STREAM_URL?: string;
  readonly ADMIN_PASSWORD?: string;
  readonly LIVE365_STATION_ID?: string;
  readonly PUBLIC_CF_BEACON_TOKEN?: string;
  readonly PUBLIC_GA_MEASUREMENT_ID?: string;
  readonly RESEND_API_KEY?: string;
  readonly NOTIFY_TO?: string;
  readonly NOTIFY_FROM?: string;
}

interface Window {
  __badradioTrack?: (event: 'play_click' | 'signup_submit') => void;
  zaraz?: { track: (name: string, properties?: Record<string, never>) => void };
  gtag?: (...args: unknown[]) => void;
  dataLayer?: unknown[];
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

type RuntimeEnv = {
  STATION?: KVNamespace;
  MASTER?: import('./lib/runtime').D1Like | string;
  ADMIN_PASSWORD?: string;
  PUBLIC_STREAM_URL?: string;
  LIVE365_STATION_ID?: string;
  PUBLIC_CF_BEACON_TOKEN?: string;
  PUBLIC_GA_MEASUREMENT_ID?: string;
  RESEND_API_KEY?: string;
  NOTIFY_TO?: string;
  NOTIFY_FROM?: string;
};

declare module '*.mdx' {
  export const frontmatter: {
    title: string;
    description: string;
  };
  export const Content: import('astro/types').MDXInstance<Record<string, unknown>>['Content'];
}

declare namespace App {
  interface Locals {
    runtime?: {
      env: RuntimeEnv;
    };
  }
}
