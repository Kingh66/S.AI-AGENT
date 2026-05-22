/* ═══════════════════════════════════════
   STORAGE — LocalStorage save/load
   ═══════════════════════════════════════ */
import { state, voiceState } from './state.js';
import { SYSTEM_PROMPTS, PROVIDER_DEFAULTS, MULTI_AGENT_CONFIG } from './config.js';
import { toast } from './ui.js';

var SETTINGS_VERSION = 7; /* Bumped: dead model cleanup + dynamic auto-detect */

var BAD_ENDPOINTS = [
    'http://localhost:8000/v1',
    'http://localhost:8080/v1',
    ''
];

/* ═══════════════════════════════════════════════════
   DEAD MODELS — Known-removed OpenRouter model IDs
   
   When a saved setting references one of these, we
   clear it to '' (empty string) instead of replacing
   with another hardcoded model that might ALSO be dead.
   
   For multi-agent: '' means "auto-detect from OpenRouter
   free models at runtime" (handled by multiagent.js).
   
   For the main chat model: '' means the user needs to
   select a fresh model from the settings dropdown.
   
   To add a newly-dead model, just add it to this map
   with value ''. The repair functions handle the rest.
   ═══════════════════════════════════════════════════ */
var DEAD_MODELS = {
    /* ── Confirmed dead (404 on OpenRouter) ── */
    'xiaomi/mimo-v2-pro:free': '',
    'minimax/minimax-m2.7:free': '',
    'nvidia/nemotron-3-super:free': '',
    'minimax/minimax-m2.5:free': '',
    'qwen/qwen-3.6-plus': '',
    'openrouter/hunter-alpha': '',
    /* ── Previously hardcoded in config v5/v6 — may be dead ── */
    'stepfun/step-3.5-flash:free': '',
    'z-ai/glm-5-turbo:free': '',
    'meta-llama/llama-3.1-70b-instruct:free': ''
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

/* ═══════════════════════════════════════════════════
   REPAIR DEAD MODELS — Multi-agent agent models
   
   OLD BUG: Replaced dead models with other hardcoded
   models (e.g. xiaomi/mimo-v2-pro:free) that were
   ALSO dead, creating an endless 404 loop.
   
   NEW: Sets dead model values to '' (empty string),
   which signals multiagent.js to auto-detect a valid
   free model from OpenRouter at runtime.
   ═══════════════════════════════════════════════════ */
function repairDeadModels() {
    var repaired = false;
    var models = state.settings.agentModels;
    if (!models) return false;

    /* Check each agent model slot */
    var agentKeys = ['planner', 'coder', 'coderFallback', 'critic', 'criticFallback', 'tester'];
    for (var k = 0; k < agentKeys.length; k++) {
        var key = agentKeys[k];
        var val = models[key];

        if (!val) continue; /* empty = auto-detect, which is fine */

        /* Check if this model is in the dead list */
        if (DEAD_MODELS.hasOwnProperty(val)) {
            console.warn('[Storage] Agent model "' + val + '" is dead. Clearing to auto-detect.');
            models[key] = ''; /* empty = auto-detect at runtime */
            repaired = true;
            continue;
        }

        /* ═══════════════════════════════════════════════════
           PROACTIVE DEAD MODEL DETECTION
           
           Even if a model isn't in our DEAD_MODELS list,
           we can detect likely-dead models by pattern:
           - Models that were hardcoded in old config versions
           - Models with known-removed patterns
           
           This catches models that die AFTER a release
           but BEFORE we update the DEAD_MODELS list.
           ═══════════════════════════════════════════════════ */
        if (typeof val === 'string' && val.indexOf('/') > -1 && val.indexOf(':free') > -1) {
            /* It's an OpenRouter free model — check if we can verify it */
            var verifiedList = state.verifiedFreeModelIds;
            if (verifiedList && verifiedList.length > 0) {
                var isVerified = false;
                for (var vi = 0; vi < verifiedList.length; vi++) {
                    if (verifiedList[vi] === val) { isVerified = true; break; }
                }
                if (!isVerified) {
                    console.warn('[Storage] Agent model "' + val + '" not in verified free model list. Clearing to auto-detect.');
                    models[key] = '';
                    repaired = true;
                }
            }
            /* If verifiedList isn't loaded yet, we can't check — leave it.
               The multiagent.js dynamic fallback will handle it at runtime. */
        }
    }

    return repaired;
}

export function resetAllSettings() {
    /* ═══════════════════════════════════════════════════
       CLEAR ALL PERSISTED STATE FROM LOCALSTORAGE
       
       FIX: Added sai_runtime_state removal.
       
       OLD BUG: resetAllSettings() cleared settings and
       multi-agent config but left sai_runtime_state
       intact. This meant stale activeTask.isRunning=true
       and cooldownUntil timestamps survived a full reset,
       poisoning the next session with ghost auto-continues
       and stuck cooldowns.
       ═══════════════════════════════════════════════════ */
    localStorage.removeItem('sai_settings');
    localStorage.removeItem('sai_context');
    localStorage.removeItem('sai_mode');
    localStorage.removeItem('sai_voice_lang');
    localStorage.removeItem('sai_voice_rate');
    localStorage.removeItem('sai_multiagent');
    localStorage.removeItem('sai_verified_free_models');
    localStorage.removeItem('sai_runtime_state'); /* ← FIX: Clear persisted runtime state */

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

    /* ═══════════════════════════════════════════════════
       FIX: RESET IN-MEMORY RUNTIME STATE FLAGS
       
       OLD BUG: Only localStorage keys were cleared, but
       the in-memory state object still held stale values.
       The next saveRuntimeState() call would write them
       right back to localStorage, defeating the reset.
       
       Now we explicitly zero out all transient runtime
       flags so both storage AND memory are clean.
       ═══════════════════════════════════════════════════ */
    state.responseTruncated = false;
    state.cooldownUntil = 0;
    if (state.cooldownTimer) {
        clearInterval(state.cooldownTimer);
        state.cooldownTimer = null;
    }
    state.pendingRequest = null;
    state.fallbackModelsTried = [];
    state.activeTask.isRunning = false;
    state.activeTask.loopCount = 0;
    state.activeTask.pendingIntegrations = [];

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

    /* ═══════════════════════════════════════════════════
       VERSION MIGRATION
       
       Bumped from v6 → v7 to force cleanup of dead
       hardcoded models (xiaomi/mimo-v2-pro:free etc.)
       that cause 404 errors in multi-agent mode.
       
       We preserve the API key and provider across
       version upgrades so the user doesn't have to
       re-enter credentials.
       ═══════════════════════════════════════════════════ */
    try {
        var savedRaw = localStorage.getItem('sai_settings');
        if (savedRaw) {
            var quickCheck = JSON.parse(savedRaw);
            if (quickCheck._version !== SETTINGS_VERSION) {
                console.warn('[Storage] Settings v' + quickCheck._version + ' → v' + SETTINGS_VERSION + '. Migrating.');
                var keepKey = quickCheck.apiKey || '';
                var keepModel = quickCheck.model || '';
                var keepProvider = quickCheck.provider || 'openrouter';
                var keepEndpoint = quickCheck.endpoint || '';
                var keepTemp = typeof quickCheck.temperature === 'number' ? quickCheck.temperature : 0.7;

                /* ── Clear dead model from main model slot ── */
                if (keepModel && DEAD_MODELS.hasOwnProperty(keepModel)) {
                    console.warn('[Storage] Main model "' + keepModel + '" is dead. Clearing.');
                    keepModel = '';
                }

                localStorage.removeItem('sai_settings');
                state.settings.provider = keepProvider;
                state.settings.endpoint = keepEndpoint || (PROVIDER_DEFAULTS[keepProvider] ? PROVIDER_DEFAULTS[keepProvider].endpoint : 'https://openrouter.ai/api/v1');
                state.settings.apiKey = keepKey;
                state.settings.model = keepModel;
                state.settings.temperature = keepTemp;
                state.settings.maxTokens = 8192;
                state.settings.contextBudget = 25000;
                state.settings.systemPrompt = SYSTEM_PROMPTS[state.currentMode];
                state.settings._version = SETTINGS_VERSION;
                repaired = true;
                toast('Settings updated to v' + SETTINGS_VERSION, 'info');
                savedRaw = null;

                /* Also clear dead multi-agent models from the old save */
                try {
                    var maOld = localStorage.getItem('sai_multiagent');
                    if (maOld) {
                        var maOldParsed = JSON.parse(maOld);
                        if (maOldParsed.agentModels) {
                            var maCleaned = false;
                            for (var mak in maOldParsed.agentModels) {
                                if (DEAD_MODELS.hasOwnProperty(maOldParsed.agentModels[mak])) {
                                    maOldParsed.agentModels[mak] = '';
                                    maCleaned = true;
                                }
                            }
                            if (maCleaned) {
                                localStorage.setItem('sai_multiagent', JSON.stringify(maOldParsed));
                            }
                        }
                    }
                } catch (maCleanErr) {
                    /* Non-critical — multi-agent repair runs below anyway */
                }
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

    /* ═══════════════════════════════════════════════════
       MULTI-AGENT SETTINGS LOAD
       
       Merges saved agent models with config defaults.
       Empty string ('') = auto-detect at runtime.
       Dead models are cleared to '' for auto-detect.
       ═══════════════════════════════════════════════════ */
    try {
        var maSaved = localStorage.getItem('sai_multiagent');
        if (maSaved) {
            var maParsed = JSON.parse(maSaved);
            state.settings.multiAgentEnabled = maParsed.multiAgentEnabled || false;

            /* Merge: saved values override defaults, but dead models get cleared */
            state.settings.agentModels = Object.assign({}, MULTI_AGENT_CONFIG.agentModels, maParsed.agentModels || {});
            state.settings.maxCoderAttempts = maParsed.maxCoderAttempts || MULTI_AGENT_CONFIG.maxCoderAttempts;
            state.settings.maxCriticRejections = maParsed.maxCriticRejections || MULTI_AGENT_CONFIG.maxCriticRejections;

            /* ── Clear dead models from agent model slots ── */
            if (repairDeadModels()) {
                repaired = true;
                toast('Cleared removed models from multi-agent settings (will auto-detect)', 'info');
            }

            /* ═══════════════════════════════════════════════════
               REMOVED: Aggressive :free auto-appending
               
               OLD BUG: This blindly appended :free to any
               model ID containing '/', which created invalid
               IDs for non-OpenRouter providers (ollama, etc.)
               and for paid models that don't have :free variants.
               
               The ensureFreeModel() function in multiagent.js
               now handles this correctly at runtime — it only
               appends :free for OpenRouter provider and only
               for models that look like they should have it.
               
               We NO LONGER modify saved model IDs in storage.
               ═══════════════════════════════════════════════════ */
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

    /* ── Endpoint validation ── */
    var defaults = PROVIDER_DEFAULTS[state.settings.provider];
    if (defaults) {
        var ep = state.settings.endpoint;
        var epIsBad = !ep || ep.indexOf('/v1/v1') > -1;
        if (!epIsBad) {
            for (var bi = 0; bi < BAD_ENDPOINTS.length; bi++) {
                if (ep === BAD_ENDPOINTS[bi]) { epIsBad = true; break; }
            }
        }
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

    /* ═══════════════════════════════════════════════════
       MAIN MODEL VALIDATION
       
       If the saved main model is a known-dead model,
       clear it so the user selects a fresh one.
       We do NOT replace it with another hardcoded model
       (that might also be dead).
       ═══════════════════════════════════════════════════ */
    if (state.settings.model) {
        /* Check if model is in dead list */
        if (DEAD_MODELS.hasOwnProperty(state.settings.model)) {
            console.warn('[Storage] Main model "' + state.settings.model + '" is dead. Clearing.');
            state.settings.model = '';
            repaired = true;
            toast('Previous model no longer available — please select a new one', 'info');
        }

        /* Basic format validation */
        var modelIsOk = false;
        if (state.settings.model.indexOf(':free') > -1) modelIsOk = true;
        if (state.settings.model.indexOf('/') > -1) modelIsOk = true;
        if (state.settings.model.indexOf('codellama') > -1) modelIsOk = true;
        if (state.settings.model.indexOf('llama') > -1) modelIsOk = true;
        if (state.settings.model.indexOf('gpt') > -1) modelIsOk = true;
        if (state.settings.model.indexOf('gemini') > -1) modelIsOk = true;
        if (state.settings.model.indexOf('models/') > -1) modelIsOk = true; /* Google AI Studio */
        if (!modelIsOk) { state.settings.model = ''; repaired = true; }
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
    var ctxBudgetEl = document.getElementById('q-context-budget');
    state.settings.contextBudget = ctxBudgetEl ? (parseInt(ctxBudgetEl.value) || 25000) : (state.settings.contextBudget || 25000);
    voiceState.lang = document.getElementById('q-voice-lang').value;
    voiceState.rate = parseFloat(document.getElementById('q-voice-rate').value);
    if (voiceState.recognition) voiceState.recognition.lang = voiceState.lang;
    repairEndpoint();
    saveSettings();
}