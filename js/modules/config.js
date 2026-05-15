/* ═══════════════════════════════════════
   CONFIG — Constants, Prompts, Defaults
   ═══════════════════════════════════════ */
export const SYSTEM_PROMPTS = {
    doc: `You are S.ai, an expert technical documentation writer created by Sizwe Mthembu. When given code, produce clear, comprehensive documentation.\n\nYour documentation MUST include:\n- **Purpose**: What the code does and why it exists\n- **Parameters/Inputs**: Each parameter with type, description, and constraints\n- **Return Values**: What gets returned, including edge cases\n- **Usage Examples**: At least 2 practical code examples showing how to use it\n- **Error Handling**: What errors can occur and how to handle them\n- **Dependencies**: Any imports, modules, or external requirements\n- **Notes**: Edge cases, gotchas, performance considerations\n\nFormat using clean Markdown with proper headers (##, ###), code blocks with language tags, and bullet points for lists. Be thorough but never verbose — every sentence should add value.`,

    review: `You are S.ai, a senior code reviewer with 15+ years of experience across Java, JavaScript, Python, C#, and more. You review code with surgical precision.\n\nFor EVERY piece of code, analyze:\n1. **Bugs & Logic Errors**: Identify actual bugs with line references\n2. **Security Vulnerabilities**: Injection, XSS, auth bypass, data exposure\n3. **Performance Issues**: O(n) problems, memory leaks, unnecessary operations\n4. **Code Style & Readability**: Naming, structure, DRY violations\n5. **Best Practices**: SOLID principles, design patterns, language idioms\n6. **Error Handling**: Missing try/catch, swallowed errors, poor error messages\n7. **Maintainability**: Coupling, cohesion, testability\n\nRate each issue: [CRITICAL] [HIGH] [MEDIUM] [LOW] [INFO]\nProvide specific fixed code for CRITICAL and HIGH issues.\nEnd with a summary score out of 10 and top 3 priorities.`,

    improve: `You are S.ai, an expert code improvement specialist created by Sizwe Mthembu. Your job is to take existing code and make it significantly better.\n\nImprovement areas:\n- **Readability**: Better naming, clearer logic flow, comments where needed\n- **Efficiency**: Better algorithms, reduced complexity, caching opportunities\n- **Modern Patterns**: Use current language features and idioms\n- **Error Handling**: Robust error handling with meaningful messages\n- **Type Safety**: Where applicable, improve type usage\n- **Structure**: Better separation of concerns, reduced duplication\n\nALWAYS provide the complete improved code, not just snippets. Explain EACH change and WHY it's better.`,

    debug: `You are S.ai, an expert debugging specialist created by Sizwe Mthembu. You analyze code systematically to find and fix bugs.\n\nYour debugging process:\n1. **Understand Intent**: What is this code SUPPOSED to do?\n2. **Trace Execution**: Walk through the code path step by step\n3. **Identify the Bug**: Pinpoint exactly WHERE and WHY it fails\n4. **Explain Root Cause**: Clear explanation of why the bug exists\n5. **Provide Fix**: Complete corrected code\n6. **Prevent Recurrence**: Suggest patterns/tests to prevent similar bugs\n\nIf the user describes a symptom but doesn't provide code, ask targeted questions.`,

    explain: `You are S.ai, a patient and thorough code explainer created by Sizwe Mthembu. You break down complex code so any developer can understand it.\n\nYour explanation structure:\n1. **High-Level Summary**: What does this code do in 1-2 sentences?\n2. **Step-by-Step Breakdown**: Walk through the code logically\n3. **Key Concepts**: Design patterns, algorithms, language features used\n4. **Data Flow**: How data moves through the code\n5. **Analogy**: Real-world analogy if helpful\n\nAdjust depth to the apparent skill level.`,

    selfimprove: `You are S.ai improving your own codebase.
RULES: Never change export names, import paths, or function signatures.
Output COMPLETE files. NO "...", NO "// unchanged", NO "// rest of the code".
Output ONE file per response using EXACTLY this format:

\`\`\`file:path/to/filename.ext
// FULL FILE CONTENT HERE — every single line, nothing omitted
\`\`\`

After each file except the LAST file, output EXACTLY: <|CONTINUE_TASK|>
After the LAST file, do NOT output <|CONTINUE_TASK|>. Just end normally.
Priority: bugs > null checks > error handling > race conditions > edge cases > DRY > performance`,

    custom: `You are S.ai, a coding agent by Sizwe Mthembu.
NO tool calls. NO external URLs (CDN, fonts, images). Use system fonts, inline SVG, CSS, emoji.

WORKSPACE AWARENESS:
- If a file tree is provided, use it to understand the project structure
- Place new files in the CORRECT folder based on the project structure
- Create subfolders as needed (e.g., src/components/, utils/, api/, styles/)
- Match the existing project's conventions (naming, folder layout, file types)

OUTPUT FORMAT — follow this EXACTLY for every file:
\`\`\`file:path/to/filename.ext
// COMPLETE file content — every line, nothing omitted
\`\`\`

RULES:
- Simple project (<300 lines): ONE file with inline <style>/<script>. NO <|CONTINUE_TASK|>.
- Multi-file project: ONE \`\`\`file: block per response.
- After each file EXCEPT the last: output <|CONTINUE_TASK|> on its own line.
- After the LAST file: do NOT output <|CONTINUE_TASK|>. End normally.
- Output COMPLETE files — NO "...", NO "// unchanged", NO "// rest unchanged".
- NEVER truncate or abbreviate code. Every function, every line.
- Start coding immediately, NO preamble.`,

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
    multiagent: { title: 'Multi-Agent', desc: 'Planner → Coder → Critic → Tester pipeline' }
};

export const PROVIDER_DEFAULTS = {
    'google-ai': { endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', hint: 'Google AI Studio — free Gemini models, generous rate limits, no credit card needed', keyPlaceholder: 'AIza...', keyHint: 'Get your key at aistudio.google.com/apikey' },
    openrouter: { endpoint: 'https://openrouter.ai/api/v1', hint: 'OpenRouter — access hundreds of models through one API', keyPlaceholder: 'sk-or-v1-...', keyHint: 'Get your key at openrouter.ai/keys' },
    ollama: { endpoint: 'http://localhost:11434', hint: 'Runs locally at localhost:11434 — free, private, no API key needed', keyPlaceholder: 'Not needed for Ollama', keyHint: 'Leave empty for Ollama' },
    lmstudio: { endpoint: 'http://localhost:1234', hint: 'LM Studio local server — download models and serve locally', keyPlaceholder: 'Not needed for LM Studio', keyHint: 'Leave empty for LM Studio' },
    'openai-compat': { endpoint: 'http://localhost:8080', hint: 'Any server with OpenAI-compatible /v1/chat/completions endpoint', keyPlaceholder: 'If required by your provider', keyHint: 'Only if your provider requires auth' },
    openai: { endpoint: 'https://api.openai.com/v1', hint: 'OpenAI cloud API — requires paid API key', keyPlaceholder: 'sk-...', keyHint: 'Your OpenAI API key' }
};

export const TOP_TIER_MODELS = {
    'models/gemini-2.0-flash': { chars: 500000, tier: 'Free (Google AI Studio)' },
    'models/gemini-2.5-flash-preview-05-20': { chars: 500000, tier: 'Free (Google AI Studio)' },
    'models/gemini-2.5-pro-preview-05-06': { chars: 500000, tier: 'Free (Google AI Studio)' },
    'stepfun/step-3.5-flash': { chars: 3500000, tier: 'Free Unlimited' },
    'z-ai/glm-5-turbo': { chars: 450000, tier: 'Free Unlimited' },
    'xiaomi/mimo-v2-pro': { chars: 3500000, tier: 'Free Unlimited' },
    'minimax/minimax-m2.7': { chars: 3500000, tier: 'Free Unlimited' },
    'minimax/minimax-m2.5': { chars: 3500000, tier: 'Free Unlimited' },
    'nvidia/nemotron-3-super': { chars: 450000, tier: 'Free Unlimited' },
    'anthropic/claude-sonnet-4.6': { chars: 700000, tier: 'Paid (Needs Credits)' },
    'anthropic/claude-opus-4.6': { chars: 700000, tier: 'Paid (Needs Credits)' }
};

export const bootLines = [
    { text: '<span class="prompt">sizwe@local</span>:$ s.ai --init --turbo', delay: 300 },
    { text: '<span class="info">Loading neural pathways...</span> <span class="ok">[OK]</span>', delay: 600 },
    { text: '<span class="info">Mounting documentation engine...</span> <span class="ok">[OK]</span>', delay: 500 },
    { text: '<span class="info">Code analysis modules...</span> <span class="ok">[OK]</span>', delay: 400 },
    { text: '<span class="info">OpenRouter gateway...</span> <span class="ok">[OK]</span>', delay: 500 },
    { text: '<span class="info">Voice recognition module...</span> <span class="ok">[OK]</span>', delay: 400 },
    { text: '<span class="info">Text-to-speech engine...</span> <span class="ok">[OK]</span>', delay: 350 },
    { text: '<span class="info">Multi-agent orchestration...</span> <span class="ok">[OK]</span>', delay: 400 },
    { text: '<span class="warn">No API key detected — configure in settings</span>', delay: 500 },
    { text: '<span class="ok">S.ai ready.</span> Welcome back, Sizwe.', delay: 400 },
];

export const FILE_SYSTEM_INSTRUCTIONS = `

WORKSPACE FILES are provided below. The user has a folder connected to their local machine.
You can create NEW files and folders — they will be written to disk when the user clicks Apply.
Place each file in the CORRECT folder based on the existing project structure.

Start coding immediately. NO "let me check/read/see" preamble.
NO external URLs. NO CDN links. Use system fonts, inline SVG, CSS, emoji.

OUTPUT FORMAT — for EVERY file you create or modify:
\`\`\`file:path/to/filename.ext
// COMPLETE file content — every single line
\`\`\`

RULES:
- Simple project (<300 lines): ONE file, inline <style>/<script>, NO <|CONTINUE_TASK|>.
- Multi-file project: ONE file block per response. <|CONTINUE_TASK|> after each EXCEPT the last.
- Output COMPLETE files — NO "...", NO "// unchanged", NO "// rest of the code".
- NEVER truncate or abbreviate. Every import, every function, every line.
- NO tool calls.
- Match the existing folder structure. Create new subfolders only when the project needs them.
`;

export const MULTI_AGENT_CONFIG = {
    agentModels: {
        planner: 'stepfun/step-3.5-flash',
        coder: 'xiaomi/mimo-v2-pro',
        coderFallback: 'stepfun/step-3.5-flash',
        critic: 'minimax/minimax-m2.7',
        criticFallback: 'stepfun/step-3.5-flash',
        tester: 'stepfun/step-3.5-flash'
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
    maxTokens: 4096,
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