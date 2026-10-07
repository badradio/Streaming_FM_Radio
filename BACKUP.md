# badradio.rocks backup

This zip is a backup mirror of the **badradio.rocks** Worker (Cloudflare Worker `badradio`).

- **Source of truth:** the Cursor Origin repo. Restore from there when you can.
- **Commit on `main`:** `4520623c0d1e027da07444454c429161b4d54156` (`4520623`)
- **No secrets are included.** There is no `.env`, no `.dev.vars`, no `node_modules`, and no API keys. `.gitignore` and `.env.example` are kept on purpose.

## Deploy from this archive

1. `npm ci`
2. Apply the SQL in the `migrations/` folder to the D1 database (`badradio-master` / binding `MASTER`).
3. Set secrets (values are not in this zip):

   ```sh
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put ADMIN_PASSWORD
   ```

4. Deploy without wiping dashboard plaintext vars:

   ```sh
   npx wrangler deploy --keep-vars
   ```

Or `npm run deploy` in this tree (it already uses `--keep-vars`).
