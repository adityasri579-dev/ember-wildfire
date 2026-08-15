# Stage 10 — Run locally

1. Install Node.js 22.5 or newer.
2. Open this folder in VS Code.
3. Run `npm start`.
4. Open `http://localhost:8787`.

For NASA FIRMS, copy `.env.example` to `.env` and put your private `FIRMS_MAP_KEY` there.

## Docker test

Run `docker compose up --build`, then open `http://localhost:8787`.

## Database backup

Run `npm run backup`. A consistent SQLite backup is written under `data/backups/` unless `BACKUP_DIR` is configured.
