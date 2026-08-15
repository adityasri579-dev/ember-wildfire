# Stage 9 upgrade notes

Stage 9 adds a local authentication and ownership layer on top of Stage 8.

- User registration and sign-in endpoints.
- Passwords hashed with Node.js `crypto.scrypt` and a random per-user salt.
- Random 256-bit session tokens; only SHA-256 token hashes are stored in SQLite.
- Session cookie is `HttpOnly`, `SameSite=Strict`, and has a 7-day lifetime.
- Scenario list/save/load/delete endpoints now require authentication.
- Every scenario is associated with a user ID and queries enforce ownership.
- Authentication is not required to run simulations or use public weather/map/fire-data layers.
- Existing Stage 8 scenarios with no owner are intentionally not exposed to newly created accounts.

## Security scope

This is a strong hackathon/local-app authentication foundation, not a complete internet-scale identity system. Before a public production deployment add HTTPS-only cookies (`Secure`), CSRF protections where cross-site hosting is introduced, rate limiting/login throttling, verified email/password reset, audit logging, database backups, and preferably a managed identity provider.
