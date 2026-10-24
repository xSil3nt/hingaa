# Journey — Greater Malé prototype

A working mobile-friendly web journey planner. Visuals are deliberately plain placeholders for the team's designers. All new files live here; the existing `rtlapp`, `map`, research and planning POC are untouched.

## Run

Requires Node.js 22+; no package installation is needed. Google integration uses the two keys in the ignored `.env.local` file; without them the local RTL/OpenStreetMap mode is available.

```powershell
cd C:\Users\Shazin\Desktop\Projects\Datathon\journey-planner
npm start
```

Open [http://localhost:4173](http://localhost:4173). Select **From** and **To** using search, a preset, location (when allowed) or ⌖ map pins, then **Find journeys**. The default Maafannu Bus Terminal → Centro Mall demonstrates cross-island travel. Try VIA Domestic Terminal for an airport journey, or Jumhooree Maidhaan → Centro Mall for a transfer. Search combines RTL stop names with Google Places results (for example, search H16 to find Hiyaa Tower H16). An RTL-only fallback remains available. Airport presets refer to the **domestic terminal bus stop**, not a verified international-terminal entrance.

For another device on the same trusted Wi-Fi, deliberately enable LAN listening:

```powershell
$env:HOST = '0.0.0.0'
npm start
```

Visit the computer's LAN IP on port 4173. Windows Firewall may need a rule. Browser geolocation generally requires HTTPS or localhost, so use stop search/pins from a phone on plain LAN HTTP. This is a local development server, with no public hosting configured.

## What works

### Google Maps integration (24 October update)

The existing Gemini-only key could not access Maps. With approval, two separate keys were created in the existing Google Cloud project: **Journey local server** (Places API (New), Routes API) and **Journey local browser** (Maps JavaScript API, restricted to `http://localhost:4173/*` and `http://127.0.0.1:4173/*`). The Gemini key was left unchanged. Both new key values are in `.env.local`, excluded by `.gitignore`; the server key is never returned to the browser. The website-restricted browser key is necessarily visible in Maps JavaScript requests. The browser key will need an intentionally approved host restriction before using Google Maps on a LAN IP or hosted site.

Google Maps replaces the base map when configured. Place autocomplete is debounced by 450 ms, restricted to Greater Malé, and uses a per-field session token followed by Place Details on selection. Search handles Google-listed flats and landmarks, not just RTL stops. Google content is displayed on the Google map; the RTL bus data remains the transport source.

Google Routes `WALK` requests supply pedestrian geometry, duration and step instructions. The planner considers the five nearest RTL stops within 850 m at each end, requests walking paths with concurrency at most four, and checks up to five shortlisted transfer paths. Unroutable/over-limit walks and ferry instructions are excluded. This candidate limit reduces calls but can miss a better stop farther away. **Google walk durations are used before choosing catchable bus departures**, including the same two-minute buffer. Bus ride duration remains modelled from RTL geometry.

The active walking context is held only in server memory, expires after five minutes, and is reused for that journey's 30-second RTL refreshes. It is not written to disk. A new journey or expired context requests new Google walks. Places responses are not persisted. Google requests consume the project's quota/billing; this prototype has bounded concurrency and candidates, not a hard spending cap. Official references: [Places Autocomplete](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete), [Routes Compute Routes](https://developers.google.com/maps/documentation/routes/compute_route_directions), [display policy](https://developers.google.com/maps/documentation/routes/policies).

When Google is unavailable the app keeps local RTL stop search and clearly labelled OpenStreetMap walking fallback. Google walking is an estimate, not a survey of entrances, sidewalks or accessibility. Privacy and prototype terms are linked from **About the data**.

The original local-mode details below describe that fallback; Google-mode walking uses its returned durations rather than the 75 m/min assumption. `test/google.test.mjs` adds deterministic API-contract, error, walking, ferry, concurrency and catchability checks. Live validation found the H16 flat through Places, fetched walking directions, and produced an RTL bus journey to it. No physical journey has been tested.

- Actual route search over 15 Greater Malé RTL route patterns, with ordered stop occurrences, loop direction, direct buses, at most one transfer, and named drop-off/pick-up restrictions.
- Walking on an OpenStreetMap public-path graph, with a maximum 850 m access/egress and 300 m transfer. Walk-only options are considered up to 2 km. Motorways, trunks, private-access and foot-prohibited ways are excluded. Foot one-way tags and blocked nodes are respected. Short map-access connectors are limited to 55 m and sampled against closed coastline polygons; sea pins and disconnected islands are rejected.
- Alternatives for earliest estimated arrival, fewer changes and less walking. Bus legs follow aligned RTL road geometry, not straight lines between stops. Stops remain in published order; a loop never silently wraps into another trip.
- Catchability includes walking plus **2 minutes at each boarding**. Missed live arrivals are excluded. When available, another supported live or published departure is used. If no departure is supported, show a route outline with **unknown total time**.
- RTL stop ETAs and vehicle dots. Conservative ETA parsing, route-code/destination/direction checks, unique stop-occurrence matching, and ordered ETA context prevent using ambiguous arrivals. `vehicleCode` identifies the corresponding `busCode`; proximity does not determine service or direction.
- Flat fares summed per boarding; distance fares remain unknown. Accessible search, keyboard selection, swap, phone layout, location-denial/no-route/error states, and a web app manifest.

## Data and timing boundaries

RTL stops/shapes and upcoming-time baseline are copied from `../rtlapp/data`, fetched **24 October 2026 at about 09:56 Maldives time (UTC+05:00)**. Exact provenance is retained in `data/routes.json`. API source: [RTL](https://rtl.mv), `https://bo.rtl.mv:4455/maldives/api` with the endpoints documented in `../rtlapp/README.md`. Route **code** 133 is R1; database ID 17 is not its API code.

The Node proxy coalesces concurrent requests and caches ETA/coordinates for **30 seconds**, route details for **5 minutes**; each request has an **8-second timeout**. It requests live feeds for up to six routes represented by the initial candidate itineraries, not the entire network. Plans and feeds refresh every 30 seconds while visible. Unknown/null/failed feeds are usable states. No saved GPS file is loaded. Dots disappear after 90 seconds without a successful check. Fetch time is retrieval time; RTL supplies no fix timestamp, heading, speed or direction for positions.

Published boarding times are fresh route-detail responses when matched to the same stop/order; otherwise the **dated saved snapshot** is used only on its Maldives local date. This is an upcoming-time snapshot, not a full operating calendar. No later-date/arrive-by claims are made. A live bus that cannot be caught may be replaced by a published departure, which remains labelled and is not a guaranteed second vehicle.

Walking is modelled at 75 m/min. Bus duration is modelled from RTL shape distance at 24 km/h plus 0.55 min per intermediate segment, rounded up, with a 2 min minimum. These are prototype assumptions, not measured run times. Transfers depend on this model and are not guaranteed. Displayed totals mix supported boarding times with modelled rides/walks; they are approximate. There is no traffic model or verified full-trip timetable linkage.

OpenStreetMap API extracts were downloaded **24 October 2026** for Malé, Hulhumalé/Hulhulé and Villimalé. Raw `data/osm-*.xml` files and derived `data/walk.json` are included. [© OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright). Short access paths are approximate; entrances, crossings, accessibility and field conditions have not been surveyed. One RTL stop, Masjid Ameel Jaleel, has no path node within the conservative snap limit. Routing can still ride through it, but cannot offer a walk to/from that exact point. External OSM tiles need internet; a local street overlay and the route geometry remain when tiles fail.

This is Greater Malé bus planning, with Villimalé internal buses only. Ferries, nationwide coverage, fares for special eligibility groups, ticketing and official operator deployment are outside scope. No synthetic passenger counts are used. No real bus trip has been tested.

## Validation and handoff

```powershell
npm test
node --check server.mjs
node --check public/app.js
```

Deterministic routing/ETA fixtures cover order, loops, return journeys, one transfer, catchability, null/stale/wrong-direction feeds, restrictions, coastline access, water separation, expired snapshots and fare rules. An HTTP test launches a separate server with unavailable RTL feeds to validate fallback and request handling. `verification.json` records browser and live checks separately.

`public/style.css` contains the visual tokens/layout; `public/index.html` and `public/app.js` contain the placeholder UI. `engine.mjs` owns routing; `server.mjs` owns the proxy. Rebuild local normalized data with `npm run prepare-data` after intentionally updating the source exports or OSM extracts. That command reads the parent RTL files and only writes inside this folder. Raw OSM extracts are retained for reproducibility; no automatic bulk re-download occurs.

## Vercel deployment

The Vercel function in `api/index.mjs` runs the same request handler as the local server. `vercel.json` includes the normalized route/walking data and public assets. Raw OSM exports, local environment files and runtime logs are excluded from deployment.

Set `GOOGLE_MAPS_API_KEY` (private Places/Routes key) and `GOOGLE_MAPS_BROWSER_KEY` (website-restricted Maps JavaScript key) in Vercel's production environment. Never commit `.env.local`. The browser key allows localhost plus `https://shazin.dev/*` and `https://*.shazin.dev/*`; the intended deployment is `https://hingaa.shazin.dev`. A Vercel-generated hostname needs its own browser-key referrer allowance if used for Maps.

Walking contexts and feed caches are per warm function instance. A different instance may recompute walks; there is no durable shared cache. The local server still starts with `npm start`.

## Map appearance

`public/map-theme.js` contains the editable Google map palette and embedded style rules: lagoon water, ivory land, quiet roads, no commercial POI or transit clutter. Street and locality names remain available. Route/vehicle overlays and required Google attribution remain visible. No Cloud map ID is needed. The header badge, About dialog, destination shortcuts and introductory welcome block have been removed from the UI.

### Local Vercel commands

- `npm run dev:vercel`: Vercel development server on port 4173; stop the existing local Node server first to free that port.
- `npm run deploy:status`: check production deployment status.
- `npm run deploy`: manual production deployment when needed.

This folder is linked to the Vercel `hingaa` project via ignored `.vercel/` metadata. CLI version 65.2.0 is pinned in these commands. Pushes to GitHub `main` deploy automatically; check that deployment instead of creating a duplicate. Production Maps credentials are configured in Vercel. Local Maps development reads the ignored `.env.local`.

## Reliable duration display and journey links

Connected journeys always expose a finite travel duration. If a required departure is missing, the card shows `min + wait`: the sum of routed walks, modelled rides and two minutes per boarding. This excludes all bus waiting and does not invent an arrival clock or service frequency. Unsupported transfers do not inherit a promised departure. Outages and next-day expiry are covered by regression tests.

Google walk selection retains the five closest stops and adds stops serving otherwise missing route patterns, up to ten at each end. Walking remains limited to 850 m. The walking phase has a shared 25-second deadline, transfer walks a shared 10-second deadline, with upstream calls at most four at a time. Failed routing falls back to the local path graph when usable.

Successful searches put the endpoints in the page URL. Share copies that link; opening it restores the endpoints and finds current journeys. These URLs contain the selected coordinates, so share location links intentionally. Search results scroll into view on phones, respect reduced motion, and omit zero-minute walk segments from the summary.

## Simpler journey instructions

The product name is `hingaa`. The main journey view focuses on bus numbers, boarding stops, highlighted be-at-stop times, and highlighted get-off stops. Stop lists, timing provenance and vehicle metadata are under expandable details; live updates are collapsed initially. Zero-distance walk steps, duplicate connection notes and the Leave now labels are removed. Waiting uncertainty remains visible in amber when departure data is unavailable.

## Active journey guidance

Choose **Start this journey** to open `/journey.html`. The selected route, leg, boarding/riding phase, stop progress and emitted alert IDs are saved in local site storage for six hours. Reloading resumes the same step in a paused state; no location prompt occurs until the user starts live guidance. End removes the session. A short-lived tab lease prevents two tabs from issuing duplicate GPS alerts. Route/step data is saved; a GPS history is not.

Location uses `watchPosition` with explicit browser permission. Accurate fresh fixes drive walking arrival and ordered bus-stop progress. Two nearby fixes are required; inaccurate, stale, implausibly fast and off-route fixes cannot advance bus stops. Boarding and alighting require user confirmation. Prepare-to-alight and stop alerts are deduplicated across reloads. A screen wake lock is requested where supported while guiding, released on pause/end, and reacquired when visible. The map follows a blue location dot; dragging stops follow and the Follow button recenters.

Device notifications are opt-in and use a notification-only service worker; there is **no background GPS or push subscription**. Foreground in-app alerts work without notification permission. Mobile browsers can suspend GPS when hidden/locked, including installed PWAs. Keep the journey screen open. iPhone notification support may require Home Screen installation. Native background location would be needed to promise locked-phone stop alerts. Live RTL boarding updates poll every 30 seconds; they do not replace GPS or identify which vehicle a user boarded.

Automated session fixtures cover transfers, pause/restore/expiry, permission-independent manual progression, duplicate and stale fixes, poor accuracy, jumping GPS, route deviation, stop alerts and explicit boarding/alighting. Real phone GPS, notification delivery, vibration and a physical bus journey still require field testing. Theme colors are charcoal, periwinkle, mint and cream, with darker accessible control colors.

### Transit-focused map update

The base map now uses charcoal water, cream islands and mint parks, with locality labels at overview scale and street names only at zoom 16 and above. Highway colors, business icons, transit labels and native camera controls are suppressed through Google Maps style/options. Custom accessible zoom buttons replace the camera widget. Google's logo, copyright, terms and keyboard controls remain visible. The planner initially fits the two selected endpoints instead of opening on a broad ocean extent. Styling is shared with active journey guidance.

### Selected palette

Lilac Coast is the sole active palette: lavender water (`#e0e2f5`), chalk land (`#faf8f0`), indigo primary routes (`#585b9d`) and teal secondary routes (`#337e79`). The app controls, icon, planner map and journey map use this palette. Street names appear at zoom 16 and above. The temporary local color laboratory and its alternative presets have been removed.
