/* ═══════════════════════════════════════
   MESSAGES — Rendering, streaming, actions
   Ultra-fast native bypass + Lightweight streaming parser
   ═══════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { parseMarkdown } from './markdown.js';
import { highlightCodeBlocks, getTimeStr } from './ui.js';

/* ── Fast-stream state ── */
let backtickCount = 0;
let streamPre = null;
let renderTimer = null;
const RENDER_THROTTLE = 25;
let lastRenderTime = 0;

export function removeWelcome() {
    const w = document.getElementById('welcome-state');
    if (w) w.remove();
}

export function addUserMessage(text) {
    removeWelcome();
    const msgs = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message user';
    div.innerHTML =
        '<div class="msg-avatar"><i class="fas fa-user"></i></div>' +
        '<div class="msg-body">' +
        '<div class="msg-meta"><span class="msg-name">You</span><span class="msg-time">' + getTimeStr() + '</span></div>' +
        '<div class="msg-content"><p>' + escapeHtml(text).replace(/\n/g, '<br>') + '</p></div>' +
        '</div>';
    msgs.appendChild(div);
    fastScroll();
}

export function addBotMessageStart() {
    removeWelcome();
    const msgs = document.getElementById('messages');
    const div = document.createElement('div');
    div.className = 'message bot';
    div.id = 'streaming-msg';

    /* Build the COMPLETE structure in one innerHTML call —
       no create-then-replace-then-reappend pattern that can
       orphan the content element and corrupt its state. */
    div.innerHTML =
        '<div class="msg-avatar">S</div>' +
        '<div class="msg-body">' +
        '<div class="msg-meta">' +
        '<span class="msg-name">S.ai</span>' +
        '<span class="msg-time">' + getTimeStr() + '</span>' +
        '<button class="speak-btn" onclick="speakLastResponse()" title="Read aloud"><i class="fas fa-volume-high"></i> Speak</button>' +
        '</div>' +
        '<div class="msg-content streaming-active">' +
        '<div class="typing-indicator"><span></span><span></span><span></span></div>' +
        '</div>' +
        '</div>';

    msgs.appendChild(div);

    /* Grab the reference AFTER the DOM is built — guaranteed intact */
    state.streamElement = div.querySelector('.msg-content');
    state.streamBuffer = '';
    state.isRenderScheduled = false;

    /* Reset fast-stream state */
    backtickCount = 0;
    streamPre = null;
    lastRenderTime = 0;
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }

    fastScroll();
}

export function appendStreamChunk(chunk) {
    /* Defensive: ensure chunk is a string, strip any null/BOM bytes
       that some models sneak in as the first character */
    if (typeof chunk !== 'string') chunk = String(chunk);
    chunk = chunk.replace(/^\u0000+/, '').replace(/^\uFEFF/, '');

    state.streamBuffer += chunk;

    /* ⚡ Count triple-backticks in THIS chunk only — O(len(chunk)) not O(total) */
    for (let i = 0; i < chunk.length - 2; i++) {
        if (chunk[i] === '`' && chunk[i + 1] === '`' && chunk[i + 2] === '`') {
            backtickCount++;
            i += 2;
        }
    }
    var inCode = (backtickCount % 2 !== 0);

    /* Schedule a throttled render — batches rapid chunks */
    if (!state.isRenderScheduled) {
        state.isRenderScheduled = true;

        var now = performance.now();
        var delay = Math.max(0, RENDER_THROTTLE - (now - lastRenderTime));

        renderTimer = setTimeout(function () {
            lastRenderTime = performance.now();
            state.isRenderScheduled = false;
            renderTimer = null;

            if (!state.streamElement) return;

            if (inCode) {
                /* ⚡ ULTRA-FAST PATH: Raw native text dump. Zero JS parsing. */
                if (!streamPre) {
                    streamPre = document.createElement('pre');
                    streamPre.className = 'streaming-code-pre';
                    state.streamElement.innerHTML = '';
                    state.streamElement.appendChild(streamPre);
                }
                streamPre.textContent = state.streamBuffer;
            } else {
                /* 🚀 FAST PATH: Lightweight streaming parser */
                streamPre = null;
                state.streamElement.innerHTML = parseMarkdownStreaming(state.streamBuffer);
            }

            /* Streaming cursor */
            appendCursor(state.streamElement);
            fastScroll();
        }, delay);
    }
}

/* ── Lightweight markdown parser for LIVE streaming ── */
function parseMarkdownStreaming(text) {
    var html = escapeHtml(text);
    html = html.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^---+$/gm, '<hr>');
    html = html.replace(/\n/g, '<br>');
    return html;
}

/* ── Streaming cursor ── */
function appendCursor(container) {
    var cursor = container.querySelector('.streaming-cursor');
    if (!cursor) {
        cursor = document.createElement('span');
        cursor.className = 'streaming-cursor';
        container.appendChild(cursor);
    }
}

function removeCursor(container) {
    var cursor = container.querySelector('.streaming-cursor');
    if (cursor) cursor.remove();
}

/* ── Finalize: full parse + syntax highlight ── */
export function finalizeStream() {
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    state.isRenderScheduled = false;

    backtickCount = 0;
    streamPre = null;

    if (state.streamElement) {
        removeCursor(state.streamElement);
        state.streamElement.classList.remove('streaming-active');

        /* Strip any leading garbage before the final parse */
        var clean = state.streamBuffer.replace(/^\u0000+/, '').replace(/^\uFEFF/, '');
        state.streamElement.innerHTML = parseMarkdown(clean);
        highlightCodeBlocks(state.streamElement);
        state.conversationHistory.push({ role: 'assistant', content: clean });

        if (voiceState.isVoiceChat) {
            import('./voice.js').then(function (m) {
                m.stopListening();
                voiceState.mode = 'speaking';
                m.setVoiceMode('speaking');
                m.speakText(clean, function () {
                    if (voiceState.isVoiceChat && !state.isStreaming) {
                        setTimeout(function () { m.startListening(); }, 1500);
                    }
                });
            });
        }

        state.streamBuffer = '';
        state.streamElement = null;
        fastScroll();
    }

    if (!state.activeTask.isRunning) {
        state.isStreaming = false;
        updateSendButton();
    }
}

function fastScroll() {
    var msgs = document.getElementById('messages');
    msgs.scrollTop = msgs.scrollHeight;
}

export function updateSendButton() {
    var btn = document.getElementById('send-btn');
    if (state.isStreaming) {
        btn.classList.add('stop');
        btn.innerHTML = '<i class="fas fa-stop"></i>';
        if (state.activeTask.loopCount > 0) {
            btn.title = 'Stop task (loop ' + state.activeTask.loopCount + '/' + state.activeTask.maxLoops + ')';
        } else {
            btn.title = 'Stop generating';
        }
    } else {
        btn.classList.remove('stop');
        btn.innerHTML = '<i class="fas fa-arrow-up"></i>';
        btn.title = 'Send message';
    }
}

export function copyCode(btn) {
    var code = btn.closest('.code-block').querySelector('code').textContent;
    navigator.clipboard.writeText(code).then(function () {
        btn.innerHTML = '<i class="fas fa-check"></i> Copied';
        setTimeout(function () { btn.innerHTML = '<i class="fas fa-copy"></i> Copy'; }, 2000);
    });
}

export function useAsInput(btn) {
    var code = btn.closest('.code-block').querySelector('code').textContent;
    var input = document.getElementById('msg-input');
    input.value = code;
    import('./ui.js').then(function (m) { m.autoResize(input); });
    input.focus();
    import('./ui.js').then(function (m) { m.toast('Code loaded into input', 'success'); });
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}