/**
 * Oja Playground — orchestrates VFS, Service Worker, layout mounting,
 * and all global reactive state. Components communicate via context + emit/listen.
 */

import {
    context, state, derived, effect,
    emit, listen, on, keys,
    layout, VFS, Out,
    notify, modal,
} from '../src/oja.full.js';

// Canonical context keys
export const [files,       setFiles]       = context('files', {});
export const[activeFile,  setActiveFile]  = context.persist('active_file', 'index.html');
export const[logs,        setLogs]        = context('logs', []);
export const [theme,       setTheme]       = context.persist('theme', 'dark');
export const [layoutMode,  setLayoutMode]  = context.persist('layout_mode', 'horizontal');
export const [mobileView,  setMobileView]  = context.persist('mobile_view', false);
export const [autoRefresh, setAutoRefresh] = context.persist('auto_refresh', true);
export const [panelSplit,  setPanelSplit]  = context.persist('panel_split', 50);
export const [consoleOpen, setConsoleOpen] = context.persist('console_open', true);
export const [consoleH,    setConsoleH]    = context.persist('console_height', 180);
export const [sidebarOpen, setSidebarOpen] = context('sidebar_open', false);
export const [sidebarPin,  setSidebarPin]  = context.persist('sidebar_pin', false);
export const[savedState,  setSavedState]  = state(null);

export const isDirty = derived(() => JSON.stringify(files()) !== savedState());

// Fetches examples/blank/index.html; falls back to a minimal inline template.
let _blankCache = null;
async function _fetchBlank() {
    if (_blankCache) return _blankCache;
    try {
        const res = await fetch('./examples/blank/index.html');
        if (res.ok) { _blankCache = await res.text(); return _blankCache; }
    } catch (_) {}
    _blankCache = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>New Project</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@agberohq/oja@latest/build/oja.min.css">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #0f0f0f; color: #e8e8e8; font-family: system-ui, sans-serif;
               min-height: 100vh; display: flex; align-items: center; justify-content: center; }
        #app { text-align: center; }
        h1 { font-size: 1.5rem; margin-bottom: 8px; }
        p  { color: #555; font-size: 14px; }
    </style>
</head>
<body>
<div id="app">
    <h1>New Project</h1>
    <p>Start building with Oja.</p>
</div>
<script type="module">
    import { state, effect } from 'https://cdn.jsdelivr.net/npm/@agberohq/oja@latest/build/oja.core.esm.js';

    // const [count, setCount] = state(0);
    // effect(() => console.log(count()));
</script>
</body>
</html>`;
    return _blankCache;
}

let _vfs = null;

async function init() {
    showLoading(true);
    try {
        await registerSW();

        _vfs = new VFS('oja-playground');
        await _vfs.ready();

        const existing = await _vfs.getAll();
        // If the DB is completely empty on load, boot the starter example
        if (Object.keys(existing).length === 0) {
            await loadExample('starter');
        } else {
            setFiles(existing);
            setSavedState(JSON.stringify(existing));
        }

        await layout.apply('#app', './layouts/playground.html');
        await Promise.all([
            layout.slot('nav',     Out.c('./components/nav.html')),
            layout.slot('tabs',    Out.c('./components/tabs.html')),
            layout.slot('editor',  Out.c('./components/editor.html')),
            layout.slot('preview', Out.c('./components/preview.html')),
            layout.slot('console', Out.c('./components/console.html')),
            layout.slot('sidebar', Out.c('./components/sidebar.html')),
        ]);

        setupEffects();
        setupEvents();
        setupResize();
        await loadFromURL();

        window.addEventListener('beforeunload', e => {
            if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
        });

        await syncToWorker();
        runPreview();

    } catch (err) {
        console.error('[playground] init failed', err);
        notify.error('Failed to start. Check console.');
    } finally {
        showLoading(false);
    }
}

function registerSW() {
    if (!('serviceWorker' in navigator)) return Promise.resolve();
    return new Promise(async (resolve) => {
        try {
            await navigator.serviceWorker.register('./sw.js');
        } catch (e) {
            console.warn('[playground] SW registration failed', e);
            resolve();
            return;
        }
        if (navigator.serviceWorker.controller) {
            resolve();
            return;
        }
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
        setTimeout(resolve, 2000);
    });
}

function syncToWorker() {
    if (!('serviceWorker' in navigator)) return Promise.resolve();

    return new Promise(async resolve => {
        try {
            const reg = await navigator.serviceWorker.ready;
            const sw = reg.active;
            if (!sw) {
                resolve();
                return;
            }

            const onMsg = e => {
                if (e.data?.type === 'VFS_SYNCED') {
                    navigator.serviceWorker.removeEventListener('message', onMsg);
                    resolve();
                }
            };

            navigator.serviceWorker.addEventListener('message', onMsg);
            sw.postMessage({ type: 'SYNC_VFS', files: files() });

            setTimeout(() => {
                navigator.serviceWorker.removeEventListener('message', onMsg);
                resolve();
            }, 1000);

        } catch (e) {
            resolve();
        }
    });
}

async function runPreview() {
    if (!files()['index.html']) {
        notify.warn('No index.html to preview.');
        return;
    }
    setLogs([]); // Automatically clear logs on every run so old state isn't visually injected back
    await syncToWorker();
    emit('preview:run', { url: `./preview-zone/index.html?t=${Date.now()}` });
    setSavedState(JSON.stringify(files()));
}

async function loadExample(dir) {
    try {
        await _vfs.clear();
        setLogs([]);
        history.replaceState(null, '', window.location.pathname + window.location.search);

        const base = `./examples/${dir}/`;
        let filesToLoad = ['index.html'];

        try {
            const cfgRes = await fetch(base + 'oja.config.json');
            if (cfgRes.ok) {
                const cfg = await cfgRes.json();
                filesToLoad = cfg.vfs?.files || filesToLoad;
            }
        } catch (_) {}

        const newFiles = {};
        await Promise.all(filesToLoad.map(async path => {
            try {
                const res = await fetch(base + path);
                if (res.ok) {
                    newFiles[path] = await res.text();
                    await _vfs.write(path, newFiles[path]);
                }
            } catch (_) {}
        }));

        setFiles(newFiles);
        setActiveFile('index.html');
        setSavedState(JSON.stringify(newFiles));

        await syncToWorker();
        runPreview();
        notify.success(`Loaded "${dir}"`);
    } catch (err) {
        notify.error(`Failed to load "${dir}"`);
        console.error(err);
    }
}

// Replaces the old resetWorkspace. Functions as a true "New Project" action.
async function createNewProject() {
    const ok = await modal.confirm('Create a new blank project? Current files will be lost.');
    if (!ok) return;

    const html    = await _fetchBlank();
    const project = { 'index.html': html };

    await _vfs.clear();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    setLogs([]);
    localStorage.removeItem('pg_expanded');

    await _vfs.write('index.html', html);
    setFiles(project);
    setActiveFile('index.html');
    setSavedState(JSON.stringify(project));

    await syncToWorker();
    runPreview();
    notify.success('New project created.');
}

async function createFile(name) {
    if (!name?.trim()) return;
    name = name.trim();
    if (files()[name]) { notify.warn(`"${name}" already exists`); return; }

    const templates = {
        js:   `// ${name}\n`,
        css:  `/* ${name} */\n`,
        html: `<!-- ${name} -->\n<div>\n\n</div>\n`,
    };
    const ext = name.split('.').pop();
    const content = templates[ext] || '';

    const next = { ...files(),[name]: content };
    setFiles(next);
    setActiveFile(name);
    setSavedState(JSON.stringify(next));
    await _vfs.write(name, content);
    syncToWorker();
}

async function deleteFile(path) {
    if (path === 'index.html') { notify.warn('index.html is required.'); return; }
    const ok = await modal.confirm(`Delete "${path}"?`);
    if (!ok) return;
    const next = { ...files() };
    delete next[path];
    setFiles(next);
    if (activeFile() === path) setActiveFile('index.html');
    setSavedState(JSON.stringify(next));
    await _vfs.rm(path);
    syncToWorker();
    notify.success(`Deleted "${path}"`);
}

async function renameFile(oldPath, newPath) {
    if (!oldPath || !newPath || oldPath === newPath) return;
    if (files()[newPath]) { notify.warn(`"${newPath}" already exists`); return; }
    const content = files()[oldPath];
    const next = { ...files() };
    delete next[oldPath];
    next[newPath] = content;
    setFiles(next);
    if (activeFile() === oldPath) setActiveFile(newPath);
    setSavedState(JSON.stringify(next));
    await _vfs.write(newPath, content);
    await _vfs.rm(oldPath);
    syncToWorker();
}

async function exportProject() {
    const data = JSON.stringify(await _vfs.getAll(), null, 2);
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([data], { type: 'application/json' })),
        download: `oja-project-${Date.now()}.json`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
    notify.success('Exported');
}

async function importProject(file) {
    if (!file) return;
    try {
        const imported = JSON.parse(await file.text());
        await _vfs.clear();
        history.replaceState(null, '', window.location.pathname + window.location.search);
        for (const [p, c] of Object.entries(imported)) await _vfs.write(p, c);
        setFiles(imported);
        setActiveFile('index.html');
        setSavedState(JSON.stringify(imported));
        await syncToWorker();
        runPreview();
        notify.success(`Imported ${Object.keys(imported).length} files`);
    } catch (err) {
        notify.error('Import failed: ' + err.message);
    }
}

async function loadFromURL() {
    const params = new URLSearchParams(location.hash.slice(1));
    const encoded = params.get('state');
    if (!encoded) return;
    try {
        const imported = JSON.parse(decodeURIComponent(atob(encoded)));
        await _vfs.clear();
        for (const [p, c] of Object.entries(imported)) await _vfs.write(p, c);
        setFiles(imported);
        setActiveFile('index.html');
        setSavedState(JSON.stringify(imported));

        // Strip the hash now that it's loaded to VFS, so refreshing doesn't overwrite new edits
        history.replaceState(null, '', window.location.pathname + window.location.search);
        notify.success('Project loaded from URL');
    } catch (_) {}
}

function setupEffects() {
    effect(() => { document.body.dataset.theme = theme(); });

    effect(() => {
        document.querySelector('.pg-layout')?.setAttribute('data-layout', layoutMode());
    });

    effect(() => {
        const sidebar = document.querySelector('.pg-sidebar');
        const main    = document.querySelector('.pg-main');
        if (!sidebar || !main) return;
        const open   = sidebarOpen() || sidebarPin();
        sidebar.classList.toggle('open',   open);
        sidebar.classList.toggle('pinned', sidebarPin());
        main.classList.toggle('sidebar-pinned', sidebarPin());
    });

    effect(() => {
        const body = document.querySelector('.console-body');
        if (body) {
            body.style.height = consoleH() + 'px';
            body.style.maxHeight = 'none';
        }
    });

    effect(() => {
        if (!autoRefresh() || !isDirty()) return;
        const t = setTimeout(() => runPreview(), 900);
        return () => clearTimeout(t);
    });
}

function setupEvents() {
    on('[data-action="run"]',            'click', () => runPreview());
    listen('preview:force',              () => runPreview());
    on('[data-action="new-project"]',    'click', () => createNewProject());
    on('[data-action="new-file"]',       'click', () => openNewFileModal());
    on('[data-action="examples"]',       'click', () => openExamplesModal());
    on('[data-action="toggle-theme"]',   'click', () => setTheme(t => t === 'dark' ? 'light' : 'dark'));
    on('[data-action="toggle-layout"]',  'click', () => setLayoutMode(m => m === 'horizontal' ? 'vertical' : 'horizontal'));
    on('[data-action="toggle-mobile"]',  'click', () => setMobileView(v => !v));
    on('[data-action="toggle-sidebar"]', 'click', () => setSidebarOpen(v => !v));
    on('[data-action="pin-sidebar"]',    'click', () => setSidebarPin(v => !v));
    on('[data-action="pop-out"]',        'click', () => {
        const f = document.getElementById('preview-frame');
        if (f?.src) window.open(f.src, '_blank');
    });

    // Explicit Share button copies URL to clipboard instead of polluting URL bar on every keystroke
    on('[data-action="share"]', 'click', () => {
        try {
            const stateStr = JSON.stringify(files());
            const encoded = btoa(encodeURIComponent(stateStr));
            const url = window.location.origin + window.location.pathname + window.location.search + '#state=' + encoded;
            navigator.clipboard.writeText(url);
            notify.success('Shareable link copied to clipboard!');
        } catch (err) {
            notify.error('Project too large to share via URL. Use Export instead.');
        }
    });

    on('[data-action="export"]',  'click', exportProject);
    on('[data-action="import"]',  'click', () => document.getElementById('import-input')?.click());
    on('#import-input', 'change', e => {
        if (e.target.files?.[0]) importProject(e.target.files[0]);
        e.target.value = '';
    });

    on('[data-action="modal-close"]',  'click', () => modal.close());

    // Form submission handlers for modals (allows pressing Enter to submit)
    on('#new-file-form', 'submit', (e) => {
        e.preventDefault();
        const val = document.getElementById('new-file-input')?.value?.trim();
        if (val) createFile(val);
        modal.close();
    });

    on('#rename-form', 'submit', (e, el) => {
        e.preventDefault();
        const path = el.dataset.path;
        const name = path.split('/').pop();
        const newName = document.getElementById('rename-input')?.value?.trim();
        if (newName && newName !== name) {
            const parts = path.split('/');
            parts.pop();
            const newPath = parts.length ? parts.join('/') + '/' + newName : newName;
            renameFile(path, newPath);
        }
        modal.close();
    });

    on('[data-action="load-example"]', 'click', (e, el) => {
        modal.close();
        if (el.dataset.ex === 'blank') { createNewProject(); return; }
        loadExample(el.dataset.ex);
    });

    listen('vfs:save', async ({ path, content }) => {
        await _vfs.write(path, content);
        syncToWorker();
    });
    listen('file:delete', ({ path }) => deleteFile(path));
    listen('file:rename', ({ oldPath, newPath }) => renameFile(oldPath, newPath));
    listen('file:rename-prompt', ({ path }) => openRenameModal(path));

    window.addEventListener('message', e => {
        if (e.data?.type === 'console') {
            setLogs(prev =>[...prev.slice(-199), e.data]);
        }
    });

    document.addEventListener('click', e => {
        if (!sidebarPin() && sidebarOpen()
            && !e.target.closest('.pg-sidebar')
            && !e.target.closest('[data-action="toggle-sidebar"]')) {
            setSidebarOpen(false);
        }
    });

    keys({
        'ctrl+enter': () => runPreview(),
        'ctrl+s':     e => { e.preventDefault(); runPreview(); },
        'ctrl+n':     e => { e.preventDefault(); openNewFileModal(); },
        'ctrl+e':     e => { e.preventDefault(); exportProject(); },
        'ctrl+i':     e => { e.preventDefault(); document.getElementById('import-input')?.click(); },
        'ctrl+\\':    () => setTheme(t => t === 'dark' ? 'light' : 'dark'),
        'ctrl+b':     () => setSidebarOpen(v => !v),
        'escape':     () => modal.close(),
        'f5':         e => { e.preventDefault(); runPreview(); },
    });
}

function setupResize() {
    makeResizable(
        document.getElementById('split-handle'),
        pct => {
            setPanelSplit(pct);
            document.querySelector('.editor-pane').style.flexBasis = pct + '%';
            document.querySelector('.preview-pane').style.flexBasis = (100 - pct) + '%';
        },
        'horizontal'
    );

    makeResizable(
        document.getElementById('console-resize'),
        px => {
            const clamped = Math.max(60, Math.min(500, px));
            setConsoleH(clamped);
            if (!consoleOpen()) setConsoleOpen(true);
        },
        'console'
    );
}

function makeResizable(handle, onResize, mode) {
    if (!handle) return;
    let active = false;

    const endDrag = () => {
        if (!active) return;
        active = false;
        handle.classList.remove('dragging');
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = '');
    };

    handle.addEventListener('pointerdown', e => {
        active = true;
        handle.setPointerCapture(e.pointerId);
        handle.classList.add('dragging');
        document.body.style.userSelect = 'none';
        document.body.style.cursor = mode === 'console' ? 'ns-resize' : 'row-resize';
        document.querySelectorAll('iframe').forEach(f => f.style.pointerEvents = 'none');
    });

    handle.addEventListener('pointermove', e => {
        if (!active) return;
        if (mode === 'horizontal') {
            const rect = document.querySelector('.editor-preview').getBoundingClientRect();
            const pct  = Math.max(20, Math.min(80, ((e.clientX - rect.left) / rect.width) * 100));
            onResize(Math.round(pct));
        } else if (mode === 'console') {
            const px = window.innerHeight - e.clientY - 28;
            onResize(Math.round(px));
        }
    });

    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
}

function openNewFileModal() {
    modal.open('pg-modal', {
        body: Out.html(`
            <form id="new-file-form" style="display:flex;flex-direction:column;gap:12px">
                <input id="new-file-input" class="modal-input" placeholder="e.g. components/card.html" autofocus>
                <div class="modal-hint">
                    <span class="hint-tag">.html</span> component &nbsp;
                    <span class="hint-tag">.js</span> module &nbsp;
                    <span class="hint-tag">.css</span> styles
                </div>
                <button type="submit" class="btn-primary">Create</button>
            </form>
        `)
    });
    setTimeout(() => document.getElementById('new-file-input')?.focus(), 50);
}

function openExamplesModal() {
    const EXAMPLES =[
        { id: 'blank',     label: 'Blank',      sub: 'empty project' },
        { id: 'starter',   label: 'Starter',    sub: 'state · effect · component' },
        { id: 'todo',      label: 'Todo',       sub: 'list · reactivity' },
        { id: 'router',    label: 'Router',     sub: 'multi-page SPA' },
        { id: 'guestbook', label: 'Guestbook',  sub: 'form · validation' },
        { id: 'channel',   label: 'Channel',    sub: 'async pipeline' },
        { id: 'game',      label: 'Game',       sub: 'Rhyme Rush' },
        { id: 'twitter',   label: 'Twitter',    sub: 'full SPA · 17 files' },
    ];
    modal.open('pg-modal', {
        body: Out.html(`
            <div class="example-grid">
                ${EXAMPLES.map(e => `
                    <button class="example-card" data-action="load-example" data-ex="${e.id}">
                        <span class="example-label">${e.label}</span>
                        <span class="example-sub">${e.sub}</span>
                    </button>
                `).join('')}
            </div>
        `)
    });
}

function openRenameModal(path) {
    const name = path.split('/').pop();
    modal.open('pg-modal', {
        body: Out.html(`
            <form id="rename-form" data-path="${path}" style="display:flex;flex-direction:column;gap:12px">
                <label style="font-size:11px;color:var(--text-muted)">Rename "${name}"</label>
                <input id="rename-input" class="modal-input" value="${name}" autofocus>
                <button type="submit" class="btn-primary">Rename</button>
            </form>
        `)
    });
    setTimeout(() => {
        const input = document.getElementById('rename-input');
        input?.focus();
        input?.select();
    }, 50);
}

let _loadEl = null;

function showLoading(show) {
    if (show && !_loadEl) {
        _loadEl = Object.assign(document.createElement('div'), { className: 'pg-loading' });
        _loadEl.innerHTML = '<div class="pg-spinner"></div>';
        document.body.appendChild(_loadEl);
    } else if (!show && _loadEl) {
        _loadEl.remove();
        _loadEl = null;
    }
}

init().catch(err => {
    console.error('[playground] fatal', err);
    notify.error('Fatal error — check console');
});