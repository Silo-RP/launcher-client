// Requirements
const os     = require('os')
const semver = require('semver')

const { MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR } = require('./assets/js/ipcconstants')
// syncClient / SYNC_URL: NOT re-imported here - landing.js already
// declares them as top-level const, and classic <script> tags share one
// global lexical scope in this app (same mechanism as DistroAPI/remote) -
// redeclaring either identifier here throws "already declared" and silently
// breaks every landing.js binding in the same scope (found the hard way).

const loggerSettingsAddons = LoggerUtil.getLogger('SettingsAddons')

const settingsState = {
    invalid: new Set()
}

function bindSettingsSelect(){
    for(let ele of document.getElementsByClassName('settingsSelectContainer')) {
        const selectedDiv = ele.getElementsByClassName('settingsSelectSelected')[0]

        selectedDiv.onclick = (e) => {
            e.stopPropagation()
            closeSettingsSelect(e.target)
            e.target.nextElementSibling.toggleAttribute('hidden')
            e.target.classList.toggle('select-arrow-active')
        }
    }
}

function closeSettingsSelect(el){
    for(let ele of document.getElementsByClassName('settingsSelectContainer')) {
        const selectedDiv = ele.getElementsByClassName('settingsSelectSelected')[0]
        const optionsDiv = ele.getElementsByClassName('settingsSelectOptions')[0]

        if(!(selectedDiv === el)) {
            selectedDiv.classList.remove('select-arrow-active')
            optionsDiv.setAttribute('hidden', '')
        }
    }
}

/* If the user clicks anywhere outside the select box,
then close all select boxes: */
document.addEventListener('click', closeSettingsSelect)

bindSettingsSelect()


function bindFileSelectors(){
    for(let ele of document.getElementsByClassName('settingsFileSelButton')){
        
        ele.onclick = async e => {
            const directoryDialog = ele.hasAttribute('dialogDirectory') && ele.getAttribute('dialogDirectory') == 'true'
            const properties = directoryDialog ? ['openDirectory', 'createDirectory'] : ['openFile']

            const options = {
                properties
            }

            if(ele.hasAttribute('dialogTitle')) {
                options.title = ele.getAttribute('dialogTitle')
            }

            const res = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), options)
            if(!res.canceled) {
                ele.previousElementSibling.value = res.filePaths[0]
            }
        }
    }
}

bindFileSelectors()

// Open the game folder in the system file explorer.
document.getElementById('settingsOpenDataDir').onclick = () => {
    shell.openPath(ConfigManager.getDataDirectory())
}

// "Fond animé" applies right away; it is persisted with the other settings.
document.getElementById('settingsAnimatedBackground').addEventListener('change', e => {
    siloSetAnimatedBackground(e.target.checked)
})


/**
 * General Settings Functions
 */

/**
  * Bind value validators to the settings UI elements. These will
  * validate against the criteria defined in the ConfigManager (if
  * any). If the value is invalid, the UI will reflect this and saving
  * will be disabled until the value is corrected. This is an automated
  * process. More complex UI may need to be bound separately.
  */
function initSettingsValidators(){
    const sEls = document.getElementById('settingsContainer').querySelectorAll('[cValue]')
    Array.from(sEls).map((v, index, arr) => {
        const vFn = ConfigManager['validate' + v.getAttribute('cValue')]
        if(typeof vFn === 'function'){
            if(v.tagName === 'INPUT'){
                if(v.type === 'number' || v.type === 'text'){
                    v.addEventListener('keyup', (e) => {
                        const v = e.target
                        if(!vFn(v.value)){
                            settingsState.invalid.add(v.id)
                            v.setAttribute('error', '')
                            settingsSaveDisabled(true)
                        } else {
                            if(v.hasAttribute('error')){
                                v.removeAttribute('error')
                                settingsState.invalid.delete(v.id)
                                if(settingsState.invalid.size === 0){
                                    settingsSaveDisabled(false)
                                }
                            }
                        }
                    })
                }
            }
        }

    })
}

/**
 * Load configuration values onto the UI. This is an automated process.
 */
async function initSettingsValues(){
    const sEls = document.getElementById('settingsContainer').querySelectorAll('[cValue]')

    for(const v of sEls) {
        const cVal = v.getAttribute('cValue')
        const serverDependent = v.hasAttribute('serverDependent') // Means the first argument is the server id.
        const gFn = ConfigManager['get' + cVal]
        const gFnOpts = []
        if(serverDependent) {
            gFnOpts.push(ConfigManager.getSelectedServer())
        }
        if(typeof gFn === 'function'){
            if(v.tagName === 'INPUT'){
                if(v.type === 'number' || v.type === 'text'){
                    // Special Conditions
                    if (cVal === 'DataDirectory'){
                        v.value = gFn.apply(null, gFnOpts)
                    } else if(cVal === 'JVMOptions'){
                        v.value = gFn.apply(null, gFnOpts).join(' ')
                    } else {
                        v.value = gFn.apply(null, gFnOpts)
                    }
                } else if(v.type === 'checkbox'){
                    v.checked = gFn.apply(null, gFnOpts)
                }
            } else if(v.tagName === 'DIV'){
                if(v.classList.contains('rangeSlider')){
                    // Special Conditions
                    if(cVal === 'MinRAM' || cVal === 'MaxRAM'){
                        let val = gFn.apply(null, gFnOpts)
                        if(val.endsWith('M')){
                            val = Number(val.substring(0, val.length-1))/1024
                        } else {
                            val = Number.parseFloat(val)
                        }

                        v.setAttribute('value', val)
                    } else {
                        v.setAttribute('value', Number.parseFloat(gFn.apply(null, gFnOpts)))
                    }
                }
            }
        }
    }

}

/**
 * Save the settings values.
 */
function saveSettingsValues(){
    const sEls = document.getElementById('settingsContainer').querySelectorAll('[cValue]')
    for(const v of sEls) {
        const cVal = v.getAttribute('cValue')
        const serverDependent = v.hasAttribute('serverDependent') // Means the first argument is the server id.
        const sFn = ConfigManager['set' + cVal]
        const sFnOpts = []
        if(serverDependent) {
            sFnOpts.push(ConfigManager.getSelectedServer())
        }
        if(typeof sFn === 'function'){
            if(v.tagName === 'INPUT'){
                if(v.type === 'number' || v.type === 'text'){
                    // Special Conditions
                    if(cVal === 'JVMOptions'){
                        if(!v.value.trim()) {
                            sFnOpts.push([])
                            sFn.apply(null, sFnOpts)
                        } else {
                            sFnOpts.push(v.value.trim().split(/\s+/))
                            sFn.apply(null, sFnOpts)
                        }
                    } else if((cVal === 'DataDirectory' || cVal === 'JavaExecutable') && (!v.value || v.value === 'null')){
                        // Never persist EJS placeholder values from uninitialized inputs.
                        continue
                    } else {
                        sFnOpts.push(v.value)
                        sFn.apply(null, sFnOpts)
                    }
                } else if(v.type === 'checkbox'){
                    sFnOpts.push(v.checked)
                    sFn.apply(null, sFnOpts)
                    // Special Conditions
                    if(cVal === 'AllowPrerelease'){
                        changeAllowPrerelease(v.checked)
                    }
                }
            } else if(v.tagName === 'DIV'){
                if(v.classList.contains('rangeSlider')){
                    // Special Conditions
                    if(cVal === 'MinRAM' || cVal === 'MaxRAM'){
                        let val = Number(v.getAttribute('value'))
                        if(val%1 > 0){
                            val = val*1024 + 'M'
                        } else {
                            val = val + 'G'
                        }

                        sFnOpts.push(val)
                        sFn.apply(null, sFnOpts)
                    } else {
                        sFnOpts.push(v.getAttribute('value'))
                        sFn.apply(null, sFnOpts)
                    }
                }
            }
        }
    }
}

const settingsNavDone = document.getElementById('settingsNavDone')

/**
 * Set if the settings save (done) button is disabled.
 * 
 * @param {boolean} v True to disable, false to enable.
 */
function settingsSaveDisabled(v){
    settingsNavDone.disabled = v
}

function fullSettingsSave() {
    saveSettingsValues()
    try {
        saveAddonConfiguration()
    } catch (err) {
        console.warn('Addon configuration could not be saved.', err)
    }
    ConfigManager.save()
}

function saveSettingsOnExit() {
    if(settingsState.invalid.size > 0){
        return
    }
    try {
        fullSettingsSave()
    } catch (err) {
        console.error('Failed to save settings on exit.', err)
        try {
            saveSettingsValues()
            ConfigManager.save()
        } catch (innerErr) {
            console.error('Failed to save core settings on exit.', innerErr)
        }
    }
}

/* Closes the settings view and saves all data. */
settingsNavDone.onclick = () => {
    fullSettingsSave()
    switchView(getCurrentView(), VIEWS.landing)
}

/**
 * Account Management Tab
 */

const msftLoginLogger = LoggerUtil.getLogger('Microsoft Login')
const msftLogoutLogger = LoggerUtil.getLogger('Microsoft Logout')

// The account menu lives in the top bar, so add/log out flows return to
// whichever main view was open when they started.
let accountFlowReturnView = null
function accountFlowView(){
    return accountFlowReturnView || VIEWS.landing
}

// Bind the add microsoft account button.
document.getElementById('settingsAddMicrosoftAccount').onclick = (e) => {
    closeAccountMenu()
    accountFlowReturnView = getCurrentView()
    switchView(getCurrentView(), VIEWS.waiting, 200, 200, () => {
        ipcRenderer.send(MSFT_OPCODE.OPEN_LOGIN, accountFlowView(), accountFlowView())
    })
}

// Bind reply for Microsoft Login.
ipcRenderer.on(MSFT_OPCODE.REPLY_LOGIN, (_, ...arguments_) => {
    if (arguments_[0] === MSFT_REPLY_TYPE.ERROR) {

        const viewOnClose = arguments_[2]
        console.log(arguments_)
        switchView(getCurrentView(), viewOnClose, 500, 500, () => {

            if(arguments_[1] === MSFT_ERROR.NOT_FINISHED) {
                // User cancelled.
                msftLoginLogger.info('Login cancelled by user.')
                return
            }

            // Unexpected error.
            setOverlayContent(
                Lang.queryJS('settings.msftLogin.errorTitle'),
                Lang.queryJS('settings.msftLogin.errorMessage'),
                Lang.queryJS('settings.msftLogin.okButton')
            )
            setOverlayHandler(() => {
                toggleOverlay(false)
            })
            toggleOverlay(true)
        })
    } else if(arguments_[0] === MSFT_REPLY_TYPE.SUCCESS) {
        const queryMap = arguments_[1]
        const viewOnClose = arguments_[2]

        // Error from request to Microsoft.
        if (Object.prototype.hasOwnProperty.call(queryMap, 'error')) {
            switchView(getCurrentView(), viewOnClose, 500, 500, () => {
                // TODO Dont know what these errors are. Just show them I guess.
                // This is probably if you messed up the app registration with Azure.      
                let error = queryMap.error // Error might be 'access_denied' ?
                let errorDesc = queryMap.error_description
                console.log('Error getting authCode, is Azure application registered correctly?')
                console.log(error)
                console.log(errorDesc)
                console.log('Full query map: ', queryMap)
                setOverlayContent(
                    error,
                    errorDesc,
                    Lang.queryJS('settings.msftLogin.okButton')
                )
                setOverlayHandler(() => {
                    toggleOverlay(false)
                })
                toggleOverlay(true)

            })
        } else {

            msftLoginLogger.info('Acquired authCode, proceeding with authentication.')

            const authCode = queryMap.code
            AuthManager.addMicrosoftAccount(authCode).then(value => {
                updateSelectedAccount(value)
                switchView(getCurrentView(), viewOnClose, 500, 500, async () => {
                    await prepareSettings()
                })
            })
                .catch((displayableError) => {

                    let actualDisplayableError
                    if(isDisplayableError(displayableError)) {
                        msftLoginLogger.error('Error while logging in.', displayableError)
                        actualDisplayableError = displayableError
                    } else {
                        // Uh oh.
                        msftLoginLogger.error('Unhandled error during login.', displayableError)
                        actualDisplayableError = Lang.queryJS('login.error.unknown')
                    }

                    switchView(getCurrentView(), viewOnClose, 500, 500, () => {
                        setOverlayContent(actualDisplayableError.title, actualDisplayableError.desc, Lang.queryJS('login.tryAgain'))
                        setOverlayHandler(() => {
                            toggleOverlay(false)
                        })
                        toggleOverlay(true)
                    })
                })
        }
    }
})

/**
 * Bind functionality for the account selection buttons. If another account
 * is selected, the UI of the previously selected account will be updated.
 */
function bindAuthAccountSelect(){
    Array.from(document.getElementsByClassName('settingsAuthAccountSelect')).map((val) => {
        val.onclick = (e) => {
            if(val.hasAttribute('selected')){
                return
            }
            const selectBtns = document.getElementsByClassName('settingsAuthAccountSelect')
            for(let i=0; i<selectBtns.length; i++){
                if(selectBtns[i].hasAttribute('selected')){
                    selectBtns[i].removeAttribute('selected')
                    selectBtns[i].innerHTML = Lang.queryJS('settings.authAccountSelect.selectButton')
                }
            }
            val.setAttribute('selected', '')
            val.innerHTML = Lang.queryJS('settings.authAccountSelect.selectedButton')
            setSelectedAccount(val.closest('.settingsAuthAccount').getAttribute('uuid'))
        }
    })
}

/**
 * Bind functionality for the log out button. If the logged out account was
 * the selected account, another account will be selected and the UI will
 * be updated accordingly.
 */
function bindAuthAccountLogOut(){
    Array.from(document.getElementsByClassName('settingsAuthAccountLogOut')).map((val) => {
        val.onclick = (e) => {
            let isLastAccount = false
            if(Object.keys(ConfigManager.getAuthAccounts()).length === 1){
                isLastAccount = true
                setOverlayContent(
                    Lang.queryJS('settings.authAccountLogout.lastAccountWarningTitle'),
                    Lang.queryJS('settings.authAccountLogout.lastAccountWarningMessage'),
                    Lang.queryJS('settings.authAccountLogout.confirmButton'),
                    Lang.queryJS('settings.authAccountLogout.cancelButton')
                )
                setOverlayHandler(() => {
                    processLogOut(val, isLastAccount)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false)
                })
                toggleOverlay(true, true)
            } else {
                processLogOut(val, isLastAccount)
            }
            
        }
    })
}

let msAccDomElementCache
/**
 * Process a log out.
 * 
 * @param {Element} val The log out button element.
 * @param {boolean} isLastAccount If this logout is on the last added account.
 */
function processLogOut(val, isLastAccount){
    const parent = val.closest('.settingsAuthAccount')
    const uuid = parent.getAttribute('uuid')
    const prevSelAcc = ConfigManager.getSelectedAccount()
    const targetAcc = ConfigManager.getAuthAccount(uuid)
    closeAccountMenu()
    if(targetAcc.type === 'microsoft') {
        msAccDomElementCache = parent
        accountFlowReturnView = getCurrentView()
        switchView(getCurrentView(), VIEWS.waiting, 200, 200, () => {
            ipcRenderer.send(MSFT_OPCODE.OPEN_LOGOUT, uuid, isLastAccount)
        })
    } else {
        AuthManager.removeMojangAccount(uuid).then(() => {
            if(!isLastAccount && uuid === prevSelAcc.uuid){
                const selAcc = ConfigManager.getSelectedAccount()
                refreshAuthAccountSelected(selAcc.uuid)
                updateSelectedAccount(selAcc)
                validateSelectedAccount()
            }
            if(isLastAccount) {
                loginOptionsCancelEnabled(false)
                loginOptionsViewOnLoginSuccess = VIEWS.landing
                loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                switchView(getCurrentView(), VIEWS.loginOptions)
            }
        })
        $(parent).fadeOut(250, () => {
            parent.remove()
        })
    }
}

// Bind reply for Microsoft Logout.
ipcRenderer.on(MSFT_OPCODE.REPLY_LOGOUT, (_, ...arguments_) => {
    if (arguments_[0] === MSFT_REPLY_TYPE.ERROR) {
        switchView(getCurrentView(), accountFlowView(), 200, 200, () => {

            if(arguments_.length > 1 && arguments_[1] === MSFT_ERROR.NOT_FINISHED) {
                // User cancelled.
                msftLogoutLogger.info('Logout cancelled by user.')
                return
            }

            // Unexpected error.
            setOverlayContent(
                Lang.queryJS('settings.msftLogout.errorTitle'),
                Lang.queryJS('settings.msftLogout.errorMessage'),
                Lang.queryJS('settings.msftLogout.okButton')
            )
            setOverlayHandler(() => {
                toggleOverlay(false)
            })
            toggleOverlay(true)
        })
    } else if(arguments_[0] === MSFT_REPLY_TYPE.SUCCESS) {
        
        const uuid = arguments_[1]
        const isLastAccount = arguments_[2]
        const prevSelAcc = ConfigManager.getSelectedAccount()

        msftLogoutLogger.info('Logout Successful. uuid:', uuid)
        
        AuthManager.removeMicrosoftAccount(uuid)
            .then(() => {
                if(!isLastAccount && uuid === prevSelAcc.uuid){
                    const selAcc = ConfigManager.getSelectedAccount()
                    refreshAuthAccountSelected(selAcc.uuid)
                    updateSelectedAccount(selAcc)
                    validateSelectedAccount()
                }
                if(isLastAccount) {
                    loginOptionsCancelEnabled(false)
                    loginOptionsViewOnLoginSuccess = VIEWS.landing
                    loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                    switchView(getCurrentView(), VIEWS.loginOptions)
                }
                if(msAccDomElementCache) {
                    msAccDomElementCache.remove()
                    msAccDomElementCache = null
                }
            })
            .finally(() => {
                if(!isLastAccount) {
                    switchView(getCurrentView(), accountFlowView(), 200, 200)
                }
            })

    }
})

/**
 * Refreshes the status of the selected account on the auth account
 * elements.
 * 
 * @param {string} uuid The UUID of the new selected account.
 */
function refreshAuthAccountSelected(uuid){
    Array.from(document.getElementsByClassName('settingsAuthAccount')).map((val) => {
        const selBtn = val.getElementsByClassName('settingsAuthAccountSelect')[0]
        if(uuid === val.getAttribute('uuid')){
            selBtn.setAttribute('selected', '')
            selBtn.innerHTML = Lang.queryJS('settings.authAccountSelect.selectedButton')
        } else {
            if(selBtn.hasAttribute('selected')){
                selBtn.removeAttribute('selected')
            }
            selBtn.innerHTML = Lang.queryJS('settings.authAccountSelect.selectButton')
        }
    })
}

const settingsCurrentMicrosoftAccounts = document.getElementById('settingsCurrentMicrosoftAccounts')

/**
 * Add auth account elements for each one stored in the authentication database.
 */
function populateAuthAccounts(){
    const authAccounts = ConfigManager.getAuthAccounts()
    const authKeys = Object.keys(authAccounts)
    if(authKeys.length === 0){
        return
    }
    const selectedUUID = ConfigManager.getSelectedAccount().uuid

    let microsoftAuthAccountStr = ''

    authKeys.forEach((val) => {
        const acc = authAccounts[val]

        const accHtml = `<div class="settingsAuthAccount" uuid="${acc.uuid}">
            <span class="settingsAuthAccountName">${acc.displayName}</span>
            <button type="button" class="linkbtn settingsAuthAccountSelect" ${selectedUUID === acc.uuid ? 'selected>' + Lang.queryJS('settings.authAccountPopulate.selectedAccount') : '>' + Lang.queryJS('settings.authAccountPopulate.selectAccount')}</button>
            <button type="button" class="linkbtn settingsAuthAccountLogOut">${Lang.queryJS('settings.authAccountPopulate.logout')}</button>
        </div>`

        microsoftAuthAccountStr += accHtml
    })

    settingsCurrentMicrosoftAccounts.innerHTML = microsoftAuthAccountStr
}

/**
 * Prepare the accounts tab for display.
 */
function prepareAccountsTab() {
    populateAuthAccounts()
    bindAuthAccountSelect()
    bindAuthAccountLogOut()
}

/**
 * Minecraft Tab
 */

/**
  * Disable decimals, negative signs, and scientific notation.
  */
document.getElementById('settingsGameWidth').addEventListener('keydown', (e) => {
    if(/^[-.eE]$/.test(e.key)){
        e.preventDefault()
    }
})
document.getElementById('settingsGameHeight').addEventListener('keydown', (e) => {
    if(/^[-.eE]$/.test(e.key)){
        e.preventDefault()
    }
})

/**
 * Re-read the settings when the selected server changes while the drawer
 * is open (per-server values such as memory and JVM options).
 */
function animateSettingsTabRefresh(){
    prepareSettings()
}

/**
 * Addons Tab
 *
 * Independent of the old distribution.json module tree (which no longer
 * carries any module data - see distromanager.js) - fetches the silo-sync
 * backend directly. An "addon" is any entry the backend resolves to mode
 * "optional" (everything under an addons/ folder by convention, see
 * app/rules.py in the silo-sync repo) or "admin" (same, but an admin
 * explicitly opted a specific addon into a staff-only tier - gated by a
 * UUID whitelist server-side, see app/access.py; entries the signed-in
 * account isn't whitelisted for are simply absent from config.json, so
 * that half of the UI never renders for a regular player). Its real target
 * path (addons/mods/Cool.jar -> mods/Cool.jar) is used both as the DOM join
 * key (`formod`) and as the value persisted via ConfigManager - actual
 * download/removal only happens during the next sync (syncClient.syncFiles),
 * not from here.
 */

const settingsAddonsContainer = document.getElementById('settingsAddonsContainer')
const ADDONS_ENTRY_PREFIX = 'addons/'

// Cosmetic-only: nicer section headers than the raw folder name.
const ADDON_GROUP_LABELS = {
    mods: 'Mods',
    shaderpacks: 'Shaderpacks',
    resourcepacks: 'Resource Packs'
}

/**
 * Resolve and update the addons list on the UI.
 */
async function resolveAddonsForUI(){
    const serv = ConfigManager.getSelectedServer()
    const servConf = ConfigManager.getAddonConfiguration(serv)
    const enabled = new Set(servConf != null ? servConf.enabled : [])

    let optionalEntries = []
    let adminEntries = []
    try {
        const uuid = ConfigManager.getSelectedAccount()?.uuid
        const syncConfig = await syncClient.fetchConfig(SYNC_URL, uuid, { maxAgeMs: 60000 })
        const addonEntries = (syncConfig.entries || []).filter(e => e.path.startsWith(ADDONS_ENTRY_PREFIX))
        optionalEntries = addonEntries.filter(e => e.mode === 'optional')
        adminEntries = addonEntries.filter(e => e.mode === 'admin')
    } catch (err) {
        loggerSettingsAddons.warn('Unable to fetch addon list.', err)
    }

    document.getElementById('settingsAddonsContent').innerHTML = parseAddonsForUI(optionalEntries, adminEntries, enabled)
}

/**
 * Build the addon UI: the regular addon groups first, then - only if the
 * account is whitelisted server-side for at least one of them, since
 * that's the only way `adminEntries` is ever non-empty - a second,
 * visually separated "Addons Admin" section using the exact same grouping/
 * toggle machinery.
 *
 * @param {Object[]} optionalEntries Flat list of "optional" mode entries from config.json.
 * @param {Object[]} adminEntries Flat list of "admin" mode entries from config.json.
 * @param {Set<string>} enabled Real target paths currently enabled for this server.
 */
function parseAddonsForUI(optionalEntries, adminEntries, enabled){
    if(optionalEntries.length === 0 && adminEntries.length === 0){
        return `<div id="settingsAddonsEmpty">${Lang.queryJS('settings.noAddons')}</div>`
    }

    let html = renderAddonGroups(optionalEntries, enabled)
    if(adminEntries.length > 0){
        html += `<div class="settingsModsHeader settingsAddonsAdminHeader">${Lang.queryJS('settings.addons.addonsAdminHeader')}</div>`
        html += renderAddonGroups(adminEntries, enabled)
    }
    return html
}

/**
 * Group a flat list of addon entries by the folder they install into
 * (mods/, shaderpacks/, ...) and render each as its own toggle list.
 *
 * @param {Object[]} entries Flat list of addon entries from config.json.
 * @param {Set<string>} enabled Real target paths currently enabled for this server.
 */
function renderAddonGroups(entries, enabled){
    const groups = {}
    for(const entry of entries){
        const realPath = entry.path.slice(ADDONS_ENTRY_PREFIX.length)
        const sepIndex = realPath.indexOf('/')
        const group = sepIndex === -1 ? realPath : realPath.substring(0, sepIndex)
        const name = sepIndex === -1 ? realPath : realPath.substring(sepIndex + 1)
        if(groups[group] == null){
            groups[group] = []
        }
        groups[group].push({ realPath, name, size: entry.size })
    }

    let html = ''
    for(const group of Object.keys(groups).sort()){
        const label = ADDON_GROUP_LABELS[group] || (group.charAt(0).toUpperCase() + group.slice(1))
        html += `<div class="settingsAddonGroupContainer">
            <div class="settingsModsHeader">${label}</div>
            <div class="settingsAddonGroupContent">
                ${groups[group].map(addon => addonRowHTML(addon, enabled.has(addon.realPath))).join('')}
            </div>
        </div>`
    }
    return html
}

function addonRowHTML(addon, isEnabled){
    return `<div id="addon-${cssEscape(addon.realPath)}" class="settingsBaseMod settingsMod" ${isEnabled ? 'enabled' : ''}>
        <div class="settingsModContent">
            <div class="settingsModMainWrapper">
                <div class="settingsModStatus"></div>
                <div class="settingsModDetails">
                    <span class="settingsModName">${addon.name}</span>
                    <span class="settingsModVersion">${formatAddonSize(addon.size)}</span>
                </div>
            </div>
            <label class="toggleSwitch">
                <input type="checkbox" formod="${addon.realPath}" ${isEnabled ? 'checked' : ''}>
                <span class="toggleSwitchSlider"></span>
            </label>
        </div>
    </div>`
}

function formatAddonSize(bytes){
    if(bytes < 1024) return `${bytes} B`
    if(bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`
    return `${(bytes/(1024*1024)).toFixed(1)} MB`
}

// Real target paths contain '/' - not valid in a raw CSS id selector unless escaped.
function cssEscape(str){
    return str.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * Bind functionality to addon toggle switches, keyed off the addon's real
 * target path instead of a maven identifier.
 */
function bindAddonsToggleSwitch(){
    const sEls = settingsAddonsContainer.querySelectorAll('[formod]')
    Array.from(sEls).forEach(v => {
        v.onchange = () => {
            const row = document.getElementById(`addon-${cssEscape(v.getAttribute('formod'))}`)
            if(v.checked) {
                row.setAttribute('enabled', '')
            } else {
                row.removeAttribute('enabled')
            }
        }
    })
}

/**
 * Save the addon configuration based on the UI values. Only persists the
 * player's choice - the actual download/removal happens on the next sync
 * (syncClient.syncFiles, see landing.js).
 */
function saveAddonConfiguration(){
    const serv = ConfigManager.getSelectedServer()
    const enabled = []
    settingsAddonsContainer.querySelectorAll('[formod]').forEach(tSwitch => {
        if(tSwitch.checked){
            enabled.push(tSwitch.getAttribute('formod'))
        }
    })
    ConfigManager.setAddonConfiguration(serv, { id: serv, enabled })
}

/**
 * Prepare the Addons tab for display.
 */
async function prepareAddonsTab(){
    await resolveAddonsForUI()
    bindAddonsToggleSwitch()
}

/**
 * Java Tab
 */

// DOM Cache
const settingsMaxRAMRange     = document.getElementById('settingsMaxRAMRange')
const settingsMinRAMRange     = document.getElementById('settingsMinRAMRange')
const settingsMaxRAMLabel     = document.getElementById('settingsMaxRAMLabel')
const settingsMinRAMLabel     = document.getElementById('settingsMinRAMLabel')
const settingsMemoryTotal     = document.getElementById('settingsMemoryTotal')
const settingsMemoryAvail     = document.getElementById('settingsMemoryAvail')
const settingsJvmOptsLink     = document.getElementById('settingsJvmOptsLink')

// Bind on change event for min memory container.
settingsMinRAMRange.onchange = (e) => {

    // Current range values
    const sMaxV = Number(settingsMaxRAMRange.getAttribute('value'))
    const sMinV = Number(settingsMinRAMRange.getAttribute('value'))

    // Get reference to range bar.
    const bar = e.target.getElementsByClassName('rangeSliderBar')[0]
    // Calculate effective total memory.
    const max = os.totalmem()/1073741824

    // Change range bar color based on the selected value.
    if(sMinV >= max/2){
        bar.setAttribute('data-level', 'high')
    } else if(sMinV >= max/4) {
        bar.setAttribute('data-level', 'mid')
    } else {
        bar.removeAttribute('data-level')
    }

    // Increase maximum memory if the minimum exceeds its value.
    if(sMaxV < sMinV){
        const sliderMeta = calculateRangeSliderMeta(settingsMaxRAMRange)
        updateRangedSlider(settingsMaxRAMRange, sMinV,
            ((sMinV-sliderMeta.min)/sliderMeta.step)*sliderMeta.inc)
        settingsMaxRAMLabel.innerHTML = formatRamGo(sMinV)
    }

    // Update label
    settingsMinRAMLabel.innerHTML = formatRamGo(sMinV)
}

// Bind on change event for max memory container.
settingsMaxRAMRange.onchange = (e) => {
    // Current range values
    const sMaxV = Number(settingsMaxRAMRange.getAttribute('value'))
    const sMinV = Number(settingsMinRAMRange.getAttribute('value'))

    // Get reference to range bar.
    const bar = e.target.getElementsByClassName('rangeSliderBar')[0]
    // Calculate effective total memory.
    const max = os.totalmem()/1073741824

    // Change range bar color based on the selected value.
    if(sMaxV >= max/2){
        bar.setAttribute('data-level', 'high')
    } else if(sMaxV >= max/4) {
        bar.setAttribute('data-level', 'mid')
    } else {
        bar.removeAttribute('data-level')
    }

    // Decrease the minimum memory if the maximum value is less.
    if(sMaxV < sMinV){
        const sliderMeta = calculateRangeSliderMeta(settingsMaxRAMRange)
        updateRangedSlider(settingsMinRAMRange, sMaxV,
            ((sMaxV-sliderMeta.min)/sliderMeta.step)*sliderMeta.inc)
        settingsMinRAMLabel.innerHTML = formatRamGo(sMaxV)
    }
    settingsMaxRAMLabel.innerHTML = formatRamGo(sMaxV)
}

/**
 * Format a memory amount in gigabytes for display: 6 -> "6 Go", 6.5 -> "6,5 Go".
 *
 * @param {number} gb Amount in gigabytes.
 * @returns {string} The formatted amount.
 */
function formatRamGo(gb){
    const rounded = Math.round(Number(gb) * 10) / 10
    return Lang.queryJS('settings.memoryAmount', { amount: rounded.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) })
}

/**
 * Calculate common values for a ranged slider.
 * 
 * @param {Element} v The range slider to calculate against. 
 * @returns {Object} An object with meta values for the provided ranged slider.
 */
function calculateRangeSliderMeta(v){
    const val = {
        max: Number(v.getAttribute('max')),
        min: Number(v.getAttribute('min')),
        step: Number(v.getAttribute('step')),
    }
    val.ticks = (val.max-val.min)/val.step
    val.inc = 100/val.ticks
    return val
}

/**
 * Binds functionality to the ranged sliders. They're more than
 * just divs now :').
 */
function bindRangeSlider(){
    Array.from(document.getElementsByClassName('rangeSlider')).map((v) => {

        // Reference the track (thumb).
        const track = v.getElementsByClassName('rangeSliderTrack')[0]

        // Set the initial slider value.
        const value = v.getAttribute('value')
        const sliderMeta = calculateRangeSliderMeta(v)

        updateRangedSlider(v, value, ((value-sliderMeta.min)/sliderMeta.step)*sliderMeta.inc)

        // Snap the value to the notch closest to a horizontal position.
        // getBoundingClientRect: the slider sits in positioned containers,
        // so offsetLeft is not relative to the page.
        const moveTo = (clientX) => {
            const rect = v.getBoundingClientRect()
            const perc = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100))
            const notch = Number(perc/sliderMeta.inc).toFixed(0)*sliderMeta.inc
            if(String(sliderMeta.min+(sliderMeta.step*(notch/sliderMeta.inc))) !== v.getAttribute('value')){
                updateRangedSlider(v, sliderMeta.min+(sliderMeta.step*(notch/sliderMeta.inc)), notch)
            }
        }

        // Press anywhere on the bar, then drag.
        v.onmousedown = (e) => {
            e.preventDefault()
            v.focus()
            moveTo(e.clientX)
            document.onmousemove = (e) => moveTo(e.clientX)
            document.onmouseup = () => {
                document.onmousemove = null
                document.onmouseup = null
            }
        }

        // Keyboard: arrows move by one step.
        v.tabIndex = 0
        v.onkeydown = (e) => {
            const dir = (e.key === 'ArrowRight' || e.key === 'ArrowUp') ? 1 : (e.key === 'ArrowLeft' || e.key === 'ArrowDown') ? -1 : 0
            if(dir === 0) return
            e.preventDefault()
            const next = Math.min(sliderMeta.max, Math.max(sliderMeta.min, Number(v.getAttribute('value')) + dir*sliderMeta.step))
            updateRangedSlider(v, next, ((next-sliderMeta.min)/sliderMeta.step)*sliderMeta.inc)
        }
    }) 
}

/**
 * Update a ranged slider's value and position.
 * 
 * @param {Element} element The ranged slider to update.
 * @param {string | number} value The new value for the ranged slider.
 * @param {number} notch The notch that the slider should now be at.
 */
function updateRangedSlider(element, value, notch){
    const oldVal = element.getAttribute('value')
    const bar = element.getElementsByClassName('rangeSliderBar')[0]
    const track = element.getElementsByClassName('rangeSliderTrack')[0]
    
    element.setAttribute('value', value)

    if(notch < 0){
        notch = 0
    } else if(notch > 100) {
        notch = 100
    }

    const event = new MouseEvent('change', {
        target: element,
        type: 'change',
        bubbles: false,
        cancelable: true
    })

    let cancelled = !element.dispatchEvent(event)

    if(!cancelled){
        track.style.left = notch + '%'
        bar.style.width = notch + '%'
        element.setAttribute('aria-valuenow', value)
        element.setAttribute('aria-valuetext', formatRamGo(value))
    } else {
        element.setAttribute('value', oldVal)
    }
}

/**
 * Display the total and available RAM.
 */
function populateMemoryStatus(){
    settingsMemoryTotal.innerHTML = formatRamGo((os.totalmem()-1073741824)/1073741824)
    settingsMemoryAvail.innerHTML = formatRamGo(os.freemem()/1073741824)
}

function populateJvmOptsLink(server) {
    const major = server.effectiveJavaOptions.suggestedMajor
    settingsJvmOptsLink.innerHTML = Lang.queryJS('settings.java.availableOptions', { major: major })
    if(major >= 12) {
        settingsJvmOptsLink.href = `https://docs.oracle.com/en/java/javase/${major}/docs/specs/man/java.html#extra-options-for-java`
    }
    else if(major >= 11) {
        settingsJvmOptsLink.href = 'https://docs.oracle.com/en/java/javase/11/tools/java.html#GUID-3B1CE181-CD30-4178-9602-230B800D4FAE'
    }
    else if(major >= 9) {
        settingsJvmOptsLink.href = `https://docs.oracle.com/javase/${major}/tools/java.htm`
    }
    else {
        settingsJvmOptsLink.href = `https://docs.oracle.com/javase/${major}/docs/technotes/tools/${process.platform === 'win32' ? 'windows' : 'unix'}/java.html`
    }
}

function bindMinMaxRam(server) {
    // Store maximum memory values.
    const SETTINGS_MAX_MEMORY = ConfigManager.getAbsoluteMaxRAM(server.rawServer.javaOptions?.ram)
    const SETTINGS_MIN_MEMORY = ConfigManager.getAbsoluteMinRAM(server.rawServer.javaOptions?.ram)

    // Set the max and min values for the ranged sliders.
    settingsMaxRAMRange.setAttribute('max', SETTINGS_MAX_MEMORY)
    settingsMaxRAMRange.setAttribute('min', SETTINGS_MIN_MEMORY)
    settingsMinRAMRange.setAttribute('max', SETTINGS_MAX_MEMORY)
    settingsMinRAMRange.setAttribute('min', SETTINGS_MIN_MEMORY)
}

/**
 * Prepare the Java tab for display.
 */
async function prepareJavaTab(){
    const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    bindMinMaxRam(server)
    bindRangeSlider(server)
    populateMemoryStatus()
    populateJvmOptsLink(server)
}

/**
 * About Tab
 */

// Bind the devtools toggle button.
document.getElementById('settingsAboutDevToolsButton').onclick = (e) => {
    let window = remote.getCurrentWindow()
    window.toggleDevTools()
}

/**
 * Return whether or not the provided version is a prerelease.
 * 
 * @param {string} version The semver version to test.
 * @returns {boolean} True if the version is a prerelease, otherwise false.
 */
function isPrerelease(version){
    const preRelComp = semver.prerelease(version)
    return preRelComp != null && preRelComp.length > 0
}

/**
 * Utility method to display version information on the
 * About and Update settings tabs.
 * 
 * @param {string} version The semver version to display.
 * @param {Element} valueElement The value element.
 * @param {Element} titleElement The title element.
 * @param {Element} checkElement The check mark element.
 */
function populateVersionInformation(version, valueElement, titleElement, checkElement){
    valueElement.innerHTML = version
    if(isPrerelease(version)){
        titleElement.innerHTML = Lang.queryJS('settings.about.preReleaseTitle')
        titleElement.style.color = '#ff886d'
        checkElement.style.background = '#ff886d'
    } else {
        titleElement.innerHTML = Lang.queryJS('settings.about.stableReleaseTitle')
        titleElement.style.color = null
        checkElement.style.background = null
    }
}

/**
 * Show the launcher version in the drawer footer.
 */
function populateAboutVersionInformation(){
    document.getElementById('settingsAboutCurrentVersionValue').textContent = remote.app.getVersion()
}

/**
 * Prepare the about information for display.
 */
function prepareAboutTab(){
    populateAboutVersionInformation()
}

/**
 * Update Tab
 */

const settingsTabUpdate            = document.getElementById('settingsTabUpdate')
const settingsUpdateTitle          = document.getElementById('settingsUpdateTitle')
const settingsUpdateVersionCheck   = document.getElementById('settingsUpdateVersionCheck')
const settingsUpdateVersionTitle   = document.getElementById('settingsUpdateVersionTitle')
const settingsUpdateVersionValue   = document.getElementById('settingsUpdateVersionValue')
const settingsUpdateChangelogTitle = settingsTabUpdate.getElementsByClassName('settingsChangelogTitle')[0]
const settingsUpdateChangelogText  = settingsTabUpdate.getElementsByClassName('settingsChangelogText')[0]
const settingsUpdateChangelogCont  = settingsTabUpdate.getElementsByClassName('settingsChangelogContainer')[0]
const settingsUpdateActionButton   = document.getElementById('settingsUpdateActionButton')

/**
 * Update the properties of the update action button.
 * 
 * @param {string} text The new button text.
 * @param {boolean} disabled Optional. Disable or enable the button
 * @param {function} handler Optional. New button event handler.
 */
function settingsUpdateButtonStatus(text, disabled = false, handler = null){
    settingsUpdateActionButton.innerHTML = text
    settingsUpdateActionButton.disabled = disabled
    if(handler != null){
        settingsUpdateActionButton.onclick = handler
    }
}

/**
 * Populate the update tab with relevant information.
 * 
 * @param {Object} data The update data.
 */
function populateSettingsUpdateInformation(data){
    if(data != null){
        settingsUpdateTitle.innerHTML = isPrerelease(data.version) ? Lang.queryJS('settings.updates.newPreReleaseTitle') : Lang.queryJS('settings.updates.newReleaseTitle')
        settingsUpdateChangelogCont.style.display = null
        settingsUpdateChangelogTitle.innerHTML = data.releaseName
        settingsUpdateChangelogText.innerHTML = data.releaseNotes
        populateVersionInformation(data.version, settingsUpdateVersionValue, settingsUpdateVersionTitle, settingsUpdateVersionCheck)
        
        if(process.platform === 'darwin'){
            settingsUpdateButtonStatus(Lang.queryJS('settings.updates.downloadButton'), false, () => {
                shell.openExternal(data.darwindownload)
            })
        } else {
            settingsUpdateButtonStatus(Lang.queryJS('settings.updates.downloadingButton'), true)
        }
    } else {
        settingsUpdateTitle.innerHTML = Lang.queryJS('settings.updates.latestVersionTitle')
        settingsUpdateChangelogCont.style.display = 'none'
        populateVersionInformation(remote.app.getVersion(), settingsUpdateVersionValue, settingsUpdateVersionTitle, settingsUpdateVersionCheck)
        settingsUpdateButtonStatus(Lang.queryJS('settings.updates.checkForUpdatesButton'), false, () => {
            if(!isDev){
                ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                settingsUpdateButtonStatus(Lang.queryJS('settings.updates.checkingForUpdatesButton'), true)
            }
        })
    }
}

/**
 * Prepare update tab for display.
 * 
 * @param {Object} data The update data.
 */
function prepareUpdateTab(data = null){
    populateSettingsUpdateInformation(data)
}

/**
 * Settings preparation functions.
 */

/**
  * Prepare the entire settings UI.
  * 
  * @param {boolean} first Whether or not it is the first load.
  */
async function prepareSettings(first = false) {
    if(first){
        initSettingsValidators()
        prepareUpdateTab()
    } else {
        await prepareAddonsTab()
    }
    await initSettingsValues()
    prepareAccountsTab()
    await prepareJavaTab()
    prepareAboutTab()
}

// Save pending settings when the launcher window is closed.
// (remote.getCurrentWindow().on('close', ...) removed with @electron/remote -
// beforeunload below already covers the same save-before-exit behavior.)
window.addEventListener('beforeunload', saveSettingsOnExit)
