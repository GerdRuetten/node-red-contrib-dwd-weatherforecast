// nodes/forecast.js – DWD MOSMIX_L Forecast Node (single_stations only)
//
// Features
// • MOSMIX_L (single_stations) – MOSMIX_S NICHT verwendet
// • Run-on-Deploy & Auto-Refresh
// • Stale-Fallback (liefert letzte gute Daten bei Fehler)
// • Filter: nur Zukunft & Stundenlimit
// • Einheiten: °C, hPa, km/h, Sichtweite in km
// • Kernfelder-Output (coreOnly)
// • RELH-Fallback aus T (TTT) & Td (Taupunkt)
// • precipitationText = Intensität + Typ + „– <mm/h>“
//
// Abhängigkeiten:
//   npm install --no-fund --no-audit request adm-zip xml2js moment-timezone
//
const request = require('request');
const AdmZip = require('adm-zip');
const { parseString } = require('xml2js');
const moment = require('moment-timezone');
moment.tz.setDefault('Europe/Berlin');

module.exports = function (RED) {

    // ────────────────────────────────────────────────────────────────────────────
    // Hilfsfunktionen
    // ────────────────────────────────────────────────────────────────────────────

    function classifyPrecipTypeFromWw(wwCode) {
        const ww = Number(wwCode);
        if (!Number.isFinite(ww)) return null;
        if (ww >= 45 && ww <= 49) return 'Nebel/Niesel';
        if (ww >= 50 && ww <= 55) return 'Nieselregen';
        if (ww >= 56 && ww <= 59) return 'Regen';
        if (ww === 66 || ww === 67) return 'gefrierender Regen';
        if (ww === 68 || ww === 69) return 'gefrierender Niesel';
        if (ww >= 60 && ww <= 65) return 'Regen';
        if (ww >= 70 && ww <= 79) return 'Schnee';
        if (ww >= 80 && ww <= 82) return 'Regenschauer';
        if (ww >= 83 && ww <= 84) return 'Schneeregenschauer';
        if (ww >= 85 && ww <= 86) return 'Schneeschauer';
        if (ww >= 87 && ww <= 89) return 'Graupel/Hagelschauer';
        if (ww >= 95 && ww <= 99) return 'Gewitter';
        if (ww >= 90 && ww <= 94) return 'Schauer';
        return null;
    }

    function classifyIntensity(mmPerHour) {
        if (mmPerHour == null) return null;
        const v = Number(mmPerHour);
        if (!Number.isFinite(v) || v <= 0) return 'kein';
        if (v <= 0.2)  return 'Spuren';
        if (v <= 1.0)  return 'leicht';
        if (v <= 5.0)  return 'mäßig';
        if (v <= 15.0) return 'kräftig';
        return 'stark';
    }

    // Baut IMMER mit Menge, sobald > 0; sonst „kein Niederschlag“
    function buildPrecipitationText(precip, wwCode) {
        const amount = Number(precip);
        const type = classifyPrecipTypeFromWw(wwCode) || 'Niederschlag';
        const intensity = classifyIntensity(amount);

        if (!Number.isFinite(amount) || amount <= 0 || intensity === 'kein') {
            return 'kein Niederschlag';
        }
        // Formulierungen für bekannte Typen
        let label = type;
        if (type === 'Nebel/Niesel') label = 'Nebel/Niesel';
        if (type === 'gefrierender Regen') label = 'gefrierender Regen';

        // z. B. „Regen (leicht) – 0.3 mm/h“
        return `${label} (${intensity}) – ${amount.toFixed(1)} mm/h`;
    }

    // ────────────────────────────────────────────────────────────────────────────

    class DwdForecastNode {
        constructor(config) {
            RED.nodes.createNode(this, config);

            // Konfiguration
            this.name       = config.name || "";
            this.station    = String(config.station || "").trim().toUpperCase();
            this.sourceUrl  = (config.sourceUrl || "https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/{station}/kml/MOSMIX_L_LATEST_{station}.kmz").trim();

            // Laufzeit / Fallback
            this.runOnDeploy        = !!config.runOnDeploy;
            this.autoRefreshSeconds = Math.max(0, Number(config.autoRefreshSeconds || 0));
            this.allowStale         = !!config.allowStale;

            // Filter
            this.onlyFuture = !!config.onlyFuture;
            this.hoursLimit = Math.max(0, Number(config.hoursLimit || 0));

            // Ausgabe-Optionen
            this.outputCelsius      = !!config.outputCelsius;
            this.outputHectoPascal  = !!config.outputHectoPascal;  // Druck
            this.outputWindKmh      = !!config.outputWindKmh;      // Wind
            this.outputVisibilityKm = !!config.outputVisibilityKm; // Sichtweite
            this.coreOnly           = !!config.coreOnly;

            // State
            this._ctx = this.context();
            this._lastGood = this._ctx.get('lastForecast') || null;
            this._interval = null;
            this._loggedElementsOnce = false;

            // Events
            this.on('input', (msg, send, done) => this.fetchOnce(msg, send, done));
            if (this.runOnDeploy) setTimeout(() => this.fetchOnce({}, null, () => {}), 500);
            if (this.autoRefreshSeconds > 0) {
                this._interval = setInterval(() => this.fetchOnce({}, null, () => {}), this.autoRefreshSeconds * 1000);
            }
            this.on('close', () => { if (this._interval) clearInterval(this._interval); });
        }

        _buildUrl(station, msg) {
            let tpl = (msg && msg.sourceUrl ? String(msg.sourceUrl) : this.sourceUrl).trim();
            return tpl.replace(/{station}/g, encodeURIComponent(station));
        }

        _empty(url, err) {
            return { payload: [], _meta: { url, error: err } };
        }

        _fail(err, url, send, done) {
            this.status({ fill:'red', shape:'ring', text: err.message });
            this.error(`DWD-Forecast Fehler: ${err.message}`);
            if (this.allowStale && this._lastGood) {
                const stale = JSON.parse(JSON.stringify(this._lastGood));
                stale._meta = stale._meta || {};
                stale._meta.stale = true;
                if (url) stale._meta.url = url;
                send(stale);
            } else {
                send(this._empty(url, err.message));
            }
            done();
        }

        fetchOnce(msg, send, done) {
            send = send || this.send.bind(this);
            done = done || ((err)=>{ if (err) this.error(err); });

            const station = String(msg?.station || this.station || "").trim().toUpperCase();
            if (!station) {
                this.status({ fill:'red', shape:'ring', text:'Station fehlt' });
                send(this._empty(null, 'no_station'));
                return done();
            }

            const url = this._buildUrl(station, msg);
            this.status({ fill:'blue', shape:'dot', text:`Abruf MOSMIX_L…` });

            request({ url, timeout: 20000, encoding: null }, (err, res, body) => {
                if (err) return this._fail(err, url, send, done);
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return this._fail(new Error(`HTTP ${res.statusCode}`), url, send, done);
                }

                let kmlText;
                try {
                    const zip = new AdmZip(body);
                    const entry = zip.getEntries().find(e => /\.kml$/i.test(e.entryName));
                    if (!entry) throw new Error('Keine .kml im KMZ gefunden');
                    kmlText = entry.getData().toString('utf8');
                } catch (e) {
                    return this._fail(e, url, send, done);
                }

                const stripNS = (name) => String(name).replace(/^.*:/, '');
                parseString(
                    kmlText,
                    { explicitArray: true, trim: true, mergeAttrs: true, tagNameProcessors: [stripNS], attrNameProcessors: [stripNS] },
                    (perr, kml) => {
                        if (perr) return this._fail(perr, url, send, done);

                        try {
                            const out = this._parseMosmixL(kml);
                            let rows = out.payload || [];

                            // Filter
                            const now = Date.now();
                            if (this.onlyFuture) rows = rows.filter(r => r.ts >= now);
                            if (this.hoursLimit > 0) {
                                const until = now + this.hoursLimit * 3600000;
                                rows = rows.filter(r => r.ts <= until);
                            }

                            // Einheiten
                            rows = rows.map(r => {
                                const rr = { ...r };
                                if (this.outputCelsius && rr.temperature != null) {
                                    const c = +(rr.temperature - 273.15).toFixed(2);
                                    if (!this.coreOnly) rr.temperature_k = rr.temperature;
                                    rr.temperature = c;
                                }
                                if (this.outputHectoPascal && rr.pressure != null) {
                                    const hpa = +(rr.pressure / 100).toFixed(1);
                                    if (!this.coreOnly) rr.pressure_pa = rr.pressure;
                                    rr.pressure = hpa;
                                }
                                if (this.outputWindKmh && rr.windSpeed != null) {
                                    const kmh = +(rr.windSpeed * 3.6).toFixed(1);
                                    if (!this.coreOnly) rr.wind_ms = rr.windSpeed;
                                    rr.windSpeed = kmh;
                                }
                                if (this.outputVisibilityKm && rr.visibility != null) {
                                    const km = +(rr.visibility / 1000).toFixed(1);
                                    if (!this.coreOnly) rr.visibility_m = rr.visibility;
                                    rr.visibility = km;
                                }

                                // Berechneter Niederschlagstext MIT Menge
                                rr.precipitationText = buildPrecipitationText(rr.precipitation, rr.condition);

                                return rr;
                            });

                            // Kernfelder
                            if (this.coreOnly) {
                                rows = rows.map(r => ({
                                    ts: r.ts, iso: r.iso,
                                    temperature: r.temperature ?? null,
                                    windSpeed: r.windSpeed ?? null,
                                    windDir: r.windDir ?? null,
                                    precipitation: r.precipitation ?? null,
                                    precipitationText: r.precipitationText ?? null,
                                    cloudCover: r.cloudCover ?? null,
                                    condition: r.condition ?? null,
                                    pressure: r.pressure ?? null,
                                    relHumidity: r.relHumidity ?? null,
                                    visibility: r.visibility ?? null
                                }));
                            }

                            const msgOut = {
                                payload: rows,
                                station: out.station,   // { id, name }
                                _meta: {
                                    url,
                                    count: rows.length,
                                    stale: false,
                                    outputCelsius: this.outputCelsius,
                                    outputHectoPascal: this.outputHectoPascal,
                                    outputWindKmh: this.outputWindKmh,
                                    outputVisibilityKm: this.outputVisibilityKm,
                                    coreOnly: this.coreOnly
                                }
                            };

                            send(msgOut);
                            this._lastGood = msgOut;
                            this._ctx.set('lastForecast', msgOut);
                            this.status({ fill:'green', shape:'dot', text:`OK (L) ${rows.length} Punkte` });
                            done();
                        } catch (e) {
                            this._fail(e, url, send, done);
                        }
                    }
                );
            });
        }

        // Parser für MOSMIX_L (single_stations)
        _parseMosmixL(kml) {
            const root = kml.kml?.[0] || kml.kml || kml;
            const doc = root.Document?.[0];
            if (!doc) throw new Error('Document fehlt');

            const extDoc = doc.ExtendedData?.[0];
            if (!extDoc) throw new Error('Document/ExtendedData fehlt');

            const prod = extDoc.ProductDefinition?.[0];
            if (!prod) throw new Error('ProductDefinition fehlt');

            const fts = prod.ForecastTimeSteps?.[0];
            if (!fts) throw new Error('ForecastTimeSteps fehlt');

            // Zeitachsen lesen
            let timeSteps = [];
            if (Array.isArray(fts.TimeStep) && fts.TimeStep.length) {
                timeSteps = fts.TimeStep
                    .map(s => (typeof s === 'object' && s._ != null) ? String(s._).trim()
                        : (typeof s === 'string' ? s.trim() : ''))
                    .filter(Boolean);
            } else if (fts._) {
                timeSteps = String(fts._).trim().split(/\s+/).filter(Boolean);
            }
            if (!timeSteps.length) throw new Error('Keine ForecastTimeSteps gefunden');

            // Placemark (eine Station)
            const placemarks = Array.isArray(doc.Placemark) ? doc.Placemark : (doc.Placemark ? [doc.Placemark] : []);
            if (!placemarks.length) throw new Error('Placemark fehlt');
            const placemark = placemarks[0];

            // Station-Metadaten
            const station = {};
            if (placemark.name?.[0]) station.id = String(placemark.name[0]).trim();
            if (placemark.description?.[0]) {
                const raw = String(placemark.description[0]).trim();
                const m = raw.match(/Station:\s*([^<(]+)/i);
                station.name = (m ? m[1] : raw).trim();
            } else {
                station.name = station.id || '';
            }

            const pmExt = placemark.ExtendedData?.[0];
            if (!pmExt) throw new Error('Placemark/ExtendedData fehlt');

            const forecasts = Array.isArray(pmExt.Forecast) ? pmExt.Forecast : [];
            if (!forecasts.length) throw new Error('Keine Forecast Einträge gefunden');

            // Serienspeicher
            const seriesByElement = {};
            for (const fc of forecasts) {
                const el = fc.elementName || (fc.$ && fc.$.elementName);
                if (!el) continue;
                const raw = (fc.value?.[0]?._ != null) ? fc.value[0]._ :
                    (typeof fc.value?.[0] === 'string' ? fc.value[0] : '');
                const values = String(raw || '')
                    .trim().split(/\s+/).filter(Boolean)
                    .map(v => (v === 'NaN' ? null : Number(v)));
                seriesByElement[el] = values;
            }

            // Einmalig die verfügbaren Elemente loggen
            if (!this._loggedElementsOnce) {
                this._loggedElementsOnce = true;
                try {
                    this.warn(`[DWD-Forecast] Verfügbare Elemente: ${Object.keys(seriesByElement).sort().join(', ')}`);
                } catch (_) {}
            }

            // Zusammenführen pro Zeitschritt
            const rows = [];
            for (let i = 0; i < timeSteps.length; i++) {
                const ts = Date.parse(timeSteps[i]);
                if (!Number.isFinite(ts)) continue;

                const rec = { ts, iso: new Date(ts).toISOString() };

                for (const el of Object.keys(seriesByElement)) {
                    const v = seriesByElement[el][i];
                    switch (el) {
                        case 'TTT':   rec.temperature   = v; break;     // Kelvin
                        case 'Td':    rec.dewPoint      = v; break;     // Kelvin
                        case 'FF':    rec.windSpeed     = v; break;     // m/s
                        case 'DD':    rec.windDir       = v; break;     // °
                        case 'PPPP':  rec.pressure      = v; break;     // Pa
                        case 'N':     rec.cloudCover    = v; break;     // %
                        case 'VV':    rec.visibility    = v; break;     // m
                        case 'RR1c':
                        case 'RRL1':
                        case 'RR':
                        case 'RR_1h':
                        case 'RRc':   rec.precipitation = v; break;     // mm/1h
                        case 'ww':    rec.condition     = (v == null ? null : String(v)); break;
                        case 'RELH':  rec.relHumidity   = v; break;     // %
                        default:      rec[el]           = v; break;     // weitere Elemente mitgeben
                    }
                }

                // RELH-Fallback (Magnus/Tetens), falls nicht vorhanden
                if (rec.relHumidity == null && rec.temperature != null && rec.dewPoint != null) {
                    const T  = rec.temperature - 273.15; // °C
                    const Td = rec.dewPoint   - 273.15;  // °C
                    const a = 17.625, b = 243.04;
                    const gammaT  = (a * T)  / (b + T);
                    const gammaTd = (a * Td) / (b + Td);
                    let rh = 100 * Math.exp(gammaTd - gammaT);
                    if (Number.isFinite(rh)) {
                        rh = Math.max(0, Math.min(100, rh));
                        rec.relHumidity = +rh.toFixed(0);
                    }
                }

                rows.push(rec);
            }

            rows.sort((a,b)=>a.ts-b.ts);
            return { payload: rows, station };
        }
    }

    RED.nodes.registerType('dwd-weatherforecast', DwdForecastNode);
};
