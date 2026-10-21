This is a backup mirror of the badradio.rocks Worker.

Source of truth is the Cursor Origin repo. No secrets are included.

Commit of main: 4ba6f86258d1976ffc231abb2be8567a69357b29

Deploy steps:
1. npm ci
2. Apply the migrations folder to the D1 database (badradio-master / MASTER).
3. Set the RESEND_API_KEY and ADMIN_PASSWORD secrets with wrangler secret put.
4. wrangler deploy --keep-vars
