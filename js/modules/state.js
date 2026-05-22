/* ═══════════════════════════════════════
   STATE — Application state management
   ═══════════════════════════════════════ */

export const state = {
    currentMode: 'custom',
    messages: [],
    conversationHistory: [],
    isStreaming: false,
    streamElement: null,
    streamBuffer: '',
    streamRenderTimeout: null,
    isRenderScheduled: false,
    sidebarOpen: false,
    currentChatId: null,
    abortController: null,
    thinkingContent: '',

    settings: {
        provider: 'openrouter',
        endpoint: 'https://openrouter.ai/api/v1',
        apiKey: '',
        model: '',
        temperature: 0.7,
        maxTokens: 8192,
        contextBudget: 25000,
        systemPrompt: '',
    },

    modelContextLimits: {},

    /* Set to true when the last response was truncated (finishReason=length) */
    responseTruncated: false,

    /* Rate limit cooldown — prevents sending during cooldown period */
    cooldownUntil: 0,
    cooldownTimer: null,

    /* Pending request to send after cooldown ends */
    pendingRequest: null,

    /* Track which models have been tried in current fallback cycle */
    fallbackModelsTried: [],

    /* Dynamically verified list of completely free model IDs (pricing.prompt=0, pricing.completion=0)
       Populated by fetchOpenRouterModels() and used by getNextFallbackModel() for rate-limit recovery.
       Persisted to localStorage so it survives page reloads. */
    verifiedFreeModelIds: [],

    activeTask: {
        isRunning: false,
        loopCount: 0,
        maxLoops: 10,
        pendingIntegrations: []
    }
};

export const voiceState = {
    isVoiceChat: false,
    mode: 'idle',
    lang: 'en-US',
    rate: 1.0,
    recognition: null,
    synthesis: null,
    currentUtterance: null,
};

/* ═══════════════════════════════════════
   RUNTIME STATE PERSISTENCE
   ═══════════════════════════════════════ */

const RUNTIME_STATE_KEY = 'sai_runtime_state';

/* Keys in `state` that should survive page reloads
   
   NOTE: activeTask is INTENTIONALLY EXCLUDED.
   
   BUG FIX: Previously, activeTask was persisted here.
   If the page closed/crashed mid-task, activeTask.isRunning=true
   was restored on reload, causing every subsequent response
   to auto-continue up to 3 times (wasting rate limit budget
   on unrelated conversations). activeTask is transient
   runtime state — it must start fresh every session. */
const PERSISTED_RUNTIME_KEYS = [
    'responseTruncated',
    'cooldownUntil',
    'fallbackModelsTried',
    'verifiedFreeModelIds'
];

export function loadRuntimeState() {
    try {
        var saved = localStorage.getItem(RUNTIME_STATE_KEY);
        if (!saved) return;
        var parsed = JSON.parse(saved);
        PERSISTED_RUNTIME_KEYS.forEach(function(key) {
            if (parsed[key] !== undefined) {
                state[key] = parsed[key];
            }
        });

        /* ═══════════════════════════════════════════════════
           SAFETY: Reset transient runtime flags
           
           Even though activeTask is no longer in
           PERSISTED_RUNTIME_KEYS, older versions of this
           code saved it to localStorage. If the user
           upgrades, the stale data is still there.
           
           We explicitly reset these to prevent a
           ghost "isRunning" from poisoning new sessions.
           ═══════════════════════════════════════════════════ */
        state.activeTask.isRunning = false;
        state.activeTask.loopCount = 0;
        state.activeTask.pendingIntegrations = [];

        /* Clear stale cooldowns from previous sessions */
        if (state.cooldownUntil && state.cooldownUntil <= Date.now()) {
            state.cooldownUntil = 0;
        }

        /* ═══════════════════════════════════════════════════
           MIGRATION: Remove activeTask from localStorage
           
           For users upgrading from the old version that
           persisted activeTask. Clean it out so it doesn't
           keep getting loaded by accident.
           ═══════════════════════════════════════════════════ */
        if (parsed.activeTask !== undefined) {
            delete parsed.activeTask;
            try {
                localStorage.setItem(RUNTIME_STATE_KEY, JSON.stringify(parsed));
            } catch (e) {
                console.warn('[State] Could not clean migrated state:', e.message);
            }
        }

        console.log('[State] Runtime state restored from localStorage');
    } catch (e) {
        console.warn('[State] Failed to restore runtime state:', e.message);
    }
}

export function saveRuntimeState() {
    try {
        var toSave = {};
        PERSISTED_RUNTIME_KEYS.forEach(function(key) {
            toSave[key] = state[key];
        });
        localStorage.setItem(RUNTIME_STATE_KEY, JSON.stringify(toSave));
    } catch (e) {
        console.warn('[State] Failed to persist runtime state:', e.message);
    }
}