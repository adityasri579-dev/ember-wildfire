# Ember Stage 11 — Go Live

Stage 11 is the cloud-release package. The application code is the same production-hardened Ember build from Stage 10, with provider configuration added for Render and Railway.

## Recommended: Render Blueprint

1. Put this entire folder in a GitHub repository. `render.yaml` must stay at the repository root.
2. In Render, create a **Blueprint** from that repository.
3. Render reads `render.yaml` and creates the Docker web service in Singapore with a 1 GB persistent disk mounted at `/app/data`.
4. When prompted for `FIRMS_MAP_KEY`, paste your own NASA FIRMS MAP_KEY. If you do not have one yet, leave the integration unconfigured and add the variable later in Render.
5. Deploy.
6. When the service becomes healthy, open the generated HTTPS `onrender.com` address.
7. Create a test account, save a scenario, sign out/in, and confirm it still exists.
8. Confirm `https://YOUR-HOST/api/health` returns JSON with `"ok": true`.

### Why this blueprint uses a paid Render service

The application currently uses SQLite. Render's normal filesystem is ephemeral; persistent disks are available for paid web services. Without the disk, users and saved scenarios could disappear on redeploy/restart.

## Railway alternative

1. Put this folder in a GitHub repository and create a Railway project from the repository.
2. Railway sees the `Dockerfile` and `railway.json`.
3. Add a persistent Volume and mount it at `/app/data`.
4. Add variables:
   - `NODE_ENV=production`
   - `HOST=0.0.0.0`
   - `DATA_DIR=/app/data`
   - `TRUST_PROXY=1`
   - `COOKIE_SECURE=1`
   - `FIRMS_MAP_KEY=<your private key>` (optional)
5. Generate a public Railway domain.
6. Verify `/api/health`, account login, scenario save/load, live weather, OSM data, and FIRMS if configured.

## Do not commit secrets

Never place a real `FIRMS_MAP_KEY` in `.env.example`, `render.yaml`, `railway.json`, browser JavaScript, screenshots, or a public Git repository.

## Custom domain later

A custom domain is optional for the hackathon. The provider-generated HTTPS URL is enough for a live demo. If you later attach a custom domain, Ember's origin validation can derive the request origin through the trusted proxy. You normally do not need to hardcode `APP_ORIGIN`.

## SQLite scaling note

This release deliberately runs as a single application instance because SQLite is a local file database. Before multi-instance production scaling, migrate persistence to managed PostgreSQL or another shared database.
