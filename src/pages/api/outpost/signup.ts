import type { APIRoute } from 'astro';
import {
  newSignupIds,
  outpostListenRedirect,
  parseSignup,
  signupFlashForError,
  signupMessage,
  type OutpostFlash,
} from '../../../lib/outpost';
import { getSignupDb, signupTableReady, upsertSignup } from '../../../lib/outpost-db';
import { notifyNewSignupIfNeeded } from '../../../lib/outpost-mail';
import { workerEnv } from '../../../lib/runtime';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const input = await readSignupInput(request);
  const parsed = parseSignup({
    email: input.email,
    name: input.name,
    source: input.source,
    xHandle: input.xHandle,
    facebookHandle: input.facebookHandle,
    shoutoutOk: input.shoutoutOk,
  });
  if (!parsed.ok) {
    return signupReply(request, input.via, {
      status: 400,
      body: { ok: false, message: signupMessage(parsed.code) },
      flash: signupFlashForError(parsed.code),
    });
  }

  const db = await getSignupDb();
  if (!db || !(await signupTableReady(db))) {
    return signupReply(request, input.via, {
      status: 503,
      body: { ok: false, message: 'Outpost is offline. Play still works — try again later.' },
      flash: 'offline',
    });
  }

  try {
    const result = await upsertSignup(db, parsed, new Date().toISOString(), newSignupIds());
    const env = await workerEnv();
    // Await so the isolate cannot drop the Resend fetch after the 200 returns.
    // Mail failure still never fails the signup (notify* swallows errors).
    await notifyNewSignupIfNeeded(env, result.row, result.action);
    return signupReply(request, input.via, {
      status: 200,
      body: { ok: true, action: result.action },
      flash: 'ok',
    });
  } catch {
    return signupReply(request, input.via, {
      status: 503,
      body: { ok: false, message: 'Outpost is offline. Play still works — try again later.' },
      flash: 'offline',
    });
  }
};

async function readSignupInput(request: Request): Promise<{
  via: 'json' | 'form';
  email: string;
  name: string;
  source: string;
  xHandle: string;
  facebookHandle: string;
  shoutoutOk: unknown;
}> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      return {
        via: 'json',
        email: typeof body.email === 'string' ? body.email : '',
        name: typeof body.name === 'string' ? body.name : '',
        source: typeof body.source === 'string' ? body.source : 'listen',
        xHandle: typeof body.xHandle === 'string' ? body.xHandle : typeof body.x_handle === 'string' ? body.x_handle : '',
        facebookHandle:
          typeof body.facebookHandle === 'string'
            ? body.facebookHandle
            : typeof body.facebook_handle === 'string'
              ? body.facebook_handle
              : '',
        shoutoutOk: body.shoutoutOk ?? body.shoutout_ok,
      };
    } catch {
      return { via: 'json', email: '', name: '', source: 'listen', xHandle: '', facebookHandle: '', shoutoutOk: false };
    }
  }

  const data = await request.formData();
  return {
    via: 'form',
    email: String(data.get('email') ?? ''),
    name: String(data.get('name') ?? ''),
    source: String(data.get('source') ?? 'listen'),
    xHandle: String(data.get('x_handle') ?? ''),
    facebookHandle: String(data.get('facebook_handle') ?? ''),
    shoutoutOk: data.get('shoutout_ok'),
  };
}

function signupReply(
  request: Request,
  via: 'json' | 'form',
  result: { status: number; body: Record<string, unknown>; flash: OutpostFlash },
) {
  if (via === 'form' && !acceptsJson(request)) {
    return new Response(null, {
      status: 303,
      headers: { Location: outpostListenRedirect(result.flash) },
    });
  }
  return Response.json(result.body, { status: result.status });
}

function acceptsJson(request: Request): boolean {
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('application/json');
}
