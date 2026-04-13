/* ═══════════════════════════════════════
   FILESYSTEM — Read/write local folders
   Uses the File System Access API (Chrome/Edge)
   Dynamic context budgeting per model
   ═══════════════════════════════════════ */
import { state } from './state.js';
import { toast } from './ui.js';

let dirHandle = null;
let fileMap = new Map();
let folderName = '';


/* ── Connect to a local folder ── */
export async function connectFolder() {
    if (!('showDirectoryPicker' in window)) {
        toast('File access requires Chrome or Edge browser.', 'error');
        return;
    }
    try {
        dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        folderName = dirHandle.name;
        fileMap.clear();
        await scanDirectory(dirHandle, '');
        renderFolderUI();
        updateContextIndicator();
        toast('Connected: ' + folderName + ' (' + fileMap.size + ' files)', 'success');
    } catch (e) {
        if (e.name !== 'AbortError') toast('Folder error: ' + e.message, 'error');
    }
}

/* ── Recursively scan directory ── */
async function scanDirectory(handle, prefix) {
    for await (const entry of handle.values()) {
        const path = prefix ? prefix + '/' + entry.name : entry.name;

        if (entry.kind === 'directory') {
            const skip = ['.', 'node_modules', '.git', '__pycache__', 'dist', 'build', '.next', 'vendor', '.venv', 'venv', '.idea', '.vscode', '.DS_Store'];
            if (entry.name.startsWith('.') || skip.includes(entry.name)) continue;
            await scanDirectory(entry, path);
            continue;
        }

        const ext = entry.name.split('.').pop().toLowerCase();
        const binaryExts = ['png','jpg','jpeg','gif','svg','ico','woff','woff2','ttf','eot','mp3','mp4','zip','gz','tar','exe','dll','bin','pyc','wasm','webp','avif'];
        try {
            const file = await entry.getFile();
            if (binaryExts.includes(ext) || file.size > 800000) {
                fileMap.set(path, { handle: entry, content: null, size: file.size, modified: false });
            } else {
                const text = await file.text();
                fileMap.set(path, { handle: entry, content: text, size: file.size, modified: false });
            }
        } catch (e) {
            fileMap.set(path, { handle: entry, content: null, size: 0, modified: false });
        }
    }
}

/* ── Read a single file ── */
export async function readFile(path) {
    const info = fileMap.get(path);
    if (!info) { toast('Not found: ' + path, 'error'); return null; }
    if (info.content !== null) return info.content;
    try {
        const file = await info.handle.getFile();
        info.content = await file.text();
        return info.content;
    } catch (e) {
        toast('Cannot read ' + path, 'error');
        return null;
    }
}

/* ── Write/create a file ── */
export async function writeFile(path, content) {
    let handle;
    const existing = fileMap.get(path);
    if (existing) {
        handle = existing.handle;
    } else {
        const parts = path.split('/');
        const fileName = parts.pop();
        let currentDir = dirHandle;
        for (const dirName of parts) {
            currentDir = await currentDir.getDirectoryHandle(dirName, { create: true });
        }
        handle = await currentDir.getFileHandle(fileName, { create: true });
    }
    try {
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        fileMap.set(path, { handle, content, size: content.length, modified: true });
        renderFolderUI();
        updateContextIndicator();
        toast('Saved: ' + path, 'success');
        return true;
    } catch (e) {
        toast('Write failed: ' + path + ' — ' + e.message, 'error');
        return false;
    }
}

/* ── Get max context chars — USER BUDGET IS THE HARD CAP ──
   This prevents sending more context than the user's credits can handle.
   The model's theoretical context window is irrelevant if you can't pay for it. ── */
function getMaxContextChars() {
    /* 1. User's explicit budget setting — this is the LAW */
    var userBudget = state.settings.contextBudget || 60000;

    /* 2. Model's theoretical limit (from API data or conservative estimates) */
    var modelLimit = 120000;
    var modelId = state.settings.model;

    if (modelId && state.settings.provider === 'openrouter') {
        var baseModel = modelId.replace(':free', '');

        if (state.modelContextLimits[modelId]) {
            modelLimit = state.modelContextLimits[modelId];
        } else if (baseModel.indexOf('step-3.5') > -1 || baseModel.indexOf('mimo-v2') > -1 || baseModel.indexOf('minimax-m2') > -1) {
            modelLimit = 450000;
        } else if (baseModel.indexOf('glm-5') > -1 || baseModel.indexOf('nemotron') > -1) {
            modelLimit = 450000;
        } else if (baseModel.indexOf('claude') > -1) {
            modelLimit = 700000;
        } else if (modelId.indexOf(':free') > -1) {
            modelLimit = 450000;
        }
    }

    /* 3. The user's budget ALWAYS wins — you can't use what you can't pay for */
    return Math.min(modelLimit, userBudget);
}

/* ── Build context string — dynamically sized ── */
export function getFileContext() {
    if (!dirHandle) return '';

    var maxChars = getMaxContextChars();

    var sysSize = (state.settings.systemPrompt || '').length;
    var historySize = 0;
    for (var h = 0; h < state.conversationHistory.length; h++) {
        historySize += (state.conversationHistory[h].content || '').length;
    }

    /* Warn if conversation history is eating into the file budget */
    var overhead = sysSize + historySize + 2000;
    if (overhead > maxChars * 0.7) {
        var estTokens = Math.round(overhead / 3.5);
        toast('Chat history is large (~' + estTokens + ' tokens). File context will be minimal. Start a new chat for full folder review.', 'info');
    }

    var budget = Math.max(4000, maxChars - overhead);

    var tree = getTree();
    var readableFiles = tree.filter(function(f) { return f.hasContent; });

    var ctx = '--- WORKSPACE: ' + folderName + ' ---\n';
    ctx += 'Context budget: ' + fmtSize(budget) + ' of ' + fmtSize(maxChars) + ' total\n';
    ctx += 'System prompt: ' + fmtSize(sysSize) + ' | History: ' + fmtSize(historySize) + '\n';
    ctx += 'Readable files: ' + readableFiles.length + ' of ' + tree.length + '\n\n';
    ctx += 'File tree:\n';

    for (var i = 0; i < tree.length; i++) {
        var item = tree[i];
        var mod = item.modified ? ' [MODIFIED]' : '';
        var sz = item.size > 0 ? ' (' + fmtSize(item.size) + ')' : '';
        var nr = item.hasContent ? '' : ' [BINARY]';
        ctx += repeat('  ', item.depth) + item.name + mod + sz + nr + '\n';
    }

    var used = ctx.length;
    var truncated = 0;

    for (var j = 0; j < readableFiles.length; j++) {
        var item = readableFiles[j];
        var content = fileMap.get(item.path).content;
        var blockOverhead = item.path.length + 40;
        if (used + content.length + blockOverhead > budget) {
            truncated = readableFiles.length - j;
            ctx += '\n\n--- TRUNCATED: ' + truncated + ' files omitted to fit ' + fmtSize(budget) + ' budget ---\n';
            ctx += 'Omitted:\n' + readableFiles.slice(j).map(function(f) { return f.path; }).join('\n');
            break;
        }
        ctx += '\n--- FILE: ' + item.path + ' ---\n' + content + '\n--- END FILE ---\n';
        used += content.length + blockOverhead;
    }

    if (truncated > 0) {
        toast('Context filled — ' + (readableFiles.length - truncated) + '/' + readableFiles.length + ' files included. Increase Context Budget in Settings if you have credits.', 'info');
    }

    return ctx;
}

/* ── Get stats for the UI indicator ── */
export function getContextStats() {
    if (!dirHandle) return null;
    var tree = getTree();
    var readable = tree.filter(function(f) { return f.hasContent; });
    var totalChars = readable.reduce(function(sum, f) { return sum + (fileMap.get(f.path).content?.length || 0); }, 0);
    var modified = tree.filter(function(f) { return f.modified; }).length;

    var maxChars = getMaxContextChars();
    var sysSize = (state.settings.systemPrompt || '').length;
    var historySize = 0;
    for (var h = 0; h < state.conversationHistory.length; h++) {
        historySize += (state.conversationHistory[h].content || '').length;
    }
    var budget = Math.max(4000, maxChars - sysSize - historySize - 2000);
    var fits = totalChars <= budget;

    return { total: tree.length, readable: readable.length, chars: totalChars, budget: budget, fits: fits, modified: modified };
}

/* ── Get flat tree array ── */
export function getTree() {
    return [...fileMap.keys()].sort().map(function(path) {
        var parts = path.split('/');
        var name = parts.pop();
        var info = fileMap.get(path);
        return { path: path, name: name, depth: parts.length, hasContent: !!info.content, size: info.size, modified: info.modified };
    });
}

export function isConnected() { return !!dirHandle; }

export async function refreshFolder() {
    if (!dirHandle) return;
    fileMap.clear();
    await scanDirectory(dirHandle, '');
    renderFolderUI();
    updateContextIndicator();
    toast('Workspace refreshed', 'success');
}

/* ── Helpers ── */
function fmtSize(b) {
    if (b < 1024) return b + 'B';
    if (b < 1048576) return (b / 1024).toFixed(1) + 'KB';
    return (b / 1048576).toFixed(1) + 'MB';
}

function repeat(s, n) {
    var r = '';
    for (var i = 0; i < n; i++) r += s;
    return r;
}

function fileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    if (['js','mjs','cjs'].includes(ext)) return 'fab fa-js';
    if (['ts','tsx','jsx'].includes(ext)) return 'fas fa-code';
    if (ext === 'py') return 'fab fa-python';
    if (ext === 'java') return 'fab fa-java';
    if (['html','htm'].includes(ext)) return 'fab fa-html5';
    if (ext === 'css') return 'fab fa-css3-alt';
    if (ext === 'php') return 'fab fa-php';
    if (['json','yml','yaml','xml','toml'].includes(ext)) return 'fas fa-file-code';
    if (['md','txt'].includes(ext)) return 'fas fa-file-lines';
    if (['sh','bash'].includes(ext)) return 'fas fa-terminal';
    if (['png','jpg','jpeg','gif','svg','ico','webp'].includes(ext)) return 'fas fa-image';
    if (['sql','db'].includes(ext)) return 'fas fa-database';
    if (['rs','go','kt','dart','rb','c','cpp','h','cs'].includes(ext)) return 'fas fa-code';
    return 'fas fa-file';
}

/* ── Update the context indicator in sidebar ── */
function updateContextIndicator() {
    var el = document.getElementById('context-indicator');
    if (!el) return;
    if (!dirHandle) { el.style.display = 'none'; return; }
    var stats = getContextStats();
    if (!stats) { el.style.display = 'none'; return; }

    var sizeStr = fmtSize(stats.chars);
    var budgetStr = fmtSize(stats.budget);
    var color = stats.fits ? 'var(--accent)' : 'var(--red)';
    var icon = stats.fits ? 'fa-check-circle' : 'fa-exclamation-triangle';
    var modText = stats.modified > 0 ? ' &middot; <span style="color:var(--accent)">' + stats.modified + ' modified</span>' : '';

    el.innerHTML = '<i class="fas ' + icon + '" style="color:' + color + '"></i> ' +
        '<span style="color:var(--text-muted);font-size:0.65rem">' +
        stats.readable + ' files &middot; ' + sizeStr + ' / ' + budgetStr + modText + '</span>';
    el.style.display = 'block';
}

/* ── Render file tree in sidebar ── */
function renderFolderUI() {
    var status = document.getElementById('folder-status');
    var tree = document.getElementById('file-tree');
    var refreshBtn = document.getElementById('btn-refresh-folder');
    if (!dirHandle) {
        status.innerHTML = '<span style="color:var(--text-muted)">No folder connected</span>';
        tree.style.display = 'none';
        if (refreshBtn) refreshBtn.style.display = 'none';
        return;
    }
    status.innerHTML = '<span style="color:var(--accent)"><i class="fas fa-folder-open"></i> ' + folderName + '</span> <span style="color:var(--text-muted);font-size:0.65rem">(' + fileMap.size + ' files)</span>';
    tree.style.display = 'block';
    if (refreshBtn) refreshBtn.style.display = 'block';

    var items = getTree();
    tree.innerHTML = items.map(function(item) {
        var mod = item.modified ? ' modified' : '';
        var binary = !item.hasContent ? ' binary' : '';
        return '<div class="file-tree-item' + mod + binary + '" data-path="' + item.path + '" title="' + item.path + '">' +
            '<i class="' + fileIcon(item.name) + '"></i><span>' + item.name + '</span>' +
            '</div>';
    }).join('');

    tree.querySelectorAll('.file-tree-item').forEach(function(el) {
        if (el.classList.contains('binary')) {
            el.style.opacity = '0.35';
            el.style.cursor = 'default';
            return;
        }
        el.addEventListener('click', async function() {
            var path = el.dataset.path;
            var content = await readFile(path);
            if (content !== null) {
                var input = document.getElementById('msg-input');
                input.value = 'File: ' + path + '\n```\n' + content + '\n```\n\nReview this file.';
                input.style.height = 'auto';
                input.style.height = Math.min(input.scrollHeight, 160) + 'px';
                input.focus();
            }
        });
    });
}

/* ── Called from the Apply button in file code blocks ── */
export async function applyFileChange(btn) {
    var block = btn.closest('.file-block');
    var filePath = block.dataset.filePath;
    var code = block.querySelector('code').textContent;

    var originalInfo = fileMap.get(filePath);
    if (originalInfo && originalInfo.content !== null) {
        var originalLines = originalInfo.content.split('\n').length;
        var newLines = code.split('\n').length;

        if (originalLines > 20 && newLines < (originalLines * 0.3)) {
            toast('⛔ SAFETY BLOCK: Original file is ' + originalLines + ' lines, but AI output is only ' + newLines + ' lines. The AI omitted code. Apply cancelled to prevent data loss.', 'error');
            btn.innerHTML = '<i class="fas fa-ban"></i> Blocked (Incomplete)';
            btn.disabled = true;
            btn.style.color = 'var(--red)';
            return;
        }
    }

    var success = await writeFile(filePath, code);
    if (success) {
        btn.innerHTML = '<i class="fas fa-check-double"></i> Applied';
        btn.disabled = true;
        btn.style.color = 'var(--green)';
    }
}