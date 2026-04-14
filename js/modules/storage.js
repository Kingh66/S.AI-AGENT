/* ═══════════════════════════════════════
   STORAGE — LocalStorage save/load
   Auto-repairs broken endpoints on load
   ═══════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { SYSTEM_PROMPTS, PROVIDER_DEFAULTS, MULTI_AGENT_CONFIG } from './config.js';
import { toast } from './ui.js';

/* ── Settings version — bump to force-clear all saved settings ── */
var SETTINGS_VERSION = 4;

var BAD_ENDPOINTS = [
    'http://localhost:8000/v1',
    'http://localhost:8080/v1',
    ''
];

var DEAD_MODELS = {
    'qwen/qwen-3.6-plus': 'xiaomi/mimo-v2-pro',
    'openrouter/hunter-alpha': 'xiaomi/mimo-v2-pro'
};

/* ═══════════════════════════════════════
   NUCLEAR SAFEGUARD — runs BEFORE loadSettings
   If the known-corrupted 68539 value exists in
   raw localStorage, nuke it immediately.
   This survives browser caching of old JS files. ═══════════════════════════════════════ */
try {
    var _rawSettings = localStorage.getItem('sai_settings');
    if (_rawSettings && _rawSettings.indexOf('68539') > -1) {
        console.warn('[Storage] Detected corrupted maxTokens=68539 in localStorage. Nuking saved settings.');
        localStorage.removeItem('sai_settings');
        _rawSettings = null;
    }
} catch (_nukeErr) {}

function repairEndpoint() {
    var ep = state.settings.endpoint;
    var provider = state.settings.provider;
    var defaults = PROVIDER_DEFAULTS[provider];
    var needsFix = false;
    if (!ep) needsFix = true;
    else {
        for (var i = 0; i < BAD_ENDPOINTS.length; i++) {
            if (ep === BAD_ENDPOINTS[i]) { needsFix = true; break; }
        }
        if (ep.indexOf('/v1/v1') > -1) needsFix = true;
    }
    if (needsFix && defaults) {
        state.settings.endpoint = defaults.endpoint;
        return true;
    }
    return false;
}

function repairDeadModels() {
    var repaired = false;
    var models = state.settings.agentModels;
    if (!models) return false;

    for (var key in DEAD_MODELS) {
        if (models[key] === key) {
            models[key] = DEAD_MODELS[key];
            repaired = true;
        }
    }
    if (models.coderFallback && DEAD_MODELS[models.coderFallback]) {
        models.coderFallback = DEAD_MODELS[models.coderFallback];
        repaired = true;
    }
    if (models.criticFallback && DEAD_MODELS[models.criticFallback]) {
        models.criticFallback = DEAD_MODELS[models.criticFallback];
        repaired = true;
    }

    return repaired;
}

export function resetAllSettings() {
    localStorage.removeItem('sai_settings');
    localStorage.removeItem('sai_context');
    localStorage.removeItem('sai_mode');
    localStorage.removeItem('sai_voice_lang');
    localStorage.removeItem('sai_voice_rate');
    localStorage.removeItem('sai_multiagent');

    state.settings.provider = 'openrouter';
    state.settings.endpoint = PROVIDER_DEFAULTS.openrouter.endpoint;
    state.settings.apiKey = '';
    state.settings.model = '';
    state.settings.temperature = 0.7;
    state.settings.maxTokens = 2048;
    state.settings.contextBudget = 60000;
    state.settings.systemPrompt = SYSTEM_PROMPTS[state.currentMode];
    state.settings._version = SETTINGS_VERSION;

    state.settings.multiAgentEnabled = false;
    state.settings.agentModels = Object.assign({}, MULTI_AGENT_CONFIG.agentModels);
    state.settings.maxCoderAttempts = MULTI_AGENT_CONFIG.maxCoderAttempts;
    state.settings.maxCriticRejections = MULTI_AGENT_CONFIG.maxCriticRejections;

    document.getElementById('project-context').value = '';
    toast('All settings reset to defaults', 'success');
}

export function saveSettings() {
    /* Clamp before saving */
    var mt = state.settings.maxTokens;
    if (typeof mt !== 'number' || mt < 256) mt = 2048;
    else if (mt > 32768) mt = 32768;

    var cb = state.settings.contextBudget;
    if (typeof cb !== 'number' || cb < 5000) cb = 60000;
    else if (cb > 500000) cb = 500000;

    var toSave = {
        _version: SETTINGS_VERSION,
        provider: state.settings.provider,
        endpoint: state.settings.endpoint,
        apiKey: state.settings.apiKey,
        model: state.settings.model,
        temperature: state.settings.temperature,
        maxTokens: mt,
        contextBudget: cb,
        systemPrompt: state.settings.systemPrompt
    };
    localStorage.setItem('sai_settings', JSON.stringify(toSave));
    localStorage.setItem('sai_context', document.getElementById('project-context').value);
    localStorage.setItem('sai_mode', state.currentMode);
    localStorage.setItem('sai_voice_lang', voiceState.lang);
    localStorage.setItem('sai_voice_rate', voiceState.rate.toString());

    var maToSave = {
        multiAgentEnabled: state.settings.multiAgentEnabled || false,
        agentModels: state.settings.agentModels || {},
        maxCoderAttempts: state.settings.maxCoderAttempts,
        maxCriticRejections: state.settings.maxCriticRejections
    };
    localStorage.setItem('sai_multiagent', JSON.stringify(maToSave));
}

export function loadSettings() {
    var repaired = false;

    /* ── VERSION CHECK: If settings are from old version, nuke them ── */
    try {
        var savedRaw = localStorage.getItem('sai_settings');
        if (savedRaw) {
            var quickCheck = JSON.parse(savedRaw);
            if (quickCheck._version !== SETTINGS_VERSION) {
                console.warn('[Storage] Settings version mismatch (got ' + quickCheck._version + ', need ' + SETTINGS_VERSION + '). Resetting.');
                /* Preserve API key and model across version resets */
                var keepKey = quickCheck.apiKey || '';
                var keepModel = quickCheck.model || '';
                localStorage.removeItem('sai_settings');
                state.settings.provider = 'openrouter';
                state.settings.endpoint = PROVIDER_DEFAULTS.openrouter.endpoint;
                state.settings.apiKey = keepKey;
                state.settings.model = keepModel;
                state.settings.temperature = 0.7;
                state.settings.maxTokens = 2048;
                state.settings.contextBudget = 60000;
                state.settings.systemPrompt = SYSTEM_PROMPTS[state.currentMode];
                state.settings._version = SETTINGS_VERSION;
                repaired = true;
                toast('Settings updated to v' + SETTINGS_VERSION + ' (maxTokens lowered to 2048 for free tier safety)', 'info');
                /* Skip normal load — we just reset everything */
                savedRaw = null;
            }
        }
    } catch (e) {
        localStorage.removeItem('sai_settings');
    }

    /* Normal load (only if version check didn't nuke it) */
    if (!repaired) {
        try {
            var saved = localStorage.getItem('sai_settings');
            if (saved) {
                var parsed = JSON.parse(saved);
                Object.assign(state.settings, parsed);
            }
        } catch (e) {
            localStorage.removeItem('sai_settings');
        }
    }

    /* ── SANITY CLAMP: maxTokens ── */
    if (typeof state.settings.maxTokens !== 'number' || state.settings.maxTokens < 256) {
        state.settings.maxTokens = 2048;
        repaired = true;
    } else if (state.settings.maxTokens > 32768) {
        console.warn('[Storage] Clamped maxTokens from ' + state.settings.maxTokens + ' to 32768');
        state.settings.maxTokens = 32768;
        repaired = true;
    }

    /* ── SANITY CLAMP: contextBudget ── */
    if (typeof state.settings.contextBudget !== 'number' || state.settings.contextBudget < 5000) {
        state.settings.contextBudget = 60000;
        repaired = true;
    } else if (state.settings.contextBudget > 500000) {
        state.settings.contextBudget = 500000;
        repaired = true;
    }

    /* Ensure version is set */
    state.settings._version = SETTINGS_VERSION;

    try {
        var maSaved = localStorage.getItem('sai_multiagent');
        if (maSaved) {
            var maParsed = JSON.parse(maSaved);
            state.settings.multiAgentEnabled = maParsed.multiAgentEnabled || false;
            state.settings.agentModels = Object.assign({}, MULTI_AGENT_CONFIG.agentModels, maParsed.agentModels || {});
            state.settings.maxCoderAttempts = maParsed.maxCoderAttempts || MULTI_AGENT_CONFIG.maxCoderAttempts;
            state.settings.maxCriticRejections = maParsed.maxCriticRejections || MULTI_AGENT_CONFIG.maxCriticRejections;

            if (repairDeadModels()) {
                repaired = true;
                toast('Auto-repaired removed models in multi-agent settings', 'info');
            }
        } else {
            state.settings.multiAgentEnabled = false;
            state.settings.agentModels = Object.assign({}, MULTI_AGENT_CONFIG.agentModels);
            state.settings.maxCoderAttempts = MULTI_AGENT_CONFIG.maxCoderAttempts;
            state.settings.maxCriticRejections = MULTI_AGENT_CONFIG.maxCriticRejections;
        }
    } catch (e) {
        console.warn('Failed to load multi-agent settings, using defaults:', e);
        state.settings.multiAgentEnabled = false;
        state.settings.agentModels = Object.assign({}, MULTI_AGENT_CONFIG.agentModels);
        state.settings.maxCoderAttempts = MULTI_AGENT_CONFIG.maxCoderAttempts;
        state.settings.maxCriticRejections = MULTI_AGENT_CONFIG.maxCriticRejections;
    }

    repaired = repairEndpoint() || repaired;

    var defaults = PROVIDER_DEFAULTS[state.settings.provider];
    if (defaults) {
        var allEndpoints = [];
        for (var key in PROVIDER_DEFAULTS) { allEndpoints.push(PROVIDER_DEFAULTS[key].endpoint); }
        if (allEndpoints.indexOf(state.settings.endpoint) === -1) {
            state.settings.endpoint = defaults.endpoint;
            repaired = true;
        }
    }

    if (state.settings.model) {
        var modelIsOk = false;
        if (state.settings.model.indexOf(':free') > -1) modelIsOk = true;
        if (state.settings.model.indexOf('/') > -1) modelIsOk = true;
        if (state.settings.model.indexOf('codellama') > -1) modelIsOk = true;
        if (state.settings.model.indexOf('llama') > -1) modelIsOk = true;
        if (state.settings.model.indexOf('gpt') > -1) modelIsOk = true;
        if (!modelIsOk) { state.settings.model = ''; repaired = true; }
    }

    if (state.settings.model && DEAD_MODELS[state.settings.model]) {
        state.settings.model = DEAD_MODELS[state.settings.model];
        repaired = true;
        toast('Main model was replaced (removed from OpenRouter)', 'info');
    }

    if (repaired) saveSettings();

    var context = localStorage.getItem('sai_context');
    if (context) document.getElementById('project-context').value = context;

    var mode = localStorage.getItem('sai_mode');
    if (mode && SYSTEM_PROMPTS[mode]) {
        import('./modes.js').then(function (m) { m.setMode(mode, true); });
    } else {
        if (!state.settings.systemPrompt) {
            state.settings.systemPrompt = SYSTEM_PROMPTS[state.currentMode];
        }
    }

    var voiceLang = localStorage.getItem('sai_voice_lang');
    if (voiceLang) {
        voiceState.lang = voiceLang;
        var langSelect = document.getElementById('q-voice-lang');
        if (langSelect) langSelect.value = voiceLang;
    }

    var voiceRate = localStorage.getItem('sai_voice_rate');
    if (voiceRate) {
        voiceState.rate = parseFloat(voiceRate);
        var rateInput = document.getElementById('q-voice-rate');
        var rateVal = document.getElementById('q-voice-rate-val');
        if (rateInput) rateInput.value = voiceState.rate;
        if (rateVal) rateVal.textContent = voiceState.rate.toFixed(1);
    }
}

export function saveFromSettingsUI() {
    state.settings.provider = document.getElementById('s-provider').value;
    state.settings.endpoint = document.getElementById('s-endpoint').value.replace(/\/+$/, '');
    state.settings.apiKey = document.getElementById('s-apikey').value.trim();
    state.settings.model = document.getElementById('s-model').value.trim();
    state.settings.temperature = parseFloat(document.getElementById('q-temp').value);
    state.settings.maxTokens = parseInt(document.getElementById('q-tokens').value) || 2048;
    state.settings.contextBudget = parseInt(document.getElementById('q-context-budget') ? document.getElementById('q-context-budget').value : 60000) || 60000;
    voiceState.lang = document.getElementById('q-voice-lang').value;
    voiceState.rate = parseFloat(document.getElementById('q-voice-rate').value);
    if (voiceState.recognition) voiceState.recognition.lang = voiceState.lang;
    repairEndpoint();
    saveSettings();
}