This is a backup mirror of the badradio.rocks Worker.

Source of truth is the Cursor Origin repo. No secrets are included.

Commit of main: 8fced7f0059a6c3264c9e2eeaa1ad4c9fa453838

Deploy steps:
1. npm ci
2. Apply the migrations folder to the D1 database (badradio-master / MASTER).
3. Set the RESEND_API_KEY, ADMIN_PASSWORD, and FEEDBACK_ADMIN_KEY secrets with wrangler secret put.
4. wrangler deploy --keep-vars
