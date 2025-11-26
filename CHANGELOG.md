## Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- (none)

## [1.4.1] – 2025-11-26

### Added
- Introduced fully localised precipitation description (`precipitationText`) with dynamic interpolation for intensity and value.
- Added new i18n keys for precipitation intensity levels (`precipIntensityLight`, `precipIntensityModerate`, `precipIntensityHeavy`) in all locale files.

### Changed
- Moved help text into dedicated, language-specific HTML files under `nodes/locales/<lang>/` according to official Node-RED i18n guidelines.
- Centralised runtime translation helper (`t()`) at module level for consistent access across all functions.
- Standardised interpolation syntax to `__variable__` for full compatibility with Node-RED’s i18n engine.
- Unified i18n key structure to align with conventions used across the updated DWD node family.

### Fixed
- Corrected missing precipitation translation caused by non-interpolated placeholders.
- Fixed a runtime error (`t is not defined`) by adjusting the translation helper scope.

## [1.4.0] - 2025-11-16
### Added
- Fully rewritten **English README** in modern structure (consistent with entire DWD node family)
- Updated and standardised **example flow** (`examples/weatherforecast-basic.json`)
- Added detailed installation instructions (including Palette Manager guidance)

### Changed
- Documentation structure unified across all DWD-related nodes (Pollen, Forecast, Warnings, Rainradar)
- Improved i18n descriptions and clarified how translator files are organised
- Refined configuration explanations (station ID, source URL, unit conversions, wind direction modes)
- Cleanup and modernisation of help text references

### Fixed
- Removed outdated documentation sections
- Minor markdown formatting corrections

### CI
- Automatically mark `-beta`, `-alpha` and `-rc` tags as **GitHub pre-releases**.

## [1.3.1] - 2025-11-15
### Fixed
- Release workflow corrected

## [1.3.0] - 2025-11-15
### Added
- Full internationalization (i18n) support for all UI elements.
  - Runtime messages localized via `RED._(...)`.
  - Editor UI now supports multi-language labels using `data-i18n`.
  - Help text moved to per-language files:
      - `nodes/locales/en-US/<node>.html`
      - `nodes/locales/de/<node>.html`
  - Automatic language switching based on Node-RED editor settings
    (“Browser”, “Deutsch”, “English”).

### Changed
- Updated internal structure to use the official Node-RED i18n layout:
    - `nodes/locales/<lang>/<node>.json`
    - `nodes/locales/<lang>/<node>.html`
  - Simplified template HTML by removing inline help text.

## [1.2.1] - 2025-11-06
### Docs
- Unified README style and structure with other DWD modules for consistent documentation.

## [1.2.0] – 2025-11-05
### Added
- Option **“Wind direction as text”** (`windDirMode`) in the UI with three modes:  
  `deg` (default, degrees only), `8` (N, NE, E, SE, S, SW, W, NW), `16` (N, NNE, NE, …).  
  For `8`/`16`, in addition to `windDir` (°), the field **`windDirCardinal`** is output in the payload.
- `_meta.windDirMode` reflects the selected setting.

### Changed
- No breaking changes. Default behavior remains unchanged (`deg`).

### Migration
- No actions required. Flows continue to work unchanged.

## [1.1.2] - 2025-11-02
### Fixed
- **Station name:** automatically read from `<kml:name>` or `<kml:description>`

## [1.1.1] - 2025-11-02
### Added
- **Filter “Only future timestamps”**: removes past timestamps before the optional hour limit applies.
- Optional **stale fallback**: sends the last successful response in case of errors, if enabled.

## [1.1.0] - 2025-11-02
### Added
- Fallback calculation of relative humidity from `TTT` (temp) and `Td` (dew point) if `rH/RELH` is not included in the MOSMIX-KML.

### Fixed
- More robust KML parser strategy (Placemark/ExtendedData, dwd:Forecast, regex fallback) to reliably find parameters.
- The limitation of the forecast to `hoursAhead` (lead time) is now correctly applied.
- Various diagnostic logs added to detect future parsing issues more quickly.

### Changed
- Consistent normalization and safe unit conversion (°C, km/h, hPa, km).

## [1.0.9] - 2025-11-01
### Fixed
- Parser error “Unexpected token ':'” in `dwd-weatherforecast.js` fixed
  (incorrect access to `dwd:ProductDefinition`).

## [1.0.8] - 2025-10-30
### Changed
- Release process improved:
    - New script `scripts/ensure-changelog.js` automatically checks on version bump whether `CHANGELOG.md` was changed and staged.
    - New `preversion`, `version` and `postversion` hooks in `package.json` for consistent commits and automatic push.
- `package.json` extended with release scripts and build process optimized.
- No functional changes to the Node code itself.

## [1.0.7] - 2025-10-30
### Changed
- HTTP client: migration from `request` (deprecated) to `axios`
- More stable error and timeout handling for DWD requests

## [1.0.6] - 2025-10-30
### Changed
- Dependencies updated: adm-zip, moment-timezone, xml2js (scorecard “latest deps”)
- Verification: `node-red.version` present on npm (scorecard note was cache)

## [1.0.5] - 2025-10-30
### Changed
- Release workflow (`.github/workflows/release.yml`) revised:
    - Automatic creation of GitHub releases with release notes
    - Maintenance of the `latest` tag for clear assignment of current version
    - Better security and consistency checks before npm publish
- `package.json`: minimum versions added
    - Node-RED: `"node-red.version": ">=3.0.0"`
    - Node.js/NPM: `"engines": { "node": ">=18.0.0", "npm": ">=9.0.0" }`
- Examples added: `examples/weatherforecast-basic.json` (for scorecard “Examples”)
- Metadata/files: `files` field now includes `examples/` and `CHANGELOG.md`

### Security / Maintenance
- Dependencies checked for current ranges (scorecard note)

## [1.0.4] - 2025-10-30
### Changed
- Metadata in `package.json` extended (`homepage`, `bugs`, `publishConfig`, `engines`)
- Presentation and linking on npm and flows.nodered.org improved

## [1.0.3] - 2025-10-30
### Added
- New `.gitignore` in repository root for Node.js, Node-RED, and WebStorm projects
- New `CHANGELOG.md` for separate maintenance of version changes

### Changed
- README.md adjusted: removed changelog section and added link to `CHANGELOG.md`
- Minor formatting and structural improvements in the documentation

## [1.0.2] - 2025-10-30
### Fixed
- Workflow tag v1.0.1 did not contain workflow file – release not triggered
- Newly tagged version v1.0.2 now triggers automatic publication

### Changed
- Repository finally synchronized with `release.yml`
- NPM publication successfully tested and confirmed

## [1.0.1] - 2025-10-30
### Added
- New node “DWD Forecast” for MOSMIX_L weather forecasts
- Supports decompression and parsing of `.kmz` (KML) files
- UI options for station selection and data fields (core, wind, pressure parameters)
- Automatic release workflow for GitHub + npm integrated

## [1.0.0] - 2025-10-30
### Added
- Initial release
- Full support for DWD MOSMIX_L single stations
- Added unit conversions and core data mode
- Added precipitation text generation
- Added RELH fallback calculation
- Added station name + ID metadata
- Added stale fallback and auto-refresh options
