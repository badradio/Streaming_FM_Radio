import { handle } from '@astrojs/cloudflare/handler';
import { ingestPlaysFromEnv } from './lib/plays-log';

type Env = { MASTER?: unknown };

export default {
  fetch: handle,
  async scheduled(_controller: unknown, env: Env) {
    await ingestPlaysFromEnv(env);
  },
};
