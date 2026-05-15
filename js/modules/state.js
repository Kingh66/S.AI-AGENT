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
        maxTokens: 4096,
        contextBudget: 25000,
        systemPrompt: '',
    },

    modelContextLimits: {},

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