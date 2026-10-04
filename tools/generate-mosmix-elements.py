# -*- coding: utf-8 -*-
"""Generiert nodes/mosmix_elements.json aus der DWD-Excel „MOSMIX-Elemente".

Quelle: https://www.dwd.de/DE/leistungen/opendata/help/schluessel_datenformate/kml/mosmix_elemente_xls.xlsx
(Aktuellste Liste laut DWD: https://opendata.dwd.de/weather/lib/MetElementDefinition.xml)

Die Feldnamen (`fieldname`) sind redaktionell vergeben und bewusst NICHT
automatisch aus den Beschreibungen abgeleitet. Bei Excel-Updates dieses Skript
neu laufen lassen — die Zuordnung CODE->fieldname bleibt stabil.

Aufruf (aus dem Repo-Root):
    python tools/generate-mosmix-elements.py <pfad/zur/mosmix_elemente.xlsx>
"""
import json
import sys
from pathlib import Path

# Redaktionelle Feldnamen; Standard-Codes des Pakets tragen exakt die
# Record-Feldnamen von dwd-weatherforecast.js (temperature, windSpeed, ...).
FIELDNAMES = {
    # --- Wind ---
    "DD": "windDir",
    "DRR1": "precipitationDuration1h",
    "E_DD": "errorWindDir",
    "E_FF": "errorWindSpeed",
    "E_PPP": "errorPressure",
    "E_Td": "errorDewPoint",
    "E_TTT": "errorTemperature",
    "FF": "windSpeed",
    "FX1": "windGust1h",
    "FX3": "windGust3h",
    "FX625": "gustProb25kn6h",
    "FX640": "gustProb40kn6h",
    "FX655": "gustProb55kn6h",
    "FXh": "windGust12h",
    "FXh25": "gustProb25kn12h",
    "FXh40": "gustProb40kn12h",
    "FXh55": "gustProb55kn12h",
    # --- Bewölkung ---
    "N": "cloudCoverTotal",
    "N05": "cloudCoverLow500ft",
    "Neff": "cloudCover",
    "Nh": "cloudCoverHigh",
    "Nl": "cloudCoverLow",
    "Nlm": "cloudCoverLowMid",
    "Nm": "cloudCoverMid",
    # --- Druck / Verdunstung ---
    "PEvap": "evapotranspiration24h",
    "PPPP": "pressure",
    # --- Sonnenschein-Wahrscheinlichkeiten ---
    "PSd00": "sunshineProbGt0",
    "PSd30": "sunshineProbGt30",
    "PSd60": "sunshineProbGt60",
    # --- Niederschlags-Wahrscheinlichkeiten 1h ---
    "R101": "precipProb01mm1h",
    "R102": "precipProb02mm1h",
    "R103": "precipProb03mm1h",
    "R105": "precipProb05mm1h",
    "R107": "precipProb07mm1h",
    "R110": "precipProb1mm1h",
    "R120": "precipProb2mm1h",
    "R130": "precipProb3mm1h",
    "R150": "precipProb5mm1h",
    # --- Niederschlags-Wahrscheinlichkeiten 6h ---
    "R600": "precipProb0mm6h",
    "R602": "precipProb02mm6h",
    "R610": "precipProb1mm6h",
    "R650": "precipProb5mm6h",
    # --- Strahlung ---
    "Rad1h": "globalIrradiance",
    "RadL3": "longwaveRadiationBalance3h",
    "RadS3": "shortwaveRadiationBalance3h",
    # --- Niederschlags-Wahrscheinlichkeiten 24h ---
    "Rd00": "precipProb0mm24h",
    "Rd02": "precipProb02mm24h",
    "Rd10": "precipProb1mm24h",
    "Rd50": "precipProb5mm24h",
    # --- Niederschlags-Wahrscheinlichkeiten 12h ---
    "Rh00": "precipProb0mm12h",
    "Rh02": "precipProb02mm12h",
    "Rh10": "precipProb1mm12h",
    "Rh50": "precipProb5mm12h",
    # --- Niederschlags-Mengen ---
    "RR1": "precipitation1hRaw",
    "RR1c": "precipitation",
    "RR1o1": "precipProb10mm1h",
    "RR1u1": "precipProb25mm1h",
    "RR1w1": "precipProb15mm1h",
    "RR3": "precipitation3hRaw",
    "RR3c": "precipitation3h",
    "RR6": "precipitation6hRaw",
    "RR6c": "precipitation6h",
    "RRad1": "irradiance1h",
    "RRd": "precipitation24hRaw",
    "RRdc": "precipitation24h",
    "RRh": "precipitation12hRaw",
    "RRhc": "precipitation12h",
    "RRL1c": "liquidPrecipitation1h",
    "RRS1c": "sleetEquivalent1h",
    "RRS3c": "sleetEquivalent3h",
    # --- Sonnenschein ---
    "RSunD": "relativeSunshineDuration24h",
    "SunD": "sunshineDurationYesterday",
    "SunD1": "sunshineDuration1h",
    "SunD3": "sunshineDuration3h",
    # --- Temperatur ---
    "T5cm": "temperature5cm",
    "T_2M": "temperature2mModel",
    "Td": "dewPoint",
    "TG": "minSurfaceTemp12h",
    "TM": "meanTemperature24h",
    "TN": "minTemperature12h",
    "TTT": "temperature",
    "TX": "maxTemperature12h",
    # --- Sicht ---
    "VV": "visibility",
    "VV10": "visibilityProbBelow1000m",
    # --- Wetter ---
    "W1W2": "pastWeather6h",
    "WPc11": "sigWeatherOptional1h",
    "WPc31": "sigWeatherOptional3h",
    "WPc61": "sigWeatherOptional6h",
    "WPcd1": "sigWeatherOptional24h",
    "WPch1": "sigWeatherOptional12h",
    "ww": "significantWeather",
    "ww3": "significantWeather3h",
    "wwC": "convectivePrecipProb1h",
    "wwC6": "convectivePrecipProb6h",
    "wwCh": "convectivePrecipProb12h",
    "wwD": "stratiformPrecipProb1h",
    "wwD6": "stratiformPrecipProb6h",
    "wwDh": "stratiformPrecipProb12h",
    "wwF": "freezingRainProb1h",
    "wwF6": "freezingRainProb6h",
    "wwFh": "freezingRainProb12h",
    "wwL": "liquidPrecipProb1h",
    "wwL6": "liquidPrecipProb6h",
    "wwLh": "liquidPrecipProb12h",
    "wwM": "fogProb1h",
    "wwM6": "fogProb6h",
    "wwMd": "fogProb24h",
    "wwMh": "fogProb12h",
    "wwP": "precipProb1h",
    "wwP6": "precipProb6h",
    "wwPd": "precipProb24h",
    "wwPh": "precipProb12h",
    "wwS": "solidPrecipProb1h",
    "wwS6": "solidPrecipProb6h",
    "wwSh": "solidPrecipProb12h",
    "wwT": "thunderProb1h",
    "wwT6": "thunderProb6h",
    "wwTd": "thunderProb24h",
    "wwTh": "thunderProb12h",
    "wwZ": "drizzleProb1h",
    "wwZ6": "drizzleProb6h",
    "wwZh": "drizzleProb12h",
    # --- Wolken ---
    "H_BsC": "convectiveCloudBase",
}


# Korrekturen offensichtlicher Tippfehler in der DWD-Excel (Stand 25.05.2020):
# - SunD3: Einheit "s/s" -> "s" (Sonnenscheindauer, keine Rate)
# - RadS3: Einheit "kJ/m3" -> "kJ/m2" (Strahlungsbilanz pro Flaeche)
UNIT_OVERRIDES = {
    "SunD3": "s",
    "RadS3": "kJ/m2",
}

# Redaktionelle Umrechnungs-Zuordnung je Feld (spiegelt die UI-Toggles der
# Node wider; nur weil ein Feld eine bestimmte Einheit traegt, wird NICHT
# automatisch umgerechnet – bewusste Ausnahme z. B. H_BsC in m).
# Bekannte Conversion-Werte:
#   toC (K -> °C), windToKmh (m/s -> km/h),
#   pressureToHpa (Pa -> hPa), visibilityToKm (m -> km)
CONVERSIONS = {
    # Temperatur (Kelvin)
    "TTT": "toC",
    "Td": "toC",
    "T5cm": "toC",
    "TG": "toC",
    "TM": "toC",
    "TN": "toC",
    "TX": "toC",
    "T_2M": "toC",
    "E_TTT": "toC",
    "E_Td": "toC",
    # Windgeschwindigkeit (m/s)
    "FF": "windToKmh",
    "FX1": "windToKmh",
    "FX3": "windToKmh",
    "FXh": "windToKmh",
    "E_FF": "windToKmh",
    # Druck (Pa)
    "PPPP": "pressureToHpa",
    "E_PPP": "pressureToHpa",
    # Sichtweite (m) — bewusst NUR VV, nicht H_BsC (Wolkenbasis bleibt m)
    "VV": "visibilityToKm",
}

KNOWN_CONVERSIONS = {"toC", "windToKmh", "pressureToHpa", "visibilityToKm"}


def main() -> None:
    import openpyxl

    src = Path(sys.argv[1])
    wb = openpyxl.load_workbook(src, read_only=True)
    sh = wb["MOSMIX-Variablen"]
    rows = list(sh.iter_rows(values_only=True))

    elements = []
    for r in rows[4:]:  # Daten ab Zeile 5 (Index 4)
        code, unit, desc_en, s, l, desc_de = (list(r) + [None] * 6)[:6]
        if not code:
            continue
        code = str(code).strip()
        # Footer-Zeilen der DWD-Excel überspringen
        if code not in FIELDNAMES:
            print(f"  ! übersprungen (kein Feldname, vermutlich Footer): {code[:60]}")
            continue
        unit_value = str(unit).strip() if unit else ""
        if code in UNIT_OVERRIDES:
            unit_value = UNIT_OVERRIDES[code]
        conversion = CONVERSIONS.get(code)
        if conversion is not None and conversion not in KNOWN_CONVERSIONS:
            sys.exit(f"Unbekannte Conversion '{conversion}' bei Code {code}")
        elements.append({
            "code": code,
            "fieldname": FIELDNAMES[code],
            "unit": unit_value,
            "conversion": conversion,
            "mosmix_s": bool(str(s).strip().lower() == "x"),
            "mosmix_l": bool(str(l).strip().lower() == "x"),
            "description_de": (str(desc_de).strip() if desc_de else ""),
            "description_en": (str(desc_en).strip() if desc_en else ""),
        })

    missing = set(FIELDNAMES) - {e["code"] for e in elements}
    if missing:
        sys.exit(f"Feldnamen ohne Excel-Zeile: {sorted(missing)}")

    fieldnames = [e["fieldname"] for e in elements]
    dupes = {f for f in fieldnames if fieldnames.count(f) > 1}
    if dupes:
        sys.exit(f"Doppelte Feldnamen: {sorted(dupes)}")

    dst = Path(__file__).parent.parent / "nodes" / "mosmix_elements.json"
    dst.write_text(
        json.dumps(elements, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"{len(elements)} Elemente -> {dst}")


if __name__ == "__main__":
    main()
