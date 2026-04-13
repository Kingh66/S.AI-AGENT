/* ═════════════════════════════════════════
   MESSAGES — Rendering, streaming, actions
   textContent streaming (zero char loss),
   safety net on empty buffer recovery
   ═══════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { parseMarkdown } from './markdown.js';
import { highlightCodeBlocks, getTimeStr } from './ui.js';

let backtickCount = 0;
let streamPre = null;
let streamTextNode = null;
let renderTimer = null;
const RENDER_THROTTLE = 25;
let lastRenderTime = 0;

/* Track whether we've received any real text this response */
let receivedAnyRealText = false;

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

    state.streamElement = div.querySelector('.msg-content');
    state.streamBuffer = '';
    state.isRenderScheduled = false;

    backtickCount = 0;
    streamPre = null;
    streamTextNode = null;
    lastRenderTime = 0;
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }

    /* Reset for each new response */
    receivedAnyRealText = false;

    fastScroll();
}

export function appendStreamChunk(chunk) {
    if (typeof chunk !== 'string') chunk = String(chunk);
    chunk = chunk.replace(/^[\u0000-\u001F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFFD]+/, '');
    if (chunk.length === 0) return;

    /* Mark that we received actual text this response */
    receivedAnyRealText = true;

    state.streamBuffer += chunk;

    for (let i = 0; i < chunk.length - 2; i++) {
        if (chunk[i] === '`' && chunk[i + 1] === '`' && chunk[i + 2] === '`') {
            backtickCount++;
            i += 2;
        }
    }
    var inCode = (backtickCount % 2 !== 0);

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
                if (!streamPre) {
                    streamPre = document.createElement('pre');
                    streamPre.className = 'streaming-code-pre';
                    state.streamElement.innerHTML = '';
                    state.streamElement.appendChild(streamPre);
                    streamTextNode = null;
                }
                streamPre.textContent = state.streamBuffer;
            } else {
                streamPre = null;
                if (!streamTextNode) {
                    streamTextNode = document.createElement('span');
                    state.streamElement.appendChild(streamTextNode);
                }
                streamTextNode.textContent = state.streamBuffer;
            }

            appendCursor(state.streamElement);
            fastScroll();
        }, delay);
    }
}

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

export function finalizeStream() {
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
    state.isRenderScheduled = false;

    backtickCount = 0;
    streamPre = null;
    streamTextNode = null;

    if (state.streamElement) {
        removeCursor(state.streamElement);
        state.streamElement.classList.remove('streaming-active');

        var clean = state.streamBuffer.replace(/^[\u0000-\u001F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\uFFFD]+/, '');

        /* ── SAFETY NET: Buffer empty but we received data ──
           Sometimes the model sends ALL text as reasoning_content and zero
           content. Or all chunks have parse errors. Result: empty buffer,
           nothing renders, user sees blank message.
           
           Recovery attempts in order:
           1. If thinking block exists in DOM, grab its text
           2. If streamTextNode exists in DOM (orphaned), grab its text
           3. Last resort: show a fallback message           */
        if (clean.length === 0 && receivedAnyRealText) {
            console.warn('[Messages] Buffer is empty but data was received. Attempting recovery...');

            /* Try thinking block */
            var thinkBlock = document.getElementById('sai-thinking-block');
            if (thinkBlock) {
                var thinkText = thinkBlock.querySelector('.thinking-text');
                if (thinkText) {
                    var recovered = thinkText.textContent || '';
                    if (recovered.length > 5) {
                        console.warn('[Messages] Recovered ' + recovered.length + ' chars from thinking block');
                        clean = recovered;
                    }
                }
            }

            /* Try orphaned streamTextNode (shouldn't happen but safety check) */
            if (clean.length === 0) {
                var orphan = document.querySelector('.streaming-code-pre, .streaming-code-block, .msg-content span');
                if (orphan) {
                    var recovered2 = orphan.textContent || '';
                    if (recovered2.length > 5) {
                        console.warn('[Messages] Recovered ' + recovered2.length + ' chars from orphan stream node');
                        clean = recovered2;
                    }
                }
            }

            /* Last resort: fallback message */
            if (clean.length === 0) {
                console.error('[Messages] COMPLETELY empty after receiving data. Model returned no text at all.');
                clean = '⚠️ The model returned an empty response. Try again or switch models.';
            }
        }

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