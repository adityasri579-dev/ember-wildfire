# Ember Stage 10 — Production deployment

Ember ships as one Docker-compatible Node service. The application stores users, sessions, and saved scenarios in SQLite, so **persistent storage is mandatory** in production.

## Required production settings

- `NODE_ENV=production`
- `DATA_DIR=/app/data` (or another persistent mount)
- `TRUST_PROXY=1` when HTTPS terminates at the hosting provider / reverse proxy
- `COOKIE_SECURE=1`
- `APP_ORIGIN=https://your-real-domain.example`
- `FIRMS_MAP_KEY=...` only if NASA FIRMS is enabled

Never commit `.env` or a real FIRMS key.

## Render

Deploy the repository as a Docker Web Service. Set the health-check path to `/api/health`. Attach a persistent disk and mount it at `/app/data`, then set `DATA_DIR=/app/data`. Add production environment variables/secrets in the service settings.

Important: Render's normal service filesystem is ephemeral. SQLite must live on the attached persistent disk. A persistent disk is currently a paid-service feature.

## Railway

Deploy the repository/service using its Dockerfile. Attach a Railway Volume at `/app/data` and set `DATA_DIR=/app/data`. Add `APP_ORIGIN` after Railway gives you the HTTPS domain, and set `TRUST_PROXY=1` and `COOKIE_SECURE=1`.

Railway volumes are mounted at runtime and persist across deployments/restarts, making them appropriate for the SQLite file.

## Docker / VPS

Use `docker compose up -d --build` as a starting point. For a public VPS, terminate HTTPS with a reverse proxy (for example your existing infrastructure) and change the production settings to `TRUST_PROXY=1`, `COOKIE_SECURE=1`, and the exact `APP_ORIGIN`.

## Backups

Run `npm run backup` from inside the service/container. It uses SQLite `VACUUM INTO` to create a consistent snapshot. Copy backups to storage outside the same server/volume for real disaster recovery.

## Before real emergency use

This project is decision-support/demo software. OSM land-cover is a fuel proxy, candidate facilities are not automatically official shelters, satellite hotspots are thermal anomalies, and the spread model/data pipeline has not been independently validated for operational life-safety use. Production hosting does not turn the model into a certified emergency-management system.
