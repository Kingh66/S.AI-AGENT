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
    isRenderScheduled: false, // Required for ultra-fast streaming
    sidebarOpen: false,
    currentChatId: null,
    abortController: null,

    settings: {
        provider: 'openrouter',
        endpoint: 'https://openrouter.ai/api/v1',
        apiKey: '',
        model: '',
        temperature: 0.7,
        maxTokens: 4096,
        systemPrompt: '',
    },

    modelContextLimits: {},

    // Agentic Task Loop Control & Resume State
    activeTask: {
        isRunning: false,
        loopCount: 0,
        maxLoops: 10, // Hard limit to prevent infinite loops
        pendingIntegrations: [] // Tracks files the AI still needs to connect
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