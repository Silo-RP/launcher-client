/**
 * Silo UI glue (presentation only): the single 3D background, which scene
 * goes with which view, the top bar (navigation, account menu, banner) and
 * the background's behaviour around a game session.
 *
 * The engine (assets/js/silo/silo-ps1.js + silo-background.js) is copied
 * as-is from docs/silo-handoff/; scenes per menu live in SiloBackground.MENUS.
 * Loaded after uibinder.js (VIEWS, ConfigManager, switchView).
 */

let siloBg = null
let siloBgLastShow = null
let siloAnimEnabled = ConfigManager.getAnimatedBackground()
let siloGameRunning = false
let siloMinimizedForGame = false
// Ambiance sonore synthétisée (silo-ambience.js), désactivée par défaut
const siloAmbience = typeof window.SiloAmbience === 'function' ? window.SiloAmbience() : null
siloAmbience?.setEnabled(ConfigManager.getAmbientSound())
document.addEventListener('visibilitychange', () => siloAmbience?.setSuspended(document.hidden || siloGameRunning))
const siloBanners = {}

/**
 * Mount the background on first use (needs the parsed #bg element). Never
 * while the game runs: it is unmounted for the whole session.
 */
function siloEnsureBg(){
    if(siloGameRunning) return null
    if(siloBg == null && typeof window.SiloBackground === 'function'){
        const bg = window.SiloBackground(document.getElementById('bg'))
        siloBg = bg
        siloBgRefresh()
        // Build the other rooms while idle, so the first visit to Bulletin or
        // Paramètres no longer builds its scene during the fade.
        setTimeout(() => {
            if(siloBg === bg){
                bg.preload(['accueil', 'bulletin', 'parametres'], next => requestIdleCallback(next, { timeout: 4000 }))
            }
        }, 3000)
    }
    return siloBg
}

// Rooms hidden for a long time are released (GPU memory) and rebuilt on the
// next visit, during the fade.
const SILO_SCENE_IDLE_MS = 10 * 60 * 1000
setInterval(() => siloBg?.trim(SILO_SCENE_IDLE_MS), 60 * 1000)

/** Run or freeze the background: animated setting on and no game running. */
function siloBgRefresh(){
    if(siloBg == null) return
    if(siloAnimEnabled && !siloGameRunning){
        siloBg.resume()
    } else {
        siloBg.pause()
    }
}

/**
 * Menu (background scene + screen styling) for a view container.
 *
 * @param {string} view A value of VIEWS.
 * @returns {string} A key of SiloBackground.MENUS.
 */
function siloMenuForView(view){
    switch(view){
        case VIEWS.landing:
            return document.getElementById('landingContainer').getAttribute('data-mode') === 'lancement' ? 'lancement' : 'accueil'
        case VIEWS.news:
            return 'bulletin'
        case VIEWS.settings:
            return 'parametres'
        default:
            return 'connexion'
    }
}

/**
 * Called on every view change: screen styling, active tab, background scene.
 *
 * @param {string} view The view container being shown (a value of VIEWS).
 */
function siloOnView(view){
    const menu = siloMenuForView(view)
    document.body.setAttribute('data-screen', menu)
    const tab = menu === 'lancement' ? 'accueil' : menu
    for(const link of document.querySelectorAll('[data-nav]')){
        if(link.getAttribute('data-nav') === tab){
            link.setAttribute('aria-current', 'page')
        } else {
            link.removeAttribute('aria-current')
        }
    }
    // The ambient sound follows the room shown.
    siloAmbience?.setScene(window.SiloBackground?.MENUS[menu]?.scene ?? null)
    // Background first: nothing else here may keep the scene from showing.
    const bg = siloEnsureBg()
    if(bg != null){
        siloBgLastShow = bg.show(menu)
    }
    closeAccountMenu()
    if(menu === 'accueil' && typeof refreshLandingMeta === 'function'){
        refreshLandingMeta()
    }
}

/**
 * Top bar navigation between the three main views.
 *
 * @param {'accueil'|'bulletin'|'parametres'} menu The destination.
 */
async function siloNavigate(menu){
    const target = { accueil: VIEWS.landing, bulletin: VIEWS.news, parametres: VIEWS.settings }[menu]
    const current = getCurrentView()
    if(target == null || target === current) return
    if(![VIEWS.landing, VIEWS.news, VIEWS.settings].includes(current)) return
    if(current === VIEWS.settings){
        // Same rule as the drawer's close button: invalid values block it.
        if(settingsState.invalid.size > 0) return
        fullSettingsSave()
    }
    if(target === VIEWS.settings){
        await prepareSettings()
    }
    if(target === VIEWS.news){
        markNewsRead()
    }
    switchView(current, target)
}

/**
 * The game process started (true) or exited (false). While it runs, the
 * launcher goes to sleep: the 3D background is unmounted (render loops
 * stopped, WebGL contexts released) and a static "game running" screen
 * covers everything, so the window draws nothing more. The window is also
 * minimized meanwhile if "Réduire le launcher pendant la partie" is on.
 * When the game exits, the background is mounted again on the current view.
 *
 * @param {boolean} running Whether the Minecraft process is running.
 */
function siloSetGameRunning(running){
    if(running === siloGameRunning) return
    siloGameRunning = running
    document.body.toggleAttribute('data-game-running', running)
    siloAmbience?.setSuspended(running || document.hidden)
    if(running){
        closeAccountMenu()
        if(siloBg != null){
            const bg = siloBg
            siloBg = null
            // Let a scene change in progress finish before tearing down.
            Promise.resolve(siloBgLastShow).catch(() => {}).then(() => bg.destroy())
        }
        if(ConfigManager.getMinimizeOnLaunch()){
            setTimeout(() => {
                if(siloGameRunning){
                    siloMinimizedForGame = true
                    ipcRenderer.send('window:minimize')
                }
            }, 1500)
        }
    } else {
        siloOnView(getCurrentView())
        if(siloMinimizedForGame){
            siloMinimizedForGame = false
            ipcRenderer.send('window:restore')
        }
    }
}

/**
 * "Ambiance sonore" setting, applied immediately.
 *
 * @param {boolean} enabled Whether the ambient sound plays.
 */
function siloSetAmbientSound(enabled){
    siloAmbience?.setEnabled(enabled)
}

/**
 * "Fond animé" setting, applied immediately.
 *
 * @param {boolean} enabled Whether the background is animated.
 */
function siloSetAnimatedBackground(enabled){
    siloAnimEnabled = enabled
    siloBgRefresh()
}

/**
 * Error banner under the top bar (outages only). One message per source.
 *
 * @param {string} key Source of the message (e.g. 'mojang').
 * @param {string|null} text Message, or null to clear it.
 */
function siloSetBanner(key, text){
    siloBanners[key] = text
    const message = Object.values(siloBanners).find(t => t)
    const banner = document.getElementById('siloBanner')
    banner.innerHTML = message || ''
    banner.hidden = !message
}

/* Account menu (top right) */

function openAccountMenu(){
    prepareAccountsTab()
    document.getElementById('accountMenu').hidden = false
    document.getElementById('accountChip').setAttribute('aria-expanded', 'true')
}

function closeAccountMenu(){
    const menu = document.getElementById('accountMenu')
    if(menu == null || menu.hidden) return
    menu.hidden = true
    document.getElementById('accountChip').setAttribute('aria-expanded', 'false')
}

document.addEventListener('DOMContentLoaded', () => {
    for(const link of document.querySelectorAll('[data-nav]')){
        link.addEventListener('click', () => siloNavigate(link.getAttribute('data-nav')))
    }

    document.getElementById('accountChip').addEventListener('click', e => {
        e.stopPropagation()
        if(document.getElementById('accountMenu').hidden){
            openAccountMenu()
        } else {
            closeAccountMenu()
        }
    })
    document.addEventListener('click', e => {
        if(!e.target.closest('.accountWrap')){
            closeAccountMenu()
        }
    })

    // Enter on the home screen = JOUER (unless a control has the focus,
    // which then handles Enter itself).
    document.addEventListener('keydown', e => {
        if(e.key !== 'Enter' || e.repeat || isOverlayVisible()) return
        const focus = document.activeElement
        if(focus != null && focus !== document.body && focus.closest('button, a, input, select, textarea, summary, label, [tabindex]')) return
        if(getCurrentView() === VIEWS.landing
            && document.getElementById('landingContainer').getAttribute('data-mode') === 'accueil'
            && !launch_button.disabled){
            e.preventDefault()
            launch_button.click()
        }
    })

    document.addEventListener('keydown', e => {
        if(e.key !== 'Escape' || isOverlayVisible()) return
        const menu = document.getElementById('accountMenu')
        if(!menu.hidden){
            closeAccountMenu()
            document.getElementById('accountChip').focus()
        } else if(getCurrentView() === VIEWS.settings){
            if(!settingsNavDone.disabled) settingsNavDone.click()
        } else if(getCurrentView() === VIEWS.news){
            siloNavigate('accueil')
        }
    })
})
