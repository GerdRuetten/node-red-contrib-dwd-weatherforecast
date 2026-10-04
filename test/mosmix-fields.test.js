"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const mosmix = require("../nodes/lib/mosmix-fields");

test("parseFieldList: null/undefined -> leer", () => {
    assert.deepEqual(mosmix.parseFieldList(null), []);
    assert.deepEqual(mosmix.parseFieldList(undefined), []);
});

test("parseFieldList: CSV-String bereinigen, trimmen, deduplizieren", () => {
    assert.deepEqual(
        mosmix.parseFieldList(" SunD, FX1 ,SunD, ,FX1"),
        ["SunD", "FX1"]
    );
});

test("parseFieldList: Array akzeptieren", () => {
    assert.deepEqual(mosmix.parseFieldList(["wwT", " N "]), ["wwT", "N"]);
});

test("parseFieldList: Groß-/Kleinschreibung bleibt erhalten", () => {
    assert.deepEqual(mosmix.parseFieldList("Neff, RR1c"), ["Neff", "RR1c"]);
});

test("resolveFields: Standardfelder immer enthalten, additional angehängt", () => {
    const r = mosmix.resolveFields("SunD,wwT");
    assert.deepEqual(r.fields, [...mosmix.STANDARD_FIELDS, "SunD", "wwT"]);
    assert.deepEqual(r.additional, ["SunD", "wwT"]);
    assert.deepEqual(r.skipped, []);
});

test("resolveFields: Standard-Codes im Additional werden dedupliziert", () => {
    const r = mosmix.resolveFields("TTT,SunD,Neff");
    assert.deepEqual(r.additional, ["SunD"]);
    assert.deepEqual(r.skipped, ["TTT", "Neff"]);
    assert.equal(r.fields.filter((c) => c === "TTT").length, 1);
});

test("resolveFields: null -> nur Standardfelder", () => {
    const r = mosmix.resolveFields(null);
    assert.deepEqual(r.fields, mosmix.STANDARD_FIELDS);
    assert.deepEqual(r.additional, []);
});

test("fieldMeta: bekannter Code liefert Feldname/Unit/Beschreibungen", () => {
    const m = mosmix.fieldMeta("SunD");
    assert.equal(m.fieldname, "sunshineDurationYesterday");
    assert.equal(m.unit, "s");
    assert.equal(m.description_de, "Sonnenscheindauer Vortag insgesamt");
    assert.ok(m.description_en.length > 0);
});

test("fieldMeta: unbekannter Code -> Code als Feldname (Fallback)", () => {
    const m = mosmix.fieldMeta("XXNOTEXIST");
    assert.equal(m.fieldname, "XXNOTEXIST");
    assert.equal(m.code, "XXNOTEXIST");
});

test("fieldMeta: Standard-Codes tragen exakt die Record-Feldnamen", () => {
    const expected = {
        TTT: "temperature",
        Td: "dewPoint",
        FF: "windSpeed",
        DD: "windDir",
        PPPP: "pressure",
        VV: "visibility",
        Neff: "cloudCover",
        RR1c: "precipitation"
    };
    for (const [code, fieldname] of Object.entries(expected)) {
        assert.equal(mosmix.fieldMeta(code).fieldname, fieldname, code);
    }
});

test("buildUsedFields: gelieferte Felder, DE+EN", () => {
    const r = mosmix.resolveFields("SunD,wwT");
    // Aufrufer filtert vor: SunD sei an der Station nicht verfügbar
    const available = r.fields.filter((c) => c !== "SunD");
    const used = mosmix.buildUsedFields(available, { windDirMode: "deg" });
    assert.deepEqual(Object.keys(used).sort(), [
        "cloudCover", "dewPoint", "precipitation", "precipitationText", "pressure",
        "relHumidity", "temperature", "thunderProb1h", "type",
        "visibility", "windDir", "windSpeed"
    ]);
    assert.equal(used.thunderProb1h.code, "wwT");
    assert.equal(used.thunderProb1h.unit, "% (0..100)");
    assert.equal(used.thunderProb1h.de, "Wahrscheinlichkeit: Auftreten von Gewittern innerhalb der letzten Stunde");
    assert.equal(used.temperature.code, "TTT");
    assert.equal(used.relHumidity.code, null);
    assert.equal(used.type.code, null);
});

test("fieldsDict: reines Dictionary ohne berechnete Felder", () => {
    const d = mosmix.fieldsDict(["SunD", "XXNOTEXIST"]);
    assert.deepEqual(Object.keys(d).sort(), ["XXNOTEXIST", "sunshineDurationYesterday"]);
    assert.equal(d.sunshineDurationYesterday.code, "SunD");
    assert.equal(d.XXNOTEXIST.de, "");
});

test("fieldAvailable: Fallback-Ketten der Standardfelder", () => {
    // Neff fehlt, aber neff vorhanden -> cloudCover verfügbar
    assert.equal(mosmix.fieldAvailable("Neff", { neff: { values: [1, 2] } }), true);
    // RR1c fehlt, RR1o1 vorhanden
    assert.equal(mosmix.fieldAvailable("RR1c", { RR1o1: { values: [0] } }), true);
    // komplett fehlend
    assert.equal(mosmix.fieldAvailable("VV", { TTT: { values: [280] } }), false);
    // vorhanden, aber nur null-Werte im Zeitfenster
    assert.equal(mosmix.fieldAvailable("FF", { FF: { values: [null, null] } }), false);
    // Additional-Feld direkt
    assert.equal(mosmix.fieldAvailable("wwT", { wwT: { values: [10, null] } }), true);
});

test("buildUsedFields: windDirCardinal nur bei Modus 8/16", () => {
    const withDeg = mosmix.buildUsedFields([], { windDirMode: "deg" });
    assert.equal(withDeg.windDirCardinal, undefined);
    const with8 = mosmix.buildUsedFields([], { windDirMode: "8" });
    assert.ok(with8.windDirCardinal);
    assert.equal(with8.windDirCardinal.code, null);
});

test("buildUsedFields: unbekannter Code erscheint unter eigenem Namen", () => {
    const used = mosmix.buildUsedFields(["XXNOTEXIST"]);
    assert.ok(used.XXNOTEXIST);
    assert.equal(used.XXNOTEXIST.de, "");
});

test("mosmix_elements.json: Codes eindeutig, Feldnamen eindeutig", () => {
    const codes = mosmix.MOSMIX_ELEMENTS.map((e) => e.code);
    const names = mosmix.MOSMIX_ELEMENTS.map((e) => e.fieldname);
    assert.equal(new Set(codes).size, codes.length);
    assert.equal(new Set(names).size, names.length);
});

// ---------------------------------------------------------------------------
// Einheitenumrechnung (Runde 5): conversion-Key in mosmix_elements.json
// ---------------------------------------------------------------------------

test("convertValue: toC mit aktivem Toggle (2 Dezimalstellen)", () => {
    assert.equal(mosmix.convertValue("T5cm", 283.15, { toC: true }), 10);
    assert.equal(mosmix.convertValue("T5cm", 290.05, { toC: true }), 16.9);
    assert.equal(mosmix.convertValue("TM", 285.16, { toC: true }), 12.01);
});

test("convertValue: Toggle aus -> Wert unverändert", () => {
    assert.equal(mosmix.convertValue("T5cm", 283.15, { toC: false }), 283.15);
    assert.equal(mosmix.convertValue("T5cm", 283.15, {}), 283.15);
    assert.equal(mosmix.convertValue("T5cm", 283.15), 283.15);
});

test("convertValue: null/undefined bleibt null", () => {
    assert.equal(mosmix.convertValue("T5cm", null, { toC: true }), null);
    assert.equal(mosmix.convertValue("T5cm", undefined, { toC: true }), null);
    assert.equal(mosmix.convertValue("T5cm", null), null);
});

test("convertValue: windToKmh / pressureToHpa / visibilityToKm", () => {
    assert.equal(mosmix.convertValue("FX1", 5, { windToKmh: true }), 18);
    assert.equal(mosmix.convertValue("FX1", 5.5, { windToKmh: true }), 19.8);
    assert.equal(mosmix.convertValue("E_PPP", 101325, { pressureToHpa: true }), 1013);
    assert.equal(mosmix.convertValue("VV", 25000, { visibilityToKm: true }), 25);
    assert.equal(mosmix.convertValue("VV", 25500, { visibilityToKm: true }), 25.5);
});

test("convertValue: Feld ohne Conversion-Zuordnung bleibt unverändert", () => {
    assert.equal(mosmix.convertValue("Rad1h", 1234, { toC: true, windToKmh: true }), 1234);
    assert.equal(mosmix.convertValue("XXNOTEXIST", 42, { toC: true }), 42);
});

test("convertValue: nicht-numerischer Wert bleibt unverändert", () => {
    assert.equal(mosmix.convertValue("T5cm", "abc", { toC: true }), "abc");
});

test("isConverted/effectiveUnit: Ziel-Unit nur bei aktivem Toggle", () => {
    const metaT5 = mosmix.fieldMeta("T5cm");
    assert.equal(mosmix.isConverted(metaT5, { toC: true }), true);
    assert.equal(mosmix.isConverted(metaT5, { toC: false }), false);
    assert.equal(mosmix.isConverted(metaT5, undefined), false);
    assert.equal(mosmix.effectiveUnit(metaT5, { toC: true }), "°C");
    assert.equal(mosmix.effectiveUnit(metaT5, { toC: false }), "Kelvin");
    const metaRad = mosmix.fieldMeta("Rad1h");
    assert.equal(mosmix.isConverted(metaRad, { toC: true }), false);
    assert.equal(mosmix.effectiveUnit(metaRad, { toC: true }), "kJ/m2");
});

test("fieldsDict: mit Toggles unit=effektiv und unit_original nur bei Umrechnung", () => {
    const d = mosmix.fieldsDict(["T5cm", "Rad1h"], { toC: true });
    assert.equal(d.temperature5cm.unit, "°C");
    assert.equal(d.temperature5cm.unit_original, "Kelvin");
    assert.equal(d.globalIrradiance.unit, "kJ/m2");
    assert.equal(d.globalIrradiance.unit_original, undefined);
});

test("fieldsDict: ohne Toggles Originalunits, kein unit_original", () => {
    const d = mosmix.fieldsDict(["T5cm"]);
    assert.equal(d.temperature5cm.unit, "Kelvin");
    assert.equal(d.temperature5cm.unit_original, undefined);
});

test("buildUsedFields: Toggles fließen in effektive Units ein", () => {
    const used = mosmix.buildUsedFields(["VV"], { toggles: { visibilityToKm: true } });
    assert.equal(used.visibility.unit, "km");
    assert.equal(used.visibility.unit_original, "m");
});

test("mosmix_elements.json: Conversion-Zuordnung vollständig und konsistent", () => {
    const valid = new Set(Object.keys(mosmix.CONVERSION_UNITS));
    const withConv = mosmix.MOSMIX_ELEMENTS.filter((e) => e.conversion);
    // Erwartete 18 Felder laut Conversion-Tabelle
    assert.equal(withConv.length, 18);
    for (const e of withConv) {
        assert.ok(valid.has(e.conversion), `${e.code}: unbekannte Conversion ${e.conversion}`);
        assert.ok(e.unit, `${e.code}: Conversion ohne Original-Unit`);
    }
    // H_BsC darf keine Sichtweiten-Umrechnung haben
    assert.equal(mosmix.fieldMeta("H_BsC").conversion, null);
    // Umrechnungsziele decken alle vier Toggles ab
    assert.equal(mosmix.CONVERSION_UNITS.toC, "°C");
    assert.equal(mosmix.CONVERSION_UNITS.windToKmh, "km/h");
    assert.equal(mosmix.CONVERSION_UNITS.pressureToHpa, "hPa");
    assert.equal(mosmix.CONVERSION_UNITS.visibilityToKm, "km");
});

// ---------------------------------------------------------------------------
// Regression: Temperatur-FEHLERgroessen (E_TTT, E_Td) duerfen nicht den
// Kelvin-Offset erhalten — die Betragsdifferenz ist in K und °C identisch.
// (Copilot-Review, Fix vom PR-Autor uebernommen.)
// ---------------------------------------------------------------------------

test("convertValue: E_TTT/E_Td behalten die Fehlergroesse (kein Kelvin-Offset)", () => {
    assert.equal(mosmix.convertValue("E_TTT", 2, { toC: true }), 2);
    assert.equal(mosmix.convertValue("E_Td", 1.55, { toC: true }), 1.55);
    // absolut gesehen falsch waere: 2 - 273.15 = -271.15
    assert.notEqual(mosmix.convertValue("E_TTT", 2, { toC: true }), -271.15);
});

test("convertValue: E_TTT/E_Td ohne Toggle unveraendert", () => {
    assert.equal(mosmix.convertValue("E_TTT", 2, { toC: false }), 2);
    assert.equal(mosmix.convertValue("E_TTT", 2), 2);
});

test("fieldsDict: E_TTT mit Toggle liefert effektive Unit und Originalunit", () => {
    const d = mosmix.fieldsDict(["E_TTT"], { toC: true });
    assert.equal(d.errorTemperature.unit, "°C");
    assert.equal(d.errorTemperature.unit_original, "Kelvin");
});
