#!/usr/bin/env node
/* eslint-disable no-console */
const { execSync } = require('node:child_process');

function run(cmd) {
    return execSync(cmd, { encoding: 'utf8' }).trim();
}
function list(cmd) {
    const out = run(cmd);
    return out ? out.split('\n').map(s => s.trim()).filter(Boolean) : [];
}

try {
    if (process.env.ALLOW_NO_CHANGELOG === '1') {
        console.log('⚠️  Skipping changelog check because ALLOW_NO_CHANGELOG=1');
        process.exit(0);
    }

    // 1) Existenz prüfen
    try { run('test -f CHANGELOG.md || test -f Changelog.md || test -f changelog.md'); }
    catch {
        console.error('❌ CHANGELOG.md fehlt (Prüfe Groß-/Kleinschreibung).');
        process.exit(1);
    }

    // 2) Dateiname case-insensitiv ermitteln
    const tracked = list('git ls-files');
    const changeLogPath = tracked.find(f => f.toLowerCase() === 'changelog.md');
    if (!changeLogPath) {
        console.error('❌ CHANGELOG.md ist nicht getrackt (git ls-files findet sie nicht).');
        process.exit(1);
    }

    // 3) Fälle, die wir akzeptieren:
    const staged = list('git diff --name-only --cached').map(s => s.toLowerCase());
    const unstaged = list('git diff --name-only').map(s => s.toLowerCase());
    let touchedInHead = false;
    try {
        touchedInHead = list('git show --name-only --pretty="" HEAD')
            .map(s => s.toLowerCase())
            .includes(changeLogPath.toLowerCase());
    } catch { /* HEAD kann fehlen in frischen Repos */ }

    const isStaged = staged.includes(changeLogPath.toLowerCase());
    const isUnstaged = unstaged.includes(changeLogPath.toLowerCase());

    if (isStaged || isUnstaged || touchedInHead) {
        console.log(`✅ CHANGELOG erkannt (${changeLogPath}) – Zustand: ` +
            `${isStaged ? 'staged' : isUnstaged ? 'unstaged' : 'im letzten Commit geändert'}.`);
        process.exit(0);
    }

    console.error('❌ CHANGELOG.md wurde für diesen Release nicht geändert oder ist nicht gestaged.');
    console.error('   Bitte `CHANGELOG.md` anpassen und `git add CHANGELOG.md` ausführen.');
    process.exit(1);
} catch (e) {
    console.error(e.message || e);
    process.exit(1);
}