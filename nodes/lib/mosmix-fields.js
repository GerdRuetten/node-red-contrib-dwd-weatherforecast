"use strict";

/**
 * Hilfsfunktionen fuer das "Additional Fields"-Feature.
 *
 * Reines Modul ohne RED-Abhängigkeit (gut unit-testbar).
 *
 * Datenquelle: nodes/mosmix_elements.json – Metadaten zu allen MOSMIX-
 * Elementen (Code, redaktioneller Feldname, Einheit, Verfügbarkeit in
 * MOSMIX_S/-L, DE/EN-Beschreibung), generiert aus der DWD-Excel
 * "MOSMIX-Elemente" (siehe tools/generate-mosmix-elements.py).
 */

const MOSMIX_ELEMENTS = require("../mosmix_elements.json");

/** Code → Element-Lookup. */
const ELEMENT_BY_CODE = new Map(MOSMIX_ELEMENTS.map((e) => [e.code, e]));

/**
 * Standard-Felder, die der Node immer liefert. Die Feldnamen entsprechen
 * exakt den bisherigen Record-Feldern (Abwärtskompatibilität).
 */
const STANDARD_FIELDS = ["TTT", "Td", "FF", "DD", "PPPP", "VV", "Neff", "RR1c"];

/**
 * Berechnete Felder (kein eigener MOSMIX-Code) für used_fields.
 */
const COMPUTED_FIELDS = {
    type: {
        code: null,
        unit: "",
        description_de: "Art des Zeitpunkts: past, current oder forecast",
        description_en: "Kind of timestamp: past, current or forecast"
    },
    relHumidity: {
        code: null,
        unit: "%",
        description_de: "Relative Luftfeuchte (aus TTT/Td berechnet)",
        description_en: "Relative humidity (computed from TTT/Td)"
    },
    precipitationText: {
        code: null,
        unit: "",
        description_de: "Niederschlag als Text",
        description_en: "Precipitation as localized text"
    },
    windDirCardinal: {
        code: null,
        unit: "",
        description_de: "Windrichtung als Himmelsrichtung",
        description_en: "Wind direction as cardinal text"
    }
};

/**
 * MOSMIX-Quellcodes je Standardfeld (Fallback-Ketten der Extraktionslogik).
 */
const STANDARD_SOURCE_CODES = {
    TTT: ["TTT"],
    Td: ["Td"],
    FF: ["FF"],
    DD: ["DD"],
    PPPP: ["PPPP"],
    VV: ["VV"],
    Neff: ["Neff", "neff"],
    RR1c: ["RR1c", "RR1o1"]
};

/**
 * Effektive Einheit je Conversion-Key (wenn der zugehörige Toggle aktiv ist).
 */
const CONVERSION_UNITS = {
    toC: "°C",
    windToKmh: "km/h",
    pressureToHpa: "hPa",
    visibilityToKm: "km"
};

/**
 * Parst eine Feldliste (Config-String "SunD,FX1" oder Array) zu einem
 * bereinigeten, deduplizierten Code-Array. Nicht erkannte/leere Einträge
 * werden entfernt; Groß-/Kleinschreibung bleibt erhalten (MOSMIX-Codes
 * sind case-sensitiv, z. B. "Neff", "RR1c").
 *
 * @param {string|Array|null|undefined} v
 * @returns {string[]} Codes in Reihenfolge des ersten Auftretens
 */
function parseFieldList(v) {
    if (v == null) return [];
    const parts = Array.isArray(v) ? v : String(v).split(",");
    const out = [];
    for (const p of parts) {
        const c = String(p).trim();
        if (c && !out.includes(c)) out.push(c);
    }
    return out;
}

/**
 * Löst die effektiv zu liefernde Feldliste auf: Standard-Felder plus
 * zusätzlich angeforderte Codes (ohne Dopplung).
 *
 * @param {string|Array|null|undefined} additional zusätzliche MOSMIX-Codes
 *        (aus UI-Config oder msg.additional_fields)
 * @returns {{fields: string[], additional: string[], skipped: string[]}}
 *          fields = Standard + Additional (dedupliziert, Reihenfolge stabil);
 *          additional = die Nicht-Standard-Codes darin;
 *          skipped = angeforderte Codes, die schon Standard waren
 */
function resolveFields(additional) {
    const fields = STANDARD_FIELDS.slice();
    const skipped = [];
    for (const code of parseFieldList(additional)) {
        if (fields.includes(code)) {
            skipped.push(code);
            continue;
        }
        fields.push(code);
    }
    return {
        fields,
        additional: fields.filter((c) => !STANDARD_FIELDS.includes(c)),
        skipped
    };
}

/**
 * Metadaten zu einem MOSMIX-Code. Codes, die nicht in der metadata-JSON
 * stehen, bekommen den Code selbst als Feldnamen (Fallback).
 *
 * @param {string} code
 * @returns {{code: string, fieldname: string, unit: string,
 *            conversion: (string|null), description_de: string, description_en: string}}
 */
function fieldMeta(code) {
    const el = ELEMENT_BY_CODE.get(code);
    if (el) {
        return {
            code: el.code,
            fieldname: el.fieldname,
            unit: el.unit,
            conversion: el.conversion || null,
            description_de: el.description_de,
            description_en: el.description_en
        };
    }
    return { code, fieldname: code, unit: "", conversion: null, description_de: "", description_en: "" };
}

/**
 * Ist für ein Feld (bei aktiven Toggles) eine Umrechnung vorgesehen?
 *
 * @param {{conversion: (string|null)}} meta Ergebnis von fieldMeta()
 * @param {Object} [toggles] cfg mit toC/windToKmh/pressureToHpa/visibilityToKm
 * @returns {boolean}
 */
function isConverted(meta, toggles) {
    return !!(meta.conversion && toggles && toggles[meta.conversion]);
}

/**
 * Effektive (ausgegebene) Einheit eines Feldes.
 *
 * @param {{unit: string, conversion: (string|null)}} meta
 * @param {Object} [toggles]
 * @returns {string} effektive Unit, bei aktiver Umrechnung die Ziel-Unit
 */
function effectiveUnit(meta, toggles) {
    if (isConverted(meta, toggles)) return CONVERSION_UNITS[meta.conversion];
    return meta.unit;
}

/**
 * Rechnet einen Zusatzfeld-Wert gemäß Metadaten und aktiven Toggles um.
 * Rundung exakt wie bei den Standardfeldern; null-safe.
 *
 * @param {string} code MOSMIX-Code
 * @param {*} value Rohwert aus den geparsten Parametern
 * @param {Object} [toggles] cfg mit toC/windToKmh/pressureToHpa/visibilityToKm
 * @returns {*} umgerechneter Wert (bzw. unverändert/null)
 */
function convertValue(code, value, toggles) {
    if (value == null) return value ?? null;
    const meta = fieldMeta(code);
    if (!isConverted(meta, toggles)) return value;
    const n = Number(value);
    if (!Number.isFinite(n)) return value;
    switch (meta.conversion) {
        case "toC":
            return +((code === "E_TTT" || code === "E_Td") ? n : n - 273.15).toFixed(2);
        case "windToKmh":
            return +(n * 3.6).toFixed(2);
        case "pressureToHpa":
            return Math.round(n / 100);
        case "visibilityToKm":
            return +(n / 1000).toFixed(1);
        default:
            return value;
    }
}

/**
 * Prüft, ob zu einem aufgelösten Feld im aktuellen Zeitfenster tatsächlich
 * Werte vorliegen (berücksichtigt die Fallback-Ketten der Standardfelder).
 *
 * @param {string} code aufgelöster Feld-Code (Standard oder additional)
 * @param {Object<string, {values: Array}>} params geparste MOSMIX-Parameter
 * @returns {boolean}
 */
function fieldAvailable(code, params) {
    const sources = STANDARD_SOURCE_CODES[code] || [code];
    return sources.some(
        (c) => params[c] && Array.isArray(params[c].values) && params[c].values.some((v) => v !== null)
    );
}

/**
 * Roh-Dictionary für eine Code-Liste: Feldname ->
 * {code, unit, [unit_original], de, en}. Bei aktiver Umrechnung ist `unit`
 * die effektive (Ziel-)Einheit und `unit_original` die MOSMIX-Originalunit.
 * Wird für fields_not_found (ohne Toggles → Originalunits) genutzt.
 *
 * @param {string[]} codes
 * @param {Object} [toggles] aktive Umrechnungs-Toggles
 * @returns {Object<string, {code: string, unit: string, unit_original?: string,
 *                           de: string, en: string}>}
 */
function fieldsDict(codes, toggles) {
    const used = {};
    for (const code of codes) {
        const m = fieldMeta(code);
        const entry = {
            code: m.code,
            unit: effectiveUnit(m, toggles),
            de: m.description_de,
            en: m.description_en
        };
        if (isConverted(m, toggles)) entry.unit_original = m.unit;
        used[m.fieldname] = entry;
    }
    return used;
}

/**
 * Baut das msg.used_fields-Dictionary: nur die tatsächlich verwendeten
 * Felder mit DE/EN-Beschreibung; berechnete Felder werden ergänzt.
 *
 * @param {string[]} fields aufgelöste Feldliste (Codes) – vom Aufrufer
 *        bereits auf verfügbare Felder gefiltert
 * @param {{windDirMode?: string, toggles?: Object}} [opts]
 *        bei windDirMode != "deg" wird windDirCardinal mit aufgenommen;
 *        toggles steuert effektive Unit / unit_original
 * @returns {Object<string, {code: (string|null), unit: string,
 *          unit_original?: string, de: string, en: string}>}
 */
function buildUsedFields(fields, opts = {}) {
    const used = fieldsDict(fields, opts.toggles);
    for (const [fieldname, meta] of Object.entries(COMPUTED_FIELDS)) {
        if (fieldname === "windDirCardinal" && (!opts.windDirMode || opts.windDirMode === "deg")) {
            continue;
        }
        used[fieldname] = { code: meta.code, unit: meta.unit, de: meta.description_de, en: meta.description_en };
    }
    return used;
}

module.exports = {
    MOSMIX_ELEMENTS,
    ELEMENT_BY_CODE,
    STANDARD_FIELDS,
    STANDARD_SOURCE_CODES,
    COMPUTED_FIELDS,
    CONVERSION_UNITS,
    parseFieldList,
    resolveFields,
    fieldMeta,
    isConverted,
    effectiveUnit,
    convertValue,
    fieldAvailable,
    fieldsDict,
    buildUsedFields
};
