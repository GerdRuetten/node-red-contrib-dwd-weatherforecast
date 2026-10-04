"use strict";

/**
 * Smoke-Test gegen die echte DWD-Station: laedt den Node mit einem
 * minimalen RED-Mock, loest einen Abruf aus und prueft die Ausgabe
 * (ohne Node-RED-Runtime).
 *
 * Aufruf (aus dem Repo-Root):
 *   node tools/smoke-test.js [station] [codesCsv]
 *
 * Beispiel:
 *   node tools/smoke-test.js K1174 "SunD,wwT,FX1,XXNOTEXIST"
 */

const captured = {};
const sent = [];

const RED = {
    _: (key) => key,
    log: () => {},
    auth: { needsPermission: () => (req, res, next) => next() },
    httpAdmin: { get: (route, perm, handler) => { captured.route = route; captured.handler = handler; } },
    nodes: {
        createNode(node) {
            node.on = (ev, fn) => { node["__on_" + ev] = fn; };
            node.status = () => {};
            node.error = (msg, err) => { console.error("node.error:", msg, err && err.message ? err.message : ""); };
            node.log = () => {};
            node.send = (msg) => { sent.push(msg); };
            node.context = () => ({ get: () => undefined, set: () => {} });
        },
        registerType(type, ctor) { captured.type = type; captured.ctor = ctor; }
    }
};

require("../nodes/dwd-weatherforecast")(RED);

const station = process.argv[2] || "K1174";
const additional = process.argv[3] || "SunD,wwT,FX1,XXNOTEXIST";

const node = new captured.ctor({
    station,
    additionalFields: additional,
    onlyFuture: false,
    fetchOnDeploy: false
});

node.__on_input({}).then(() => {
    if (!sent.length) {
        console.error("KEINE AUSGABE erhalten");
        process.exit(1);
    }
    const out = sent[0];
    const rec = (out.payload || [])[0] || {};
    console.log("--- Smoke-Test", station, "---");
    console.log("Datensaetze:", out.payload.length);
    console.log("keys d. ersten Records:", Object.keys(rec).join(", "));
    console.log("_meta.additionalFields:", JSON.stringify(out._meta.additionalFields));
    console.log("_meta.additionalFieldsSkipped:", JSON.stringify(out._meta.additionalFieldsSkipped));
    console.log("_meta.additionalFieldsNotAvailable:", JSON.stringify(out._meta.additionalFieldsNotAvailable));
    console.log("used_fields:", Object.keys(out.used_fields || {}).join(", "));
    console.log("fields_not_found:", JSON.stringify(out.fields_not_found));
    console.log("types (erste 5):", (out.payload || []).slice(0, 5).map(r => r.type).join(", "));
    console.log("Record[0]:", JSON.stringify(rec, null, 1).slice(0, 1200));
    process.exit(0);
}).catch((e) => {
    console.error("FEHLER:", e);
    process.exit(1);
});
