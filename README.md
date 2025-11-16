# node-red-contrib-dwd-weatherforecast

A Node-RED node that retrieves local weather forecasts from the **Deutscher Wetterdienst (DWD)** using the official **MOSMIX_L** open data products.

The node downloads the KMZ file for a given DWD station, extracts and parses the KML content and returns a structured JSON payload that is easy to consume in dashboards, notifications or further processing nodes.

---

## ✨ Features

- Uses official **DWD MOSMIX_L** forecast data (hourly resolution)
- Works with any **DWD single station ID** (e.g. `H721` for Cologne/Bonn)
- Supports **auto-refresh** (periodic updates, no inject node required)
- Optional **fetch on deploy** (immediate forecast after deployment)
- Optional **stale fallback** (keep last valid data if DWD is temporarily unavailable)
- Configurable **forecast horizon** (limit to next N hours)
- Flexible **unit conversions** (°C, hPa, km/h, km)
- Optional **core-only mode** for compact payloads
- Optional **cardinal wind direction** output (`windDirCardinal`) in 8 or 16 sectors
- Adds a human-readable **precipitation text** field
- Fully **i18n-enabled** (English / German, including help text and status messages)

---

## 📦 Install

From your Node-RED user directory (typically `~/.node-red`):

```bash
npm install node-red-contrib-dwd-weatherforecast
```

Or via the Node-RED Palette Manager:

1. Open the Node-RED editor
2. Menu → **Manage palette**
3. Tab **Install**
4. Search for **`node-red-contrib-dwd-weatherforecast`**
5. Click **Install**

---

## 🔧 Configuration

The main configuration options of the node:

### Name
Optional display name for the node. If left empty, a default label is used.

### DWD station ID
The DWD station identifier, for example `H721` for Cologne/Bonn airport.

You can look up station IDs via the DWD documentation and station lists.

### Source URL
Template URL for the DWD MOSMIX_L KMZ file. By default:

```text
https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/{station}/kml/MOSMIX_L_LATEST_{station}.kmz
```

The placeholder `{station}` will be replaced with the configured station ID (e.g. `H721`).

In most cases you can keep this field untouched.

### Fetch on deploy
When enabled, the node performs an initial fetch shortly after the flow is deployed.  
This is useful when you always want to have fresh data available without a manual trigger.

### Auto-refresh (sec)
Interval in seconds for periodic updates.

- `0` → no automatic refresh (only manual/inject-triggered)
- `> 0` → fetch forecast in this interval (e.g. `1800` = every 30 minutes)

### Lead time (hours)
Limits the forecast horizon.

- `0` → all available forecast steps
- `24` → only the next 24 hours
- `48` → next two days, etc.

### Only future timestamps
If enabled, forecast steps in the past are filtered out and only current / future timestamps are returned.

### Fallback on error (stale)
When enabled, the node returns the last successfully fetched forecast data in case of an error (network issues, DWD outage, etc.).  
The `_meta.stale` flag in the output is set to `true` in this case.

### Output options

- **Core fields only**  
  Reduces the payload to the main weather parameters (temperature, pressure, wind, precipitation, humidity, visibility).

- **Temperature in °C**  
  Converts Kelvin → °C.

- **Wind speed in km/h**  
  Converts m/s → km/h.

- **Pressure in hPa**  
  Converts Pa → hPa.

- **Visibility in km**  
  Converts m → km.

- **Wind direction as text**  
  Controls whether the node adds a `windDirCardinal` field:

    - `deg` → keep numeric degrees only (0–360)
    - `8`   → 8 sectors (`N, NE, E, SE, S, SW, W, NW`)
    - `16`  → 16 sectors (`N, NNE, NE, ENE, E, ESE, …`)

### Enable diagnostics
When enabled, additional log messages are written into the Node-RED log to help with debugging and understanding the internal processing steps.

---

## 🔌 Inputs

Any incoming message triggers a forecast update using the current configuration, unless the node is already updating due to auto-refresh.

The contents of the input message are not evaluated in the current version – only the trigger matters.

---

## 📤 Outputs

The node outputs a message where `msg.payload` contains an array of forecast steps and additional metadata:

```json
{
  "payload": [
    {
      "ts": 1761609600000,
      "iso": "2025-10-28T00:00:00.000Z",
      "temperature": 7.7,
      "pressure": 1010.1,
      "windSpeed": 18.5,
      "windDir": 236,
      "windDirCardinal": "SW",
      "cloudCover": 69,
      "precipitation": 0.3,
      "precipitationText": "Rain (light)",
      "relHumidity": 92,
      "condition": "61",
      "visibility": 25.7
    }
  ],
  "station": {
    "id": "H721",
    "name": "Köln/Bonn-Flughafen"
  },
  "_meta": {
    "url": "https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/H721/kml/MOSMIX_L_LATEST_H721.kmz",
    "count": 120,
    "stale": false,
    "coreOnly": false
  }
}
```

The exact structure depends on your configuration (unit conversions, core-only mode, visibility, wind direction options, etc.).

---

## 🔎 Status text

The node uses its status indicator in the Node-RED editor to show what it is doing:

- **loading…** – fetching data from DWD
- **ready** – idle, waiting for triggers or auto-refresh
- **ok** – last fetch successful, shows number of points
- **error** – an error occurred while fetching or parsing
- **stale (n)** – serving cached (stale) data because the latest fetch failed

All status strings are localized (English / German).

---

## 🌍 Internationalisation (i18n)

All editor labels, tips, help text and runtime status messages are localized using the Node-RED i18n mechanism:

- English:
    - `nodes/locales/en-US/dwd-weatherforecast.json`
    - `nodes/locales/en-US/dwd-weatherforecast.html`
- German:
    - `nodes/locales/de/dwd-weatherforecast.json`
    - `nodes/locales/de/dwd-weatherforecast.html`

The Node-RED editor language (or browser language, if configured) controls which texts are displayed.

---

## 🧪 Example flow

A basic example flow is included in:

```text
examples/weatherforecast-basic.json
```

It demonstrates:

- manual triggering via **Inject** node,
- configuration of the DWD station ID,
- and inspection of the full payload using a **Debug** node.

Import steps:

1. In Node-RED, open the menu → **Import**
2. Choose **Clipboard**
3. Paste the contents of `weatherforecast-basic.json`
4. Click **Import**

---

## 🗺️ Roadmap

Planned enhancements:

- Additional helper fields (e.g. “feels like” temperature)
- Optional aggregation (min/max per day)
- Ready-to-use dashboard examples
- Combined flows with other DWD nodes (pollen, warnings, rain radar)
- Extended error reporting and metrics

---

## ⚖️ License

MIT © 2025 Gerd Rütten

---

## 🧰 Changelog

See [`CHANGELOG.md`](./CHANGELOG.md) for a detailed list of changes.

---

> 🌦 **node-red-contrib-dwd-weatherforecast** — bringing official DWD forecast data directly into your Node-RED flows.
