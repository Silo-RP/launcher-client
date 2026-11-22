/**
 * Script for landing.ejs
 */
// Requirements
const {
    MojangRestAPI,
    getServerStatus
}                             = require('helios-core/mojang')
const {
    RestResponseStatus
}                             = require('helios-core/common')
const {
    MojangIndexProcessor,
    downloadQueue,
    getExpectedDownloadSize
}                             = require('helios-core/dl')

// Internal Requirements
const fs                      = require('fs-extra')
const ProcessBuilder          = require('./assets/js/processbuilder')
const { ensureDefaultServerList } = require('./assets/js/serverlistutil')
const syncClient              = require('./assets/js/syncClient')
const { SYNC_URL }    = require('./assets/js/launcherConfig')
const newsManager              = require('./assets/js/newsManager')

// Launch Elements
const landingContainer        = document.getElementById('landingContainer')
const launch_content          = document.getElementById('launch_content')
const launch_button           = document.getElementById('launch_button')
const launch_details          = document.getElementById('launch_details')
const launch_progress         = document.getElementById('launch_progress')
const launch_fill             = document.getElementById('launch_fill')
const launch_level            = document.getElementById('launch_level')
const launch_progress_label   = document.getElementById('launch_progress_label')
const launch_details_text     = document.getElementById('launch_details_text')
const launch_state            = document.getElementById('launch_state')
const launch_log              = document.getElementById('launch_log')
const launch_log_toggle       = document.getElementById('launch_log_toggle')
const user_text               = document.getElementById('user_text')

const loggerLanding = LoggerUtil.getLogger('Landing')

/* Launch Progress Wrapper Functions */

// The launch runs several independent stages, each reporting its own 0-100%.
// They are mapped onto one monotonic progress, shown as "Niveau 087 / 144"
// (the silo's 144 levels). The background keeps its normal speed.
const LAUNCH_LEVELS = 144
const LAUNCH_PHASES = {
    validate: [0, 0.12],
    vanilla:  [0.12, 0.42],
    java:     [0.42, 0.52],
    forge:    [0.52, 0.66],
    files:    [0.66, 0.96],
    start:    [0.96, 1]
}
let launchPhase = 'validate'
let launchProgress = 0
let launchFile = ''
let launchLogLines = []

/**
 * Switch the home screen between its resting state and the launch state.
 * The launch state replaces the JOUER button with the progress block.
 *
 * @param {boolean} loading True if the loading area should be shown, otherwise false.
 */
function toggleLaunchArea(loading){
    if(loading){
        launch_button.disabled = true
        launchPhase = 'validate'
        launchProgress = 0
        launchFile = ''
        launchLogLines = []
        renderLaunchLog()
        setLaunchState('preparing')
        landingContainer.setAttribute('data-mode', 'lancement')
        renderLaunchProgress()
    } else {
        landingContainer.setAttribute('data-mode', 'accueil')
        setLaunchLogOpen(false)
        setLaunchEnabled(ConfigManager.getSelectedServer() != null)
    }
    if(getCurrentView() === VIEWS.landing){
        siloOnView(VIEWS.landing)
    }
}

/**
 * Right-hand state button while launching: LANCEMENT (preparing) or
 * EN JEU (the game process is running). Never clickable.
 *
 * @param {'preparing'|'ingame'} state The state to show.
 */
function setLaunchState(state){
    launch_state.setAttribute('data-state', state)
    launch_state.innerHTML = state === 'ingame'
        ? Lang.queryJS('landing.launchState.ingame')
        : Lang.queryJS('landing.launchState.preparing')
}

/**
 * Set the details text of the loading area, and log it in the journal.
 *
 * @param {string} details The new text for the loading details.
 */
function setLaunchDetails(details){
    launch_details_text.innerHTML = details
    launchFile = ''
    const text = launch_details_text.textContent
    if(launchLogLines.length === 0 || launchLogLines[launchLogLines.length-1].text !== text){
        launchLogLines.forEach(l => { if(l.status === 'run') l.status = 'ok' })
        launchLogLines.push({ time: new Date().toLocaleTimeString('fr-FR'), text, status: 'run' })
        renderLaunchLog()
    }
    renderLaunchProgress()
}

/**
 * Show the file currently being downloaded under the progress bar.
 *
 * @param {string} file The file name.
 */
function setLaunchFile(file){
    launchFile = file || ''
    renderLaunchProgress()
}

/**
 * Start a new launch stage: its 0-100% maps onto the stage's slice of the
 * overall progress.
 *
 * @param {string} phase A key of LAUNCH_PHASES.
 */
function setLaunchPhase(phase){
    launchPhase = phase
    setLaunchPercentage(0)
}

/**
 * Set the progress of the current stage.
 *
 * @param {number} percent Percentage (0-100)
 */
function setLaunchPercentage(percent){
    const [from, to] = LAUNCH_PHASES[launchPhase] || LAUNCH_PHASES.validate
    const p = Math.min(100, Math.max(0, Number(percent) || 0)) / 100
    launchProgress = Math.max(launchProgress, from + (to - from) * p)
    renderLaunchProgress()
}

function renderLaunchProgress(){
    const level = Math.round(launchProgress * LAUNCH_LEVELS)
    launch_level.textContent = Lang.queryJS('landing.level', { level: String(level).padStart(3, '0'), total: LAUNCH_LEVELS })
    launch_fill.style.width = (launchProgress * 100).toFixed(2) + '%'
    launch_progress.setAttribute('aria-valuenow', level)
    const percent = Math.round(launchProgress * 100) + ' %'
    launch_progress_label.textContent = launchFile ? `${percent} · ${launchFile}` : percent
}

function renderLaunchLog(){
    launch_log.replaceChildren(...launchLogLines.map(l => {
        const row = document.createElement('div')
        const time = document.createElement('span')
        const status = document.createElement('b')
        const text = document.createElement('span')
        time.textContent = l.time
        status.textContent = Lang.queryJS(`landing.logStatus.${l.status}`)
        status.setAttribute('data-status', l.status)
        text.textContent = l.text
        row.append(time, status, text)
        return row
    }))
    launch_log.scrollTop = launch_log.scrollHeight
}

function setLaunchLogOpen(open){
    launch_log.hidden = !open
    launch_log_toggle.setAttribute('aria-expanded', open)
    launch_log_toggle.innerHTML = open ? Lang.queryJS('landing.hideLog') : Lang.queryJS('landing.showLog')
}
launch_log_toggle.addEventListener('click', () => setLaunchLogOpen(launch_log.hidden))

/**
 * Set the value of the OS progress bar and display that on the UI.
 *
 * @param {number} percent Percentage (0-100)
 */
function setDownloadPercentage(percent){
    remote.getCurrentWindow().setProgressBar(percent/100)
    setLaunchPercentage(percent)
}

/**
 * Enable or disable the launch button.
 *
 * @param {boolean} val True to enable, false to disable.
 */
function setLaunchEnabled(val){
    launch_button.disabled = !val || proc != null
}

// Bind launch button
launch_button.addEventListener('click', async e => {
    loggerLanding.info('Launching game..')
    try {
        // Java is no longer a player-facing choice: dlAsync() acquires and
        // wires up the exact Java syncClient.ensureJava() manages, so there's
        // nothing left to scan/download here first.
        await dlAsync()
    } catch(err) {
        loggerLanding.error('Unhandled error in during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
    }
})

// Bind selected account
function updateSelectedAccount(authUser){
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    if(authUser != null){
        if(authUser.displayName != null){
            username = authUser.displayName
        }
    }
    user_text.innerHTML = username
}
updateSelectedAccount(ConfigManager.getSelectedAccount())

// Server details shown on the home screen (name, tagline, versions).
let landingServer = null

/**
 * Refresh the line under the JOUER button: Forge version and allocated memory.
 */
function refreshLandingMeta(){
    const parts = []
    if(landingServer?.rawServer.forgeVersion){
        parts.push(Lang.queryJS('landing.meta.forge', { version: landingServer.rawServer.forgeVersion }))
    }
    const servId = ConfigManager.getSelectedServer()
    let maxRam = null
    try {
        // Throws until ensureJavaSettings() created this server's entry
        // (first launch: the distribution is still loading).
        maxRam = servId != null ? ConfigManager.getMaxRAM(servId) : null
    } catch {
        maxRam = null
    }
    if(maxRam){
        const gb = maxRam.endsWith('M') ? Number(maxRam.slice(0, -1)) / 1024 : Number.parseFloat(maxRam)
        parts.push(formatRamGo(gb))
    }
    document.getElementById('landingMeta').textContent = parts.join(' · ')
}

// Bind selected server
function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    landingServer = serv
    if(serv != null){
        document.getElementById('landingTitle').textContent = serv.rawServer.name || Lang.queryEJS('landing.title')
        if(serv.rawServer.description){
            document.getElementById('landingTagline').textContent = serv.rawServer.description
        }
        const version = document.getElementById('landingVersion')
        version.textContent = Lang.queryJS('landing.serverStatus.version', { version: serv.rawServer.minecraftVersion })
        version.hidden = !serv.rawServer.minecraftVersion
    }
    refreshLandingMeta()
    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
}

// Mojang status: only surfaced when an essential service is down.
const refreshMojangStatuses = async function(){
    loggerLanding.info('Refreshing Mojang Statuses..')

    const response = await MojangRestAPI.status()
    if(response.responseStatus !== RestResponseStatus.SUCCESS) {
        loggerLanding.warn('Unable to refresh Mojang service status.')
        siloSetBanner('mojang', null)
        return
    }

    const down = response.data.filter(service => service.essential && service.status === 'red')
    siloSetBanner('mojang', down.length > 0
        ? Lang.queryJS('landing.mojangOutage', { services: down.map(s => s.name).join(', ') })
        : null)
}

const refreshServerStatus = async (fade = false) => {
    loggerLanding.info('Refreshing Server Status')
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())

    let online = false
    let players = null

    try {
        const servStat = await getServerStatus(47, serv.hostname, serv.port)
        online = true
        players = Lang.queryJS('landing.serverStatus.players', { online: servStat.players.online, max: servStat.players.max })
    } catch (err) {
        loggerLanding.warn('Unable to refresh server status, assuming offline.')
        loggerLanding.debug(err)
    }

    document.getElementById('server_status_wrapper').setAttribute('data-online', online)
    document.getElementById('landingPlayerLabel').innerHTML = online
        ? Lang.queryJS('landing.serverStatus.online')
        : Lang.queryJS('landing.serverStatus.offline')
    const count = document.getElementById('player_count')
    count.innerHTML = players || ''
    count.hidden = players == null
}

refreshMojangStatuses()
// Server Status is refreshed in uibinder.js on distributionIndexDone.

// Refresh statuses every hour. The status page itself refreshes every day so...
let mojangStatusListener = setInterval(() => refreshMojangStatuses(true), 60*60*1000)
// Set refresh rate to once every 5 minutes.
let serverStatusListener = setInterval(() => refreshServerStatus(true), 300000)

/* News */

// Hash of the last successful /news.json fetch, to remember it as read once
// the Bulletin view has been opened.
let newsHash = null

/**
 * Check silo-sync for news, independent of login/server-selection state
 * (same idea as refreshMojangStatuses above) - so the home teaser is
 * already correct by the time the player sees the landing view.
 */
async function refreshNews(){
    let news
    try {
        news = await newsManager.fetchNews(SYNC_URL)
    } catch (err) {
        loggerLanding.warn('Unable to fetch news.', err)
        return
    }
    newsHash = news.hash

    const hasContent = news.content != null && news.content.trim().length > 0
    const seen = ConfigManager.getNewsCache()
    setBulletins(news.content, hasContent && (seen.date !== news.hash || !seen.dismissed))
}
refreshNews()

/**
 * Remember the current news as read (called when the Bulletin view opens).
 */
function markNewsRead(){
    document.getElementById('newsTeaser').removeAttribute('unread')
    if(newsHash != null){
        ConfigManager.setNewsCache({ date: newsHash, content: null, dismissed: true })
        ConfigManager.save()
    }
}

document.getElementById('newsTeaser').addEventListener('click', () => siloNavigate('bulletin'))

/**
 * Shows an error overlay, toggles off the launch area.
 *
 * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showLaunchFailure(title, desc){
    setOverlayContent(
        title,
        desc,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    if(proc == null){
        toggleLaunchArea(false)
    }
}

// Keep reference to Minecraft Process
let proc
const GAME_LAUNCH_REGEX = /^\[.+\]: (?:MinecraftForge .+ Initialized|ModLauncher(?: .+)? (?:starting|running): .+|Loading Minecraft .+ with Fabric Loader .+)$/
const MIN_LINGER = 2000
const LAUNCH_UI_FALLBACK_MS = 120000

function forEachGameLogLine(data, handler){
    data.toString().split(/\r?\n/).forEach(line => {
        const trimmed = line.trim()
        if(trimmed.length > 0){
            handler(trimmed)
        }
    })
}

async function dlAsync(login = true) {

    // Login parameter is temporary for debug purposes. Allows testing the validation/downloads without
    // launching the game.

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    // Switch to the launch screen right away (the distribution refresh
    // below can take a moment); every early failure switches back.
    toggleLaunchArea(true)
    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))

    let distro

    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        onDistroRefresh(distro)
    } catch(err) {
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }

    const serv = distro.getServerById(ConfigManager.getSelectedServer())
    if(serv == null){
        loggerLaunchSuite.error('Selected server is missing from the distribution index.')
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.launch.failureText'))
        return
    }

    if(login && ConfigManager.getSelectedAccount() == null){
        loggerLaunchSuite.error('You must be logged into an account.')
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.selectedAccount.noAccountSelected'))
        return
    }

    // Vanilla Minecraft assets only (mods/config/Forge/Java are entirely
    // handled by syncClient below) - no more FullRepair/DistributionIndexProcessor,
    // which required a distribution.json-backed modules list to avoid throwing
    // 'No mod loader found!'. Runs in-process; no fork needed for this part.
    const repairMojangProcessor = new MojangIndexProcessor(
        ConfigManager.getCommonDirectory(),
        serv.rawServer.minecraftVersion)

    loggerLaunchSuite.info('Validating files.')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
    setLaunchPhase('validate')
    let invalidAssets
    try {
        await repairMojangProcessor.init()
        const numStages = repairMojangProcessor.totalStages()
        let completedStages = 0
        const validated = await repairMojangProcessor.validate(async () => {
            completedStages++
            setLaunchPercentage(Math.trunc((completedStages / numStages) * 100))
        })
        invalidAssets = [...validated.assets, ...validated.libraries, ...validated.client, ...validated.misc]
        setLaunchPercentage(100)
    } catch (err) {
        loggerLaunchSuite.error('Error during file validation.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileVerificationTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        return
    }

    if(invalidAssets.length > 0) {
        loggerLaunchSuite.info('Downloading files.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingMinecraft'))
        setLaunchPhase('vanilla')
        try {
            const expectedTotalSize = getExpectedDownloadSize(invalidAssets)
            let currentPercent = 0
            await downloadQueue(invalidAssets, received => {
                const nextPercent = expectedTotalSize > 0 ? Math.trunc((received / expectedTotalSize) * 100) : 100
                if(currentPercent !== nextPercent) {
                    currentPercent = nextPercent
                    setDownloadPercentage(currentPercent)
                }
            })
            setDownloadPercentage(100)
        } catch(err) {
            loggerLaunchSuite.error('Error during file download.', err)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
            return
        }
    } else {
        loggerLaunchSuite.info('No invalid vanilla files.')
        setLaunchPhase('vanilla')
        setLaunchPercentage(100)
    }

    // Remove download bar.
    remote.getCurrentWindow().setProgressBar(-1)

    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))

    let modLoaderData
    let versionData
    let realServ
    try {
        // Vanilla Minecraft assets only - unrelated to distribution.json,
        // untouched by the silo-sync switch below.
        const mojangIndexProcessor = new MojangIndexProcessor(
            ConfigManager.getCommonDirectory(),
            serv.rawServer.minecraftVersion)
        versionData = await mojangIndexProcessor.getVersionJson()

        // silo-sync: Java, Forge (installed for real, locally), and
        // mods/config/resourcepacks via forced/download/ignore rules -
        // replaces what DistributionIndexProcessor/Nebula used to do.
        const commonDir = ConfigManager.getCommonDirectory()
        const instancesRoot = ConfigManager.getInstanceDirectory()
        const instanceDir = ConfigManager.getServerInstanceDirectory(serv.rawServer.id)

        const onDlProgress = ({ file, percent }) => {
            setLaunchFile(file)
            setDownloadPercentage(percent)
        }

        const syncConfig = await syncClient.fetchConfig(SYNC_URL, ConfigManager.getSelectedAccount()?.uuid)
        setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingJava'))
        setLaunchPhase('java')
        const javaPath = await syncClient.ensureJava(syncConfig.java, commonDir, onDlProgress)
        // ProcessBuilder spawns whatever ConfigManager.getJavaExecutable()
        // holds for this server - it knows nothing about syncClient. Without
        // this, the actual launch would silently fall back to a stale or
        // nonexistent value instead of the Java we just ensured is present.
        ConfigManager.setJavaExecutable(serv.rawServer.id, javaPath)
        ConfigManager.save()
        setLaunchDetails(Lang.queryJS('landing.dlAsync.installingForge'))
        setLaunchPhase('forge')
        const forgeVersionJsonPath = await syncClient.ensureForge(
            syncConfig.forge, javaPath, instanceDir, commonDir, onDlProgress)
        const enabledAddons = ConfigManager.getAddonConfiguration(serv.rawServer.id)?.enabled || []
        setLaunchDetails(Lang.queryJS('landing.dlAsync.syncingServerFiles'))
        setLaunchPhase('files')
        await syncClient.syncFiles(syncConfig, instanceDir, enabledAddons, onDlProgress)

        modLoaderData = await fs.readJson(forgeVersionJsonPath)
        realServ = syncClient.buildDistribution({
            id: serv.rawServer.id,
            name: serv.rawServer.name,
            description: serv.rawServer.description,
            icon: serv.rawServer.icon,
            address: serv.rawServer.address,
            minecraftVersion: serv.rawServer.minecraftVersion,
            forgeVersion: syncConfig.forge.forgeVersion,
            discord: serv.rawServer.discord,
            autoconnect: serv.rawServer.autoconnect
        }, modLoaderData, commonDir, instancesRoot)
    } catch (err) {
        loggerLaunchSuite.error('Error while preparing launch metadata.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))
        return
    }

    if(login) {
        const authUser = ConfigManager.getSelectedAccount()
        loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
        let pb = new ProcessBuilder(realServ, versionData, modLoaderData, authUser, remote.app.getVersion())
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))
        setLaunchPhase('start')

        const onLoadComplete = () => {
            if(loadCompleteHandled){
                return
            }
            loadCompleteHandled = true
            if(launchUiFallbackTimer != null){
                clearTimeout(launchUiFallbackTimer)
                launchUiFallbackTimer = null
            }
            if(proc == null){
                toggleLaunchArea(false)
                return
            }
            if(proc.stdout != null){
                proc.stdout.removeListener('data', tempListener)
            }
            if(proc.stderr != null){
                proc.stderr.removeListener('data', tempListener)
                proc.stderr.removeListener('data', gameErrorListener)
            }
        }
        let loadCompleteHandled = false
        let launchUiFallbackTimer = null
        let spawnGracePeriod = true
        const start = Date.now()

        const handleLaunchProgressLine = (line) => {
            if(loadCompleteHandled){
                return
            }
            if(GAME_LAUNCH_REGEX.test(line)){
                const diff = Date.now()-start
                if(diff < MIN_LINGER) {
                    setTimeout(onLoadComplete, MIN_LINGER-diff)
                } else {
                    onLoadComplete()
                }
            }
        }

        const seedServerListIfNeeded = () => {
            const serverAddress = serv.hostname && serv.port
                ? `${serv.hostname}:${serv.port}`
                : (serv.rawServer.address || '')
            try {
                ensureDefaultServerList(
                    ConfigManager.getServerInstanceDirectory(serv.rawServer.id),
                    serv.rawServer.name,
                    serverAddress
                )
            } catch (err) {
                loggerLaunchSuite.warn('Unable to prepare servers.dat before launch.', err)
            }
        }

        // Attach a temporary listener to the client output.
        // Will wait for a certain bit of text meaning that
        // the client application has started, and we can hide
        // the progress bar stuff.
        const tempListener = function(data){
            forEachGameLogLine(data, handleLaunchProgressLine)
        }

        const gameErrorListener = function(data){
            forEachGameLogLine(data, line => {
                if(line.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                    loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                    showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
                }
            })
        }

        try {
            // Seed multiplayer list before Java starts so Minecraft reads a stable file.
            seedServerListIfNeeded()

            // Build Minecraft process.
            proc = pb.build()

            if(proc == null || proc.pid == null){
                throw new Error('Minecraft process failed to start.')
            }

            loggerLaunchSuite.info(`Minecraft process started (pid ${proc.pid}).`)

            // Bind listeners to stdout/stderr for launch-progress and error detection.
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', tempListener)
            proc.stderr.on('data', gameErrorListener)

            // Hide the launcher overlay as soon as Java starts; mod loading can take several minutes.
            setTimeout(onLoadComplete, MIN_LINGER)

            launchUiFallbackTimer = setTimeout(() => {
                if(!loadCompleteHandled){
                    loggerLaunchSuite.warn('Launch UI fallback triggered; hiding progress bar after timeout.')
                    onLoadComplete()
                }
            }, LAUNCH_UI_FALLBACK_MS)

            setTimeout(() => {
                spawnGracePeriod = false
            }, 15000)

            proc.on('close', (code, signal) => {
                if(spawnGracePeriod && code !== 0 && code != null){
                    loggerLaunchSuite.error(`Minecraft exited early with code ${code}${signal ? ` (${signal})` : ''}.`)
                    showLaunchFailure(
                        Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'),
                        Lang.queryJS('landing.dlAsync.checkConsoleForDetails')
                    )
                }
                proc = null
                loggerLaunchSuite.info('Minecraft process exited.')
                siloSetGameRunning(false)
                toggleLaunchArea(false)
            })

            setLaunchPercentage(100)
            setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))
            setLaunchState('ingame')
            siloSetGameRunning(true)

        } catch(err) {

            loggerLaunchSuite.error('Error during launch', err)
            proc = null
            siloSetGameRunning(false)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))

        }
    }

}

