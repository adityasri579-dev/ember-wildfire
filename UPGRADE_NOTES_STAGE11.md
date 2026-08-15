# Stage 11 upgrade notes

Added cloud-provider release configuration without changing the wildfire simulation behavior.

- `render.yaml`: Docker Blueprint, Singapore region, `/api/health`, persistent `/app/data` disk, production proxy/cookie settings, and prompted FIRMS secret.
- `railway.json`: Docker build, health check, restart policy, and graceful deployment draining.
- `GO_LIVE.md`: exact deployment and post-deploy verification steps.
- Retains Stage 10 Docker, CSRF, secure sessions, rate limits, backups, SQLite WAL, graceful shutdown, FIRMS backend proxy, private scenario ownership, and real-world data integrations.

No credentials are included in this archive.
