import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-guard';
import { toSignupCsv } from '../../../lib/outpost';
import { getSignupDb, listSignups, signupTableReady } from '../../../lib/outpost-db';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const db = await getSignupDb();
  if (!db || !(await signupTableReady(db))) {
    return Response.json({ ok: false, message: 'outpost_signups table is not on D1 yet' }, { status: 503 });
  }

  try {
    const rows = await listSignups(db);
    return new Response(toSignupCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="badradio-outpost-signups.csv"',
      },
    });
  } catch {
    return Response.json({ ok: false, message: 'Could not export signups' }, { status: 503 });
  }
};
