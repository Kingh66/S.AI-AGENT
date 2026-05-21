/* ═══════════════════════════════════════
   STORAGE — LocalStorage save/load
   ═══════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { SYSTEM_PROMPTS, PROVIDER_DEFAULTS, MULTI_AGENT_CONFIG } from './config.js';
import { toast } from './ui.js';

var SETTINGS_VERSION = 6;

var BAD_ENDPOINTS = [
    'http://localhost:8000/v1',
    'http://localhost:8080/v1',
    ''
];

var DEAD_MODELS = {
    'qwen/qwen-3.6-plus': 'xiaomi/mimo-v2-pro:free',
    'openrouter/hunter-alpha': 'xiaomi/mimo-v2-pro:free'
};

/* ── Nuclear safeguard ── */
try {
    var _rawSettings = localStorage.getItem('sai_settings');
    if (_rawSettings && _rawSettings.indexOf('68539') > -1) {
        console.warn('[Storage] Detected corrupted maxTokens=68539. Nuking.');
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
    state.settings.maxTokens = 8192;
    state.settings.contextBudget = 25000;
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
    var mt = state.settings.maxTokens;
    if (typeof mt !== 'number' || mt < 32) mt = 2048;
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

    try {
        var savedRaw = localStorage.getItem('sai_settings');
        if (savedRaw) {
            var quickCheck = JSON.parse(savedRaw);
            if (quickCheck._version !== SETTINGS_VERSION) {
                console.warn('[Storage] Settings version mismatch. Resetting.');
                var keepKey = quickCheck.apiKey || '';
                var keepModel = quickCheck.model || '';
                localStorage.removeItem('sai_settings');
                state.settings.provider = 'openrouter';
                state.settings.endpoint = PROVIDER_DEFAULTS.openrouter.endpoint;
                state.settings.apiKey = keepKey;
                state.settings.model = keepModel;
                state.settings.temperature = 0.7;
                state.settings.maxTokens = 8192;
                state.settings.contextBudget = 25000;
                state.settings.systemPrompt = SYSTEM_PROMPTS[state.currentMode];
                state.settings._version = SETTINGS_VERSION;
                repaired = true;
                toast('Settings updated to v' + SETTINGS_VERSION, 'info');
                savedRaw = null;
            }
        }
    } catch (e) {
        localStorage.removeItem('sai_settings');
    }

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

    if (typeof state.settings.maxTokens !== 'number' || state.settings.maxTokens < 32) {
        state.settings.maxTokens = 8192;
        repaired = true;
    } else if (state.settings.maxTokens > 32768) {
        state.settings.maxTokens = 32768;
        repaired = true;
    }
    if (state.settings.maxTokens >= 32 && state.settings.maxTokens < 512) {
        state.settings.maxTokens = 8192;
        repaired = true;
    }

    if (typeof state.settings.contextBudget !== 'number' || state.settings.contextBudget < 5000) {
        state.settings.contextBudget = 25000;
        repaired = true;
    } else if (state.settings.contextBudget > 500000) {
        state.settings.contextBudget = 500000;
        repaired = true;
    }

    state.settings._version = SETTINGS_VERSION;

    try {
        var maSaved = localStorage.getItem('sai_multiagent');
        if (maSaved) {
            var maParsed = JSON.parse(maSaved);
            state.settings.multiAgentEnabled = maParsed.multiAgentEnabled || false;
            state.settings.agentModels = Object.assign({}, MULTI_AGENT_CONFIG.agentModels, maParsed.agentModels || {});
            state.settings.maxCoderAttempts = maParsed.maxCoderAttempts || MULTI_AGENT_CONFIG.maxCoderAttempts;
            state.settings.maxCriticRejections = maParsed.maxCriticRejections || MULTI_AGENT_CONFIG.maxCriticRejections;

            if (state.settings.agentModels) {
                var agentModelsFixed = false;
                for (var amKey in state.settings.agentModels) {
                    var amVal = state.settings.agentModels[amKey];
                    if (amVal && amVal.indexOf('/') > -1 && amVal.indexOf(':free') === -1) {
                        state.settings.agentModels[amKey] = amVal + ':free';
                        agentModelsFixed = true;
                    }
                }
                if (agentModelsFixed) {
                    repaired = true;
                    toast('Auto-fixed multi-agent models to use free tier', 'info');
                }
            }

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
        state.settings.multiAgentEnabled = false;
        state.settings.agentModels = Object.assign({}, MULTI_AGENT_CONFIG.agentModels);
        state.settings.maxCoderAttempts = MULTI_AGENT_CONFIG.maxCoderAttempts;
        state.settings.maxCriticRejections = MULTI_AGENT_CONFIG.maxCriticRejections;
    }

    repaired = repairEndpoint() || repaired;

    /* ── FIX: Only reset endpoint if it's truly invalid, not just different from default ──
       OLD BUG: This always reset the endpoint to the provider default,
       even if the user intentionally set a custom URL (e.g. proxy, different region). */
    var defaults = PROVIDER_DEFAULTS[state.settings.provider];
    if (defaults) {
        var ep = state.settings.endpoint;
        /* Only reset if endpoint is empty, has double /v1, or matches a known-bad endpoint */
        var epIsBad = !ep || ep.indexOf('/v1/v1') > -1;
        if (!epIsBad) {
            for (var bi = 0; bi < BAD_ENDPOINTS.length; bi++) {
                if (ep === BAD_ENDPOINTS[bi]) { epIsBad = true; break; }
            }
        }
        /* Also reset if the endpoint belongs to a DIFFERENT provider */
        if (!epIsBad && defaults.endpoint) {
            var allProviderEndpoints = Object.values(PROVIDER_DEFAULTS).map(function(d) { return d.endpoint; });
            var epMatchesOtherProvider = false;
            for (var pi = 0; pi < allProviderEndpoints.length; pi++) {
                if (ep === allProviderEndpoints[pi] && ep !== defaults.endpoint) {
                    epMatchesOtherProvider = true;
                    break;
                }
            }
            if (epMatchesOtherProvider) {
                state.settings.endpoint = defaults.endpoint;
                repaired = true;
            }
        }
        if (epIsBad) {
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
        if (state.settings.model.indexOf('gemini') > -1) modelIsOk = true;
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
    state.settings.maxTokens = parseInt(document.getElementById('q-tokens').value) || 8192;
    /* ── FIX: Null check for dynamically-injected context budget element ── */
    var ctxBudgetEl = document.getElementById('q-context-budget');
    state.settings.contextBudget = ctxBudgetEl ? (parseInt(ctxBudgetEl.value) || 25000) : (state.settings.contextBudget || 25000);
    voiceState.lang = document.getElementById('q-voice-lang').value;
    voiceState.rate = parseFloat(document.getElementById('q-voice-rate').value);
    if (voiceState.recognition) voiceState.recognition.lang = voiceState.lang;
    repairEndpoint();
    saveSettings();
}