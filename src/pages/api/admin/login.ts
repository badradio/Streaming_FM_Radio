import type { APIRoute } from 'astro';
import { getAdminPassword, makeSessionToken, passwordsMatch, sessionCookie } from '../../../lib/admin-auth';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const expected = await getAdminPassword();
  if (!expected) {
    return Response.json({ ok: false, message: 'ADMIN_PASSWORD is not set on this server' }, { status: 503 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  let password = '';
  if (contentType.includes('application/json')) {
    const body = (await request.json()) as { password?: string };
    password = body.password ?? '';
  } else {
    const form = await request.formData();
    password = String(form.get('password') ?? '');
  }

  if (!(await passwordsMatch(password, expected))) {
    if (contentType.includes('application/json')) {
      return Response.json({ ok: false, message: 'Wrong desk password' }, { status: 401 });
    }
    return new Response(null, { status: 303, headers: { Location: '/admin/login?error=1' } });
  }

  const token = await makeSessionToken(expected);
  const secure = new URL(request.url).protocol === 'https:';
  const headers = new Headers({ 'Set-Cookie': sessionCookie(token, secure) });

  if (contentType.includes('application/json')) {
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ ok: true }), { headers });
  }
  headers.set('Location', '/admin');
  return new Response(null, { status: 303, headers });
};
