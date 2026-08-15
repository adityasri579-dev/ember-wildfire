# Ember — Stage 9

Stage 9 adds **user accounts and private scenario ownership** to the Stage 8 backend architecture. Users can create an account, sign in, and save/load only their own scenarios. Passwords are salted and hashed server-side, and sessions use HttpOnly cookies.

See `STAGE9_RUN.md` and `UPGRADE_NOTES_STAGE9.md`.

# Ember — predictive wildfire spread & evacuation routing

## Geographic Stage 2 upgrade

This build can anchor the simulator to a real place and load real elevation from the public AWS Terrain Tiles dataset. It also queries OpenStreetMap land-use/natural polygons and maps them into Ember's existing fuel classes as a clearly-labelled planning proxy. Roads, communities, population and shelters are still synthetic. See `UPGRADE_NOTES.md` for limitations.


A browser-based simulator that couples a **Rothermel surface fire-spread model** to a
**time-dependent evacuation router** whose road network closes as the fire front crosses it.

Open `ember-wildfire.html` in any modern browser. That's it — no server, no build step,
no install, no network. It works from `file://` on a machine with the network unplugged.

![](screenshots/shot_default.png)

---

## Contents

```
ember-wildfire.html      the whole app, single file, 101 KB, zero dependencies
build.sh                 concatenates src/* back into ember-wildfire.html
src/
  00_head.html           <head>, all CSS, DOM skeleton
  10_core.js             constants, seeded RNG, value-noise fBm, terrain + fuel synthesis
  20_fire.js             Rothermel spread model, elliptical template, arrival-time Dijkstra
  30_roads.js            settlement placement, MST + A* road network synthesis
  40_evac.js             time-dependent routing, closures, BPR congestion, zone tiering
  50_render.js           canvas layers, hillshade, fire raster, roads, routes, smoke
  60_ui.js               panels, timeline, zone cards, SVG charts, interaction
  99_tail.html           closing tags
tools/                   Playwright scripts used to verify the build (see below)
screenshots/             reference renders of the three scenario presets
```

`build.sh` is the only build tooling: it `cat`s the eight `src/` files together in
numeric order. Edit a source file, run `./build.sh`, reload the browser.

---

## What's real and what's synthetic

**The algorithms are real. The landscape is not.** Worth being precise about, because
the distinction matters if you plan to build on this.

### Real — implemented from the published equations

| Component | Source |
|---|---|
| Surface fire spread | Rothermel (1972) — reaction intensity, propagating flux ratio, wind & slope coefficients, effective heating number |
| Fuel models | Anderson (1982) — FM1 grass, FM2 grass-shrub, FM4 chaparral, FM5 brush, FM8 closed timber litter, FM10 timber-understory |
| Effective wind limit | Rothermel / Andrews — `U_eff ≤ 0.9 · I_R`, which is what keeps grass models sane at high wind |
| Fire shape | Anderson (1983) length-to-breadth ratio → ellipse eccentricity → directional spread rate |
| Intensity & flame length | Byram — `I = H·w·R`, `L = 0.0775·I^0.46` |
| Traffic | BPR volume-delay function (α 0.15, β 4) with incremental assignment |

Spot-checked against published BehavePlus values during development: FM1 at 6 % dead
fuel moisture, no wind, no slope → **4.6 ft/min**; FM8 → **0.93 ft/min**. Both in range.

### Synthetic — generated from `scenario.seed`

- **Terrain** — 6-octave value-noise fBm + a ridged component + a regional tilt,
  scaled to 210–1030 m, smoothed three times (raw noise differentiates into cliffs).
  Slope, aspect and hillshade derived by finite differences.
- **Fuels** — rule-based over elevation band, a second noise field and slope:
  valley grass → foothill brush/chaparral → mixed timber → closed timber, with lakes
  in low flat spots and rock above the treeline.
- **Roads, settlements, populations, shelters** — see below.
- **Weather** — three slider values (20 ft wind speed, wind direction, 1-h dead fuel
  moisture). Per-cell moisture is then adjusted for aspect, canopy cover and elevation.

Everything derives deterministically from the seed via a mulberry32 PRNG, so a seed
reproduces a scenario exactly.

### External APIs and data sources

**None.** No NASA FIRMS, no LANDFIRE, no NOAA, no map tiles, no routing service, no CDN.
No `fetch`, no `XMLHttpRequest`, no `localStorage`. Verify with:

```bash
grep -Ei "fetch\(|XMLHttpRequest|https?://|@import|src=|href=|cdn" ember-wildfire.html
```

(the only matches you'll see are the XML namespace URLs Chrome adds to inline SVG).

---

## How it works

### 1. Landscape (`10_core.js`)

A 240 × 240 grid at 32 m per cell — a **7.68 × 7.68 km domain**, 57 600 cells. Elevation,
slope, aspect, hillshade, fuel class and canopy cover all live in parallel typed arrays.

### 2. Fire spread (`20_fire.js`)

`computeSpreadField()` evaluates Rothermel once per cell and caches three numbers:
the heading spread rate `rHead` (m/min), the heading direction `headDir` (radians), and
the ellipse eccentricity `ecc`. Wind and slope are **vector-added**, not summed — which
is why fires turn uphill against a crosswind. `rosAt(i, θ)` then gives the spread rate
in any direction from the elliptical template.

`computeArrival()` is the unconventional part. Instead of stepping a cellular automaton
forward tick by tick, it solves the **entire arrival-time field in one shot as a
shortest-path problem**: Dijkstra over the grid where a link's cost is its length divided
by the directional spread rate, split half-and-half between the two cells so
heterogeneous fuel beds average correctly.

Two details matter:

- A **16-neighbour stencil** (all `(dx,dy)` with `|dx|,|dy| ≤ 2` and `gcd = 1`) instead of
  8, which suppresses the octagonal bias that plagues 8-connected grid Dijkstra.
- **Ember spotting** folds into the same loop: cells finalised above 1500 kW/m roll a
  seeded hash and may loft a firebrand 120–1500 m downwind, pushed back onto the heap
  with a 3–12 min ignition delay.

The payoff: every cell carries the earliest minute the front can reach it. The timeline
scrubber is then pure rendering — scrubbing costs nothing, and the router gets exactly
the field it needs.

Typical solve: **~120 ms** for the fire, **~350 ms** for a full landscape rebuild.

### 3. Road network (`30_roads.js`)

Seven settlements are scored for gentle slope adjacent to heavy fuel — the
wildland–urban interface, which is where these towns actually sit — and greedily selected
with a minimum separation. Three shelters go on flat ground near the domain edge, away
from heavy fuel.

A **minimum spanning tree** over all ten sites decides which pairs connect, plus the three
shortest non-tree chords for redundancy. Each pair is routed with **A\*** over the terrain,
cost = distance × gradient penalty, water heavily penalised (bridges), and — critically —
a **0.22× discount on cells already carrying a road**. That reuse discount is what makes
new roads merge into existing corridors instead of running parallel, and it's why the
output reads like a real mountain road network rather than a spider.

The overlapping polylines become a graph: nodes at endpoints, at junction cells, and every
9 cells (~288 m) otherwise. Links touching a shelter are highway (2 lanes, 95 km/h,
1900 veh/h/lane), other MST links arterial (1 lane, 70 km/h, 1100), chords local
(1 lane, 50 km/h, 700).

`stampFireTimes()` writes the fire arrival minute onto every node and edge. **That stamp
is the only coupling between the two halves of the app.**

### 4. Evacuation (`40_evac.js`)

`tdDijkstra(src, t0, vol)` is a label-setting Dijkstra where the label is *clock time*,
not distance. Departing at `t0`, relaxing edge `(u,v)` gives `t_v = t_u + travel`. An edge
is skipped entirely if `t_v > edge.fireT − 10 min` or `t_v > node[v].fireT − 10 min` —
you must **finish** the traversal, with margin, before burnover. Travel times are static
within one assignment pass, so the FIFO property holds and label-setting is valid.

Congestion uses **incremental assignment**: 8 passes, each loading 1/8 of every community's
demand (population ÷ 2.4 people per vehicle, spread over the mobilisation window in veh/h)
onto the links its path used, with every later pass seeing accumulated volume. Travel time
is free-flow × `1 + 0.15·(v/c)^4`, with `v/c` clamped at 2.6 — past roughly 2× capacity a
real network is in queue spillback, which a static volume-delay curve doesn't describe, so
the curve stops rather than emitting a meaningless number.

Communities are tiered **GO NOW** (< 90 min) / **SET** (< 4 h) / **READY** (< 8 h) /
**MONITOR**, and in staged mode depart in urgency order with a 12-minute offset per rank.
Each reports clearance time, margin (fire ETA − clearance), and unroutable population.

The most interesting failure mode the model produces on its own: a town whose **access road
burns over before the town does**. It shows as `no route` / `UNROUTABLE`, and it is the
mechanism behind most real wildfire evacuation casualties.

### 5. Rendering (`50_render.js`)

Four Canvas 2D contexts. Terrain paints once per landscape into a 240 × 240 `ImageData`.
Fire repaints per frame into a second one, coloured by `t − arrival`: flame under 5 min,
ember to 22, cooling to 75, then a semi-transparent scar so hillshade still reads through.
Both are drawn scaled with smoothing on. Roads, routes, vehicle dots and markers are drawn
as vectors in screen space so they stay crisp at any zoom. Smoke is 16 stacked radial
gradients along the downwind axis from the active front's centroid.

---

## Controls

| | |
|---|---|
| `space` | play / pause |
| `←` `→` | scrub ±10 min (`shift` for ±1 h) |
| drag | pan · **scroll** zoom |
| click a town | isolate its evacuation route |
| *Place ignition* | arm, then click the map — everything re-solves |

Three presets — **Marginal burn day**, **Typical summer day**, **Red-flag wind event**.
Try red-flag and watch the *unroutable* counter; then turn off staged evacuation and
compare corridor load.

---

## Verification

`tools/` holds the Playwright scripts used during the build. They need Playwright
available (`npm i playwright`) and the path at the top of each file adjusted to your
install.

- `test.mjs` — loads the page, asserts no console/page errors, dumps ROS spot-checks
  against published BehavePlus values
- `diag.mjs` / `diag2.mjs` — slope and spread-rate distributions, per-community
  evacuation outcomes, corridor v/c ratios, all three presets
- `play.mjs` — exercises playback, keyboard, zoom, hover tooltips
- `shots.mjs` / `shots2.mjs` / `final.mjs` — screenshot runs

All three presets currently run clean with zero console errors.

---

## Using real data

The seam is narrow and clean:

1. Replace `buildLandscape()` with a DEM plus a LANDFIRE fuel raster resampled to the grid.
2. Replace `buildNetwork()` with an OSM extract (Overpass or a `.pbf`).
3. Point the weather fields at a gridded forecast.
4. Stamp real populations onto the community nodes.

Everything downstream — `computeSpreadField()`, `computeArrival()`, `stampFireTimes()`,
`planEvacuation()` — consumes typed arrays and a graph and needs no changes.

Two realistic complications: a real fuel raster needs the full 40-model Scott & Burgan set
rather than the six here, and a real road graph needs turn restrictions and one-way
handling, which the current symmetric adjacency list doesn't model.

---

## Limitations

- Surface fire only — no crown fire initiation or spread, no canopy bulk density.
- No suppression, no fire behaviour feedback from firefighting activity.
- Rothermel is known to over-predict at high wind. The effective-wind-speed limit is
  applied, but the red-flag preset's numbers sit at the top of the model's credible range.
- Traffic is a static volume-delay assignment, not a dynamic queueing or cell-transmission
  model. It captures corridor saturation, not intersection-level gridlock or spillback.
- Evacuation compliance is assumed to be 100 % within the mobilisation window; shadow
  evacuation and late departures are not modelled.
- Single ignition point per run.

---

*Built with Claude (Cowork). Fire behaviour equations are from the published literature;
the landscape is procedurally generated and does not represent any real place.*

---

## Geographic Stage 1 upgrade

This build now supports a real-world WGS84 anchor while retaining the existing local-grid
simulation engine.

New capabilities:

- Search a city, park, address-like place name, or enter `latitude, longitude` directly.
- Open an interactive OpenStreetMap/Leaflet picker and click to reposition the 7.68 km domain.
- Use browser geolocation when permission is available.
- Place ignition from the geographic picker when the point lies inside the active domain.
- Convert every simulation cell to/from latitude/longitude; hover tooltips now show coordinates.
- Deterministically seed a synthetic landscape from the chosen geographic center.

### Important limitation

The geographic anchor is real, but elevation, fuel, roads, settlements, populations and shelters
are still synthetic. This version must **not** be used for real emergency decisions. The next
production stage is to ingest a real DEM/land-cover raster and an OpenStreetMap road extract into
the existing fire and evacuation engines.

### Network requirements for geographic features

The original simulation remains a single HTML file. The new location picker uses Leaflet 1.9.4,
OpenStreetMap tiles and Nominatim geocoding, so those geographic-picker features require an
internet connection. Direct coordinate entry still lets the scenario be geographically anchored
when geocoding is unavailable.


## Real-world upgrade status

**Stage 4:** selected scenarios can now load measured elevation, OpenStreetMap-derived land-cover fuel proxies, the actual OpenStreetMap drivable road network, mapped settlement names/locations, population tags where available, and mapped evacuation-site candidates. Missing population/capacity values are explicitly treated as planning estimates, and public facilities are not represented as official shelters unless emergency-shelter tagging is present. Public-data failures fall back to synthetic layers so the demo remains runnable.

This is not an operational wildfire or evacuation system. Do not use it for emergency decisions.

### Stage 5 additions
The current build can fetch Open-Meteo weather for the selected area and apply a forecast snapshot to the wildfire scenario. It includes a 24-hour hour-picker and preserves manual weather controls for what-if analysis or offline fallback. Open-Meteo 10 m wind is treated as a documented proxy for the model's 20-ft wind input; dead-fuel moisture remains manual.

### Stage 6 additions

Stage 6 adds a real wildfire incident layer using NASA EONET v3. The left-side **Ignition & response** panel can refresh nearby open wildfire events and either use an incident as the current ignition or recenter the simulation on it. The app preserves manual ignition for hypothetical scenarios and displays the provenance of the current ignition.

EONET is a natural-event metadata feed rather than a per-pixel thermal-detection product. Near-real-time MODIS/VIIRS hotspot ingestion via NASA FIRMS is reserved for the backend stage because FIRMS web-service requests require a MAP_KEY that should not be exposed in client-side JavaScript.


---

## Stage 10 — deployment-ready build

Stage 10 adds the production boundary around the Stage 9 application: Docker deployment, secure production cookies, CSRF protection, rate limiting, security headers, external-request timeouts, persistent-data configuration, health checks, graceful shutdown, and a SQLite backup command.

For local use run `npm start` and open `http://localhost:8787`.

For deployment, read `DEPLOYMENT.md`. SQLite must be placed on persistent storage by setting `DATA_DIR` to the mounted volume/disk path.

## Stage 11 cloud release

This package adds `render.yaml`, `railway.json`, and `GO_LIVE.md`. For a public hackathon URL, follow `GO_LIVE.md`.
