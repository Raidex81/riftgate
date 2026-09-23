// --- Windows platform integration ------------------------------------------
// Extracted from main.js as part of adding macOS support (see mac.js for the
// Mac side of this same interface). This file is a behavior-preserving
// extraction: every function here is the exact same logic that used to live
// directly in main.js, just moved and renamed to match the shared interface
// platform/index.js dispatches to. Nothing about how the Windows app behaves
// should change because of this move.

const { shell } = require("electron");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const platformName = "windows";

function extractVdfValue(content, key) {
    const match = content.match(new RegExp(`"${key}"\\s*"([^"]*)"`, "i"));
    return match ? match[1] : null;
}

function findSteamLibraryPaths() {
    const candidates = [
        "C:\\Program Files (x86)\\Steam",
        "C:\\Program Files\\Steam"
    ];

    const steamRoot = candidates.find((p) => fs.existsSync(p));
    if (!steamRoot) return [];

    const libraryPaths = [path.join(steamRoot, "steamapps")];

    const vdfPath = path.join(steamRoot, "steamapps", "libraryfolders.vdf");

    try {
        if (fs.existsSync(vdfPath)) {
            const content = fs.readFileSync(vdfPath, "utf8");
            const pathMatches = content.matchAll(/"path"\s*"([^"]*)"/gi);

            for (const m of pathMatches) {
                const libPath = path.join(m[1].replace(/\\\\/g, "\\"), "steamapps");
                if (fs.existsSync(libPath) && !libraryPaths.includes(libPath)) {
                    libraryPaths.push(libPath);
                }
            }
        }
    } catch (err) {
        console.error("[import] failed to parse Steam libraryfolders.vdf:", err.message || err);
    }

    return libraryPaths;
}

function scanSteamGames() {
    const games = [];

    try {
        for (const steamapps of findSteamLibraryPaths()) {
            if (!fs.existsSync(steamapps)) continue;

            const manifestFiles = fs.readdirSync(steamapps)
                .filter((f) => /^appmanifest_\d+\.acf$/i.test(f));

            for (const file of manifestFiles) {
                try {
                    const content = fs.readFileSync(path.join(steamapps, file), "utf8");
                    const appid = extractVdfValue(content, "appid");
                    const name = extractVdfValue(content, "name");

                    if (appid && name) {
                        games.push({
                            name,
                            path: `steam://rungameid/${appid}`,
                            source: "Steam"
                        });
                    }
                } catch (err) {
                    // skip unreadable manifest, keep scanning the rest
                }
            }
        }
    } catch (err) {
        console.error("[import] Steam scan failed:", err.message || err);
    }

    return games;
}

function isSteamAppStillInstalled(appid) {
    try {
        for (const steamapps of findSteamLibraryPaths()) {
            if (fs.existsSync(path.join(steamapps, `appmanifest_${appid}.acf`))) {
                return true;
            }
        }
        return false;
    } catch (err) {
        return true;
    }
}

function scanEpicGames() {
    const games = [];
    const manifestDir = "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests";

    try {
        if (!fs.existsSync(manifestDir)) return games;

        const itemFiles = fs.readdirSync(manifestDir)
            .filter((f) => f.toLowerCase().endsWith(".item"));

        for (const file of itemFiles) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(manifestDir, file), "utf8"));

                if (data.DisplayName && data.InstallLocation && data.LaunchExecutable) {
                    const exePath = path.join(data.InstallLocation, data.LaunchExecutable);

                    if (fs.existsSync(exePath)) {
                        games.push({
                            name: data.DisplayName,
                            path: exePath,
                            source: "Epic Games"
                        });
                    }
                }
            } catch (err) {
                // skip unreadable/malformed manifest, keep scanning the rest
            }
        }
    } catch (err) {
        console.error("[import] Epic scan failed:", err.message || err);
    }

    return games;
}

// Every store this platform can identify from its own manifest files
// (Steam, Epic). Anything else installed through a launcher without a
// manifest (Battle.net, GOG Galaxy, Riot, Ubisoft Connect, ...) is only
// found via scanGenericApps() below.
function scanStoreManifests() {
    return [...scanSteamGames(), ...scanEpicGames()];
}

// Finds installed desktop apps/games via Start Menu shortcuts (.lnk) —
// this covers everything scanStoreManifests misses, since virtually every
// Windows installer creates one of these. Resolves shortcut targets in a
// single PowerShell pass rather than one process per shortcut, for speed.
function scanGenericApps() {
    return new Promise((resolve) => {
        const psScript = [
            '$ErrorActionPreference = "SilentlyContinue"',
            '$shell = New-Object -ComObject WScript.Shell',
            '$dirs = @(',
            '    "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",',
            '    "$env:AppData\\Microsoft\\Windows\\Start Menu\\Programs"',
            ')',
            '$skipWords = @("uninstall","read me","readme","help","website","license","support","changelog","documentation","faq","setup","install")',
            '$results = @()',
            'foreach ($dir in $dirs) {',
            '    if (-not (Test-Path $dir)) { continue }',
            '    Get-ChildItem -Path $dir -Filter *.lnk -Recurse | ForEach-Object {',
            '        $nameLower = $_.BaseName.ToLower()',
            '        $skip = $false',
            '        foreach ($w in $skipWords) { if ($nameLower.Contains($w)) { $skip = $true } }',
            '        if ($skip) { return }',
            '        try {',
            '            $sc = $shell.CreateShortcut($_.FullName)',
            '            $target = $sc.TargetPath',
            '            if ($target -and $target.ToLower().EndsWith(".exe") -and (Test-Path $target)) {',
            '                $results += [PSCustomObject]@{ name = $_.BaseName; path = $target }',
            '            }',
            '        } catch {}',
            '    }',
            '}',
            '$results | ConvertTo-Json -Compress'
        ].join("\n");

        execFile(
            "powershell",
            ["-NoProfile", "-NonInteractive", "-Command", psScript],
            { timeout: 20000, maxBuffer: 10 * 1024 * 1024 },
            (error, stdout) => {
                if (error || !stdout) {
                    if (error) console.error("[import] shortcut scan failed:", error.message || error);
                    resolve([]);
                    return;
                }
                try {
                    let parsed = JSON.parse(stdout);
                    if (!Array.isArray(parsed)) parsed = parsed ? [parsed] : [];
                    const seen = new Set();
                    const deduped = [];
                    for (const item of parsed) {
                        if (!item || !item.name || !item.path) continue;
                        const key = String(item.path).toLowerCase() + "|" + String(item.name).toLowerCase();
                        if (seen.has(key)) continue;
                        seen.add(key);
                        deduped.push({ name: item.name, path: item.path, source: "Detected" });
                    }
                    resolve(deduped);
                } catch (err) {
                    console.error("[import] shortcut scan JSON parse failed:", err.message || err);
                    resolve([]);
                }
            }
        );
    });
}

// Resolves a Windows .lnk shortcut to its real target executable, so a
// shortcut dragged in from the desktop/Start Menu works the same as
// dragging the actual .exe. Non-shortcut paths pass through unchanged.
function resolveShortcut(filePath) {
    if (!filePath.toLowerCase().endsWith(".lnk")) {
        return filePath;
    }

    try {
        const shortcut = shell.readShortcutLink(filePath);
        return shortcut.target || filePath;
    } catch (err) {
        console.error("[shortcut] failed to resolve .lnk:", err.message || err);
        return filePath;
    }
}

// Reads the embedded FileDescription from an .exe's Windows version info
// (e.g. chrome.exe's real description is "Google Chrome", not "Chrome") —
// this is what fixes wrong covers/descriptions/trailers caused by using
// just the filename.
function getExeDescription(exePath) {
    return new Promise((resolve) => {
        const psCommand = "(Get-Item -LiteralPath $env:RIFTGATE_EXE_PATH).VersionInfo.FileDescription";

        execFile(
            "powershell",
            ["-NoProfile", "-NonInteractive", "-Command", psCommand],
            { timeout: 5000, env: { ...process.env, RIFTGATE_EXE_PATH: exePath } },
            (error, stdout) => {
                if (error) {
                    resolve(null);
                    return;
                }
                const desc = stdout.trim();
                resolve(desc || null);
            }
        );
    });
}

// Checks whether any process with the given image name (e.g. "BF6.exe")
// is currently running, using Windows' tasklist. Used instead of watching
// the initially-spawned process directly, since many games/launchers spawn
// a short-lived bootstrapper that exits immediately while the real app
// keeps running (Steam, Battle.net, and anti-cheat wrappers all do this).
function isProcessRunning(imageName) {
    return new Promise((resolve) => {
        execFile(
            "tasklist",
            ["/FI", `IMAGENAME eq ${imageName}`, "/FO", "CSV", "/NH"],
            (error, stdout) => {
                if (error) {
                    resolve(false);
                    return;
                }
                resolve(stdout.toLowerCase().includes(imageName.toLowerCase()));
            }
        );
    });
}

function getAllProcesses() {
    return new Promise((resolve) => {
        execFile("tasklist", ["/FO", "CSV", "/NH"], (error, stdout) => {
            if (error) {
                resolve([]);
                return;
            }
            const processes = stdout
                .split("\n")
                .map((line) => {
                    const match = line.match(/^"([^"]+)","(\d+)"/);
                    return match ? { name: match[1], pid: match[2] } : null;
                })
                .filter(Boolean);
            resolve(processes);
        });
    });
}

// The image name tasklist/isProcessRunning expects to match against, for
// a freshly launched game — the .exe's own filename. Returns a Promise for
// interface parity with the Mac side, which needs an actual plist lookup.
function getLaunchImageName(exePath) {
    return Promise.resolve(path.basename(exePath));
}

// Launches a real filesystem path (not a launcher:// protocol URI, which
// callers handle separately via shell.openExternal).
function spawnApp(exePath, onExit) {
    execFile(exePath, (error) => {
        if (error) {
            console.error(error);
        }
        if (onExit) onExit(error);
    });
}

// --- Detecting a freshly-installed app/game --------------------------------
// Watches for any running process whose name looks like an installer
// ("setup", "install"), and once it exits, checks whether any shortcut
// appeared on the Desktop or in the Start Menu more recently than the
// installer started — a strong signal something just got installed.
const INSTALLER_NAME_PATTERNS = [/setup/i, /install/i];
let watchedInstallers = {}; // { pid: { name, startTime } }

function scanForNewShortcuts(sinceTimestamp, gamesFilePath, onDetected) {
    const { app } = require("electron");
    const locations = [
        app.getPath("desktop"),
        process.env.APPDATA ? path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs") : null,
        process.env.ProgramData ? path.join(process.env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs") : null
    ].filter(Boolean);

    const foundShortcuts = [];

    for (const dir of locations) {
        if (!fs.existsSync(dir)) continue;

        try {
            const scan = (folder, depth) => {
                if (depth > 2) return;
                let entries;
                try {
                    entries = fs.readdirSync(folder, { withFileTypes: true });
                } catch (err) {
                    return;
                }
                for (const entry of entries) {
                    const fullPath = path.join(folder, entry.name);
                    if (entry.isDirectory()) {
                        scan(fullPath, depth + 1);
                    } else if (entry.name.toLowerCase().endsWith(".lnk")) {
                        try {
                            const stat = fs.statSync(fullPath);
                            if (stat.mtimeMs > sinceTimestamp) {
                                foundShortcuts.push({ path: fullPath, name: entry.name.replace(/\.lnk$/i, "") });
                            }
                        } catch (err) {
                            // skip unreadable shortcut
                        }
                    }
                }
            };
            scan(dir, 0);
        } catch (err) {
            console.error("[installer-detect] scan failed for", dir, err.message || err);
        }
    }

    if (foundShortcuts.length === 0) return;

    const seenTargets = new Set();
    const candidates = [];

    let existingPaths = new Set();
    try {
        const games = JSON.parse(fs.readFileSync(gamesFilePath, "utf8"));
        existingPaths = new Set(games.map((g) => (g.path || "").toLowerCase()));
    } catch (err) {
        // if this fails, just proceed without the extra check
    }

    for (const item of foundShortcuts) {
        try {
            const shortcut = shell.readShortcutLink(item.path);
            const target = shortcut.target;
            if (!target) continue;
            const key = target.toLowerCase();
            if (seenTargets.has(key) || existingPaths.has(key)) continue;
            seenTargets.add(key);
            candidates.push({ path: target, name: item.name });
        } catch (err) {
            // unreadable shortcut, skip
        }
    }

    if (candidates.length > 0) {
        console.log(`[installer-detect] Found ${candidates.length} new install(s) after installer closed.`);
        onDetected(candidates);
    }
}

// Starts the recurring watcher for newly-installed apps. Calls
// onDetected(candidates) whenever it finds some. gamesFilePath is a
// function returning the current GAMES_FILE path (it's set at startup,
// after this module is first used).
function startInstallWatcher(getGamesFilePath, onDetected) {
    setInterval(async () => {
        const processes = await getAllProcesses();
        const currentPids = new Set(processes.map((p) => p.pid));

        processes.forEach((proc) => {
            if (proc.name.toLowerCase().includes("riftgate")) return;

            const looksLikeInstaller = INSTALLER_NAME_PATTERNS.some((pattern) => pattern.test(proc.name));
            if (looksLikeInstaller && !watchedInstallers[proc.pid]) {
                watchedInstallers[proc.pid] = { name: proc.name, startTime: Date.now() };
                console.log(`[installer-detect] Watching installer process: ${proc.name} (PID ${proc.pid})`);
            }
        });

        for (const pid of Object.keys(watchedInstallers)) {
            if (!currentPids.has(pid)) {
                const { name, startTime } = watchedInstallers[pid];
                delete watchedInstallers[pid];
                console.log(`[installer-detect] ${name} (PID ${pid}) exited — scanning for new shortcuts...`);
                scanForNewShortcuts(startTime, getGamesFilePath(), onDetected);
            }
        }
    }, 5000);
}

// Many Electron-based apps (Discord, Slack, VS Code, and others) use a
// versioned-folder auto-update scheme: <parent>\app-X.Y.Z\<AppName>.exe.
// When the app updates itself, it creates a new version folder and the
// old one — which Riftgate's saved path points to — stops existing, so
// the app looks "removed" even though it's still installed, just at a
// new version folder. This checks specifically for that pattern before
// giving up, so an update doesn't get mistaken for an uninstall.
function findRelocatedApp(originalPath) {
    try {
        const dir = path.dirname(originalPath);
        const exeName = path.basename(originalPath);
        const dirName = path.basename(dir);

        if (!/^app-[\d.]+$/i.test(dirName)) return null;

        const parentDir = path.dirname(dir);
        if (!fs.existsSync(parentDir)) return null;

        const siblingFolders = fs.readdirSync(parentDir)
            .filter((name) => /^app-[\d.]+$/i.test(name) && name !== dirName);

        for (const folder of siblingFolders) {
            const candidatePath = path.join(parentDir, folder, exeName);
            if (fs.existsSync(candidatePath)) {
                return candidatePath;
            }
        }
        return null;
    } catch (err) {
        return null;
    }
}

// --- Real uninstall (Windows registry) -------------------------------------
const UNINSTALL_REGISTRY_HIVES = [
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
];

function queryUninstallHive(hivePath) {
    return new Promise((resolve) => {
        execFile("reg", ["query", hivePath, "/s"], { maxBuffer: 1024 * 1024 * 20 }, (error, stdout) => {
            if (error || !stdout) {
                resolve([]);
                return;
            }
            resolve(parseUninstallRegistryOutput(stdout));
        });
    });
}

function parseUninstallRegistryOutput(stdout) {
    const entries = [];
    const blocks = stdout.split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean);

    blocks.forEach((block) => {
        const lines = block.split(/\r?\n/);
        const keyLine = lines[0].trim();
        if (!keyLine.startsWith("HKEY_")) return;

        const entry = {};
        for (let i = 1; i < lines.length; i++) {
            const match = /^\s{2,}(\S.*?)\s{2,}(REG_[A-Z_]+)\s{2,}(.*)$/.exec(lines[i]);
            if (!match) continue;
            entry[match[1]] = match[3].trim();
        }
        if (entry.DisplayName) entries.push(entry);
    });

    return entries;
}

async function queryAllUninstallEntries() {
    const results = await Promise.all(UNINSTALL_REGISTRY_HIVES.map(queryUninstallHive));
    return results.flat();
}

// Splits a registry UninstallString ("C:\Path To\uninst.exe" /flag, or a
// bare MsiExec.exe /X{GUID} call) into an executable and its arguments,
// respecting a quoted executable path.
function parseUninstallCommand(cmd) {
    if (!cmd) return null;
    const trimmed = cmd.trim();

    if (trimmed.startsWith('"')) {
        const closingQuote = trimmed.indexOf('"', 1);
        if (closingQuote === -1) return { exe: trimmed.slice(1), args: [] };
        const exe = trimmed.slice(1, closingQuote);
        const rest = trimmed.slice(closingQuote + 1).trim();
        return { exe, args: rest ? rest.split(/\s+/) : [] };
    }

    const parts = trimmed.split(/\s+/);
    return { exe: parts[0], args: parts.slice(1) };
}

// Tries to find the registry Uninstall entry for an installed program,
// preferring an exact install-folder match over a name-based guess.
async function findUninstallEntryForGame(gamePath, gameName) {
    const entries = await queryAllUninstallEntries();
    const gameDir = path.dirname(gamePath).replace(/\\+$/, "").toLowerCase();

    let match = entries.find((e) => {
        if (!e.InstallLocation) return false;
        const loc = e.InstallLocation.replace(/\\+$/, "").toLowerCase();
        return loc && (gameDir === loc || gameDir.startsWith(loc + "\\"));
    });

    let confidence = "high";

    if (!match) {
        match = entries.find((e) => {
            const ref = (e.UninstallString || e.DisplayIcon || "").toLowerCase();
            return ref.includes(gameDir);
        });
    }

    if (!match && gameName) {
        const normalizedName = gameName.toLowerCase().trim();
        match = entries.find((e) => {
            const displayName = (e.DisplayName || "").toLowerCase().trim();
            return displayName && (displayName === normalizedName || displayName.includes(normalizedName) || normalizedName.includes(displayName));
        });
        confidence = "low";
    }

    if (!match || !match.UninstallString) return null;

    return {
        displayName: match.DisplayName,
        uninstallString: match.UninstallString,
        confidence
    };
}

// Looks up the same uninstaller Control Panel / Settings would run (from
// the registry's Uninstall keys) and launches it directly, rather than
// deleting any files ourselves.
async function uninstallApp(gamePath, gameName) {
    const found = await findUninstallEntryForGame(gamePath, gameName);

    if (!found) {
        return {
            success: false,
            reason: "not_found",
            error: "Couldn't find an uninstaller for this in Windows' installed-programs list (common for portable apps or manually-added entries). You can still remove it from Riftgate's list, or uninstall it yourself from Windows Settings."
        };
    }

    const command = parseUninstallCommand(found.uninstallString);
    if (!command || !command.exe) {
        return {
            success: false,
            reason: "unparseable",
            error: "Found an uninstaller entry, but couldn't understand how to run it."
        };
    }

    execFile(command.exe, command.args, (error) => {
        if (error) {
            console.error("[uninstall] uninstaller process error:", error.message || error);
        }
    });

    return {
        success: true,
        displayName: found.displayName,
        confidence: found.confidence
    };
}

module.exports = {
    platformName,
    scanStoreManifests,
    scanGenericApps,
    isSteamAppStillInstalled,
    resolveShortcut,
    getExeDescription,
    isProcessRunning,
    getAllProcesses,
    getLaunchImageName,
    spawnApp,
    startInstallWatcher,
    findRelocatedApp,
    uninstallApp,
    // exposed for tests / debugging, not part of the cross-platform contract
    _internal: {
        extractVdfValue,
        findSteamLibraryPaths,
        scanSteamGames,
        scanEpicGames,
        parseUninstallCommand,
        parseUninstallRegistryOutput
    }
};
