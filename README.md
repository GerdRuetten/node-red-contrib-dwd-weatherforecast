# node-red-contrib-dwd-weatherforecast

A Node-RED node that retrieves **local weather forecasts** from the  
**Deutscher Wetterdienst (DWD)** MOSMIX_L open data API.

It downloads the official **KMZ (MOSMIX_L)** forecast file for a given DWD weather station,  
extracts and parses the KML data, and outputs a structured JSON array with  
key weather parameters such as temperature, humidity, wind, pressure, and precipitation.

---

## 🌦 Features

- Uses official **DWD MOSMIX_L** forecast data (hourly resolution)
- Works with **any DWD single station ID** (e.g. `H721` for Köln/Bonn)
- Supports **auto-refresh** (periodic updates without inject nodes)
- Optionally triggers a fetch **on deploy**
- Allows **stale fallback** (keeps last valid data if DWD is temporarily unavailable)
- Provides **unit conversion** (°C, hPa, km/h, km)
- Allows **filtering** to only show active or future forecast steps
- Includes **core data mode** for compact payloads
- Provides **station metadata** (`id` + `name`)
- Includes **computed field `precipitationText`** (e.g. “Regen (leicht) – 0.3 mm/h”)
- Built-in fallback calculation for **relative humidity (RELH)** if missing in the feed

---

## 🧩 Installation

### Using the Node-RED Palette Manager

1. Open Node-RED in your browser  
2. Go to **Menu → Manage palette → Install**
3. Search for **`node-red-contrib-dwd-weatherforecast`**
4. Click **Install**

### Using command line (for Docker or local installations)

```bash
cd /data
npm install --no-fund --no-audit GerdRuetten/node-red-contrib-dwd-weatherforecast
```

or (if published on npm):

```bash
npm install node-red-contrib-dwd-weatherforecast
```

If Node-RED runs inside Docker, execute from the container shell:

```bash
docker exec -u node-red -it node-red bash -lc 'cd /data && npm install --no-fund --no-audit GerdRuetten/node-red-contrib-dwd-weatherforecast#master'
```

Then restart Node-RED.

---

## ⚙️ Configuration

| Setting | Type | Description |
|----------|------|-------------|
| **Station ID** | string | DWD station ID (e.g. `H721`) |
| **Source URL** | string | Default: <br>`https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/{station}/kml/MOSMIX_L_LATEST_{station}.kmz` |
| **Run on deploy** | checkbox | Immediately fetch data after deploy |
| **Auto refresh (seconds)** | number | Optional interval to automatically update the forecast |
| **Allow stale fallback** | checkbox | Keep last valid data if DWD feed fails |
| **Only active/future forecasts** | checkbox | Skip past timestamps (`past != true`) |
| **Hours limit** | number | Limit how many forecast hours are returned |
| **Convert temperature to °C** | checkbox | Converts Kelvin → °C |
| **Convert pressure to hPa** | checkbox | Converts Pa → hPa |
| **Convert wind speed to km/h** | checkbox | Converts m/s → km/h |
| **Convert visibility to km** | checkbox | Converts m → km |
| **Core data only** | checkbox | Outputs only main weather parameters |
| **Show precipitation text** | built-in | Adds human-readable `precipitationText` field |

---

## 🧾 Example Output

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
      "cloudCover": 69,
      "precipitation": 0.3,
      "precipitationText": "Regen (leicht)",
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

---

## 💡 Tips

- Use the [official DWD station list](https://opendata.dwd.de/weather/weather_reports/stations_file_description.html) to find your station ID.
- The node caches the last valid forecast internally to prevent empty data during outages.
- For automatic updates, set *auto refresh* (e.g. `1800` s = 30 min).
- Combine this node with dashboard, notification, or influxdb nodes for live weather visualization.

---

## 🧠 Data Source

All forecast data comes from  
**Deutscher Wetterdienst (DWD)**  
via the [Open Data Server](https://opendata.dwd.de/weather/local_forecasts/mos/).

This node uses **MOSMIX_L (Local Forecast Mix – Long version)** datasets.  
MOSMIX_L provides detailed hourly forecasts for each DWD single station.

---

## ⚖️ License

MIT © 2025 [Gerd Rütten](https://github.com/GerdRuetten)

---

## 🧰 Changelog

### v1.0.0
- Initial release  
- Full support for DWD MOSMIX_L single stations  
- Added unit conversions and core data mode  
- Added precipitation text generation  
- Added RELH fallback calculation  
- Added station name + ID metadata  
- Added stale fallback and auto-refresh options

---

## 🧪 Example Flow

```json
[
  {
    "id": "dwd_forecast",
    "type": "dwd-forecast",
    "name": "DWD Forecast Köln/Bonn",
    "station": "H721",
    "runOnDeploy": true,
    "autoRefreshSeconds": 1800,
    "allowStale": true,
    "onlyFuture": true,
    "outputCelsius": true,
    "outputHectoPascal": true,
    "outputWindKmh": true,
    "outputVisibilityKm": true,
    "coreOnly": false
  }
]
```

---

> 🧩 **node-red-contrib-dwd-weatherforecast** — bringing official DWD forecast data directly into your Node-RED flows.
