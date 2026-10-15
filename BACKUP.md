This is a backup mirror of the badradio.rocks Worker.

Source of truth is the Cursor Origin repo. No secrets are included.

Commit of main: 96d78702f8c2fabdb7f1ec991f4a1dd2c268cab9

Deploy steps:
1. npm ci
2. Apply the migrations folder to the D1 database (badradio-master / MASTER).
3. Set the RESEND_API_KEY and ADMIN_PASSWORD secrets with wrangler secret put.
4. wrangler deploy --keep-vars
