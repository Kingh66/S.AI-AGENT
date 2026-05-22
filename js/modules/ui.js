/* ═══════════════════════════════════════
   UI — Toast, helpers, modals
   ═══════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { PROVIDER_DEFAULTS } from './config.js';

/* ── Safe text setter — never crashes on missing elements ── */
function safeText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
}

function safeVal(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value;
}

export function toast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toast-container');
    if (!container) return;
    var t = document.createElement('div');
    t.className = 'toast ' + type;
    var icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
    t.innerHTML = '<i class="fas ' + (icons[type] || icons.info) + '"></i><span>' + message + '</span>';
    container.appendChild(t);
    setTimeout(function() { t.classList.add('removing'); setTimeout(function() { t.remove(); }, 300); }, 3500);
}

export function getTimeStr() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function setConnectionStatus(status, text) {
    var el = document.getElementById('conn-status');
    var txt = document.getElementById('conn-text');
    if (el) el.className = 'conn-status ' + status;
    if (txt) txt.textContent = text;
}

export function scrollToBottom() {
    var msgs = document.getElementById('messages');
    if (msgs) requestAnimationFrame(function() { msgs.scrollTop = msgs.scrollHeight; });
}

export function highlightCodeBlocks(container) {
    if (!container) return;
    container.querySelectorAll('pre code').forEach(function(block) {
        if (!block.classList.contains('prism-highlighted')) {
            try {
                Prism.highlightElement(block);
            } catch (e) {
                console.warn('[Prism] highlightElement failed for ' + block.className + ':', e.message);
                block.className = block.className.replace(/language-[\w-]+/g, '');
            }
            block.classList.add('prism-highlighted');
        }
    });
}

export function autoResize(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
}

export function openModal(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.add('active');
    if (id === 'settings-modal') populateSettingsUI();
    if (id === 'prompt-modal') {
        safeVal('s-prompt', state.settings.systemPrompt);
        document.querySelectorAll('.preset-chip').forEach(function(c) {
            c.classList.toggle('active', c.dataset.preset === state.currentMode);
        });
    }
}

export function closeModal(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
}

export function bindQuickActions() {
    document.querySelectorAll('.quick-action[data-cmd]').forEach(function(btn) {
        btn.onclick = function() {
            import('./commands.js').then(function(m) { m.handleSlashCommand(btn.dataset.cmd); });
        };
    });
}

/* ═══════════════════════════════════════
   FORMAT HELPERS   ═══════════════════════════════════════ */
function fmtBudgetChars(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'K';
    return n.toString();
}

function fmtBudgetTokens(chars) {
    var tokens = Math.round(chars / 3.5);
    if (tokens >= 1000) return Math.round(tokens / 1000) + 'K tokens';
    return tokens + ' tokens';
}

/* ═══════════════════════════════════════   INJECT CONTEXT BUDGET UI
   ═══════════════════════════════════════ */
function injectContextBudgetUI() {
    if (document.getElementById('context-budget-row')) return;

    var tokensRow = document.getElementById('q-tokens');
    if (!tokensRow) return;
    var parentRow = tokensRow.closest('.setting-row');
    if (!parentRow) return;

    var wrapper = document.createElement('div');
    wrapper.className = 'setting-row';
    wrapper.id = 'context-budget-row';
    wrapper.innerHTML =
        '<label class="setting-label">' +
        'Context Budget' +
        '<span style="display:block;color:var(--text-muted);font-size:0.6rem;margin-top:1px">Max file context sent per request (input tokens)</span>' +
        '</label>' +
        '<div style="width:100%">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
        '<input type="range" id="q-context-budget" min="10000" max="500000" step="5000" value="25000" style="flex:1">' +
        '<span id="q-context-budget-val" style="min-width:90px;text-align:right;font-size:0.8rem;color:var(--accent);font-weight:600;white-space:nowrap">25K chars</span>' +
        '</div>' +
        '<div id="q-context-budget-tokens" style="font-size:0.6rem;color:var(--text-muted);margin-top:1px">~7K tokens</div>' +
        '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">' +
        '<button type="button" class="ctx-preset-btn" data-val="15000" style="padding:3px 10px;font-size:0.65rem;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;transition:all 0.15s">Ultra Safe</button>' +
        '<button type="button" class="ctx-preset-btn" data-val="25000" style="padding:3px 10px;font-size:0.65rem;border-radius:4px;border:1px solid var(--accent);background:rgba(0,212,170,0.1);color:var(--accent);cursor:pointer;transition:all 0.15s;font-weight:600">Free Safe</button>' +
        '<button type="button" class="ctx-preset-btn" data-val="60000" style="padding:3px 10px;font-size:0.65rem;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;transition:all 0.15s">Standard</button>' +
        '<button type="button" class="ctx-preset-btn" data-val="120000" style="padding:3px 10px;font-size:0.65rem;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;transition:all 0.15s">Large Folder</button>' +
        '<button type="button" class="ctx-preset-btn" data-val="500000" style="padding:3px 10px;font-size:0.65rem;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;transition:all 0.15s">Maximum</button>' +
        '</div>' +
        '<div style="font-size:0.58rem;color:var(--text-muted);margin-top:4px;line-height:1.4">' +
        'Free tier: ~20-30K input tokens. "Free Safe" preset (25K chars ≈ 7K tokens) leaves room for system prompt + history. Increase only if using Ollama or paid credits.' +
        '</div>' +
        '</div>';

    parentRow.parentNode.insertBefore(wrapper, parentRow.nextSibling);

    var slider = document.getElementById('q-context-budget');
    var valEl = document.getElementById('q-context-budget-val');
    var tokEl = document.getElementById('q-context-budget-tokens');

    slider.addEventListener('input', function() {
        var v = parseInt(this.value);
        if (valEl) valEl.textContent = fmtBudgetChars(v) + ' chars';
        if (tokEl) tokEl.textContent = '~' + fmtBudgetTokens(v);
        highlightActivePreset(v);
    });

    wrapper.querySelectorAll('.ctx-preset-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var v = parseInt(this.dataset.val);
            if (slider) slider.value = v;
            if (valEl) valEl.textContent = fmtBudgetChars(v) + ' chars';
            if (tokEl) tokEl.textContent = '~' + fmtBudgetTokens(v);
            highlightActivePreset(v);
        });
    });
}

function highlightActivePreset(val) {
    document.querySelectorAll('.ctx-preset-btn').forEach(function(btn) {
        var bv = parseInt(btn.dataset.val);
        if (bv === val) {
            btn.style.borderColor = 'var(--accent)';
            btn.style.background = 'rgba(0,212,170,0.1)';
            btn.style.color = 'var(--accent)';
            btn.style.fontWeight = '600';
        } else {
            btn.style.borderColor = 'var(--border)';
            btn.style.background = 'transparent';
            btn.style.color = 'var(--text-muted)';
            btn.style.fontWeight = '400';
        }
    });
}

/* ═══════════════════════════════════════
   INJECT MAX TOKENS PRESETS
   ═══════════════════════════════════════ */
function injectMaxTokensPresets() {
    if (document.getElementById('max-tokens-presets')) return;

    var tokensRow = document.getElementById('q-tokens');
    if (!tokensRow) return;
    var parentRow = tokensRow.closest('.setting-row');
    if (!parentRow || parentRow.querySelector('.max-tokens-presets')) return;

    tokensRow.max = '32768';
    tokensRow.step = '512';

    var presetWrap = document.createElement('div');
    presetWrap.className = 'max-tokens-presets';
    presetWrap.id = 'max-tokens-presets';
    presetWrap.style.cssText = 'display:flex;gap:6px;margin-top:6px;flex-wrap:wrap';
    presetWrap.innerHTML =
        '<button type="button" class="mtk-preset-btn" data-val="2048" style="padding:3px 10px;font-size:0.65rem;border-radius:4px;border:1px solid var(--accent);background:rgba(0,212,170,0.1);color:var(--accent);cursor:pointer;transition:all 0.15s;font-weight:600">2K</button>' +
        '<button type="button" class="mtk-preset-btn" data-val="4096" style="padding:3px 10px;font-size:0.65rem;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;transition:all 0.15s">4K</button>' +
        '<button type="button" class="mtk-preset-btn" data-val="8192" style="padding:3px 10px;font-size:0.65rem;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;transition:all 0.15s">8K</button>' +
        '<button type="button" class="mtk-preset-btn" data-val="16384" style="padding:3px 10px;font-size:0.65rem;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;transition:all 0.15s">16K</button>' +
        '<button type="button" class="mtk-preset-btn" data-val="32768" style="padding:3px 10px;font-size:0.65rem;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--text-muted);cursor:pointer;transition:all 0.15s">32K</button>';

    parentRow.appendChild(presetWrap);

    presetWrap.querySelectorAll('.mtk-preset-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var v = parseInt(this.dataset.val);
            tokensRow.value = v;
            highlightMtkPreset(v);
        });
    });

    tokensRow.addEventListener('input', function() {
        highlightMtkPreset(parseInt(this.value));
    });
}

function highlightMtkPreset(val) {
    document.querySelectorAll('.mtk-preset-btn').forEach(function(btn) {
        var bv = parseInt(btn.dataset.val);
        if (bv === val) {
            btn.style.borderColor = 'var(--accent)';
            btn.style.background = 'rgba(0,212,170,0.1)';
            btn.style.color = 'var(--accent)';
            btn.style.fontWeight = '600';
        } else {
            btn.style.borderColor = 'var(--border)';
            btn.style.background = 'transparent';
            btn.style.color = 'var(--text-muted)';
            btn.style.fontWeight = '400';
        }
    });
}

/* ═══════════════════════════════════════
   POPULATE SETTINGS
   ═══════════════════════════════════════ */
export function populateSettingsUI() {
    injectContextBudgetUI();
    injectMaxTokensPresets();

    safeVal('s-provider', state.settings.provider);
    safeVal('s-endpoint', state.settings.endpoint);
    safeVal('s-apikey', state.settings.apiKey);
    safeVal('s-model', state.settings.model);
    safeVal('q-temp', state.settings.temperature);
    safeText('q-temp-val', state.settings.temperature);
    safeVal('q-tokens', state.settings.maxTokens);
    safeVal('s-prompt', state.settings.systemPrompt);
    safeVal('q-voice-lang', voiceState.lang);
    safeVal('q-voice-rate', voiceState.rate);
    safeText('q-voice-rate-val', voiceState.rate.toFixed(1));

    /* Context budget slider — default 25K for free tier safety */
    var ctxSlider = document.getElementById('q-context-budget');
    if (ctxSlider) {
        var cb = state.settings.contextBudget || 25000;
        ctxSlider.value = cb;
        safeText('q-context-budget-val', fmtBudgetChars(cb) + ' chars');
        safeText('q-context-budget-tokens', '~' + fmtBudgetTokens(cb));
        highlightActivePreset(cb);
    }

    highlightMtkPreset(state.settings.maxTokens || 4096);

    updateProviderHint();
}

export function updateProviderHint() {
    var providerEl = document.getElementById('s-provider');
    if (!providerEl) return;
    var provider = providerEl.value;
    var defaults = PROVIDER_DEFAULTS[provider];
    if (!defaults) return;

    safeText('s-provider-hint', defaults.hint);

    var keyEl = document.getElementById('s-apikey');
    if (keyEl) keyEl.placeholder = defaults.keyPlaceholder;

    safeText('s-key-hint', defaults.keyHint);

    var currentEndpoint = document.getElementById('s-endpoint');
    if (!currentEndpoint) return;
    /* Always set endpoint to match the selected provider's default */
    currentEndpoint.value = defaults.endpoint;
}

/* ═══════════════════════════════════════
   MULTI-AGENT UI — Settings panel + visibility
   ═══════════════════════════════════════ */

/* ── Helper: ensure multiAgent sub-object exists ── */
function ensureMultiAgent() {
    if (!state.settings.multiAgent) {
        state.settings.multiAgent = {
            enabled: false,
            agentModels: {
                planner: '',
                coder: '',
                coderFallback: '',
                critic: '',
                criticFallback: '',
                tester: ''
            },
            maxCoderAttempts: 3,
            maxCriticRejections: 3
        };
    }
    /* ── Clear dead model IDs from old saves ──
       Old saves had xiaomi/mimo-v2-pro:free, minimax/minimax-m2.7:free etc.
       Empty string = auto-detect at runtime via multiagent.js */
    var DEAD_IDS = [
        'xiaomi/mimo-v2-pro:free',
        'minimax/minimax-m2.7:free',
        'nvidia/nemotron-3-super:free',
        'minimax/minimax-m2.5:free',
        'stepfun/step-3.5-flash:free',
        'z-ai/glm-5-turbo:free',
        'meta-llama/llama-3.1-70b-instruct:free'
    ];
    if (state.settings.multiAgent.agentModels) {
        for (var key in state.settings.multiAgent.agentModels) {
            var val = state.settings.multiAgent.agentModels[key];
            if (DEAD_IDS.indexOf(val) > -1) {
                state.settings.multiAgent.agentModels[key] = '';
            }
            /* Backward compat: auto-fix models missing :free suffix (if not empty) */
            if (val && val.indexOf('/') > -1 && val.indexOf(':free') === -1) {
                state.settings.multiAgent.agentModels[key] = val + ':free';
            }
        }
    }
    if (!state.settings.multiAgent.agentModels) {
        state.settings.multiAgent.agentModels = {};
    }
    return state.settings.multiAgent;
}

export function renderMultiAgentSettings() {
    var container = document.getElementById('multiagent-settings');
    if (!container) return;

    var ma = ensureMultiAgent();
    var models = ma.agentModels;

    /* ═══════════════════════════════════════════════════
       DYNAMIC MODEL LIST FOR MULTI-AGENT SETTINGS
       
       Instead of hardcoded dead model IDs, we now:
       1. Offer "Auto-detect" (empty string) as the
          default — multiagent.js picks at runtime
       2. If we have verifiedFreeModelIds from the
          OpenRouter fetch, use those as options
       3. Fallback to a few known-stable models
       ═══════════════════════════════════════════════════ */
    var availableModels = [];
    if (state.verifiedFreeModelIds && state.verifiedFreeModelIds.length > 0) {
        availableModels = state.verifiedFreeModelIds.slice();
    } else {
        try {
            var cached = localStorage.getItem('sai_verified_free_models');
            if (cached) availableModels = JSON.parse(cached);
        } catch (e) {}
    }
    if (availableModels.length === 0) {
        availableModels = [
            'qwen/qwen3-235b-a22b:free',
            'qwen/qwen3-coder:free',
            'deepseek/deepseek-chat-v3-0324:free',
            'meta-llama/llama-4-scout:free',
            'google/gemma-3-27b-it:free'
        ];
    }

    function modelOptions(selectedValue) {
        var html = '<option value=""' + (!selectedValue ? ' selected' : '') + '>🤖 Auto-detect (recommended)</option>';
        for (var i = 0; i < availableModels.length; i++) {
            var id = availableModels[i];
            var selected = id === selectedValue ? ' selected' : '';
            /* Shorten display name: remove :free suffix for readability */
            var displayName = id.replace(':free', '');
            html += '<option value="' + id + '"' + selected + '>' + displayName + '</option>';
        }
        return html;
    }

    container.innerHTML =
        '<div class="setting-row">' +
        '<label class="setting-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
        '<input type="checkbox" id="ma-enabled" ' + (ma.enabled ? 'checked' : '') + '>' +
        'Enable Multi-Agent Mode' +
        '</label>' +
        '</div>' +

        '<div style="font-size:0.68rem;color:var(--text-muted);margin:6px 0 10px;padding:6px 8px;background:var(--accent-dim);border:1px solid var(--border);border-radius:6px">' +
        '<i class="fas fa-info-circle" style="color:var(--accent);margin-right:4px"></i> ' +
        '"Auto-detect" lets the system pick the best available free model at runtime. Models are fetched live from OpenRouter.' +
        '</div>' +

        '<div class="setting-row">' +
        '<label class="setting-label">Planner Model</label>' +
        '<select class="setting-select" id="ma-planner-model">' + modelOptions(models.planner) + '</select>' +
        '</div>' +

        '<div class="setting-row">' +
        '<label class="setting-label">Coder Primary</label>' +
        '<select class="setting-select" id="ma-coder-model">' + modelOptions(models.coder) + '</select>' +
        '</div>' +

        '<div class="setting-row">' +
        '<label class="setting-label">Coder Fallback</label>' +
        '<select class="setting-select" id="ma-coder-fallback-model">' + modelOptions(models.coderFallback) + '</select>' +
        '</div>' +

        '<div class="setting-row">' +
        '<label class="setting-label">Critic Model</label>' +
        '<select class="setting-select" id="ma-critic-model">' + modelOptions(models.critic) + '</select>' +
        '</div>' +

        '<div class="setting-row">' +
        '<label class="setting-label">Critic Fallback</label>' +
        '<select class="setting-select" id="ma-critic-fallback-model">' + modelOptions(models.criticFallback) + '</select>' +
        '</div>' +

        '<div class="setting-row">' +
        '<label class="setting-label">Tester Model</label>' +
        '<select class="setting-select" id="ma-tester-model">' + modelOptions(models.tester) + '</select>' +
        '</div>' +

        '<div class="setting-row">' +
        '<label class="setting-label">Max Coder Attempts</label>' +
        '<input type="number" class="setting-input" id="ma-max-attempts" value="' + (ma.maxCoderAttempts || 3) + '" min="1" max="6">' +
        '</div>' +

        '<div class="setting-row">' +
        '<label class="setting-label">Max Critic Rejections</label>' +
        '<input type="number" class="setting-input" id="ma-max-rejections" value="' + (ma.maxCriticRejections || 3) + '" min="1" max="5">' +
        '</div>';

    /* ── Wire up event listeners ── */
    var selectIds = {
        'ma-planner-model': 'planner',
        'ma-coder-model': 'coder',
        'ma-coder-fallback-model': 'coderFallback',
        'ma-critic-model': 'critic',
        'ma-critic-fallback-model': 'criticFallback',
        'ma-tester-model': 'tester'
    };

    var maEnabled = document.getElementById('ma-enabled');
    if (maEnabled) maEnabled.addEventListener('change', function(e) {
        var ma2 = ensureMultiAgent();
        ma2.enabled = e.target.checked;
        import('./storage.js').then(function(s) { s.saveSettings(); });
    });

    for (var selectId in selectIds) {
        (function(id, key) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('change', function(e) {
                var ma2 = ensureMultiAgent();
                ma2.agentModels[key] = e.target.value;
                import('./storage.js').then(function(s) { s.saveSettings(); });
            });
        })(selectId, selectIds[selectId]);
    }

    var maAttempts = document.getElementById('ma-max-attempts');
    if (maAttempts) maAttempts.addEventListener('change', function(e) {
        var ma2 = ensureMultiAgent();
        ma2.maxCoderAttempts = parseInt(e.target.value) || 3;
        import('./storage.js').then(function(s) { s.saveSettings(); });
    });

    var maRejections = document.getElementById('ma-max-rejections');
    if (maRejections) maRejections.addEventListener('change', function(e) {
        var ma2 = ensureMultiAgent();
        ma2.maxCriticRejections = parseInt(e.target.value) || 3;
        import('./storage.js').then(function(s) { s.saveSettings(); });
    });
}

export function updateMultiAgentVisibility(show) {
    var container = document.getElementById('multiagent-settings-container');
    if (!container) return;
    if (show) {
        container.style.display = 'block';
        renderMultiAgentSettings();
    } else {
        container.style.display = 'none';
    }
}