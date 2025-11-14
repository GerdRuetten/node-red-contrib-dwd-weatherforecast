module.exports = function (RED) {
    "use strict";
    const axios = require("axios");
    const AdmZip = require("adm-zip");
    const { parseStringPromise } = require("xml2js");
    const moment = require("moment-timezone");

    const DEFAULT_URL_TEMPLATE =
        "https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/{station}/kml/MOSMIX_L_LATEST_{station}.kmz";

    // -------- utils ----------
    const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
    const safeNumber = (x) => {
        if (x == null) return null;
        const n = Number(String(x).trim());
        return Number.isFinite(n) ? n : null;
    };
    const toC = (k) => (k == null ? null : k - 273.15);
    const toKmh = (ms) => (ms == null ? null : ms * 3.6);
    const toHpa = (pa) => (pa == null ? null : pa / 100);
    const toKm = (m) => (m == null ? null : m / 1000);

    const endsWithAny = (key, names) => names.some((n) => key === n || key.endsWith(":" + n));

    // ---- KML helpers ----
    function getKmlRoot(tree) {
        if (!tree || typeof tree !== "object") return tree;
        if (tree.kml && Array.isArray(tree.kml)) return tree.kml[0];
        if (tree["kml:kml"] && Array.isArray(tree["kml:kml"])) return tree["kml:kml"][0];
        return tree;
    }

    function findFirstDocumentNode(obj) {
        const stack = [obj];
        while (stack.length) {
            const cur = stack.pop();
            if (!cur || typeof cur !== "object") continue;
            for (const [key, val] of Object.entries(cur)) {
                if (endsWithAny(key, ["Document"])) {
                    const arr = asArray(val);
                    if (arr.length && typeof arr[0] === "object") return arr[0];
                }
                if (val && typeof val === "object") {
                    if (Array.isArray(val)) stack.push(...val);
                    else stack.push(val);
                }
            }
        }
        return null;
    }

    // sammelt Strings aus allen *TimeStep*-Knoten (Namespace-agnostisch)
    function collectTimeStepStrings(obj, hits = []) {
        if (!obj || typeof obj !== "object") return hits;
        for (const [key, val] of Object.entries(obj)) {
            if (endsWithAny(key, ["TimeStep"])) {
                for (const v of asArray(val)) {
                    if (typeof v === "string") hits.push(v);
                    else if (v && typeof v._ === "string") hits.push(v._);
                    else if (v && typeof v.value === "string") hits.push(v.value);
                    else if (v) collectTimeStepStrings(v, hits);
                }
            } else if (val && typeof val === "object") {
                collectTimeStepStrings(val, hits);
            }
        }
        return hits;
    }

    // Fallback: gx:Track/when
    function collectTrackWhenStrings(obj, hits = []) {
        if (!obj || typeof obj !== "object") return hits;
        for (const [key, val] of Object.entries(obj)) {
            if (endsWithAny(key, ["Track"])) {
                for (const tr of asArray(val)) {
                    const whenArr = tr && tr.when;
                    if (whenArr) {
                        for (const w of asArray(whenArr)) {
                            if (typeof w === "string") hits.push(w);
                            else if (w && typeof w._ === "string") hits.push(w._);
                            else if (w && typeof w.value === "string") hits.push(w.value);
                        }
                    }
                }
            } else if (val && typeof val === "object") {
                collectTrackWhenStrings(val, hits);
            }
        }
        return hits;
    }

    // Station-Name (Placemark > name / kml:name / description fallback)
    function tryGetStationName(document) {
        const asArr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
        const looksLikeId = (s) => /^[A-Z]\d{3,4}$/i.test(String(s).trim());

        const placemarks = []
            .concat(asArr(document && document.Placemark))
            .concat(asArr(document && document["kml:Placemark"]));
        if (!placemarks.length) return null;

        const pm = placemarks[0];

        const pickDeepName = (obj) => {
            const stack = [obj];
            while (stack.length) {
                const cur = stack.pop();
                if (!cur || typeof cur !== "object") continue;

                for (const [k, v] of Object.entries(cur)) {
                    const isNameKey = k === "name" || /:name$/i.test(k);
                    if (isNameKey) {
                        const arr = asArr(v);
                        for (const a of arr) {
                            if (typeof a === "string" && a.trim()) {
                                const s = a.trim();
                                if (!looksLikeId(s)) return s;
                            } else if (a && typeof a._ === "string" && a._.trim()) {
                                const s = a._.trim();
                                if (!looksLikeId(s)) return s;
                            } else if (a && typeof a.value === "string" && a.value.trim()) {
                                const s = a.value.trim();
                                if (!looksLikeId(s)) return s;
                            }
                        }
                    }
                    if (Array.isArray(v)) stack.push(...v);
                    else if (v && typeof v === "object") stack.push(v);
                }
            }
            return null;
        };

        let name = pickDeepName(pm);
        if (name) return name;

        const pickText = (node, key) => {
            const arr = asArr(node && node[key]);
            if (!arr.length) return null;
            const raw = arr[0];
            if (typeof raw === "string") return raw.trim();
            if (raw && typeof raw._ === "string") return raw._.trim();
            if (raw && typeof raw.value === "string") return raw.value.trim();
            return null;
        };

        const desc =
            pickText(pm, "kml:description") ||
            pickText(pm, "description");

        if (desc) {
            const plain = desc.replace(/<[^>]*>/g, "").trim();
            const m = plain.match(/^(.+?)\s*\([A-Z0-9]{3,4}\)\s*$/i);
            if (m && m[1] && !looksLikeId(m[1])) return m[1].trim();
            const first = plain.split(/[\r\n]/)[0].trim();
            if (first && !looksLikeId(first)) return first;
        }

        return null;
    }

    // ---- Parameter-Extraktionen (A–D) ----
    function extractParamsFromSchemaData(document, diagFn) {
        const params = {};
        if (!document) return params;

        function collectAllExtendedData(obj) {
            let result = []
                .concat(asArray(obj.ExtendedData))
                .concat(asArray(obj["kml:ExtendedData"]))
                .concat(asArray(obj["dwd:ExtendedData"]));
            const placemarks = []
                .concat(asArray(obj.Placemark))
                .concat(asArray(obj["kml:Placemark"]));
            for (const pm of placemarks) {
                if (!pm) continue;
                result = result.concat(
                    asArray(pm.ExtendedData),
                    asArray(pm["kml:ExtendedData"]),
                    asArray(pm["dwd:ExtendedData"])
                );
            }
            return result.filter(Boolean);
        }

        const ext = collectAllExtendedData(document);
        const simpleArrayNodes = [];

        const pushIfSimpleArray = (obj) => {
            if (!obj || typeof obj !== "object") return;
            for (const [key, val] of Object.entries(obj)) {
                if (endsWithAny(key, ["SimpleArrayData"])) {
                    for (const sad of asArray(val)) simpleArrayNodes.push(sad);
                } else if (val && typeof val === "object") {
                    if (Array.isArray(val)) val.forEach(pushIfSimpleArray);
                    else pushIfSimpleArray(val);
                }
            }
        };

        for (const e of ext) {
            if (!e) continue;
            pushIfSimpleArray(e);
            const schemas = []
                .concat(asArray(e.SchemaData))
                .concat(asArray(e["kml:SchemaData"]))
                .concat(asArray(e["dwd:SchemaData"]));
            for (const s of schemas) pushIfSimpleArray(s);
        }

        for (const node of simpleArrayNodes) {
            const code = (node.name || node.id || node.parameterId || "").toString().trim();
            if (!code) continue;
            const unit = node.u || node.unit || null;

            const valueStrings = [];
            for (const [k, v] of Object.entries(node)) {
                if (endsWithAny(k, ["value"])) {
                    for (const one of asArray(v)) {
                        if (typeof one === "string") valueStrings.push(one);
                        else if (one && typeof one._ === "string") valueStrings.push(one._);
                    }
                }
            }
            if (!valueStrings.length) continue;

            const numbers = valueStrings
                .join(" ")
                .trim()
                .split(/\s+/)
                .map((s) => safeNumber(s));

            if (numbers.length) {
                params[code] = { code, unit, values: numbers };
            }
        }

        if (diagFn) diagFn(`[DWD-Forecast] gefundene Parameter (SchemaData inkl. Placemark): ${Object.keys(params).length}`);
        return params;
    }

    function extractParamsFromForecast(document, diagFn) {
        const params = {};
        if (!document) return params;

        function collectAllExtendedData(obj) {
            let result = []
                .concat(asArray(obj.ExtendedData))
                .concat(asArray(obj["kml:ExtendedData"]))
                .concat(asArray(obj["dwd:ExtendedData"]));
            const placemarks = []
                .concat(asArray(obj.Placemark))
                .concat(asArray(obj["kml:Placemark"]));
            for (const pm of placemarks) {
                if (!pm) continue;
                result = result.concat(
                    asArray(pm.ExtendedData),
                    asArray(pm["kml:ExtendedData"]),
                    asArray(pm["dwd:ExtendedData"])
                );
            }
            return result.filter(Boolean);
        }

        const extArr = collectAllExtendedData(document);

        let ts0 = null;
        for (const ext of extArr) {
            if (!ext) continue;
            const fc = ext["dwd:Forecast"] || ext.Forecast;
            const fc0 = asArray(fc)[0];
            const tss = fc0 && (fc0["dwd:TimeSeries"] || fc0.TimeSeries);
            ts0 = asArray(tss)[0];
            if (ts0) break;
        }

        if (!ts0) {
            if (diagFn) diagFn("[DWD-Forecast] Forecast/TimeSeries nicht gefunden (ok, wenn SchemaData vorhanden).");
            return params;
        }

        const keys = Object.keys(ts0).filter((k) => endsWithAny(k, ["Parameter"]));
        for (const k of keys) {
            for (const p of asArray(ts0[k])) {
                const code = (p.id || p.name || "").toString().trim();
                if (!code) continue;
                const unit = p.unit || p.u || null;
                const values = [];

                const vNode =
                    p["dwd:values"] ||
                    p.values ||
                    p["dwd:value"] ||
                    p.value;
                if (vNode) {
                    for (const vv of asArray(vNode)) {
                        if (typeof vv === "string") {
                            values.push(...String(vv).trim().split(/\s+/).map(safeNumber));
                        } else if (vv && typeof vv._ === "string") {
                            values.push(...String(vv._).trim().split(/\s+/).map(safeNumber));
                        } else if (vv && typeof vv.value === "string") {
                            values.push(...String(vv.value).trim().split(/\s+/).map(safeNumber));
                        }
                    }
                }
                if (values.length) params[code] = { code, unit, values };
            }
        }

        if (diagFn) diagFn(`[DWD-Forecast] gefundene Parameter (XML inkl. Placemark): ${Object.keys(params).length}`);
        return params;
    }

    // B2: dwd:Forecast (Attribut dwd:elementName + <dwd:value>…)
    function extractParamsFromDwdForecast(document, diagFn) {
        const params = {};
        if (!document) return params;

        function collectAllExtendedData(obj) {
            let result = []
                .concat(asArray(obj.ExtendedData))
                .concat(asArray(obj["kml:ExtendedData"]))
                .concat(asArray(obj["dwd:ExtendedData"]));
            const placemarks = []
                .concat(asArray(obj.Placemark))
                .concat(asArray(obj["kml:Placemark"]));
            for (const pm of placemarks) {
                if (!pm) continue;
                result = result.concat(
                    asArray(pm.ExtendedData),
                    asArray(pm["kml:ExtendedData"]),
                    asArray(pm["dwd:ExtendedData"])
                );
            }
            return result.filter(Boolean);
        }

        const allExt = collectAllExtendedData(document);
        let found = 0;

        function attrOf(node, names) {
            for (const name of names) {
                const v = node && node[name];
                if (typeof v === "string") return v.trim();
                if (Array.isArray(v) && typeof v[0] === "string") return v[0].trim();
            }
            return null;
        }

        function textBlocks(node, names) {
            const out = [];
            for (const name of names) {
                const arr = asArray(node && (node[name] || node[`dwd:${name}`] || node[`kml:${name}`]));
                for (const it of arr) {
                    if (typeof it === "string") out.push(it);
                    else if (it && typeof it._ === "string") out.push(it._);
                }
            }
            return out;
        }

        function harvestForecast(obj) {
            if (!obj || typeof obj !== "object") return;
            for (const [key, val] of Object.entries(obj)) {
                if (endsWithAny(key, ["Forecast"])) {
                    for (const fc of asArray(val)) {
                        let code =
                            attrOf(fc, ["dwd:elementName", "elementName", "name", "id"]) ||
                            null;
                        if (!code) {
                            const tn = textBlocks(fc, ["elementName", "name", "id"]);
                            if (tn.length) code = tn[0].trim();
                        }
                        if (!code) continue;

                        const blocks = []
                            .concat(textBlocks(fc, ["value"]))
                            .concat(textBlocks(fc, ["values"]));

                        const numbers = blocks
                            .join(" ")
                            .trim()
                            .split(/\s+/)
                            .map(safeNumber)
                            .filter((n) => n != null);

                        if (numbers.length) {
                            params[code] = { code, unit: null, values: numbers };
                            found++;
                        }
                    }
                } else if (val && typeof val === "object") {
                    if (Array.isArray(val)) val.forEach(harvestForecast);
                    else harvestForecast(val);
                }
            }
        }

        for (const e of allExt) harvestForecast(e);

        if (diagFn) diagFn(`[DWD-Forecast] gefundene Parameter (dwd:Forecast attr+value): ${found}`);
        return params;
    }

    // C: Regex-Fallback
    function extractParamsByRegex(kmlStr, diagFn) {
        const params = {};
        if (!kmlStr || typeof kmlStr !== "string") return params;

        const simpleRe =
            /<[^>]*SimpleArrayData[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/[^>]*SimpleArrayData>/g;
        let m;
        while ((m = simpleRe.exec(kmlStr))) {
            const code = m[1].trim();
            const block = m[2];
            const values = [];
            const valRe = /<[^>]*value[^>]*>([\s\S]*?)<\/[^>]*value>/g;
            let mv;
            while ((mv = valRe.exec(block))) {
                const nums = mv[1].trim().split(/\s+/).map(safeNumber);
                values.push(...nums);
            }
            if (code && values.length) {
                params[code] = { code, unit: null, values };
            }
        }

        const paramRe =
            /<dwd:Parameter[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/dwd:Parameter>/g;
        while ((m = paramRe.exec(kmlStr))) {
            const code = m[1].trim();
            const block = m[2];
            const values = [];
            const vr = /<(?:dwd:)?values[^>]*>([\s\S]*?)<\/(?:dwd:)?values>/g;
            let mv;
            while ((mv = vr.exec(block))) {
                const nums = mv[1].trim().split(/\s+/).map(safeNumber);
                values.push(...nums);
            }
            if (code && values.length) {
                if (!params[code]) params[code] = { code, unit: null, values };
            }
        }

        const fcChildRe = /<dwd:Forecast\b[^>]*>([\s\S]*?)<\/dwd:Forecast>/gi;
        let mf;
        while ((mf = fcChildRe.exec(kmlStr))) {
            const block = mf[1];
            const nameM = block.match(/<dwd:elementName[^>]*>([\s\S]*?)<\/dwd:elementName>/i);
            const valuesM = block.match(/<(?:dwd:)?values[^>]*>([\s\S]*?)<\/(?:dwd:)?values>/i);
            if (!nameM || !valuesM) continue;
            const code = nameM[1].trim();
            const values = valuesM[1].trim().split(/\s+/).map(safeNumber);
            if (code && values.length && !params[code]) {
                params[code] = { code, unit: null, values };
            }
        }

        const fcAttrRe = /<dwd:Forecast\b[^>]*\bdwd:elementName="([^"]+)"[^>]*>([\s\S]*?)<\/dwd:Forecast>/gi;
        let mfa;
        while ((mfa = fcAttrRe.exec(kmlStr))) {
            const code = mfa[1].trim();
            const block = mfa[2];
            const values = [];
            const valTagRe = /<(?:dwd:)?value\b[^>]*>([\s\S]*?)<\/(?:dwd:)?value>/gi;
            let mv;
            while ((mv = valTagRe.exec(block))) {
                values.push(
                    ...mv[1].trim().split(/\s+/).map(safeNumber).filter((n) => n != null)
                );
            }
            if (code && values.length && !params[code]) {
                params[code] = { code, unit: null, values };
            }
        }

        if (diagFn) diagFn(`[DWD-Forecast] gefundene Parameter (Regex): ${Object.keys(params).length}`);
        return params;
    }

    // D: Generischer Tiefenscan
    function extractParamsByGenericWalk(root, diagFn) {
        const params = {};
        if (!root || typeof root !== "object") return params;

        const tryAdd = (obj) => {
            if (!obj || typeof obj !== "object") return false;

            let code =
                (typeof obj.name === "string" && obj.name.trim()) ||
                (typeof obj.id === "string" && obj.id.trim()) ||
                (typeof obj.elementName === "string" && obj.elementName.trim()) ||
                (typeof obj["dwd:elementName"] === "string" && obj["dwd:elementName"].trim()) ||
                null;

            if (!code) {
                if (obj.name && typeof obj.name === "object" && typeof obj.name._ === "string") code = obj.name._.trim();
                if (!code && obj.elementName && typeof obj.elementName === "object" && typeof obj.elementName._ === "string") code = obj.elementName._.trim();
                if (!code && obj["dwd:elementName"] && typeof obj["dwd:elementName"] === "object" && typeof obj["dwd:elementName"]._ === "string") code = obj["dwd:elementName"]._.trim();
            }

            const rawBlocks = [];
            for (const [k, v] of Object.entries(obj)) {
                if (/(^|:)values$/i.test(k) || /^value$/i.test(k) || /:value$/i.test(k)) {
                    for (const one of (Array.isArray(v) ? v : [v])) {
                        if (typeof one === "string") rawBlocks.push(one);
                        else if (one && typeof one._ === "string") rawBlocks.push(one._);
                    }
                }
            }

            if (code && rawBlocks.length) {
                const numbers = rawBlocks
                    .join(" ")
                    .trim()
                    .split(/\s+/)
                    .map((s) => {
                        const n = Number(String(s).trim());
                        return Number.isFinite(n) ? n : null;
                    })
                    .filter((n) => n !== null);

                if (numbers.length) {
                    if (!params[code]) params[code] = { code, unit: obj.u || obj.unit || null, values: [] };
                    params[code].values.push(...numbers);
                    return true;
                }
            }
            return false;
        };

        const stack = [root];
        while (stack.length) {
            const cur = stack.pop();
            if (!cur || typeof cur !== "object") continue;

            tryAdd(cur);

            for (const val of Object.values(cur)) {
                if (Array.isArray(val)) {
                    for (const it of val) stack.push(it);
                } else if (val && typeof val === "object") {
                    stack.push(val);
                }
            }
        }

        if (diagFn) diagFn(`[DWD-Forecast] gefundene Parameter (GenericWalk): ${Object.keys(params).length}`);
        return params;
    }

    // ---- Windrichtungs-Konvertierung ----
    // mode: "deg" | "8" | "16"  (Deutsch: O statt E)
    function dirToCardinal(deg, mode) {
        if (deg == null || !Number.isFinite(deg)) return null;
        const norm = ((deg % 360) + 360) % 360;

        if (mode === "8") {
            const names8 = ["N","NO","O","SO","S","SW","W","NW"];
            const idx = Math.round(norm / 45) % 8;
            return names8[idx];
        }
        if (mode === "16") {
            const names16 = ["N","NNO","NO","ONO","O","OSO","SO","SSO","S","SSW","SW","WSW","W","WNW","NW","NNW"];
            const idx = Math.round(norm / 22.5) % 16;
            return names16[idx];
        }
        return null; // "deg" -> kein Text
    }

    // ---- Normalisierung auf Records ----
    function normalizeRecords(timeSteps, params, cfg) {
        const getFirst = (codes, i) => {
            for (const code of codes) {
                const p = params[code];
                if (p && p.values[i] !== undefined) return p.values[i];
            }
            return null;
        };

        const KtoC = (k) => (k == null ? null : k - 273.15);
        const A = 17.625, B = 243.04;

        const out = [];
        for (let i = 0; i < timeSteps.length; i++) {
            const ts = timeSteps[i];
            const iso = new Date(ts).toISOString();

            const T_K   = getFirst(["TTT"], i);
            const Td_K  = getFirst(["Td"], i);
            let   RH    = getFirst(["rH","RELH"], i);

            let windSpeed   = getFirst(["FF"], i);
            let windDir     = getFirst(["DD"], i);
            let pressurePa  = getFirst(["PPPP"], i);
            let visibilityM = getFirst(["VV"], i);
            let cloudCover  = getFirst(["Neff","neff"], i);
            let precip      = getFirst(["RR1c","RR1o1"], i);

            if ((RH == null || !Number.isFinite(RH)) && T_K != null && Td_K != null) {
                const T_C  = KtoC(T_K);
                const Td_C = KtoC(Td_K);
                if (Number.isFinite(T_C) && Number.isFinite(Td_C)) {
                    const gamma = (xC) => (A * xC) / (B + xC);
                    const es  = Math.exp(gamma(T_C));
                    const e   = Math.exp(gamma(Td_C));
                    RH = Math.max(0, Math.min(100, 100 * (e / es)));
                }
            }

            let temperature = T_K;
            let pressure    = pressurePa;
            let visibility  = visibilityM;

            if (cfg.toC && temperature != null) temperature = +KtoC(temperature).toFixed(2);
            if (cfg.windToKmh && windSpeed != null) windSpeed = +toKmh(windSpeed).toFixed(2);
            if (cfg.pressureToHpa && pressure != null) pressure = Math.round(toHpa(pressure));
            if (cfg.visibilityToKm && visibility != null) visibility = +toKm(visibility).toFixed(1);

            const rec = {
                ts, iso,
                temperature: temperature ?? null,
                windSpeed: windSpeed ?? null,
                windDir: windDir ?? null,
                pressure: pressure ?? null,
                relHumidity: (RH != null && Number.isFinite(RH)) ? Math.round(RH) : null,
                visibility: visibility ?? null,
                cloudCover: cloudCover ?? null,
                precipitation: precip ?? null,
                precipitationText: null,
            };

            // Windrichtung als Text nach Wunsch
            if (cfg.windDirMode && cfg.windDirMode !== "deg") {
                rec.windDirCardinal = dirToCardinal(rec.windDir, cfg.windDirMode);
            }

            if (rec.precipitation != null) {
                const kind = "Regen";
                const intensity = rec.precipitation < 0.3 ? "leicht"
                    : rec.precipitation < 1.0 ? "mäßig"
                        : "stark";
                rec.precipitationText = `${kind} (${intensity}) – ${rec.precipitation} mm/h`;
            }

            out.push(rec);
        }

        if (cfg.coreOnly) {
            const core = [
                "ts","iso",
                "temperature","windSpeed","windDir","pressure",
                "relHumidity","visibility","precipitation","precipitationText","cloudCover","windDirCardinal"
            ];
            return out.map((r) => {
                const o = {};
                for (const k of core) o[k] = r[k] ?? null;
                return o;
            });
        }
        return out;
    }

    // ---- HTTP ----
    async function httpGetArrayBuffer(url) {
        const res = await axios.get(url, { responseType: "arraybuffer", validateStatus: () => true });
        if (res.status !== 200) {
            const e = new Error(`HTTP ${res.status}`);
            e.status = res.status;
            throw e;
        }
        return res.data;
    }

    // ---- Fetch & Parse ----
    async function fetchAndParseMosmix(url, tz, diagFn) {
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const buf = await httpGetArrayBuffer(url);
                const zip = new AdmZip(buf);
                const entries = zip.getEntries();
                if (!entries || !entries.length) throw new Error("KMZ leer");

                const kmlEntry = entries.find((e) => e.entryName.toLowerCase().endsWith(".kml")) || entries[0];
                const kmlStr = kmlEntry.getData().toString("utf8");

                if (diagFn) {
                    diagFn("[DWD-Forecast] KMZ KML-Entries:");
                    entries
                        .filter((e) => e.entryName.toLowerCase().endsWith(".kml"))
                        .forEach((e) => diagFn(` - ${e.entryName} (${e.header.size} bytes)`));
                    diagFn(`[DWD-Forecast] KML picked: ${kmlEntry.entryName} (${kmlEntry.header.size} bytes)`);
                }

                // Diagnose-Kennzahlen
                if (diagFn) {
                    const count = (re) => ((kmlStr.match(re) || []).length);
                    diagFn(`[DWD-Forecast] Count <SimpleArrayData>: ${count(/<([a-zA-Z0-9_]+:)?SimpleArrayData\b/gi)}`);
                    diagFn(`[DWD-Forecast] Count <Parameter id="...">: ${count(/<([a-zA-Z0-9_]+:)?Parameter\b[^>]*\bid="/gi)}`);
                    diagFn(`[DWD-Forecast] Count <elementName>: ${count(/<([a-zA-Z0-9_]+:)?elementName\b/gi)}`);
                    diagFn(`[DWD-Forecast] Count <values>: ${count(/<([a-zA-Z0-9_]+:)?values\b/gi)}`);
                    diagFn(`[DWD-Forecast] Count <value>: ${count(/<([a-zA-Z0-9_]+:)?value\b/gi)}`);

                    const m3 = kmlStr.match(/<([a-zA-Z0-9_]+:)?Forecast\b[\s\S]*?<\/\1?Forecast>/i);
                    if (m3) diagFn(`[DWD-Forecast] Sample Forecast: ${m3[0].slice(0, 500).replace(/\s+/g,' ')}…`);
                }

                const kml = await parseStringPromise(kmlStr, {
                    explicitArray: true,
                    preserveChildrenOrder: false,
                    mergeAttrs: true,
                });

                const kmlRoot = getKmlRoot(kml);
                const doc = findFirstDocumentNode(kmlRoot) || findFirstDocumentNode(kml);

                if (diagFn) {
                    const topKey = Object.keys(kml)[0] || "kml:kml";
                    diagFn(`[DWD-Forecast] KML Top-Level Keys: ${topKey}`);
                    diagFn(`[DWD-Forecast] Document keys: ${doc ? Object.keys(doc).join(", ") : "(none)"}`);
                }
                if (!doc) throw new Error("KML Document fehlt");

                // optional: Placemark-Struktur debuggen
                if (diagFn && doc) {
                    const pms = []
                        .concat(asArray(doc.Placemark))
                        .concat(asArray(doc["kml:Placemark"]))
                        .filter(Boolean);

                    if (pms.length) {
                        diagFn(`[DWD-Forecast] Placemark keys: ${Object.keys(pms[0]).join(", ")}`);
                    }
                }

                // TimeSteps
                let tsStrings = collectTimeStepStrings(doc, []);
                if (!tsStrings.length) {
                    const w = collectTrackWhenStrings(doc, []);
                    if (diagFn) diagFn(`[DWD-Forecast] Fallback when: ${w.length} Treffer`);
                    tsStrings = w;
                }
                if (!tsStrings.length) {
                    const whenRe = /<\w*:TimeStep>([^<]+)<\/\w*:TimeStep>/g;
                    const tmp = [];
                    let m;
                    while ((m = whenRe.exec(kmlStr))) tmp.push(m[1]);
                    if (diagFn) diagFn(`[DWD-Forecast] Regex-Fallback TimeSteps: ${tmp.length} Treffer`);
                    tsStrings = tmp;
                }

                const timeSteps = tsStrings
                    .map((s) => moment.tz(String(s), tz).valueOf())
                    .filter((v) => Number.isFinite(v));

                if (diagFn) {
                    diagFn(`[DWD-Forecast] TimeSteps gesamt: ${tsStrings.length}`);
                    diagFn(`[DWD-Forecast] TimeSteps nach Parse: ${timeSteps.length}`);
                    if (tsStrings.length) {
                        diagFn(`[DWD-Forecast] TimeStep-Beispiele (roh): ${tsStrings.slice(0, 5).join(", ")}`);
                    }
                }
                if (!timeSteps.length) throw new Error("ForecastTimeSteps leer");

                // Params A–D sammeln
                const paramsA = extractParamsFromSchemaData(doc, diagFn);
                let params = { ...paramsA };

                if (!Object.keys(params).length) {
                    const paramsB = extractParamsFromForecast(doc, diagFn);
                    params = { ...params, ...paramsB };
                }

                if (!Object.keys(params).length) {
                    const paramsB2 = extractParamsFromDwdForecast(doc, diagFn);
                    params = { ...params, ...paramsB2 };
                }

                if (!Object.keys(params).length) {
                    const paramsC = extractParamsByRegex(kmlStr, diagFn);
                    params = { ...params, ...paramsC };
                }

                if (!Object.keys(params).length) {
                    const paramsD = extractParamsByGenericWalk(doc, diagFn);
                    params = { ...params, ...paramsD };
                }

                if (diagFn) diagFn(`[DWD-Forecast] gefundene Parameter (gesamt): ${Object.keys(params).length}`);
                if (diagFn && Object.keys(params).length) {
                    const sampleCodes = Object.keys(params).slice(0, 20).join(", ");
                    diagFn(`[DWD-Forecast] Param-Codes (Auszug): ${sampleCodes}`);
                }

                // Länge angleichen
                for (const p of Object.values(params)) {
                    if (p.values.length > timeSteps.length) p.values = p.values.slice(0, timeSteps.length);
                    if (p.values.length < timeSteps.length)
                        p.values = p.values.concat(Array(timeSteps.length - p.values.length).fill(null));
                }

                const stationName = tryGetStationName(doc);
                return { timeSteps, params, stationName, kmlStr };
            } catch (e) {
                lastErr = e;
                if (diagFn) diagFn(`[DWD-Forecast] Versuch ${attempt + 1} fehlgeschlagen: ${e.message}`);
                if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
            }
        }
        throw lastErr || new Error("Unbekannter Fehler");
    }

    function DwdWeatherForecastNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        // i18n-Helfer: Runtime-Übersetzungen über RED._
        const t = (key, opts) =>
            RED._("node-red-contrib-dwd-weatherforecast/dwd-weatherforecast:" + key, opts);

        // ---- Konfiguration aus UI ----
        node.station = (config.station || "").toUpperCase().trim();
        node.sourceUrl = (config.sourceUrl || DEFAULT_URL_TEMPLATE).trim();

        node.fetchOnDeploy = !!config.fetchOnDeploy;
        node.autoRefresh = Number(config.autoRefresh || 0);
        node.hoursAhead = Number(
            (config.hoursAhead != null ? config.hoursAhead : config.maxHours) || 0
        );
        node.coreOnly = !!config.coreOnly;
        node.toC = config.toC !== false;
        node.windToKmh = config.windToKmh !== false;
        node.pressureToHpa = config.pressureToHpa !== false;
        node.visibilityToKm = config.visibilityToKm !== false;
        node.windDirMode = (config.windDirMode || "deg"); // NEW
        node.diag = !!config.diag;
        node.staleOnError = !!config.staleOnError;
        node.onlyFuture = !!config.onlyFuture;

        // ---- Status-Helfer ----
        let refreshTimer = null;
        const setStatus = (text, shape = "dot", color = "blue") =>
            node.status({ fill: color, shape, text });

        // ---- Context für Stale-Daten ----
        const ctx = node.context();
        const CTX_KEY = "lastGood";

        function saveLastGood(series, meta, station) {
            ctx.set(CTX_KEY, {
                at: Date.now(),
                station,
                series,
                meta
            });
        }

        function sendStaleIfAvailable() {
            const last = ctx.get(CTX_KEY);
            if (!last) return false;

            const count = last.meta?.count || last.series?.length || 0;
            const out = {
                payload: last.series,
                station: { id: last.station, name: last.meta?.stationName || null },
                _meta: { ...(last.meta || {}), stale: true }
            };

            node.status({
                fill: "yellow",
                shape: "ring",
                text: t("runtime.statusStale", { count })
            });

            node.send(out);
            return true;
        }

        // ---- URL bauen (mit i18n-Fehler bei fehlender Station) ----
        function buildUrl(station, tpl) {
            const st = (station || "").toUpperCase().trim();
            if (!st) {
                // Fehlermeldung bereits übersetzt
                throw new Error(t("runtime.errorStationMissing"));
            }
            return (tpl || DEFAULT_URL_TEMPLATE).replace(/{station}/gi, st);
        }

        // begrenzt timeSteps/params auf das Zeitfenster [now, now + hoursAhead h]
        function applyHoursAheadFilter(timeSteps, params, hoursAhead) {
            const now = Date.now();
            if (!hoursAhead || !Number.isFinite(hoursAhead) || hoursAhead <= 0) {
                return { timeSteps, params };
            }
            const end = now + hoursAhead * 3600 * 1000;

            let firstIdx = -1,
                lastIdx = -1;
            for (let i = 0; i < timeSteps.length; i++) {
                const tVal = timeSteps[i];
                if (tVal >= now && tVal <= end) {
                    if (firstIdx === -1) firstIdx = i;
                    lastIdx = i;
                }
            }

            if (firstIdx === -1) {
                for (let i = 0; i < timeSteps.length; i++) {
                    const tVal = timeSteps[i];
                    if (tVal >= now) {
                        firstIdx = i;
                        break;
                    }
                }
                if (firstIdx !== -1) {
                    lastIdx = Math.min(
                        timeSteps.length - 1,
                        firstIdx + Math.max(0, Math.ceil(hoursAhead)) - 1
                    );
                }
            }

            if (firstIdx === -1 || lastIdx === -1 || lastIdx < firstIdx) {
                return { timeSteps, params };
            }

            const newSteps = timeSteps.slice(firstIdx, lastIdx + 1);
            const newParams = {};
            for (const [code, p] of Object.entries(params)) {
                newParams[code] = { ...p, values: p.values.slice(firstIdx, lastIdx + 1) };
            }
            return { timeSteps: newSteps, params: newParams };
        }

        // nur zukünftige Zeitpunkte behalten
        function applyOnlyFutureFilter(timeSteps, params, onlyFuture) {
            if (!onlyFuture) return { timeSteps, params };
            const now = Date.now();

            let start = -1;
            for (let i = 0; i < timeSteps.length; i++) {
                if (timeSteps[i] >= now) {
                    start = i;
                    break;
                }
            }

            if (start <= 0) {
                if (start === -1) {
                    const emptyParams = {};
                    for (const [code, p] of Object.entries(params)) {
                        emptyParams[code] = { ...p, values: [] };
                    }
                    return { timeSteps: [], params: emptyParams };
                }
                return { timeSteps, params };
            }

            const ts = timeSteps.slice(start);
            const pr = {};
            for (const [code, p] of Object.entries(params)) {
                pr[code] = { ...p, values: p.values.slice(start) };
            }
            return { timeSteps: ts, params: pr };
        }

        // ---- Haupt-Logik: Abruf + Normalisierung ----
        async function runFetch(msg) {
            const station = (msg && msg.station) || node.station;
            const tpl =
                (msg && msg.sourceUrl) || node.sourceUrl || DEFAULT_URL_TEMPLATE;
            const url = buildUrl(station, tpl);

            if (node.diag) node.log(`[DWD-Forecast] URL: ${url}`);
            setStatus(t("runtime.statusLoading"), "dot", "blue");

            const effectiveHoursAhead = Number(
                msg && msg.hoursAhead != null ? msg.hoursAhead : node.hoursAhead
            );
            if (node.diag) {
                node.log(
                    `[DWD-Forecast] cfg.hoursAhead: ${node.hoursAhead} | msg.hoursAhead: ${
                        msg && msg.hoursAhead
                    } | effective=${effectiveHoursAhead}`
                );
            }

            try {
                const { timeSteps, params, stationName } = await fetchAndParseMosmix(
                    url,
                    "Europe/Berlin",
                    node.diag ? node.log.bind(node) : null
                );

                if (node.diag) {
                    node.log(
                        `[DWD-Forecast] StationName resolved: ${
                            stationName ?? "null"
                        }`
                    );
                }

                const before = timeSteps.length;
                const effHoursAhead = Number(
                    (msg && msg.hoursAhead != null ? msg.hoursAhead : node.hoursAhead) || 0
                );
                const effectiveOnlyFuture =
                    typeof (msg && msg.onlyFuture) === "boolean"
                        ? msg.onlyFuture
                        : node.onlyFuture;

                // 1) Vergangenheit entfernen
                let { timeSteps: ts1, params: pa1 } = applyOnlyFutureFilter(
                    timeSteps,
                    params,
                    effectiveOnlyFuture
                );
                // 2) Stundenfenster anwenden
                let { timeSteps: ts2, params: pa2 } = applyHoursAheadFilter(
                    ts1,
                    pa1,
                    effHoursAhead
                );

                if (node.diag) {
                    node.log(
                        `[DWD-Forecast] hoursAhead filter: in=${before}, out=${ts2.length}`
                    );
                    if (ts2.length && before !== ts2.length) {
                        node.log(
                            `[DWD-Forecast] hoursAhead window: first=${new Date(
                                ts2[0]
                            ).toISOString()}, last=${new Date(
                                ts2[ts2.length - 1]
                            ).toISOString()}`
                        );
                    }
                    node.log(
                        `[DWD-Forecast] onlyFuture=${effectiveOnlyFuture} | hoursAhead=${effHoursAhead}`
                    );
                }

                const cfg = {
                    coreOnly: node.coreOnly,
                    toC: node.toC,
                    windToKmh: node.windToKmh,
                    pressureToHpa: node.pressureToHpa,
                    visibilityToKm: node.visibilityToKm,
                    windDirMode: node.windDirMode // NEW
                };

                const series = normalizeRecords(ts2, pa2, cfg);

                if (node.diag && pa2 && Object.keys(pa2).length) {
                    node.log(
                        `[DWD-Forecast] Codes (Auszug): ${Object.keys(pa2)
                            .slice(0, 20)
                            .join(", ")}`
                    );
                }

                if (node.diag) {
                    node.log(
                        `[DWD-Forecast] Ausgabe-Datensätze: ${series.length}`
                    );
                }

                const out = {
                    payload: series,
                    station: { id: station, name: stationName || null },
                    _meta: {
                        url,
                        count: series.length,
                        stale: false,
                        paramsAvailable: Object.keys(pa2).sort(),
                        windDirMode: node.windDirMode
                    }
                };

                saveLastGood(series, out._meta, station);

                setStatus(
                    t("runtime.statusOk", { count: series.length }),
                    "dot",
                    "green"
                );
                node.send(out);
            } catch (err) {
                if (node.staleOnError) {
                    const sent = sendStaleIfAvailable();
                    if (sent) return;
                }

                const errMsg =
                    err && err.message ? err.message : String(err);
                node.error(
                    t("runtime.errorFetch", { error: errMsg }),
                    err
                );
                setStatus(t("runtime.statusError"), "ring", "red");
            }
        }

        // ---- Auto-Refresh Timer ----
        function scheduleRefresh() {
            if (refreshTimer) {
                clearInterval(refreshTimer);
                refreshTimer = null;
            }
            const s = Number(node.autoRefresh || 0);
            if (s > 0) {
                refreshTimer = setInterval(() => runFetch({}), s * 1000);
            }
        }

        // ---- Event-Handler ----
        node.on("input", runFetch);

        node.on("close", () => {
            if (refreshTimer) clearInterval(refreshTimer);
            setStatus("");
        });

        // Initialisierung
        scheduleRefresh();
        if (node.fetchOnDeploy) {
            runFetch({}).catch(() => {
                // Fehler werden in runFetch geloggt
            });
        } else {
            setStatus(t("runtime.statusReady"));
        }
    }

    RED.nodes.registerType("dwd-weatherforecast", DwdWeatherForecastNode);
};