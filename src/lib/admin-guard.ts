import { getAdminPassword, isValidSession, readSessionCookie } from './admin-auth';

export async function requireAdmin(request: Request): Promise<{ ok: true } | { ok: false; response: Response }> {
  const secret = await getAdminPassword();
  if (!secret) {
    return {
      ok: false,
      response: Response.json({ ok: false, message: 'ADMIN_PASSWORD is not set' }, { status: 503 }),
    };
  }
  const token = readSessionCookie(request.headers.get('cookie'));
  if (!(await isValidSession(token, secret))) {
    return {
      ok: false,
      response: Response.json({ ok: false, message: 'desk login required' }, { status: 401 }),
    };
  }
  return { ok: true };
}
