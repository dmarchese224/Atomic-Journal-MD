const state = {
    dirHandle: null,
    entries: {},
    activeDate: null,
    searchQuery: '',
    calYear: 0,
    calMonth: 0,
    theme: 'dark'
};

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDisplay = s => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

function showToast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window.__toast);
    window.__toast = setTimeout(() => t.classList.remove('show'), 2200);
}

function applyTheme(t) {
    state.theme = t;
    document.documentElement.setAttribute('data-theme', t);
}

function markUnsaved() { $('#saveStatusText').textContent = 'Unsaved changes'; }
function markSaved() { $('#saveStatusText').textContent = 'Saved'; }

// The easiest, safest parser ever built. No regex allowed.
function parseEntry(text) {
    let events = '';
    let forward = '';
    
    if (!text) return { events, forward };
    
    const evIdx = text.indexOf("## Today's Events");
    const fwIdx = text.indexOf("## Looking Forward");
    
    if (evIdx !== -1 && fwIdx !== -1) {
        // We have both sections
        events = text.slice(evIdx + 17, fwIdx).trim();
        forward = text.slice(fwIdx + 18).trim();
    } else if (evIdx !== -1) {
        // We only have the first section
        events = text.slice(evIdx + 17).trim();
    }
    
    return { events, forward };
}

function buildMd(dateStr, eventsText, forwardText) {
    return `---
date: ${dateStr}
---

## Today's Events
${eventsText.trim()}

## Looking Forward
${forwardText.trim()}
`;
}

async function loadAllEntries() {
    if (!state.dirHandle) return;
    state.entries = {};
    
    try {
        for await (const [name, handle] of state.dirHandle.entries()) {
            if (handle.kind === 'file' && /^\d{4}-\d{2}-\d{2}\.md$/.test(name)) {
                const text = await (await handle.getFile()).text();
                const dateKey = name.replace('.md', '');
                state.entries[dateKey] = { text: text, parsed: parseEntry(text) };
            }
        }
    } catch (err) {
        console.error("Error reading files", err);
    }
    renderMiniCal();
    renderEntriesList();
}

async function openFolder() {
    try {
        state.dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        $('#folderPath').textContent = state.dirHandle.name;
        await loadAllEntries();
        await openEntryForDate(todayStr());
        showToast('Folder opened');
    } catch (e) {
        if (e.name !== 'AbortError') showToast('Could not open folder');
    }
}

async function saveEntry() {
    if (!state.dirHandle) {
        showToast('Open a folder first');
        return;
    }
    
    const eventsText = $('#eventsText').value;
    const forwardText = $('#forwardText').value;
    const md = buildMd(state.activeDate, eventsText, forwardText);
    
    try {
        const fh = await state.dirHandle.getFileHandle(state.activeDate + '.md', { create: true });
        const w = await fh.createWritable();
        await w.write(md);
        await w.close();
        
        state.entries[state.activeDate] = { text: md, parsed: parseEntry(md) };
        renderMiniCal();
        renderEntriesList();
        markSaved();
        showToast('Entry saved');
    } catch (e) {
        showToast('Save failed');
    }
}

async function openEntryForDate(dateStr) {
    state.activeDate = dateStr;
    $('#entryDateDisplay').textContent = fmtDisplay(dateStr);
    $('#entryFilename').textContent = dateStr + '.md';
    
    if (!state.dirHandle) {
        $('#noFolderMsg').style.display = 'flex';
        $('#entryForm').style.display = 'none';
        return;
    }
    
    $('#noFolderMsg').style.display = 'none';
    $('#entryForm').style.display = 'flex';
    
    // Load text if file exists, otherwise clear fields
    if (state.entries[dateStr]) {
        $('#eventsText').value = state.entries[dateStr].parsed.events;
        $('#forwardText').value = state.entries[dateStr].parsed.forward;
    } else {
        $('#eventsText').value = '';
        $('#forwardText').value = '';
    }
    
    markSaved();
    renderMiniCal();
    switchView('editor');
}

function renderEntriesList() {
    const keys = Object.keys(state.entries).sort((a, b) => b.localeCompare(a));
    const q = state.searchQuery.toLowerCase();
    
    const filtered = keys.filter(k => {
        if (q && !state.entries[k].text.toLowerCase().includes(q)) return false;
        return true;
    });
    
    $('#browseSubtitle').textContent = q ? `Search: "${q}" — ${filtered.length} results` : `${filtered.length} entries`;
    const box = $('#entriesList');
    box.innerHTML = '';
    
    if (!filtered.length) {
        box.innerHTML = '<div class="empty-state"><h3>No notes found</h3></div>';
        return;
    }
    
    filtered.forEach(k => {
        const e = state.entries[k].parsed;
        const preview = (e.events || e.forward || '').slice(0, 150) + '...';
        
        const card = document.createElement('div');
        card.className = 'entry-card';
        card.innerHTML = `
            <div class="entry-card-top"><div class="entry-card-date">${fmtDisplay(k)}</div></div>
            <div class="entry-card-preview">${preview}</div>
        `;
        card.onclick = () => openEntryForDate(k);
        box.appendChild(card);
    });
}

function renderMiniCal() {
    const now = new Date();
    if (!state.calYear) { state.calYear = now.getFullYear(); state.calMonth = now.getMonth(); }
    
    const y = state.calYear; const m = state.calMonth;
    $('#calMonthLabel').textContent = new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    
    const grid = $('#calGrid'); grid.innerHTML = '';
    ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(d => {
        const el = document.createElement('div'); el.className = 'cal-dow'; el.textContent = d; grid.appendChild(el);
    });
    
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    
    for (let i = 0; i < first; i++) { grid.appendChild(document.createElement('div')); }
    
    for (let d = 1; d <= days; d++) {
        const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const el = document.createElement('div');
        el.className = 'cal-day';
        if (ds === todayStr()) el.classList.add('today');
        if (ds === state.activeDate) el.classList.add('selected');
        if (state.entries[ds]) el.classList.add('has-entry');
        el.textContent = d;
        el.onclick = () => openEntryForDate(ds);
        grid.appendChild(el);
    }
}

function switchView(name) {
    $$('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    $$('.view').forEach(v => v.classList.remove('active'));
    $('#view-' + name).classList.add('active');
}

document.addEventListener('DOMContentLoaded', () => {
    applyTheme('dark');
    if (window.lucide) lucide.createIcons();
    renderMiniCal();
    
    $('#themeToggle').onclick = () => applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    $('#openFolderBtn').onclick = openFolder;
    $('#emptyOpenFolderBtn').onclick = openFolder;
    $('#settingsOpenBtn').onclick = openFolder;
    
    $('#todayBtn').onclick = () => openEntryForDate(todayStr());
    $('#saveEntryBtn').onclick = saveEntry;
    
    $('#eventsText').addEventListener('input', markUnsaved);
    $('#forwardText').addEventListener('input', markUnsaved);
    
    $('#sidebarToggle').onclick = () => $('#sidebar').classList.toggle('collapsed');
    
    $$('.nav-item[data-view]').forEach(b => {
        b.onclick = () => {
            switchView(b.dataset.view);
            if (b.dataset.view === 'browse') renderEntriesList();
        };
    });
    
    $('#quickSearch').addEventListener('input', e => {
        state.searchQuery = e.target.value.trim();
        switchView('browse');
        renderEntriesList();
    });
    
    $('#refreshBtn').onclick = async () => {
        if (state.dirHandle) {
            await loadAllEntries();
            openEntryForDate(state.activeDate || todayStr());
            showToast('Reloaded');
        }
    };
    
    $('#calPrev').onclick = () => { state.calMonth--; if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; } renderMiniCal(); };
    $('#calNext').onclick = () => { state.calMonth++; if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; } renderMiniCal(); };
});