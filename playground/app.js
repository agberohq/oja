// Oja Playground - Main Application
import { state, effect, context } from 'https://cdn.jsdelivr.net/npm/oja-framework@latest/build/oja.core.esm.js';

// ============================================
// Default Files (Virtual File System)
// ============================================
const DEFAULT_FILES = {
    'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Oja App</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      font-family: system-ui, sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .card {
      background: rgba(255,255,255,0.05);
      backdrop-filter: blur(12px);
      border-radius: 32px;
      padding: 48px;
      text-align: center;
      border: 1px solid rgba(255,255,255,0.1);
    }
    h1 { font-size: 3rem; margin-bottom: 1rem; background: linear-gradient(135deg, #60a5fa, #a855f7); -webkit-background-clip: text; background-clip: text; color: transparent; }
    .counter { font-size: 5rem; font-weight: 800; margin: 24px 0; color: #f0f9ff; }
    button {
      background: #3b82f6;
      border: none;
      padding: 12px 32px;
      border-radius: 40px;
      font-size: 1rem;
      font-weight: 600;
      color: white;
      cursor: pointer;
      transition: transform 0.1s, background 0.2s;
    }
    button:hover { background: #2563eb; transform: scale(1.02); }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚡ Oja Counter</h1>
    <div class="counter" id="count">0</div>
    <button id="incBtn">Increment +1</button>
  </div>
  <script type="module">
    import { state, effect } from 'https://cdn.jsdelivr.net/npm/oja-framework@latest/build/oja.core.esm.js';
    const [count, setCount] = state(0);
    effect(() => document.getElementById('count').textContent = count());
    document.getElementById('incBtn').onclick = () => setCount(n => n + 1);
  <\/script>
</body>
</html>`,

    'app.js': `// Oja Router Example
import { Router, Out, context } from 'https://cdn.jsdelivr.net/npm/oja-framework@latest/build/oja.core.esm.js';

export const [theme, setTheme] = context('theme', 'dark');

const router = new Router({ mode: 'hash', outlet: '#app' });

router.Get('/', Out.component('index.html'));
router.Get('/about', Out.component('pages/about.html'));

router.NotFound(Out.html('<div style="padding:40px;text-align:center">404 — Not found</div>'));

router.start('/');`,

    'pages/about.html': `<div style="padding:48px; max-width:600px; margin:0 auto">
  <h1>✨ About Oja</h1>
  <p style="font-size:18px; margin-top:20px; line-height:1.6">Zero-build reactive framework. Write HTML, add state, done.</p>
  <p style="margin-top:16px; color:#888">Features: state, effect, context, routing, components, and more.</p>
  <a href="#/" style="display:inline-block; margin-top:24px; color:#3b82f6; text-decoration:none">← Back home</a>
</div>`
};

// ============================================
// Application State
// ============================================
const [files, setFiles] = state(DEFAULT_FILES);
const [activeFile, setActiveFile] = state('index.html');
const [openTabs, setOpenTabs] = state(['index.html', 'app.js', 'pages/about.html']);
const [consoleLogs, setConsoleLogs] = state([]);
const [consoleFilter, setConsoleFilter] = state('all');
const [consolePaused, setConsolePaused] = state(false);
const [theme, setTheme] = context('playground-theme', 'dark');

let editor = null;
let updateTimer = null;
let currentBlobUrls = [];

// ============================================
// CodeMirror Editor Setup
// ============================================
function initEditor() {
    const textarea = document.getElementById('editorTextarea');

    editor = CodeMirror.fromTextArea(textarea, {
        lineNumbers: true,
        theme: 'dracula',
        mode: 'htmlmixed',
        indentUnit: 2,
        tabSize: 2,
        lineWrapping: true,
        styleActiveLine: true,
        foldGutter: true,
        gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
        matchBrackets: true,
        autoCloseBrackets: true,
        autoCloseTags: true
    });

    editor.on('change', () => {
        if (activeFile()) {
            const newFiles = { ...files() };
            newFiles[activeFile()] = editor.getValue();
            setFiles(newFiles);

            if (updateTimer) clearTimeout(updateTimer);
            updateTimer = setTimeout(() => runPreview(), 400);
        }
    });

    editor.on('cursorActivity', () => {
        const cursor = editor.getCursor();
        document.getElementById('cursorPosition').textContent = `Ln ${cursor.line + 1}, Col ${cursor.ch + 1}`;
    });

    updateEditorContent();
}

function updateEditorContent() {
    if (!editor) return;
    const currentFile = activeFile();
    const content = files()[currentFile] || '';
    editor.setValue(content);
    setEditorMode(currentFile);
    document.getElementById('fileType').textContent = currentFile.split('.').pop().toUpperCase();
}

function setEditorMode(filename) {
    if (!editor) return;
    if (filename.endsWith('.js')) editor.setOption('mode', 'javascript');
    else if (filename.endsWith('.css')) editor.setOption('mode', 'css');
    else if (filename.endsWith('.html')) editor.setOption('mode', 'htmlmixed');
    else editor.setOption('mode', 'htmlmixed');
}

// ============================================
// File Tree Rendering
// ============================================
function renderFileTree() {
    const container = document.getElementById('fileTree');
    const fileList = Object.keys(files()).sort();

    container.innerHTML = fileList.map(path => `
    <div class="file-item ${path === activeFile() ? 'active' : ''}" data-path="${path}">
      <span class="file-icon">${getFileIcon(path)}</span>
      <span class="file-name">${escapeHtml(path)}</span>
      <span class="file-del" data-path="${path}">✕</span>
    </div>
  `).join('');

    // Add event listeners
    container.querySelectorAll('.file-item').forEach(el => {
        const path = el.dataset.path;
        el.addEventListener('click', (e) => {
            if (e.target.classList.contains('file-del')) return;
            openFile(path);
        });

        const delBtn = el.querySelector('.file-del');
        if (delBtn) {
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteFile(path);
            });
        }
    });

    document.getElementById('fileStats').textContent = `${fileList.length} files`;
}

function getFileIcon(path) {
    if (path.endsWith('.html')) return '📄';
    if (path.endsWith('.js')) return '⚡';
    if (path.endsWith('.css')) return '🎨';
    return '📁';
}

function renderTabs() {
    const container = document.getElementById('tabBar');
    const tabs = openTabs();

    container.innerHTML = tabs.map(path => `
    <div class="tab ${path === activeFile() ? 'active' : ''}" data-path="${path}">
      <span>${path.split('/').pop()}</span>
      <span class="tab-close" data-path="${path}">✕</span>
    </div>
  `).join('');

    container.querySelectorAll('.tab').forEach(el => {
        const path = el.dataset.path;
        el.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-close')) {
                closeTab(path);
            } else {
                openFile(path);
            }
        });
    });
}

function openFile(path) {
    if (!files()[path]) return;

    if (!openTabs().includes(path)) {
        setOpenTabs([...openTabs(), path]);
    }
    setActiveFile(path);
    updateEditorContent();
    renderFileTree();
    renderTabs();
}

function closeTab(path) {
    const newTabs = openTabs().filter(p => p !== path);
    setOpenTabs(newTabs);

    if (activeFile() === path) {
        setActiveFile(newTabs[0] || null);
    }
    if (activeFile()) updateEditorContent();
    renderFileTree();
    renderTabs();
}

async function deleteFile(path) {
    if (path === 'index.html') {
        addConsoleLog('error', ['Cannot delete index.html (entry point required)']);
        return;
    }

    if (!confirm(`Delete ${path}?`)) return;

    const newFiles = { ...files() };
    delete newFiles[path];
    setFiles(newFiles);

    const newTabs = openTabs().filter(p => p !== path);
    setOpenTabs(newTabs);

    if (activeFile() === path) {
        setActiveFile(newTabs[0] || 'index.html');
    }
    if (activeFile()) updateEditorContent();
    renderFileTree();
    renderTabs();
    runPreview();
}

async function createFile(path, content = '') {
    if (files()[path]) {
        addConsoleLog('error', [`File ${path} already exists`]);
        return false;
    }

    const defaultContent = getDefaultContent(path);
    const newFiles = { ...files(), [path]: content || defaultContent };
    setFiles(newFiles);
    setOpenTabs([...openTabs(), path]);
    setActiveFile(path);
    updateEditorContent();
    renderFileTree();
    renderTabs();
    runPreview();
    return true;
}

function getDefaultContent(path) {
    if (path.endsWith('.html')) return `<!-- ${path} -->\n<div class="container">\n  <h1>Hello Oja</h1>\n</div>`;
    if (path.endsWith('.js')) return `// ${path}\nimport { state, effect } from 'https://cdn.jsdelivr.net/npm/oja-framework@latest/build/oja.core.esm.js';\n\nconst [count, setCount] = state(0);\neffect(() => console.log('count:', count()));`;
    if (path.endsWith('.css')) return `/* ${path} */\n.container {\n  padding: 20px;\n}`;
    return '';
}

// ============================================
// Preview Builder
// ============================================
function buildPreviewHTML() {
    const indexContent = files()['index.html'];
    if (!indexContent) {
        return `<html><body style="background:#0a0c10;color:white;display:flex;justify-content:center;align-items:center;height:100vh"><h3>❌ No index.html found</h3><p>Create an index.html file to preview</p></body></html>`;
    }

    // Clean up old blob URLs
    currentBlobUrls.forEach(url => URL.revokeObjectURL(url));
    currentBlobUrls = [];

    const blobMap = {};
    Object.keys(files()).forEach(path => {
        const mime = path.endsWith('.js') ? 'text/javascript' :
            path.endsWith('.css') ? 'text/css' : 'text/html';
        const blob = new Blob([files()[path]], { type: mime });
        const url = URL.createObjectURL(blob);
        blobMap[path] = url;
        currentBlobUrls.push(url);
    });

    let result = indexContent;

    // Rewrite import statements
    result = result.replace(/(import\s+(?:[\w*{},\s]+from\s+)?['"])([^'"]+)(['"])/g, (match, pre, spec, post) => {
        if (spec.startsWith('http') || spec.startsWith('blob:')) return match;
        const resolved = spec.replace(/^\.\//, '');
        if (blobMap[resolved]) return pre + blobMap[resolved] + post;
        if (blobMap[`pages/${resolved}`]) return pre + blobMap[`pages/${resolved}`] + post;
        return match;
    });

    // Rewrite src/href attributes
    result = result.replace(/(src|href)=["']([^"']+)["']/g, (match, attr, val) => {
        if (val.startsWith('http') || val.startsWith('blob:') || val.startsWith('#')) return match;
        if (blobMap[val]) return `${attr}="${blobMap[val]}"`;
        if (blobMap[`pages/${val}`]) return `${attr}="${blobMap[`pages/${val}`]}"`;
        return match;
    });

    // Add console bridge
    const bridgeScript = `<script>
    (function() {
      const methods = ['log', 'warn', 'error', 'info'];
      methods.forEach(m => {
        const orig = console[m];
        console[m] = function(...args) {
          orig.apply(console, args);
          window.parent.postMessage({
            type: 'console',
            level: m,
            args: args.map(a => {
              try {
                return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a);
              } catch { return String(a); }
            })
          }, '*');
        };
      });
      window.addEventListener('error', (e) => {
        window.parent.postMessage({
          type: 'console',
          level: 'error',
          args: [e.message + ' at ' + (e.filename?.split('/').pop() || 'unknown') + ':' + e.lineno]
        }, '*');
      });
    })();
  <\/script>`;

    result = result.replace('</head>', bridgeScript + '</head>');
    return result;
}

function runPreview() {
    const html = buildPreviewHTML();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const iframe = document.getElementById('previewFrame');
    iframe.src = url;
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    document.getElementById('previewStatus').innerHTML = '● running';
}

// ============================================
// Console Management
// ============================================
function addConsoleLog(level, args) {
    if (consolePaused()) return;

    const message = args.map(a => {
        if (typeof a === 'object') {
            try { return JSON.stringify(a, null, 2); }
            catch { return String(a); }
        }
        return String(a);
    }).join(' ');

    const logs = consoleLogs();
    const newLog = {
        id: Date.now() + Math.random(),
        time: new Date().toLocaleTimeString(),
        level,
        message
    };

    setConsoleLogs([...logs, newLog].slice(-500)); // Keep last 500 logs
    renderConsoleLogs();
}

function renderConsoleLogs() {
    const container = document.getElementById('consoleLogs');
    const logs = consoleLogs();
    const filtered = consoleFilter() === 'all'
        ? logs
        : logs.filter(l => l.level === consoleFilter());

    if (filtered.length === 0) {
        container.innerHTML = '<div class="console-empty">✓ No logs — run your code to see output</div>';
        return;
    }

    container.innerHTML = filtered.map(log => `
    <div class="log-line">
      <span class="log-time">${log.time}</span>
      <span class="log-level ${log.level}">${log.level}</span>
      <span class="log-message">${escapeHtml(log.message)}</span>
    </div>
  `).join('');

    container.scrollTop = container.scrollHeight;
}

function clearConsole() {
    setConsoleLogs([]);
    renderConsoleLogs();
}

// ============================================
// Examples
// ============================================
const EXAMPLES = [
    {
        name: '🔥 Counter',
        desc: 'state + effect reactive counter',
        files: {
            'index.html': `<!DOCTYPE html>
<html>
<head><title>Counter</title>
<style>
body{background:#0f172a;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
.card{background:rgba(255,255,255,0.05);border-radius:32px;padding:48px;text-align:center}
h1{color:#60a5fa}
.count{font-size:72px;font-weight:800;margin:24px 0;color:#f0f9ff}
button{background:#3b82f6;padding:12px 32px;border:none;border-radius:40px;color:white;cursor:pointer}
</style>
</head>
<body>
<div class="card">
<h1>⚡ Oja Counter</h1>
<div class="count" id="count">0</div>
<button id="inc">+1</button>
</div>
<script type="module">
import{state,effect}from'https://cdn.jsdelivr.net/npm/oja-framework@latest/build/oja.core.esm.js';
const[count,setCount]=state(0);
effect(()=>document.getElementById('count').textContent=count());
document.getElementById('inc').onclick=()=>setCount(c=>c+1);
<\/script>
</body>
</html>`
        }
    },
    {
        name: '📝 Todo List',
        desc: 'reactive array with add/remove',
        files: {
            'index.html': `<!DOCTYPE html>
<html>
<head><title>Todo</title>
<style>
body{background:#0f172a;display:flex;justify-content:center;padding:40px}
.card{background:#1e293b;border-radius:24px;padding:32px;width:400px}
input{padding:12px;border-radius:12px;border:none;width:70%}
button{padding:12px 20px;margin-left:8px;background:#3b82f6;border:none;border-radius:12px;color:white;cursor:pointer}
ul{list-style:none;padding:0;margin-top:20px}
li{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #334155}
</style>
</head>
<body>
<div class="card">
<h2>📋 Oja Todo</h2>
<div><input id="newTask" placeholder="write a task"><button id="addBtn">Add</button></div>
<ul id="list"></ul>
</div>
<script type="module">
import{state,effect}from'https://cdn.jsdelivr.net/npm/oja-framework@latest/build/oja.core.esm.js';
const[tasks,setTasks]=state([]);
effect(()=>{
const ul=document.getElementById('list');
ul.innerHTML=tasks().map((t,i)=>'<li><span>'+t+'</span><button data-idx='+i+' style="background:#ef4444">✕</button></li>').join('');
});
document.getElementById('addBtn').onclick=()=>{
const inp=document.getElementById('newTask');
if(inp.value.trim())setTasks([...tasks(),inp.value]);
inp.value='';
};
document.getElementById('list').onclick=(e)=>{
if(e.target.tagName==='BUTTON')setTasks(tasks().filter((_,i)=>i!=e.target.dataset.idx));
};
<\/script>
</body>
</html>`
        }
    }
];

function loadExample(example) {
    const newFiles = { ...files() };
    Object.entries(example.files).forEach(([path, content]) => {
        newFiles[path] = content;
    });
    setFiles(newFiles);
    setOpenTabs(Object.keys(example.files));
    setActiveFile(Object.keys(example.files)[0]);
    updateEditorContent();
    renderFileTree();
    renderTabs();
    runPreview();
    addConsoleLog('info', [`Loaded example: ${example.name}`]);
}

// ============================================
// Theme Management
// ============================================
function setThemeMode(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    setTheme(mode);
    if (editor) editor.setOption('theme', mode === 'dark' ? 'dracula' : 'default');
    localStorage.setItem('oja-playground-theme', mode);
}

function toggleTheme() {
    const newTheme = theme() === 'dark' ? 'light' : 'dark';
    setThemeMode(newTheme);
    const btn = document.getElementById('themeToggleBtn');
    btn.innerHTML = newTheme === 'dark' ? '<span>🌙</span>' : '<span>☀️</span>';
}

// ============================================
// Event Listeners
// ============================================
window.addEventListener('message', (e) => {
    if (e.data?.type === 'console') {
        addConsoleLog(e.data.level, e.data.args);
    }
});

document.getElementById('runBtn').onclick = () => runPreview();
document.getElementById('clearConsoleBtn').onclick = () => clearConsole();
document.getElementById('pauseConsoleBtn').onclick = () => {
    setConsolePaused(!consolePaused());
    document.getElementById('pauseConsoleBtn').innerHTML = consolePaused() ? '▶' : '⏸';
};
document.getElementById('themeToggleBtn').onclick = toggleTheme;

// Filter chips
document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.onclick = () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        setConsoleFilter(chip.dataset.level);
        renderConsoleLogs();
    };
});

// New file dialog
const newDialog = document.getElementById('newFileDialog');
document.getElementById('newFileBtn').onclick = () => newDialog.classList.add('open');
document.getElementById('addFileSidebar').onclick = () => newDialog.classList.add('open');
document.getElementById('cancelDialog').onclick = () => newDialog.classList.remove('open');
document.getElementById('confirmDialog').onclick = () => {
    const name = document.getElementById('newFileName').value.trim();
    if (name) createFile(name);
    newDialog.classList.remove('open');
    document.getElementById('newFileName').value = '';
};

// Examples dialog
const examplesDialog = document.getElementById('examplesDialog');
document.getElementById('examplesBtn').onclick = () => {
    const container = document.getElementById('exampleList');
    container.innerHTML = EXAMPLES.map(ex => `
    <div class="example-card" data-example="${ex.name}">
      <div class="example-name">${ex.name}</div>
      <div class="example-desc">${ex.desc}</div>
    </div>
  `).join('');

    container.querySelectorAll('.example-card').forEach(card => {
        card.onclick = () => {
            const example = EXAMPLES.find(e => e.name === card.dataset.example);
            if (example) loadExample(example);
            examplesDialog.classList.remove('open');
        };
    });
    examplesDialog.classList.add('open');
};
document.getElementById('closeExamples').onclick = () => examplesDialog.classList.remove('open');

// Close dialogs on overlay click
document.querySelectorAll('.dialog-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('open');
    });
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runPreview();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        document.getElementById('newFileDialog').classList.add('open');
    }
});

// ============================================
// Helper Functions
// ============================================
function escapeHtml(str) {
    return String(str).replace(/[&<>]/g, m => {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ============================================
// Initialize
// ============================================
function init() {
    const savedTheme = localStorage.getItem('oja-playground-theme') || 'dark';
    setThemeMode(savedTheme);
    document.getElementById('themeToggleBtn').innerHTML = savedTheme === 'dark' ? '<span>🌙</span>' : '<span>☀️</span>';

    initEditor();
    renderFileTree();
    renderTabs();
    runPreview();

    addConsoleLog('info', ['Welcome to Oja Playground! Press Ctrl+Enter to run, Ctrl+N for new file']);
}

init();