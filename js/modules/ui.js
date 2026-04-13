/* ═══════════════════════════════════════
   UI — Toast, helpers, modals
   ═══════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { PROVIDER_DEFAULTS } from './config.js';

export function toast(message, type) {
    type = type || 'info';
    var container = document.getElementById('toast-container');
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
    el.className = 'conn-status ' + status;
    txt.textContent = text;
}

export function scrollToBottom() {
    var msgs = document.getElementById('messages');
    requestAnimationFrame(function() { msgs.scrollTop = msgs.scrollHeight; });
}

export function highlightCodeBlocks(container) {
    container.querySelectorAll('pre code').forEach(function(block) {
        if (!block.classList.contains('prism-highlighted')) {
            Prism.highlightElement(block);
            block.classList.add('prism-highlighted');
        }
    });
}

export function autoResize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
}

export function openModal(id) {
    document.getElementById(id).classList.add('active');
    if (id === 'settings-modal') populateSettingsUI();
    if (id === 'prompt-modal') {
        document.getElementById('s-prompt').value = state.settings.systemPrompt;
        document.querySelectorAll('.preset-chip').forEach(function(c) {
            c.classList.toggle('active', c.dataset.preset === state.currentMode);
        });
    }
}

export function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

export function bindQuickActions() {
    document.querySelectorAll('.quick-action[data-cmd]').forEach(function(btn) {
        btn.onclick = function() {
            import('./commands.js').then(function(m) { m.handleSlashCommand(btn.dataset.cmd); });
        };
    });
}

export function populateSettingsUI() {
    document.getElementById('s-provider').value = state.settings.provider;
    document.getElementById('s-endpoint').value = state.settings.endpoint;
    document.getElementById('s-apikey').value = state.settings.apiKey;
    document.getElementById('s-model').value = state.settings.model;
    document.getElementById('q-temp').value = state.settings.temperature;
    document.getElementById('q-temp-val').textContent = state.settings.temperature;
    document.getElementById('q-tokens').value = state.settings.maxTokens;
    document.getElementById('s-prompt').value = state.settings.systemPrompt;
    document.getElementById('q-voice-lang').value = voiceState.lang;
    document.getElementById('q-voice-rate').value = voiceState.rate;
    document.getElementById('q-voice-rate-val').textContent = voiceState.rate.toFixed(1);
    updateProviderHint();
}

export function updateProviderHint() {
    var provider = document.getElementById('s-provider').value;
    var defaults = PROVIDER_DEFAULTS[provider];
    document.getElementById('s-provider-hint').textContent = defaults.hint;
    document.getElementById('s-apikey').placeholder = defaults.keyPlaceholder;
    document.getElementById('s-key-hint').textContent = defaults.keyHint;
    var currentEndpoint = document.getElementById('s-endpoint').value;
    var allDefaults = Object.values(PROVIDER_DEFAULTS).map(function(d) { return d.endpoint; });
    if (!currentEndpoint || allDefaults.indexOf(currentEndpoint) === -1) {
        document.getElementById('s-endpoint').value = defaults.endpoint;
    }
}

/* ═══════════════════════════════════════
   MULTI-AGENT UI — Settings panel + visibility
   ═══════════════════════════════════════ */

export function renderMultiAgentSettings() {
    var container = document.getElementById('multiagent-settings');
    if (!container) return;

    var models = state.settings.agentModels || {};

    container.innerHTML =
        '<div class="setting-row">' +
        '<label class="setting-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
        '<input type="checkbox" id="ma-enabled" ' + (state.settings.multiAgentEnabled ? 'checked' : '') + '>' +
        'Enable Multi-Agent Mode' +
        '</label>' +
        '</div>' +

        '<div class="setting-row" style="margin-top:10px">' +
        '<label class="setting-label">Planner Model</label>' +
        '<select class="setting-select" id="ma-planner-model">' +
        '<option value="stepfun/step-3.5-flash"' + (models.planner === 'stepfun/step-3.5-flash' ? ' selected' : '') + '>Step 3.5 Flash (Recommended)</option>' +
        '<option value="xiaomi/mimo-v2-pro"' + (models.planner === 'xiaomi/mimo-v2-pro' ? ' selected' : '') + '>MiMo V2 Pro</option>' +
        '<option value="minimax/minimax-m2.7"' + (models.planner === 'minimax/minimax-m2.7' ? ' selected' : '') + '>Minimax M2.7</option>' +
        '<option value="z-ai/glm-5-turbo"' + (models.planner === 'z-ai/glm-5-turbo' ? ' selected' : '') + '>GLM 5 Turbo</option>' +
        '</select>' +
        '</div>' +

        '<div class="setting-row">' +
        '<label class="setting-label">Coder Primary</label>' +
        '<select class="setting-select" id="ma-coder-model">' +
        '<option value="xiaomi/mimo-v2-pro"' + (models.coder === 'xiaomi/mimo-v2-pro' ? ' selected' : '') + '>MiMo V2 Pro (Recommended)</option>' +
        '<option value="stepfun/step-3.5-flash"' + (models.coder === 'stepfun/step-3.5-flash' ? ' selected' : '') + '>Step 3.5 Flash</option>' +
        '<option value="minimax/minimax-m2.7"' + (models.coder === 'minimax/minimax-m2.7' ? ' selected' : '') + '>Minimax M2.7</option>' +
        '<option value="z-ai/glm-5-turbo"' + (models.coder === 'z-ai/glm-5-turbo' ? ' selected' : '') + '>GLM 5 Turbo</option>' +
        '</select>' +
        '</div>' +

        '<div class="setting-row">' +
        '<label class="setting-label">Coder Fallback</label>' +
        '<select class="setting-select" id="ma-coder-fallback-model">' +
        '<option value="stepfun/step-3.5-flash"' + (models.coderFallback === 'stepfun/step-3.5-flash' ? ' selected' : '') + '>Step 3.5 Flash</option>' +
        '<option value="minimax/minimax-m2.7"' + (models.coderFallback === 'minimax/minimax-m2.7' ? ' selected' : '') + '>Minimax M2.7</option>' +
        '<option value="z-ai/glm-5-turbo"' + (models.coderFallback === 'z-ai/glm-5-turbo' ? ' selected' : '') + '>GLM 5 Turbo</option>' +
        '<option value="xiaomi/mimo-v2-pro"' + (models.coderFallback === 'xiaomi/mimo-v2-pro' ? ' selected' : '') + '>MiMo V2 Pro</option>' +
        '</select>' +
        '</div>' +

        '<div class="setting-row">' +
        '<label class="setting-label">Critic Model</label>' +
        '<select class="setting-select" id="ma-critic-model">' +
        '<option value="minimax/minimax-m2.7"' + (models.critic === 'minimax/minimax-m2.7' ? ' selected' : '') + '>Minimax M2.7 (Recommended)</option>' +
        '<option value="stepfun/step-3.5-flash"' + (models.critic === 'stepfun/step-3.5-flash' ? ' selected' : '') + '>Step 3.5 Flash</option>' +
        '<option value="xiaomi/mimo-v2-pro"' + (models.critic === 'xiaomi/mimo-v2-pro' ? ' selected' : '') + '>MiMo V2 Pro</option>' +
        '<option value="z-ai/glm-5-turbo"' + (models.critic === 'z-ai/glm-5-turbo' ? ' selected' : '') + '>GLM 5 Turbo</option>' +
        '</select>' +
        '</div>' +

        '<div class="setting-row">' +
        '<label class="setting-label">Critic Fallback</label>' +
        '<select class="setting-select" id="ma-critic-fallback-model">' +
        '<option value="stepfun/step-3.5-flash"' + (models.criticFallback === 'stepfun/step-3.5-flash' ? ' selected' : '') + '>Step 3.5 Flash</option>' +
        '<option value="xiaomi/mimo-v2-pro"' + (models.criticFallback === 'xiaomi/mimo-v2-pro' ? ' selected' : '') + '>MiMo V2 Pro</option>' +
        '<option value="minimax/minimax-m2.7"' + (models.criticFallback === 'minimax/minimax-m2.7' ? ' selected' : '') + '>Minimax M2.7</option>' +
        '</select>' +
        '</div>' +

        '<div class="setting-row">' +
        '<label class="setting-label">Tester Model</label>' +
        '<select class="setting-select" id="ma-tester-model">' +
        '<option value="stepfun/step-3.5-flash"' + ((models.tester || 'stepfun/step-3.5-flash') === 'stepfun/step-3.5-flash' ? ' selected' : '') + '>Step 3.5 Flash (Recommended)</option>' +
        '<option value="xiaomi/mimo-v2-pro"' + (models.tester === 'xiaomi/mimo-v2-pro' ? ' selected' : '') + '>MiMo V2 Pro</option>' +
        '<option value="minimax/minimax-m2.7"' + (models.tester === 'minimax/minimax-m2.7' ? ' selected' : '') + '>Minimax M2.7</option>' +
        '</select>' +
        '</div>' +

        '<div class="setting-row">' +
        '<label class="setting-label">Max Coder Attempts</label>' +
        '<input type="number" class="setting-input" id="ma-max-attempts" value="' + (state.settings.maxCoderAttempts || 3) + '" min="1" max="5">' +
        '</div>' +

        '<div class="setting-row">' +
        '<label class="setting-label">Max Critic Rejections</label>' +
        '<input type="number" class="setting-input" id="ma-max-rejections" value="' + (state.settings.maxCriticRejections || 2) + '" min="1" max="3">' +
        '</div>';

    /* Bind all events */
    document.getElementById('ma-enabled').addEventListener('change', function(e) {
        state.settings.multiAgentEnabled = e.target.checked;
        import('./storage.js').then(function(s) { s.saveSettings(); });
    });

    document.getElementById('ma-planner-model').addEventListener('change', function(e) {
        if (!state.settings.agentModels) state.settings.agentModels = {};
        state.settings.agentModels.planner = e.target.value;
        import('./storage.js').then(function(s) { s.saveSettings(); });
    });

    document.getElementById('ma-coder-model').addEventListener('change', function(e) {
        if (!state.settings.agentModels) state.settings.agentModels = {};
        state.settings.agentModels.coder = e.target.value;
        import('./storage.js').then(function(s) { s.saveSettings(); });
    });

    document.getElementById('ma-coder-fallback-model').addEventListener('change', function(e) {
        if (!state.settings.agentModels) state.settings.agentModels = {};
        state.settings.agentModels.coderFallback = e.target.value;
        import('./storage.js').then(function(s) { s.saveSettings(); });
    });

    document.getElementById('ma-critic-model').addEventListener('change', function(e) {
        if (!state.settings.agentModels) state.settings.agentModels = {};
        state.settings.agentModels.critic = e.target.value;
        import('./storage.js').then(function(s) { s.saveSettings(); });
    });

    document.getElementById('ma-critic-fallback-model').addEventListener('change', function(e) {
        if (!state.settings.agentModels) state.settings.agentModels = {};
        state.settings.agentModels.criticFallback = e.target.value;
        import('./storage.js').then(function(s) { s.saveSettings(); });
    });

    document.getElementById('ma-tester-model').addEventListener('change', function(e) {
        if (!state.settings.agentModels) state.settings.agentModels = {};
        state.settings.agentModels.tester = e.target.value;
        import('./storage.js').then(function(s) { s.saveSettings(); });
    });

    document.getElementById('ma-max-attempts').addEventListener('change', function(e) {
        state.settings.maxCoderAttempts = parseInt(e.target.value) || 3;
        import('./storage.js').then(function(s) { s.saveSettings(); });
    });

    document.getElementById('ma-max-rejections').addEventListener('change', function(e) {
        state.settings.maxCriticRejections = parseInt(e.target.value) || 2;
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