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