/**
 * DWD MOSMIX Forecast (KMZ/KML) for Node-RED
 * - Source: MOSMIX_L single_stations
 * - URL pattern: https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/{STATION}/kml/MOSMIX_L_LATEST_{STATION}.kmz
 * - UI options reflected in `config`:
 *   - stationId: string (e.g., "H721")
 *   - includePressure: boolean
 *   - includeWind: boolean
 *   - includeVisibility: boolean  (VV)
 *   - computePrecipText: boolean  (derive human-readable precipitation text)
 *   - immediateFetch: boolean     (fetch on deploy)
 *   - autoRefreshSec: number      (poll every N seconds, 0/empty = off)
 *   - allowStale: boolean         (if unzip/parse fails temporarily, reuse last good)
 *   - timeoutMs: number
 */

module.exports = function (RED) {
    const axios = require("axios");
    const AdmZip = require("adm-zip");
    const xml2js = require("xml2js");
    const moment = require("moment-timezone");

    function DwdWeatherForecastNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.stationId = (config.stationId || "").trim();     // e.g. "H721"
        node.includePressure = !!config.includePressure;
        node.includeWind = !!config.includeWind;
        node.includeVisibility = !!config.includeVisibility;
        node.computePrecipText = !!config.computePrecipText;

        node.immediateFetch = !!config.immediateFetch;
        node.autoRefreshSec = Number(config.autoRefreshSec || 0);
        node.allowStale = !!config.allowStale;

        node.timeoutMs = Number(config.timeoutMs || 20000);

        let pollTimer = null;
        let lastGood = null;

        function statusOK(text) { node.status({ fill: "green", shape: "dot", text }); }
        function statusWarn(text) { node.status({ fill: "yellow", shape: "ring", text }); }
        function statusErr(text) { node.status({ fill: "red", shape: "dot", text }); }

        function buildUrl(station) {
            const s = (station || node.stationId || "").toUpperCase();
            return `https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/${s}/kml/MOSMIX_L_LATEST_${s}.kmz`;
        }

        async function fetchKmz(url, timeoutMs) {
            const res = await axios.get(url, {
                timeout: timeoutMs || 20000,
                responseType: "arraybuffer"
            });
            if (res.status < 200 || res.status >= 300) {
                throw new Error(`HTTP ${res.status} for ${url}`);
            }
            return Buffer.from(res.data);
        }

        function unzipKml(kmzBuffer) {
            const zip = new AdmZip(kmzBuffer);
            const entries = zip.getEntries();
            const kmlEntry = entries.find(e => e.entryName.toLowerCase().endsWith(".kml"));
            if (!kmlEntry) throw new Error("KML Document fehlt");
            const xml = kmlEntry.getData().toString("utf-8");
            return xml;
        }

        function findStationName(kml) {
            // Try Placemark.name or Document.name/description, or ExtendedData/ProductDefinition
            try {
                const doc = kml.Document || {};
                const placemark = doc.Placemark || {};
                const name = placemark.name || doc.name || null;
                if (name) return String(name);
                // fallback: description might contain station name
                if (placemark.description) return String(placemark.description).replace(/<[^>]+>/g, "").trim();
                if (doc.description) return String(doc.description).replace(/<[^>]+>/g, "").trim();
            } catch (_) {}
            return null;
        }

        function toTS(iso) {
            const t = Date.parse(iso);
            return Number.isFinite(t) ? t : null;
        }

        function mmPerHourFromParams(rec) {
            // Many MOSMIX elements exist; we already mapped a generic 'precipitation' when available (RR*).
            // If not present, returns null.
            if (typeof rec.precipitation === "number") return rec.precipitation;
            return null;
        }

        function humanPrecip(precipMmH) {
            if (precipMmH == null) return null;
            if (precipMmH <= 0.0) return "kein Niederschlag";
            if (precipMmH < 0.1) return `sehr leichter Niederschlag – ${precipMmH.toFixed(1)} mm/h`;
            if (precipMmH < 0.5) return `Niesel/leichter Niederschlag – ${precipMmH.toFixed(1)} mm/h`;
            if (precipMmH < 2.0) return `Regen (leicht) – ${precipMmH.toFixed(1)} mm/h`;
            if (precipMmH < 6.0) return `Regen (mäßig) – ${precipMmH.toFixed(1)} mm/h`;
            if (precipMmH < 10.0) return `Regen (stark) – ${precipMmH.toFixed(1)} mm/h`;
            return `starker Niederschlag – ${precipMmH.toFixed(1)} mm/h`;
        }

        function normalizeMOSMIX(kml) {
            // KML structure (namespaces omitted via xml2js options):
            // kml -> Document -> ExtendedData (ProductDefinition, ForecastTimeSteps, Forecast) + Placemark (parameters)
            const root = kml.kml || kml;
            const doc = root.Document;
            if (!doc) throw new Error("ProductDefinition fehlt (Document)");

            const ext = doc.ExtendedData || {};
            const prod =
                ext.ProductDefinition ||
                ext["dwd:ProductDefinition"] ||
                ext.dwdProductDefinition ||
                ext;
            const fts = doc.ForecastTimeSteps || ext.ForecastTimeSteps || ext["dwd:ForecastTimeSteps"] || null;
            if (!fts || !fts.TimeStep) throw new Error("ForecastTimeSteps fehlt");
            const timeSteps = Array.isArray(fts.TimeStep) ? fts.TimeStep : [fts.TimeStep];

            const placemark = doc.Placemark || {};
            const forecast = placemark.Forecast || placemark["dwd:Forecast"] || {};
            const elements = Array.isArray(forecast) ? forecast : [forecast];

            // Build time-indexed map and merge params
            const recordsByIso = Object.create(null);
            timeSteps.forEach(iso => {
                recordsByIso[iso] = {
                    ts: toTS(iso),
                    iso,
                    // core (common fields we already produced previously)
                    pressure: null,        // PPP/PPPP
                    temperature: null,     // TTT
                    Td: null,              // Td
                    windDir: null,         // DD
                    windSpeed: null,       // FF (m/s)
                    precipitation: null,   // RR (mm/h) if present
                    visibility: null,      // VV (m)
                    // … many more params will be merged below as we find them
                };
            });

            // Helper to set value into the record only when time index aligns
            function applySeries(paramName, values) {
                if (!values || !Array.isArray(values)) return;
                values.forEach((v, idx) => {
                    const iso = timeSteps[idx];
                    if (!iso || !(iso in recordsByIso)) return;
                    const rec = recordsByIso[iso];
                    switch (paramName) {
                        case "TTT": rec.temperature = Number(v); break;             // K
                        case "Td":  rec.Td = Number(v); break;                      // K
                        case "PPP":
                        case "PPPP":
                            rec.pressure = Number(v) * 1000;                          // hPa->Pa if PPP given; MOSMIX often uses hPa in some variants.
                            break;
                        case "DD":  rec.windDir = Number(v); break;                 // degrees
                        case "FF":  rec.windSpeed = Number(v); break;               // m/s
                        case "VV":  rec.visibility = Number(v); break;              // meters
                        case "RR":  // unified precip rate if directly provided
                        case "RR1c":
                        case "RRL1c":
                            // prefer highest resolution if multiple are present
                            if (rec.precipitation == null) rec.precipitation = Number(v) || 0;
                            break;
                        default:
                            // keep full element as well (non-core) to not lose information
                            if (v == null || v === "") return;
                            rec[paramName] = (Number.isFinite(Number(v)) ? Number(v) : v);
                    }
                });
            }

            // Each element should look like: { name: 'TTT', value: [array aligned with timeSteps] } depending on how xml2js mergedAttrs
            // Our earlier parser used mergeAttrs:true; keep same:
            elements.forEach(el => {
                if (!el || typeof el !== "object") return;
                const name = el.name || el["@name"] || el["name"];
                // Values can be in el.value or el.Data or el.timeSeries etc. Our previous mapping stored under "value"
                let vals = el.value || el.timeSeries || el.values || el.Data || null;
                if (vals == null) {
                    // Some MOSMIX put them in el["dwd:value"]
                    vals = el["dwd:value"] || null;
                }
                if (typeof vals === "string") {
                    // space-separated
                    vals = vals.trim().split(/\s+/);
                }
                if (!Array.isArray(vals)) return;
                applySeries(String(name || "").trim(), vals);
            });

            // Convert to array sorted by time
            const out = Object.values(recordsByIso)
                .filter(r => r.ts != null)
                .sort((a, b) => a.ts - b.ts);

            // precipitationText if requested later
            return {
                records: out,
                document: doc
            };
        }

        function addComputedFields(records) {
            if (!node.computePrecipText) return;
            records.forEach(rec => {
                const mmh = mmPerHourFromParams(rec);
                rec.precipitationText = humanPrecip(mmh);
            });
        }

        function filterByOptions(records) {
            // The node previously offered toggles to include extra fields.
            // Core are temperature, Td, precipitation; pressure/wind/visibility are gated by checkboxes.
            if (node.includePressure && node.includeWind && node.includeVisibility) return records; // nothing to do

            return records.map(r => {
                const keep = {
                    ts: r.ts, iso: r.iso,
                    temperature: r.temperature,
                    Td: r.Td,
                    precipitation: r.precipitation,
                    precipitationText: r.precipitationText
                };
                if (node.includePressure) keep.pressure = r.pressure;
                if (node.includeWind) { keep.windDir = r.windDir; keep.windSpeed = r.windSpeed; }
                if (node.includeVisibility) keep.visibility = r.visibility;

                return keep;
            });
        }

        async function runOnce(msg, fromTimer = false) {
            try {
                node.status({});
                const url = buildUrl(node.stationId);
                const kmz = await fetchKmz(url, node.timeoutMs);
                const kmlXml = unzipKml(kmz);

                const kml = await xml2js.parseStringPromise(kmlXml, {
                    explicitArray: false,
                    mergeAttrs: true,
                    normalizeTags: false,
                    normalize: false,
                    trim: true
                });

                const norm = normalizeMOSMIX(kml);
                addComputedFields(norm.records);
                const pruned = filterByOptions(norm.records);

                const stationName = findStationName(kml) || null;

                const out = {
                    payload: pruned,
                    station: { id: node.stationId, name: stationName },
                    _meta: {
                        url: buildUrl(node.stationId),
                        count: pruned.length,
                        stale: false,
                        fetchedAt: new Date().toISOString(),
                        fromTimer
                    }
                };

                lastGood = out;
                node.send(out);
                statusOK(`${pruned.length} rows`);

            } catch (err) {
                const msgText = (err && err.message) ? err.message : String(err);
                statusWarn(`DWD-Forecast Fehler: ${msgText}`);

                if (node.allowStale && lastGood) {
                    const stale = Object.assign({}, lastGood, {
                        _meta: { ...(lastGood._meta || {}), stale: true, error: msgText, deliveredAt: new Date().toISOString() }
                    });
                    node.send(stale);
                } else {
                    node.send({
                        payload: [],
                        station: { id: node.stationId, name: null },
                        _meta: {
                            url: buildUrl(node.stationId),
                            count: 0,
                            stale: false,
                            error: msgText,
                            fetchedAt: new Date().toISOString()
                        }
                    });
                }
            }
        }

        function schedule() {
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            const sec = Number(node.autoRefreshSec || 0);
            if (sec > 0) {
                pollTimer = setInterval(() => runOnce({}, true), sec * 1000);
            }
        }

        node.on("input", function (msg) {
            runOnce(msg, false);
        });

        node.on("close", function () {
            if (pollTimer) clearInterval(pollTimer);
        });

        // init
        schedule();
        if (node.immediateFetch) {
            setTimeout(() => runOnce({}, false), 200);
        } else {
            statusOK("bereit");
        }
    }

    RED.nodes.registerType("dwd-weatherforecast", DwdWeatherForecastNode);
};