import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-guard';
import { parseMasterUpload, planMasterUpsert } from '../../../lib/radio/master';
import {
  getMasterDb,
  importMasterPlan,
  loadMasterFingerprints,
  masterTracksReady,
  masterUnavailableMessage,
} from '../../../lib/radio/master-db';
import { workerEnv } from '../../../lib/runtime';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const raw = (await workerEnv())?.MASTER;
  const db = await getMasterDb();
  if (!db) {
    return Response.json({ ok: false, message: masterUnavailableMessage(raw) }, { status: 503 });
  }

  try {
    if (!(await masterTracksReady(db))) {
      return Response.json(
        {
          ok: false,
          message: 'D1 MASTER is bound but master_tracks is missing. Run npm run d1:migrate:remote, then import.',
        },
        { status: 503 },
      );
    }

    const { text, filename } = await readUpload(request);
    if (!text.trim()) {
      return Response.json({ ok: false, message: 'Upload master.csv or NDJSON' }, { status: 400 });
    }

    const parsed = parseMasterUpload(text, filename);
    if (parsed.rows.length === 0) {
      return Response.json(
        { ok: false, message: 'No artist/title rows found', skipped: parsed.skipped },
        { status: 400 },
      );
    }

    const existing = await loadMasterFingerprints(db);
    const plan = planMasterUpsert(existing, parsed.rows);
    await importMasterPlan(db, plan, new Date().toISOString());

    return Response.json({
      ok: true,
      inserted: plan.insert.length,
      updated: plan.update.length,
      skipped: plan.skipped + parsed.skipped,
      duplicatesInFile: parsed.duplicatesInFile,
      parsed: parsed.rows.length,
    });
  } catch {
    return Response.json(
      { ok: false, message: 'Import failed (D1 query). The desk still loads. Check master_tracks.' },
      { status: 503 },
    );
  }
};

async function readUpload(request: Request): Promise<{ text: string; filename: string }> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file') ?? form.get('csv') ?? form.get('master');
    if (file instanceof File) {
      return { text: await file.text(), filename: file.name.toLowerCase() };
    }
    const raw = form.get('text');
    if (typeof raw === 'string') return { text: raw, filename: 'paste.csv' };
    return { text: '', filename: '' };
  }
  const text = await request.text();
  return { text, filename: type.includes('ndjson') ? 'upload.ndjson' : type.includes('json') ? 'upload.json' : 'upload.csv' };
}
