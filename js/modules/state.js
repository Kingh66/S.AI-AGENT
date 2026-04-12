export const state = {
    currentMode: 'custom',    // ← was 'code', but no 'code' exists in MODE_INFO
    messages: [],
    conversationHistory: [],
    isStreaming: false,
    streamElement: null,
    streamBuffer: '',
    streamRenderTimeout: null,
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