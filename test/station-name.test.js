"use strict";
// Tests fuer tryGetStationName (Station-Name aus dem KML-Placemark).
// Numerische WMO-IDs (z. B. 10962) und buchstabengefuehrte DWD-IDs (K1174)
// muessen beide als ID erkannt und der Description-Fallback genutzt werden.
const assert = require("node:assert");
const { test } = require("node:test");

const RED = {
    _: (key) => key,
    log: () => {},
    auth: { needsPermission: () => (req, res, next) => next() },
    httpAdmin: { get: () => {} },
    nodes: { createNode() {}, registerType() {} }
};

const factory = require("../nodes/dwd-weatherforecast");
factory(RED);
const { tryGetStationName } = factory._test;

test("StationName: buchstabengefuehrte ID (K1174) -> Name aus Description", () => {
    const doc = { Placemark: [{ name: ["K1174"], description: ["HEINSBERG"] }] };
    assert.equal(tryGetStationName(doc), "HEINSBERG");
});

test("StationName: numerische WMO-ID (10962) -> Name aus Description", () => {
    const doc = { Placemark: [{ name: ["10962"], description: ["HOHENPEISS.BG"] }] };
    assert.equal(tryGetStationName(doc), "HOHENPEISS.BG");
});

test("StationName: kml:-praefixierte Schluessel werden erkannt", () => {
    const doc = { "kml:Placemark": [{ "kml:name": ["10962"], "kml:description": ["HOHENPEISS.BG"] }] };
    assert.equal(tryGetStationName(doc), "HOHENPEISS.BG");
});

test("StationName: Description mit ID in Klammern wird bereinigt", () => {
    const doc = { Placemark: [{ name: ["K1174"], description: ["Heinsberg (K1174)"] }] };
    assert.equal(tryGetStationName(doc), "Heinsberg");
});

test("StationName: keine Description -> null (ID ist kein Name)", () => {
    const doc = { Placemark: [{ name: ["10962"] }] };
    assert.equal(tryGetStationName(doc), null);
    const doc2 = { Placemark: [{ name: ["K1174"] }] };
    assert.equal(tryGetStationName(doc2), null);
});

test("StationName: echter Name in <name> ohne Description wird akzeptiert", () => {
    const doc = { Placemark: [{ name: ["Heinsberg"] }] };
    assert.equal(tryGetStationName(doc), "Heinsberg");
});

test("StationName: xml2js-Objektform ({_}) wird verarbeitet", () => {
    const doc = { Placemark: [{ name: [{ _: "10962" }], description: [{ _: "HOHENPEISS.BG" }] }] };
    assert.equal(tryGetStationName(doc), "HOHENPEISS.BG");
});

test("StationName: Ortszusatz in Klammern bleibt erhalten (Halle (Saale))", () => {
    const doc = { Placemark: [{ name: ["H721"], description: ["Halle (Saale)"] }] };
    assert.equal(tryGetStationName(doc), "Halle (Saale)");
});

test("StationName: numerische ID in Klammern wird gestrippt", () => {
    const doc = { Placemark: [{ name: ["10962"], description: ["Hohenpeißenberg (10962)"] }] };
    assert.equal(tryGetStationName(doc), "Hohenpeißenberg");
});
