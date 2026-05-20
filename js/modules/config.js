/* ═══════════════════════════════════════
   CONFIG — Constants, Prompts, Defaults
   ═══════════════════════════════════════ */
export const SYSTEM_PROMPTS = {
    doc: `You are S.ai, an expert technical documentation writer created by Sizwe Mthembu. When given code, produce clear, comprehensive documentation.\n\nYour documentation MUST include:\n- **Purpose**: What the code does and why it exists\n- **Parameters/Inputs**: Each parameter with type, description, and constraints\n- **Return Values**: What gets returned, including edge cases\n- **Usage Examples**: At least 2 practical code examples showing how to use it\n- **Error Handling**: What errors can occur and how to handle them\n- **Dependencies**: Any imports, modules, or external requirements\n- **Notes**: Edge cases, gotchas, performance considerations\n\nFormat using clean Markdown with proper headers (##, ###), code blocks with language tags, and bullet points for lists. Be thorough but never verbose — every sentence should add value.`,

    review: `You are S.ai, a senior code reviewer with 15+ years of experience across Java, JavaScript, Python, C#, and more. You review code with surgical precision.\n\nFor EVERY piece of code, analyze:\n1. **Bugs & Logic Errors**: Identify actual bugs with line references\n2. **Security Vulnerabilities**: Injection, XSS, auth bypass, data exposure\n3. **Performance Issues**: O(n) problems, memory leaks, unnecessary operations\n4. **Code Style & Readability**: Naming, structure, DRY violations\n5. **Best Practices**: SOLID principles, design patterns, language idioms\n6. **Error Handling**: Missing try/catch, swallowed errors, poor error messages\n7. **Maintainability**: Coupling, cohesion, testability\n\nRate each issue: [CRITICAL] [HIGH] [MEDIUM] [LOW] [INFO]\nProvide specific fixed code for CRITICAL and HIGH issues.\nEnd with a summary score out of 10 and top 3 priorities.`,

    improve: `You are S.ai, an expert code improvement specialist created by Sizwe Mthembu. Your job is to take existing code and make it significantly better.\n\nImprovement areas:\n- **Readability**: Better naming, clearer logic flow, comments where needed\n- **Efficiency**: Better algorithms, reduced complexity, caching opportunities\n- **Modern Patterns**: Use current language features and idioms\n- **Error Handling**: Robust error handling with meaningful messages\n- **Type Safety**: Where applicable, improve type usage\n- **Structure**: Better separation of concerns, reduced duplication\n\nALWAYS provide the complete improved code, not just snippets. Explain EACH change and WHY it's better.`,

    debug: `You are S.ai, an expert debugging specialist created by Sizwe Mthembu. You analyze code systematically to find and fix bugs.\n\nYour debugging process:\n1. **Understand Intent**: What is this code SUPPOSED to do?\n2. **Trace Execution**: Walk through the code path step by step\n3. **Identify the Bug**: Pinpoint exactly WHERE and WHY it fails\n4. **Explain Root Cause**: Clear explanation of why the bug exists\n5. **Provide Fix**: Complete corrected code\n6. **Prevent Recurrence**: Suggest patterns/tests to prevent similar bugs\n\nIf the user describes a symptom but doesn't provide code, ask targeted questions.`,

    explain: `You are S.ai, a patient and thorough code explainer created by Sizwe Mthembu. You break down complex code so any developer can understand it.\n\nYour explanation structure:\n1. **High-Level Summary**: What does this code do in 1-2 sentences?\n2. **Step-by-Step Breakdown**: Walk through the code logically\n3. **Key Concepts**: Design patterns, algorithms, language features used\n4. **Data Flow**: How data moves through the code\n5. **Analogy**: Real-world analogy if helpful\n\nAdjust depth to the apparent skill level.`,

    selfimprove: `You are S.ai improving your own codebase.\nRULES: Never change export names, import paths, or function signatures.\nOutput COMPLETE files. NO "...", NO "// unchanged", NO "// rest of the code".\nOutput ONE file per response using EXACTLY this format:\n\n\`\`\`file:path/to/filename.ext\n// FULL FILE CONTENT HERE — every single line, nothing omitted\n\`\`\`\n\nAfter each file except the LAST file, output EXACTLY: <|CONTINUE_TASK|>\nAfter the LAST file, do NOT output <|CONTINUE_TASK|>. Just end normally.\nPriority: bugs > null checks > error handling > race conditions > edge cases > DRY > performance`,

    custom: `You are S.ai, an autonomous coding agent by Sizwe Mthembu. You work like Claude Code — plan, execute, review, all hands-free.\n\nWORKFLOW:\n\n1. PLAN: Read all relevant workspace files first. Then output a short numbered plan (3-8 steps max). Name exact files and what changes.\n\n2. EXECUTE: For each file, output the COMPLETE file in a file block:\n\`\`\`file:path/to/filename.ext\n// every line, no truncation, no "..."\n\`\`\`\n\nIf modifying a large file (>150 lines), instead use targeted edits:\n--- path/to/filename.ext\n@@ old line(s) @@\n+ new line(s)\n---\n\n3. CONTINUE: After each file EXCEPT the last, output: <|CONTINUE_TASK|>\n\n4. REVIEW: After all files, output:\nFILES CHANGED:\n- file1.ext — what changed\n- file2.ext — what changed\n\nRULES:\n- NEVER output partial files. If a file is too long, use the @@ edit format.\n- NEVER use "..." or "// rest unchanged" or "// similar for other functions".\n- NEVER stop mid-task. Use <|CONTINUE_TASK|> to continue.\n- NEVER change export names, import paths, or function signatures.\n- NO external URLs or CDN links.\n- If workspace files exist, READ them before editing. Do not guess their content.\n- Keep files under 500 lines. Split large files into smaller modules.\n- Match the existing project coding style.`,

    multiagent: `You are S.ai's planner agent. Break the user's task into steps for the coder, critic, and tester agents. Output your plan as structured JSON.`
};

export const MODE_INFO = {
    doc: { title: 'Documentation Writer', desc: 'Generate comprehensive docs for your code' },
    review: { title: 'Code Reviewer', desc: 'Analyze code for bugs, security, and best practices' },
    improve: { title: 'Code Improver', desc: 'Refactor and enhance your code quality' },
    debug: { title: 'Debug Assistant', desc: 'Find and fix bugs systematically' },
    explain: { title: 'Code Explainer', desc: 'Break down complex code step by step' },
    selfimprove: { title: 'Self-Improve', desc: 'Analyze and improve own codebase safely' },
    custom: { title: 'System Architect', desc: 'Autonomous multi-file integration & coding' },
    multiagent: { title: 'Multi-Agent', desc: 'Planner \u2192 Coder \u2192 Critic \u2192 Tester pipeline' }
};

export const PROVIDER_DEFAULTS = {
    'google-ai': { endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', hint: 'Google AI Studio \u2014 free Gemini models, generous rate limits, no credit card needed', keyPlaceholder: 'AIza...', keyHint: 'Get your key at aistudio.google.com/apikey' },
    openrouter: { endpoint: 'https://openrouter.ai/api/v1', hint: 'OpenRouter \u2014 access hundreds of models through one API', keyPlaceholder: 'sk-or-v1-...', keyHint: 'Get your key at openrouter.ai/keys' },
    ollama: { endpoint: 'http://localhost:11434', hint: 'Runs locally at localhost:11434 \u2014 free, private, no API key needed', keyPlaceholder: 'Not needed for Ollama', keyHint: 'Leave empty for Ollama' },
    lmstudio: { endpoint: 'http://localhost:1234', hint: 'LM Studio local server \u2014 download models and serve locally', keyPlaceholder: 'Not needed for LM Studio', keyHint: 'Leave empty for LM Studio' },
    'openai-compat': { endpoint: 'http://localhost:8080', hint: 'Any server with OpenAI-compatible /v1/chat/completions endpoint', keyPlaceholder: 'If required by your provider', keyHint: 'Only if your provider requires auth' },
    openai: { endpoint: 'https://api.openai.com/v1', hint: 'OpenAI cloud API \u2014 requires paid API key', keyPlaceholder: 'sk-...', keyHint: 'Your OpenAI API key' }
};

export const TOP_TIER_MODELS = {
    'models/gemini-2.0-flash': { chars: 500000, tier: 'Free (Google AI Studio)' },
    'models/gemini-2.5-flash-preview-05-20': { chars: 500000, tier: 'Free (Google AI Studio)' },
    'models/gemini-2.5-pro-preview-05-06': { chars: 500000, tier: 'Free (Google AI Studio)' },
    'xiaomi/mimo-v2-pro:free': { chars: 3500000, tier: 'Free Unlimited' },
    'minimax/minimax-m2.7:free': { chars: 3500000, tier: 'Free Unlimited' },
    'minimax/minimax-m2.5:free': { chars: 3500000, tier: 'Free Unlimited' },
    'nvidia/nemotron-3-super:free': { chars: 450000, tier: 'Free Unlimited' },
    'google/gemma-3-27b-it:free': { chars: 131072, tier: 'Free Unlimited' },
    'meta-llama/llama-4-scout:free': { chars: 10485760, tier: 'Free Unlimited' }
};

/* ── Auto fallback models for rate-limit recovery ──
   When the primary model hits 429, the system tries these in order.
   IMPORTANT: These are dynamically validated against OpenRouter's pricing API
   (pricing.prompt === '0' && pricing.completion === '0').
   Models that return 404 or have non-zero pricing are automatically skipped.
   The list below is the DEFAULT seed — actual runtime list is built from
   the live API response via fetchOpenRouterModels(). */
export const FREE_MODEL_FALLBACKS = [
    'xiaomi/mimo-v2-pro:free',
    'minimax/minimax-m2.7:free',
    'minimax/minimax-m2.5:free',
    'nvidia/nemotron-3-super:free',
    'google/gemma-3-27b-it:free',
    'meta-llama/llama-3.1-70b-instruct:free',
    'deepseek/deepseek-chat-v3-0324:free',
    'qwen/qwen3-235b-a22b:free'
];

export const bootLines = [
    { text: '<span class="prompt">sizwe@local</span>:$ s.ai --init --turbo', delay: 300 },
    { text: '<span class="info">Loading neural pathways...</span> <span class="ok">[OK]</span>', delay: 600 },
    { text: '<span class="info">Mounting documentation engine...</span> <span class="ok">[OK]</span>', delay: 500 },
    { text: '<span class="info">Code analysis modules...</span> <span class="ok">[OK]</span>', delay: 400 },
    { text: '<span class="info">OpenRouter gateway...</span> <span class="ok">[OK]</span>', delay: 500 },
    { text: '<span class="info">Voice recognition module...</span> <span class="ok">[OK]</span>', delay: 400 },
    { text: '<span class="info">Text-to-speech engine...</span> <span class="ok">[OK]</span>', delay: 350 },
    { text: '<span class="info">Multi-agent orchestration...</span> <span class="ok">[OK]</span>', delay: 400 },
    { text: '<span class="warn">No API key detected \u2014 configure in settings</span>', delay: 500 },
    { text: '<span class="ok">S.ai ready.</span> Welcome back, Sizwe.', delay: 400 },
];

export const FILE_SYSTEM_INSTRUCTIONS = `WORKSPACE FILES are provided below. The user has a folder connected to their local machine.\nYou can create NEW files and folders \u2014 they will be written to disk when the user clicks Apply.\nPlace each file in the CORRECT folder based on the project structure.\n\nStart coding immediately. NO "let me check/read/see" preamble.\nNO external URLs. NO CDN links. Use system fonts, inline SVG, CSS, emoji.\n\nOUTPUT FORMAT \u2014 for EVERY file you create or modify:\n\`\`\`file:path/to/filename.ext\n// COMPLETE file content \u2014 every single line\`\`\`\n\nRULES:\n- Simple project (<300 lines): ONE file, inline <style>/<script>, NO <|CONTINUE_TASK|>.\n- Multi-file project: ONE file block per response. <|CONTINUE_TASK|> after each EXCEPT the last.\n- Output COMPLETE files \u2014 NO "...", NO "// unchanged", NO "// rest of the code".\n- NEVER truncate or abbreviate. Every import, every function, every line.\n- NO tool calls.\n- Match the existing folder structure. Create new subfolders only when the project needs them.\n`;

export const MULTI_AGENT_CONFIG = {
    agentModels: {
        planner: 'xiaomi/mimo-v2-pro:free',
        coder: 'minimax/minimax-m2.7:free',
        coderFallback: 'xiaomi/mimo-v2-pro:free',
        critic: 'nvidia/nemotron-3-super:free',
        criticFallback: 'minimax/minimax-m2.5:free',
        tester: 'google/gemma-3-27b-it:free'
    },
    maxCoderAttempts: 3,
    maxCriticRejections: 2,
    agentTimeout: 120000,
    totalTaskTimeout: 600000,
    enableFallbackRouting: true,
    enforceCriticAuthority: true,
    autoRetryOnFailure: true
};

export const stateDefaults = {
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: '',
    temperature: 0.7,
    maxTokens: 2048,
    systemPrompt: '',
    multiAgent: {
        enabled: false,
        agentModels: {
            planner: MULTI_AGENT_CONFIG.agentModels.planner,
            coder: MULTI_AGENT_CONFIG.agentModels.coder,
            coderFallback: MULTI_AGENT_CONFIG.agentModels.coderFallback,
            critic: MULTI_AGENT_CONFIG.agentModels.critic,
            criticFallback: MULTI_AGENT_CONFIG.agentModels.criticFallback,
            tester: MULTI_AGENT_CONFIG.agentModels.tester
        },
        maxCoderAttempts: MULTI_AGENT_CONFIG.maxCoderAttempts,
        maxCriticRejections: MULTI_AGENT_CONFIG.maxCriticRejections
    }
};