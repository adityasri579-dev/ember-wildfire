# Stage 10 changes

- Production environment mode and configurable host/data directory.
- Dockerfile, Compose file, container healthcheck, and deployment guide.
- Secure session cookies in production.
- CSRF double-submit token for authentication and scenario-changing requests.
- Same-origin enforcement for sensitive production writes.
- Route-aware in-memory rate limits for authentication and external-data proxies.
- Security headers including CSP, frame protection, content-type protection, referrer and permissions policies.
- Proxy-aware client address/protocol handling.
- External fetch timeouts and bounded in-memory response cache.
- SQLite WAL mode, foreign keys, busy timeout, and expired-session cleanup.
- Graceful SIGTERM/SIGINT shutdown for container platforms.
- `npm run backup` for consistent SQLite snapshots.
- Production request logging without exposing passwords or FIRMS credentials.
