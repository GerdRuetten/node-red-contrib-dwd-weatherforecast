# node-red-contrib-dwd-weatherforecast

Ein Node-RED-Node zur Abfrage der offiziellen **DWD MOSMIX_L Wettervorhersage** für einzelne DWD-Messstationen.  
Der Node lädt die MOSMIX_L KMZ-Datei einer Station, extrahiert die KML-Daten und gibt eine strukturierte JSON-Vorhersage aus – ideal für Dashboards, Automationen und Auswertungen.

---

## ✨ Features

- Offizielle **DWD MOSMIX_L** Vorhersagedaten (stündliche Auflösung)
- Funktioniert mit jeder **DWD Stations-ID** (z. B. `H721` für Köln/Bonn)
- Unterstützt **Auto-Aktualisierung**
- Option **„Beim Deploy abrufen“**
- Optionaler **Stale-Modus** (Fallback auf letzte erfolgreiche Daten)
- Filterung der Vorhersage: nur zukünftige Werte, max. Stunden
- Unit-Conversions: °C, hPa, km/h, km
- Windrichtung wahlweise: Grad, 8-Sektor, 16-Sektor
- Detaillierte **Niederschlagsbeschreibung**
- Vollständige Unterstützung für **i18n** (Deutsch/Englisch)
- Diagnosemodus mit erweiterten Logs

---

## 📦 Installation

Im Node-RED Benutzerverzeichnis (typisch `~/.node-red`):

```bash
npm install node-red-contrib-dwd-weatherforecast
```

Oder über den Node-RED Paletten-Manager:

1. Node-RED Editor öffnen
2. Menü → **Palette verwalten**
3. Tab **Installieren**
4. Nach **`node-red-contrib-dwd-weatherforecast`** suchen
5. **Installieren** klicken

---

## 🔧 Konfiguration

### Name
Optionaler Anzeigename des Nodes.

### DWD Stations-ID
Beispiel: `H721` für Köln/Bonn Flughafen.

### Quell-URL
Standard:

```
https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/{station}/kml/MOSMIX_L_LATEST_{station}.kmz
```

`{station}` wird automatisch ersetzt.

### Beim Deploy abrufen
Holt direkt nach dem Deploy eine frische Vorhersage.

### Auto-Aktualisierung (Sek.)
- `0` → deaktiviert
- `> 0` → holt Vorhersage periodisch

### Vorhersage-Horizont (Stunden)
Begrenzt die Vorhersage auf die nächsten X Stunden.

### Nur zukünftige Zeitpunkte
Filtert alte Zeitpunkte aus der MOSMIX-Vorhersage.

### Stale-Modus
Verwendet alte Vorhersagedaten, wenn der Fetch fehlschlägt.

### Ausgabeoptionen
- **Core-only**: Kompakte Ausgabe
- **°C statt Kelvin**
- **km/h statt m/s**
- **hPa statt Pa**
- **km statt m**
- **Windrichtung als Text (8 / 16 Sektoren)**

### Diagnose
Detaillierte Log-Ausgaben im Node-RED Log.

---

## 🔌 Eingänge

Jede eingehende Nachricht löst einen Abruf basierend auf der aktuellen Konfiguration aus (sofern Auto-Refresh nicht aktiv ist).

---

## 📤 Ausgänge

Struktur der Ausgabe (`msg.payload`):

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
    "url": "...",
    "count": 120,
    "stale": false,
    "coreOnly": false
  }
}
```

---

## 🔎 Statusanzeigen

- **lade…** – Datenabruf läuft
- **bereit** – Wartet auf Trigger oder Auto-Aktualisierung
- **ok** – Erfolgreich, zeigt Anzahl Datensätze
- **Fehler** – Abruf/PARSING fehlgeschlagen
- **stale (n)** – Alte Daten werden ausgegeben

Alle Texte werden je nach Editor-Sprache lokalisiert.

---

## 🌍 Internationalisierung (i18n)

Folgende Dateien steuern die Localization:

- Englisch:
    - `nodes/locales/en-US/dwd-weatherforecast.json`
    - `nodes/locales/en-US/dwd-weatherforecast.html`

- Deutsch:
    - `nodes/locales/de/dwd-weatherforecast.json`
    - `nodes/locales/de/dwd-weatherforecast.html`

---

## 🧪 Beispiel-Flow

Der Beispiel-Flow befindet sich unter:

```
examples/weatherforecast-basic.json
```

Import:

1. Node-RED Menü → **Importieren**
2. **Zwischenablage**
3. JSON einfügen
4. **Importieren**

---

## 🗺️ Roadmap

- „Feels Like“-Temperatur
- Tages-Min/Max Aggregation
- Dashboard-Komponenten
- Kombinierte DWD-Daten-Flows
- Erweiterte Fehlerdiagnose

---

## ⚖️ Lizenz
MIT © 2025 Gerd Rütten

---

> 🌦 **node-red-contrib-dwd-weatherforecast** — bringt die offizielle DWD-MOSMIX_L-Vorhersage direkt in deine Node-RED-Flows.
