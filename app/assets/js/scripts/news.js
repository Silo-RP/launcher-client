/**
 * Script for news.ejs - the Bulletin view. Doesn't fetch anything itself:
 * landing.js owns the /news.json check and hands the markdown over through
 * setBulletins().
 *
 * The backend serves a single markdown document. Each `## ` heading starts
 * one bulletin (newest first); text before the first heading, or a document
 * without any heading, becomes a single untitled bulletin. A heading may start
 * with a date followed by a separator: "## 18/11 · Titre",
 * "## 18/11/2026 - Titre", "## 2026-11-18 | Titre", "## 18 novembre · Titre".
 */
const marked = require('marked')

const newsList    = document.getElementById('newsList')
const newsArticle = document.getElementById('newsArticle')
const newsEmpty   = document.getElementById('newsEmpty')

let bulletins = []
let bulletinSelected = 0

const BULLETIN_DATE = /^(\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?|\d{4}-\d{2}-\d{2}|\d{1,2}(?:er)?\s+(?:janv|f[ée]vr|mars|avr|mai|juin|juil|ao[uû]t|sept|oct|nov|d[ée]c)[a-zéû]*\.?(?:\s+\d{4})?)\s*[·|:–-]\s*(.+)$/i

/**
 * Split an optional leading date off a bulletin heading.
 *
 * @param {string} heading The heading text.
 * @returns {{date: string|null, title: string}} Date (as written) and title.
 */
function splitBulletinHeading(heading){
    const m = BULLETIN_DATE.exec(heading.trim())
    return m ? { date: m[1], title: m[2] } : { date: null, title: heading }
}

function escapeBulletinText(text){
    return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

/**
 * Split the backend markdown into bulletins.
 *
 * @param {string} markdown Raw markdown, as returned by /news.json.
 * @returns {{num: number, title: string, body: string}[]} Newest first.
 */
function parseBulletins(markdown){
    if(!markdown || markdown.trim().length === 0){
        return []
    }
    const parts = []
    let current = null
    let preamble = []
    for(const line of markdown.split(/\r?\n/)){
        const m = /^##\s+(.+?)\s*#*\s*$/.exec(line)
        if(m){
            current = { title: m[1], lines: [] }
            parts.push(current)
        } else if(current){
            current.lines.push(line)
        } else {
            preamble.push(line)
        }
    }
    const preambleText = preamble.join('\n').trim()
    if(parts.length === 0){
        parts.push({ title: Lang.queryJS('news.untitled'), lines: preamble })
    } else if(preambleText.length > 0){
        parts[0].lines.unshift(preambleText, '')
    }
    return parts.map((p, i) => ({
        num: parts.length - i,
        ...splitBulletinHeading(p.title),
        body: p.lines.join('\n').trim()
    }))
}

function renderBulletins(){
    const hasAny = bulletins.length > 0
    newsEmpty.hidden = hasAny
    newsList.parentElement.hidden = !hasAny
    newsArticle.hidden = !hasAny
    if(!hasAny){
        newsList.innerHTML = ''
        newsArticle.innerHTML = ''
        return
    }
    newsList.innerHTML = bulletins.map((b, i) => `<button class="post" type="button" data-post="${i}" aria-current="${i === bulletinSelected}">
            <span class="meta"><i aria-hidden="true"></i>${b.date ? `${escapeBulletinText(b.date)} \u00B7 ${Lang.queryJS('news.numberShort', { num: b.num })}` : Lang.queryJS('news.number', { num: b.num })}</span>
            <span class="ttl">${escapeBulletinText(b.title)}</span>
        </button>`).join('')
    const b = bulletins[bulletinSelected]
    newsArticle.innerHTML = `<p class="when">${b.date ? Lang.queryJS('news.numberWithDate', { num: b.num, date: escapeBulletinText(b.date) }) : Lang.queryJS('news.number', { num: b.num })}</p>
        <h2>${escapeBulletinText(b.title)}</h2>
        <div class="articleBody">${marked.parse(b.body)}</div>`
    newsArticle.scrollTop = 0
}

/**
 * Replace the bulletins shown in the view (and in the home teaser).
 *
 * @param {string} markdown Raw markdown from /news.json.
 * @param {boolean} unread Whether the latest content hasn't been opened yet.
 */
function setBulletins(markdown, unread){
    bulletins = parseBulletins(markdown)
    bulletinSelected = 0
    renderBulletins()

    const teaser = document.getElementById('newsTeaser')
    document.querySelector('.navLink[data-nav="bulletin"]').toggleAttribute('data-unread', !!unread && bulletins.length > 0)
    if(bulletins.length > 0){
        document.getElementById('newsTeaserNum').textContent = Lang.queryJS('news.number', { num: bulletins[0].num })
        document.getElementById('newsTeaserTitle').textContent = bulletins[0].title
        teaser.toggleAttribute('unread', !!unread)
        teaser.hidden = false
    } else {
        teaser.hidden = true
    }
}

newsList.addEventListener('click', e => {
    const btn = e.target.closest('[data-post]')
    if(btn){
        bulletinSelected = Number(btn.getAttribute('data-post'))
        renderBulletins()
        newsList.querySelector(`[data-post="${bulletinSelected}"]`)?.focus()
    }
})

renderBulletins()
