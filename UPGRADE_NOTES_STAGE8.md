# Stage 8 upgrade notes

- Added server-side `.env` loading without an npm dependency.
- Added `/api/firms/status`.
- Added `/api/firms/hotspots` using NASA FIRMS Area CSV API.
- Validates bounding boxes, day range, and supported NRT source IDs.
- Keeps `FIRMS_MAP_KEY` server-side.
- Parses FIRMS CSV into frontend-friendly JSON.
- Adds a 2-minute backend cache for hotspot requests.
- Adds a frontend NASA FIRMS panel, nearest hotspot list, and hotspot-to-ignition / recenter actions.
- Draws FIRMS detections that fall inside the simulation domain.
- Clearly labels FIRMS points as thermal anomalies rather than confirmed wildfires.
- Gracefully disables FIRMS when no MAP_KEY is configured; EONET/manual ignition remain usable.
