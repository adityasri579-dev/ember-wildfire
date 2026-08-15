# Ember geographic Stage 2 — implementation notes

## Implemented in Stage 1

- WGS84 scenario center (`centerLat`, `centerLon`, `locationName`).
- Local-grid ↔ latitude/longitude conversion.
- Real place search, direct coordinates, browser geolocation and OpenStreetMap picker.
- Real-coordinate ignition placement and geographic hover readouts.

## Implemented in Stage 2

1. **Real elevation adapter** using the public AWS Terrain Tiles / Mapzen Terrarium dataset.
2. Terrarium PNG decoding to metres: `R*256 + G + B/256 - 32768`.
3. Resampling of real elevation into Ember's existing 240×240 / 32 m simulation grid.
4. Slope, aspect and hillshade are recalculated from the loaded DEM, so the existing fire spread solver uses the real terrain surface.
5. **OpenStreetMap land-cover adapter** using Overpass geometry for `landuse`, `natural` and parks.
6. OSM features are rasterized directly into Ember's fuel grid and mapped to the existing Anderson-style fuel classes.
7. The UI reports what data source is active and the percentage of cells explicitly covered by mapped OSM polygons.
8. Untagged OSM areas remain an explicit grass–shrub planning proxy rather than being presented as observed fuel data.
9. Public-data failures are handled safely: real elevation/OSM loading can fail without breaking the demo, and Ember falls back to the previous synthetic landscape.
10. Choosing a new geographic area automatically attempts to load the real landscape.

## Still synthetic / not production-ready

- Road graph and road capacities.
- Communities and population counts.
- Shelter locations/capacities.
- Live/forecast weather.
- Official wildfire detections/perimeters.
- Validated wildfire fuel raster and calibrated local fire behaviour.
- Backend caching, rate limiting and persistent scenarios.

## Data / modelling note

OpenStreetMap land-use tags are not a calibrated wildfire fuel dataset. Their mapping to Ember's fuel models is only a hackathon/planning proxy. This application must not be used for real emergency warnings or evacuation decisions.

## Recommended Stage 3

Replace `buildNetwork()` with an OpenStreetMap road-network import, classify roads by OSM `highway` type, derive realistic speeds/capacities, and anchor communities/shelters to real mapped locations.

## Stage 3 — Real road network

Stage 3 replaces the generated evacuation road graph with live OpenStreetMap road geometry for the selected 7.68 km area. The browser queries Overpass for drivable `highway=*` ways and converts them to Ember's existing time-dependent evacuation graph.

Implemented in this stage:

- Real OpenStreetMap drivable road geometry.
- OSM road classification mapped into Ember highway / arterial / local rendering classes.
- `maxspeed` is used when tagged; otherwise Ember uses a class-based planning fallback.
- `lanes` is used when tagged to estimate directional capacity.
- `oneway=yes`, `oneway=-1`, and roundabout directionality are respected by routing.
- Road segments are rasterized onto the fire grid so fire-arrival times can close real road links.
- Existing Stage-2 synthetic communities and shelters are snapped to the nearest usable real-road nodes.
- If the public road-data service is unavailable, the previous synthetic network remains as an explicit fallback rather than breaking the demo.

Still not real-world complete:

- Community locations and population are synthetic.
- Shelter locations/capacities are synthetic.
- Road capacities and untagged speeds are planning estimates, not traffic-engineering data.
- There is no live traffic, incident closure, contraflow, or emergency-authority feed.
- The wildfire model has not been validated for operational emergency use.

**Safety:** Ember remains a hackathon decision-support demonstrator and must not be used for real emergency evacuation decisions.


## Stage 4 — Mapped communities, population provenance, and evacuation sites

Stage 4 replaces synthetic community names/locations with OpenStreetMap `place=*` features in the selected simulation area and snaps them to the real Stage-3 road graph.

- Uses mapped settlement names and classes (`city`, `town`, `village`, `hamlet`, `suburb`, `quarter`, `neighbourhood`, `isolated_dwelling`).
- Uses OSM `population=*` when present. Missing population is explicitly shown as a planning estimate; it is not presented as census/observed population.
- Prefers facilities explicitly tagged as emergency/social-facility shelters.
- If there are too few explicitly tagged shelters, mapped schools, colleges, community centres and town halls may be used as **candidate public evacuation sites**. These are clearly labelled `(candidate)` and are not represented as official shelters.
- Uses mapped `capacity=*` where present; otherwise shelter capacity remains an explicit planning estimate.
- Real communities and sites are snapped to reachable nodes on the real OSM road graph.
- Keeps the synthetic Stage-3 communities/sites as a fallback if public map data are unavailable or absent in the selected 7.68 km window.

### Still not authoritative

OSM settlement/population/facility coverage varies by location. Candidate public facilities have not been verified as emergency shelters, and estimated populations/capacities are modelling proxies. Ember remains a hackathon/planning demonstration and must not be used for emergency decisions.

## Stage 5 — live weather (Open-Meteo)

- Added API-key-free current/forecast weather loading for the selected geographic centre.
- Applies temperature, relative humidity, 10 m wind speed/direction and exposes gust/precipitation in the UI.
- Ember's spread solver expects a 20-ft wind input; Stage 5 explicitly labels Open-Meteo 10 m wind as a proxy rather than claiming they are identical.
- 1-hour dead fuel moisture remains a manual planning input; the app does not fabricate a measured fuel-moisture value from ordinary weather fields.
- Added a next-24-hour forecast selector so a scenario can be rerun using a chosen forecast hour.
- Added timezone-correct forecast display using the selected location's timezone.
- Manual wind changes are visibly marked as overrides while retaining the forecast as a reference.
- Weather failure falls back to the existing manual controls so a demo remains usable.
- Stage 5 remains a planning/hackathon prototype and is not for emergency decision-making.

## Stage 6 — NASA wildfire incidents

- Added NASA EONET v3 wildfire-event discovery for the selected location.
- Searches open wildfire events from the last 30 days within a 300 km planning radius and sorts them by distance.
- Nearby EONET incidents display their real name, reported point, distance, and available event date.
- If an incident lies inside Ember's current 7.68 km simulation domain, it can be used directly as the ignition point.
- If it lies outside the current domain, **Center on incident** relocates the simulation domain to the reported point, reloads terrain/roads/places/weather, and uses the incident as the ignition source.
- Manual ignition remains available and Ember records whether the current ignition is manual or NASA EONET-sourced.
- EONET is incident/event metadata, not a dense satellite thermal-hotspot feed. The UI states this explicitly.
- NASA FIRMS provides near-real-time MODIS/VIIRS active-fire hotspots, but its web-service API requires a free MAP_KEY. That key is intentionally not embedded in this browser-only build; FIRMS should be proxied through the backend in the production architecture.
- Fixed a Stage-5 startup bug that could request weather from the animation loop. Weather and wildfire context are now fetched once at application boot and on explicit refresh/location changes.

**Safety / scope:** incident locations and model outputs are informational planning data. Ember has not been validated or certified for operational wildfire response or evacuation decisions.


## Stage 7 — backend + SQLite persistence
- Added a Node.js backend (`server.js`) and SQLite database using Node's built-in `node:sqlite`.
- External data now flows through `/api/*` server routes: Open-Meteo, NASA EONET, Nominatim, Overpass, and AWS Terrarium elevation tiles.
- Added in-memory upstream caching and Overpass endpoint failover.
- Added persistent scenario Save/Load controls backed by `data/ember.db`.
- Added `.env.example` with a server-only placeholder for a future NASA FIRMS MAP_KEY.
- Run with Node 22.5+ using `npm start`, then open http://localhost:8787. Do not open the HTML file directly for Stage 7.
