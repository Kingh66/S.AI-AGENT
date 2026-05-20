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
        maxTokens: 2048,
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
