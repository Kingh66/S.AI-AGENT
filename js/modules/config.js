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

    custom: `You are S.ai, an autonomous coding agent by Sizwe Mthembu. You operate like Claude Code / OpenClaw — a fully autonomous, multi-step coding assistant that plans, reads, writes, and iterates with zero human intervention between steps.

═══════════════════════════════════════════
MANDATORY WORKFLOW — FOLLOW THIS EXACTLY
═══════════════════════════════════════════

PHASE 1: PLAN (always first)
━━━━━━━━━━━━━━━━━━━━━━━━━━
Before writing ANY code, you MUST:
1. Analyze the user's request thoroughly
2. If workspace files exist, READ all relevant files first to understand the current codebase
3. Output a structured plan with checkboxes:

📋 PLAN:
☐ Step 1: Read and analyze [file] — understand current structure
☐ Step 2: Create/Modify [file] — [what you'll do and why]
☐ Step 3: Create/Modify [file] — [what you'll do and why]
...

Be specific. Name exact files. Describe what changes and why.
If you discover new needs while reading files, ADD them to the plan.

PHASE 2: EXECUTE (one file at a time)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
For EACH file in your plan:

1. Show which file you're working on:
   📁 WORKING ON: path/to/filename.ext
   Status: ⏳ In Progress

2. If MODIFYING an existing file:
   - First show what you read (brief summary)
   - Then show what you're changing and why
   - Output the COMPLETE modified file

3. If CREATING a new file:
   - Explain why this file is needed
   - Output the COMPLETE new file

4. When done with a file, mark it:
   ✅ DONE: path/to/filename.ext
   ☐ NEXT: path/to/next-file.ext

5. IMMEDIATELY move to the next file — DO NOT stop or wait

PHASE 3: REVIEW
━━━━━━━━━━━━━━━━
After ALL files are done:

📦 FILES READY TO APPLY:
1. path/to/file1.ext — [created/modified] — [1-line description]
2. path/to/file2.ext — [created/modified] — [1-line description]

📊 SUMMARY:
- Files created: X
- Files modified: X
- Key changes: [brief summary]

⚠️ REVIEW BEFORE APPLYING — Check each file above, then click "Apply" to write them to disk.

═══════════════════════════════════════════
ERROR FIXING — MANDATORY OUTPUT RULE
═══════════════════════════════════════════
When you fix ANY error or bug, you MUST output the COMPLETE updated file — every single line, no matter how large (even 5000+ lines).
NEVER truncate, abbreviate, skip, or use "..." or "// rest unchanged".
The user clicks "Apply" to save — they must NEVER manually copy and paste.
Every file must be 100% complete and Apply-ready. A partial file is a FAILED task.
All fixed/modified files MUST appear in 📦 FILES READY TO APPLY summary.
This rule has ZERO exceptions.

═══════════════════════════════════════════
OUTPUT FORMAT — STRICT RULES
═══════════════════════════════════════════

- Output ONE complete file per response using the file block format:
file:path/to/filename.ext
// COMPLETE file content — every single line, nothing omitted. NEVER truncate, abbreviate, or use "..."
Every file must be 100% complete
After each file EXCEPT the last: output <|CONTINUE_TASK|> on its own line
After the LAST file: do NOT output <|CONTINUE_TASK|>. End with the 📦 FILES READY TO APPLY summary
The system auto-continues when it sees <|CONTINUE_TASK|>
═══════════════════════════════════════════
RULES
═══════════════════════════════════════════

NEVER ask the user to type "continue" — auto-continuation is handled by the system
NEVER stop mid-task — if you have more files, output <|CONTINUE_TASK|>
ALWAYS read existing files before modifying them
NEVER output partial files — every file must be 100% complete, no matter how large
NEVER use external URLs, CDN links, or require internet access
Use system fonts, inline SVG, CSS, and emoji for any UI
NEVER change export names, import paths, or function signatures
Place new files in the CORRECT folder based on project structure
Output complete files no matter the size — use <|CONTINUE_TASK|> between files if needed, the system handles continuation
Match the existing project's coding style`,

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

/* ── Mode-specific maxTokens recommendations ──
   Coding modes need much more output than chat modes.
   These are the FLOOR values — the user's setting is respected if higher. */
export const MODE_MAX_TOKENS_FLOOR = {
    doc: 4096,
    review: 4096,
    improve: 8192,
    debug: 4096,
    explain: 4096,
    selfimprove: 8192,
    custom: 8192,
    multiagent: 8192
};

export const PROVIDER_DEFAULTS = {
    'google-ai': { endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', hint: 'Google AI Studio — free Gemini models, generous rate limits, no credit card needed', keyPlaceholder: 'AIza...', keyHint: 'Get your key at aistudio.google.com/apikey' },
    openrouter: { endpoint: 'https://openrouter.ai/api/v1', hint: 'OpenRouter — access hundreds of models through one API', keyPlaceholder: 'sk-or-v1-...', keyHint: 'Get your key at openrouter.ai/keys' },
    ollama: { endpoint: 'http://localhost:11434', hint: 'Runs locally at localhost:11434 — free, private, no API key needed', keyPlaceholder: 'Not needed for Ollama', keyHint: 'Leave empty for Ollama' },
    lmstudio: { endpoint: 'http://localhost:1234', hint: 'LM Studio local server — download models and serve locally', keyPlaceholder: 'Not needed for LM Studio', keyHint: 'Leave empty for LM Studio' },
    'openai-compat': { endpoint: 'http://localhost:8080', hint: 'Any server with OpenAI-compatible /v1/chat/completions endpoint', keyPlaceholder: 'If required by your provider', keyHint: 'Only if your provider requires auth' },
    openai: { endpoint: 'https://api.openai.com/v1', hint: 'OpenAI cloud API — requires paid API key', keyPlaceholder: 'sk-...', keyHint: 'Your OpenAI API key' }
};

/* ═══════════════════════════════════════════════════
   TOP TIER MODELS — Context length hints only
   
   These are NOT used for model selection.
   They provide context-length metadata for the settings
   dropdown. If a model is removed from OpenRouter, it
   simply won't appear in the fetched model list — no 404.
   
   The chars values are used by connection.js to set
   state.modelContextLimits for token budgeting.
   ═══════════════════════════════════════════════════ */
export const TOP_TIER_MODELS = {
    'models/gemini-2.0-flash': { chars: 500000, tier: 'Free (Google AI Studio)' },
    'models/gemini-2.5-flash-preview-05-20': { chars: 500000, tier: 'Free (Google AI Studio)' },
    'models/gemini-2.5-pro-preview-05-06': { chars: 500000, tier: 'Free (Google AI Studio)' },
    /* OpenRouter free models — context lengths are approximate.
       These IDs may change as OpenRouter rotates free models.
       The dynamic model discovery in multiagent.js handles this. */
    'meta-llama/llama-4-scout:free': { chars: 10485760, tier: 'Free Unlimited' },
    'qwen/qwen3-235b-a22b:free': { chars: 131072, tier: 'Free Unlimited' },
    'qwen/qwen3-coder:free': { chars: 131072, tier: 'Free Unlimited' },
    'deepseek/deepseek-chat-v3-0324:free': { chars: 131072, tier: 'Free Unlimited' },
    'google/gemma-3-27b-it:free': { chars: 131072, tier: 'Free Unlimited' }
};

/* ═══════════════════════════════════════════════════
   FREE MODEL FALLBACKS — Seed list for rate-limit recovery
   
   When the primary model hits 429, connection.js tries
   these in order as LAST RESORT fallbacks.
   
   IMPORTANT: At runtime, the ACTUAL fallback list is built
   dynamically from OpenRouter's /v1/models API by filtering
   for models where pricing.prompt === '0' && pricing.completion === '0'.
   That dynamic list (state.verifiedFreeModelIds) is ALWAYS
   preferred over this hardcoded list.
   
   This seed list is ONLY used when:
   1. The dynamic fetch hasn't completed yet
   2. The fetch failed (network error, no API key)
   3. localStorage cache is empty
   
   Models that 404 are automatically skipped by the
   fallback routing in connection.js.
   ═══════════════════════════════════════════════════ */
export const FREE_MODEL_FALLBACKS = [
    'qwen/qwen3-235b-a22b:free',
    'qwen/qwen3-coder:free',
    'deepseek/deepseek-chat-v3-0324:free',
    'meta-llama/llama-4-scout:free',
    'google/gemma-3-27b-it:free',
    'stepfun/step-3.5-flash:free',
    'minimax/minimax-m2.5:free',
    'z-ai/glm-5-turbo:free'
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
    { text: '<span class="warn">No API key detected — configure in settings</span>', delay: 500 },
    { text: '<span class="ok">S.ai ready.</span> Welcome back, Sizwe.', delay: 400 },
];

export const FILE_SYSTEM_INSTRUCTIONS = `WORKSPACE FILES are provided below. The user has a folder connected to their local machine.
You can create NEW files and folders — they will be written to disk when the user clicks Apply.
Place each file in the CORRECT folder based on the project structure.

Start coding immediately. NO "let me check/read/see" preamble.
NO external URLs. NO CDN links. Use system fonts, inline SVG, CSS, emoji.

OUTPUT FORMAT — for EVERY file you create or modify:
\`\`\`file:path/to/filename.ext
// COMPLETE file content — every single line\`\`\`

RULES:
- Simple project (<300 lines): ONE file, inline <style>/<script>, NO <|CONTINUE_TASK|>.
- Multi-file project: ONE file block per response. <|CONTINUE_TASK|> after each EXCEPT the last.
- Output COMPLETE files — NO "...", NO "// unchanged", NO "// rest of the code".
- NEVER truncate or abbreviate. Every import, every function, every line.
- NO tool calls.
- Match the existing folder structure. Create new subfolders only when the project needs them.
`;

/* ═══════════════════════════════════════════════════
   MULTI-AGENT CONFIG — Dynamic model selection
   
   agentModels: Empty strings mean "auto-detect from OpenRouter".
   The multiagent.js module fetches available free models at
   runtime and assigns them based on AGENT_MODEL_PREFERENCES
   (defined in multiagent.js). Hardcoded model IDs are NOT
   used unless the dynamic fetch completely fails.
   
   If a user manually configures a model in the settings UI,
   that explicit choice always takes priority over auto-detect.
   ═══════════════════════════════════════════════════ */
export const MULTI_AGENT_CONFIG = {
    agentModels: {
        planner: '',       /* auto-detect: prefers mimo, minimax, qwen3 */
        coder: '',         /* auto-detect: prefers minimax, qwen3, deepseek */
        coderFallback: '', /* auto-detect: next available model after coder fails */
        critic: '',        /* auto-detect: prefers nemotron, minimax, qwen3 */
        criticFallback: '',/* auto-detect: next available model after critic fails */
        tester: ''         /* auto-detect: prefers gemma, qwen3, mimo */
    },
    maxCoderAttempts: 3,
    maxCriticRejections: 2,
    agentTimeout: 120000,
    totalTaskTimeout: 600000,
    enableFallbackRouting: true,
    enforceCriticAuthority: true,
    autoRetryOnFailure: true
};

/* ═══════════════════════════════════════════════════
   AGENT MODEL PREFERENCES
   
   When auto-detecting models for multi-agent, these
   substring patterns are tried in order against the
   dynamically discovered free model list. The first
   match wins for each agent role.
   
   This is imported by multiagent.js at runtime.
   ═══════════════════════════════════════════════════ */
export const AGENT_MODEL_PREFERENCES = {
    planner: ['mimo', 'minimax', 'qwen3', 'deepseek', 'nemotron', 'llama-4', 'gemma', 'step', 'glm'],
    coder:   ['minimax', 'qwen3', 'deepseek', 'mimo', 'llama-4', 'gemma', 'nemotron', 'step', 'glm'],
    critic:  ['nemotron', 'minimax', 'mimo', 'qwen3', 'gemma', 'deepseek', 'llama-4', 'step', 'glm'],
    tester:  ['gemma', 'qwen3', 'mimo', 'minimax', 'deepseek', 'llama-4', 'nemotron', 'step', 'glm']
};

export const stateDefaults = {
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1',
    apiKey: '',
    model: '',
    temperature: 0.7,
    maxTokens: 8192,
    systemPrompt: '',
    multiAgent: {
        enabled: false,
        agentModels: {
            planner: '',       /* auto-detect from OpenRouter free models */
            coder: '',         /* auto-detect */
            coderFallback: '', /* auto-detect */
            critic: '',        /* auto-detect */
            criticFallback: '',/* auto-detect */
            tester: ''         /* auto-detect */
        },
        maxCoderAttempts: MULTI_AGENT_CONFIG.maxCoderAttempts,
        maxCriticRejections: MULTI_AGENT_CONFIG.maxCriticRejections
    }
};