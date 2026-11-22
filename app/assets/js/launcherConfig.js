// Everything that ties this launcher build to one specific project lives
// either here or in the few non-JS files listed in the README ("Configuration and branding")
// - nothing else in app/ should hardcode a server, URL or brand name.

const pkg = require('../../../package.json')

// URL of the silo-sync backend (github.com/Silo-RP/launcher-backend), serving
// config.json / news.json / files / java / forge / backgrounds for this server.
// No trailing slash.
exports.SYNC_URL = 'http://185.146.193.198:25570'

// GitHub "owner/repo" the launcher's releases are published to: release
// notes feed (Settings > About), macOS update download link. Must match the
// `publish` block of electron-builder.yml, which is what the auto-updater
// itself reads.
exports.GITHUB_REPO = 'Silo-RP/launcher-client'

// Folder created under the OS app-data root (%APPDATA%, ~/Library/Application
// Support, ~) that holds the game files: common/, instances/, Java runtimes.
// Kept distinct per project so two launchers built from this codebase never
// share or clobber each other's game files on the same machine.
exports.DATA_DIR_NAME = '.silolauncher'

// Shown to Minecraft (${launcher_name}) and in the macOS dock.
exports.LAUNCHER_NAME = pkg.productName

// Installer file prefix, matches the `artifactName` patterns of
// electron-builder.yml (`${name}-setup-...`).
exports.ARTIFACT_PREFIX = pkg.name
