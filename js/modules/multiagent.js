/* ═══════════════════════════════════════════════════════════════
   MULTI-AGENT ORCHESTRATION
   + DYNAMIC MODEL DISCOVERY
   + 429 rate-limit model switching + GLOBAL DAILY LIMIT detection
   + 404 model pruning
   + LENIENT validation for free models
   + Inter-agent delay
   + Trivial plan detection
   + Coder output → Apply button conversion
   + FULL file content injection for target files
   ═══════════════════════════════════════════════════════════════ */
import { state } from './state.js';
import { toast, setConnectionStatus, autoResize, getTimeStr, highlightCodeBlocks } from './ui.js';
import { removeWelcome, addUserMessage } from './messages.js';
import { parseMarkdown } from './markdown.js';
import { getFileContext, isConnected, readFile, getTree } from './filesystem.js';

/* ═══════════════════════════════════════════════════
   DYNAMIC MODEL DISCOVERY
   ═══════════════════════════════════════════════════ */
var _verifiedFreeModels = null;
var _modelFetchPromise = null;

var HARDCODED_FALLBACK_MODELS = [
    'qwen/qwen3-235b-a22b:free',
    'qwen/qwen3-coder:free',
    'deepseek/deepseek-chat-v3-0324:free',
    'meta-llama/llama-4-scout:free',
    'google/gemma-3-27b-it:free',
    'stepfun/step-3.5-flash:free'
];

/* ═══════════════════════════════════════════════════
   RATE-LIMIT TRACKING
   ═══════════════════════════════════════════════════ */
var _rateLimitedModels = {};
var RATE_LIMIT_COOLDOWN_MS = 90000;

/* ═══════════════════════════════════════════════════
   GLOBAL DAILY LIMIT TRACKING
   
   OpenRouter returns a 429 with "free-models-per-day"
   when the account's daily free-model quota is exhausted.
   This is a GLOBAL limit — no model switching will help.
   We track the reset timestamp so we can inform the user
   exactly when they can resume.
   ═══════════════════════════════════════════════════ */
var _globalDailyLimitReset = 0;

function markRateLimited(modelId, cooldownMs) {
    if (!modelId) return;
    var expiry = (cooldownMs && cooldownMs > 0) ? (Date.now() + cooldownMs) : (Date.now() + RATE_LIMIT_COOLDOWN_MS);
    _rateLimitedModels[modelId] = expiry;
    console.log('[MultiAgent] Rate-limited: ' + modelId + ' (until ' + new Date(expiry).toLocaleTimeString() + ')');
}

function markGlobalDailyLimit(resetTimestamp) {
    _globalDailyLimitReset = resetTimestamp || (Date.now() + 3600000);
    // Mark ALL verified free models as rate-limited until the global reset
    if (_verifiedFreeModels && _verifiedFreeModels.length > 0) {
        for (var i = 0; i < _verifiedFreeModels.length; i++) {
            _rateLimitedModels[_verifiedFreeModels[i]] = _globalDailyLimitReset;
        }
    }
    var resetDate = new Date(_globalDailyLimitReset).toLocaleTimeString();
    console.log('[MultiAgent] GLOBAL daily limit hit. All free models blocked until ' + resetDate);
}

function isGlobalDailyLimitActive() {
    if (!_globalDailyLimitReset) return false;
    if (Date.now() > _globalDailyLimitReset) { _globalDailyLimitReset = 0; return false; }
    return true;
}

function isRateLimited(modelId) {
    if (!modelId) return false;
    if (isGlobalDailyLimitActive()) return true; // All models blocked
    var expiry = _rateLimitedModels[modelId];
    if (!expiry) return false;
    if (Date.now() > expiry) { delete _rateLimitedModels[modelId]; return false; }
    return true;
}

function clearRateLimits() { _rateLimitedModels = {}; _globalDailyLimitReset = 0; }

function countRateLimitedModels() {
    var count = 0, now = Date.now();
    for (var key in _rateLimitedModels) { if (_rateLimitedModels[key] > now) count++; }
    return count;
}

/* ═══════════════════════════════════════════════════
   PARSE 429 RESET TIMESTAMP
   
   OpenRouter 429 errors include:
   "X-RateLimit-Reset":"1779494400000"
   
   We extract this to know exactly when the limit resets.
   ═══════════════════════════════════════════════════ */
function parse429ResetTimestamp(errorText) {
    if (!errorText) return null;
    var match = errorText.match(/X-RateLimit-Reset["\s:]+(\d{10,13})/);
    if (match) {
        var ts = parseInt(match[1], 10);
        // If timestamp is in seconds (10 digits), convert to milliseconds
        if (ts < 1e12) ts *= 1000;
        return ts;
    }
    return null;
}

/* ═══════════════════════════════════════════════════
   404 MODEL PRUNING
   ═══════════════════════════════════════════════════ */
function pruneDeadModel(modelId) {
    if (!modelId || !_verifiedFreeModels) return;
    var idx = _verifiedFreeModels.indexOf(modelId);
    if (idx > -1) { _verifiedFreeModels.splice(idx, 1); console.log('[MultiAgent] Pruned 404 model: ' + modelId + ' (' + _verifiedFreeModels.length + ' remaining)'); }
    if (state.verifiedFreeModelIds) { var sIdx = state.verifiedFreeModelIds.indexOf(modelId); if (sIdx > -1) state.verifiedFreeModelIds.splice(sIdx, 1); }
    try { var cached = localStorage.getItem('sai_verified_free_models'); if (cached) { var parsed = JSON.parse(cached); var cIdx = parsed.indexOf(modelId); if (cIdx > -1) { parsed.splice(cIdx, 1); localStorage.setItem('sai_verified_free_models', JSON.stringify(parsed)); } } } catch (e) {}
}

var AGENT_MODEL_PREFERENCES = {
    planner: ['mimo', 'minimax', 'qwen3', 'deepseek', 'nemotron', 'llama-4', 'gemma', 'step', 'glm'],
    coder:   ['minimax', 'qwen3', 'deepseek', 'mimo', 'llama-4', 'gemma', 'nemotron', 'step', 'glm'],
    critic:  ['nemotron', 'minimax', 'mimo', 'qwen3', 'gemma', 'deepseek', 'llama-4', 'step', 'glm'],
    tester:  ['gemma', 'qwen3', 'mimo', 'minimax', 'deepseek', 'llama-4', 'nemotron', 'step', 'glm']
};

async function fetchAvailableFreeModels() {
    if (_verifiedFreeModels && _verifiedFreeModels.length > 0) return _verifiedFreeModels;
    if (state.verifiedFreeModelIds && state.verifiedFreeModelIds.length > 0) { _verifiedFreeModels = state.verifiedFreeModelIds.slice(); return _verifiedFreeModels; }
    try { var cached = localStorage.getItem('sai_verified_free_models'); if (cached) { var parsed = JSON.parse(cached); if (parsed && parsed.length > 0) { _verifiedFreeModels = parsed; state.verifiedFreeModelIds = parsed; return _verifiedFreeModels; } } } catch (e) {}
    if (_modelFetchPromise) return _modelFetchPromise;
    _modelFetchPromise = (async function () {
        try {
            console.log('[MultiAgent] Fetching available free models from OpenRouter...');
            toast('Discovering available free models...', 'info');
            var h = { 'Content-Type': 'application/json' };
            if (state.settings.apiKey) h['Authorization'] = 'Bearer ' + state.settings.apiKey;
            var r = await fetch('https://openrouter.ai/api/v1/models', { headers: h });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            var d = await r.json();
            var allModels = d.data || [];
            for (var x = 0; x < allModels.length; x++) { if (allModels[x].context_length) state.modelContextLimits[allModels[x].id] = Math.floor(allModels[x].context_length * 3.5); }
            var trulyFree = allModels.filter(function (m) { if (!m || !m.pricing) return false; var p = m.pricing; return (p.prompt === '0' || parseFloat(p.prompt) === 0) && (p.completion === '0' || parseFloat(p.completion) === 0); });
            trulyFree.sort(function (a, b) { return (b.context_length || 0) - (a.context_length || 0); });
            _verifiedFreeModels = trulyFree.map(function (m) { return m.id; });
            state.verifiedFreeModelIds = _verifiedFreeModels;
            try { localStorage.setItem('sai_verified_free_models', JSON.stringify(_verifiedFreeModels)); } catch (e) {}
            console.log('[MultiAgent] Discovered ' + _verifiedFreeModels.length + ' free models');
            if (_verifiedFreeModels.length > 0) toast(_verifiedFreeModels.length + ' free models available', 'success');
            else { toast('No free models found — using fallbacks', 'warning'); _verifiedFreeModels = HARDCODED_FALLBACK_MODELS.slice(); }
            return _verifiedFreeModels;
        } catch (e) {
            console.error('[MultiAgent] Failed to fetch free models:', e);
            toast('Could not fetch models — using fallbacks', 'warning');
            _verifiedFreeModels = HARDCODED_FALLBACK_MODELS.slice();
            return _verifiedFreeModels;
        } finally { _modelFetchPromise = null; }
    })();
    return _modelFetchPromise;
}

function pickModelForRole(agentName, availableModels) {
    if (!availableModels || availableModels.length === 0) return null;
    var preferences = AGENT_MODEL_PREFERENCES[agentName] || AGENT_MODEL_PREFERENCES.planner;
    for (var p = 0; p < preferences.length; p++) { var pattern = preferences[p]; for (var m = 0; m < availableModels.length; m++) { var candidate = availableModels[m]; if (multiAgentState.triedModels && multiAgentState.triedModels.has(candidate)) continue; if (isRateLimited(candidate)) continue; if (candidate.toLowerCase().indexOf(pattern.toLowerCase()) > -1) return candidate; } }
    for (var i = 0; i < availableModels.length; i++) { if (multiAgentState.triedModels && multiAgentState.triedModels.has(availableModels[i])) continue; if (isRateLimited(availableModels[i])) continue; return availableModels[i]; }
    var now = Date.now(); var hasExpired = false;
    for (var rlKey in _rateLimitedModels) { if (_rateLimitedModels[rlKey] <= now) { delete _rateLimitedModels[rlKey]; hasExpired = true; } }
    if (hasExpired) return pickModelForRole(agentName, availableModels);
    console.warn('[MultiAgent] All models exhausted. Resetting tracking.');
    if (multiAgentState.triedModels) multiAgentState.triedModels.clear();
    clearRateLimits();
    return availableModels[0];
}

function getNextAvailableModel(currentModel, agentName) {
    if (!multiAgentState.triedModels) multiAgentState.triedModels = new Set();
    if (currentModel) multiAgentState.triedModels.add(currentModel);
    if (!_verifiedFreeModels || _verifiedFreeModels.length === 0) return null;
    return pickModelForRole(agentName, _verifiedFreeModels);
}

/* ═══════════════════════════════════════════════════
   AGENT DEFINITIONS
   ═══════════════════════════════════════════════════ */
export var AGENTS = {
    planner: {
        name: 'Planner',
        description: 'Task decomposition and architecture design',
        defaultModel: '',
        fallbackModels: [],
        maxTokens: 16384,
        prompt: 'You are S.ai\'s Planner agent. Your ONLY responsibility is to understand the task and create a detailed, step-by-step implementation plan.\n\nCRITICAL RULES:\n1. If a workspace file tree is provided, use it to understand the project structure\n2. Reference specific file paths in your plan\n3. Break complex tasks into 3-7 actionable steps\n4. Each step must be specific, testable, and independent\n5. Consider file structure, dependencies, and integration points\n6. Output format: EXACTLY this structure:\n\n## PLAN\n**Objective:** [Clear one-sentence goal]\n\n**Steps:**\n1. [Step 1 description - specific action, referencing actual files]\n2. [Step 2 description]\n3. ...\n\n**Files to create/modify:**\n- path/to/file.ext (purpose)\n- path/to/file.ext (purpose)\n\n**Dependencies:**\n- [List any external requirements]\n\n**Risks:**\n- [Potential issues and mitigation]\n\nNEVER write code. NEVER review code. ONLY plan.',

        parsePlan: function(text) {
            var planMatch = text.match(/##\s*PLAN([\s\S]*?)(?=##\s*(?!PLAN)|$)/i);
            if (!planMatch) planMatch = text.match(/#\s*PLAN([\s\S]*?)(?=#[^#]|$)/i);
            if (!planMatch) { if (text && text.length > 50) planMatch = [null, '\n' + text]; else return null; }
            var planText = planMatch[1];
            var objectiveMatch = planText.match(/(?:Objective|Goal|Summary|Purpose|Task)\s*[:\-]\s*(.+)/i);
            var stepsMatch = planText.match(/(?:Steps|Tasks|Actions|Implementation)\s*[:\-]?\s*([\s\S]*?)(?=Files|Dependencies|Risks|Notes|##|$)/i);
            var filesMatch = planText.match(/Files?\s*(?:to\s*)?(?:create|modify|touch|generate|output)?\s*[:\-]?\s*([\s\S]*?)(?=Dependencies|Risks|Notes|##|$)/i);
            var depsMatch = planText.match(/Dependencies?\s*[:\-]\s*([\s\S]*?)(?=Risks|Notes|##|$)/i);
            var risksMatch = planText.match(/Risks?\s*[:\-]\s*([\s\S]*?)$/i);
            var steps = [];
            if (stepsMatch) { steps = stepsMatch[1].split('\n').filter(function(l) { return l.trim().match(/^\d+[\.\)]\s*/); }).map(function(l) { return l.replace(/^\d+[\.\)]\s*/, '').trim(); }).filter(function(l) { return l.length > 0; }); }
            if (steps.length === 0 && stepsMatch) { steps = stepsMatch[1].split('\n').filter(function(l) { return l.trim().match(/^[-*]\s*/); }).map(function(l) { return l.replace(/^[-*\s]+/, '').trim(); }).filter(function(l) { return l.length > 0; }); }
            if (steps.length === 0) { steps = planText.split('\n').filter(function(l) { return l.trim().match(/^\d+[\.\)]\s+\S/); }).map(function(l) { return l.replace(/^\d+[\.\)]\s*/, '').trim(); }).filter(function(l) { return l.length > 10; }); }
            if (steps.length === 0) { steps = planText.split('\n').filter(function(l) { return l.trim().match(/^[-*]\s+\S/); }).map(function(l) { return l.replace(/^[-*\s]+/, '').trim(); }).filter(function(l) { return l.length > 10; }); }
            var files = [];
            if (filesMatch) { files = filesMatch[1].split('\n').map(function(l) { var cleaned = l.replace(/^[-*\d\.\)]+\s*/, '').trim(); cleaned = cleaned.replace(/\s*\(.*\)\s*$/, '').trim(); return cleaned; }).filter(function(l) { return l.length > 0 && l.indexOf(':') === -1 && l.length < 120; }); }
            if (files.length === 0) {
                var filePattern = planText.match(/[\w\-./]+\.(js|ts|jsx|tsx|py|java|html|css|json|md|yaml|yml|sh|sql|go|rs|cpp|c|h|rb|php|dart|kt)/gi);
                if (filePattern) { var seen = {}; for (var fi = 0; fi < filePattern.length; fi++) { var fname = filePattern[fi].trim(); if (!seen[fname] && fname.indexOf('.') > 0) { seen[fname] = true; files.push(fname); } } }
            }
            return {
                objective: objectiveMatch ? objectiveMatch[1].trim() : (multiAgentState.currentTask ? multiAgentState.currentTask.userPrompt.substring(0, 120) : 'Task implementation'),
                steps: steps, files: files,
                dependencies: depsMatch ? depsMatch[1].trim() : 'None specified',
                risks: risksMatch ? risksMatch[1].trim() : 'None identified'
            };
        }
    },

    coder: {
        name: 'Coder',
        description: 'Implementation based on plan',
        defaultModel: '',
        fallbackModels: [],
        maxTokens: 16384,
        currentModel: null,

        prompt: 'You are S.ai\'s Coder agent. You modify EXISTING files in a real project.\n\nCRITICAL RULES:\n1. You will receive the FULL current content of each file you need to modify.\n2. You MUST output the COMPLETE file with ALL existing code preserved plus your changes.\n3. NEVER invent new HTML structure, never drop existing elements, never replace a file with a different one.\n4. If adding a feature (e.g. a dropdown), ADD it to the EXISTING structure — keep everything else exactly as-is.\n5. Every existing import, function, element, and style MUST appear in your output unchanged.\n6. If a file is large, output it in full anyway — do NOT use "..." or "// rest unchanged".\n\nOUTPUT FORMAT — follow EXACTLY:\nFor EACH file, output:\n\nfile:path/to/filename.ext\nCOMPLETE file content here — every line, no omissions\n\nAfter ALL files, output: <|INTEGRATION_CHECK|>\n\nREMEMBER: You are MODIFYING existing files, not creating new ones from scratch. Preserve ALL existing code.',

        validateOutput: function(text) {
            if (!text || text.length < 50) return { valid: false, error: 'Output too short' };

            var lines = text.split('\n');
            var lazyLineCount = 0;
            for (var li = 0; li < lines.length; li++) {
                var line = lines[li].trim();
                if (line === '...' || line === '…') { lazyLineCount++; continue; }
                if ((line.startsWith('//') || line.startsWith('#') || line.startsWith('/*') || line.startsWith('*')) &&
                    /\.\.\./.test(line) &&
                    /\b(rest|unchanged|existing|same|omitted|continued|previous|unchanged code|existing code|other code|more code|etc)\b/i.test(line)) {
                    lazyLineCount++; continue;
                }
                if (/\/\/\s*\.\.\.\s*$/.test(line)) { lazyLineCount++; continue; }
                if (/#\s*\.\.\.\s*$/.test(line)) { lazyLineCount++; continue; }
            }
            if (lazyLineCount > 2) {
                return { valid: false, error: 'Lazy code detected — ' + lazyLineCount + ' lines contain abbreviated "..."' };
            }

            var fileCount = 0;

            var standardBlocks = text.match(/file:([^\n]+)\n([\s\S]*?)(?=\nfile:|<\|INTEGRATION_CHECK\|>|$)/g);
            if (standardBlocks && standardBlocks.length > 0) {
                fileCount = standardBlocks.length;
                console.log('[MultiAgent] Coder validation: ' + fileCount + ' file blocks (standard format)');
                return { valid: true, fileCount: fileCount };
            }

            var spaceBlocks = text.match(/file:\s*([^\n]+)\n([\s\S]*?)(?=\nfile:|<\|INTEGRATION_CHECK\|>|$)/g);
            if (spaceBlocks && spaceBlocks.length > 0) {
                fileCount = spaceBlocks.length;
                console.log('[MultiAgent] Coder validation: ' + fileCount + ' file blocks (space format)');
                return { valid: true, fileCount: fileCount };
            }

            var mdBlocks = text.match(/```[\w]*\s*[:/]?([^\n]*\.(js|ts|jsx|tsx|py|java|html|css|json|md|yaml|yml|sh|sql|go|rs|cpp|c|h|rb|php|dart|kt|svg))[^\n]*\n([\s\S]*?)```/g);
            if (mdBlocks && mdBlocks.length > 0) {
                fileCount = mdBlocks.length;
                console.log('[MultiAgent] Coder validation: ' + fileCount + ' file blocks (markdown+filename format)');
                return { valid: true, fileCount: fileCount };
            }

            var codeBlocks = text.match(/```[\w]*\n([\s\S]*?)```/g);
            if (codeBlocks && codeBlocks.length > 0) {
                var substantialBlocks = 0;
                for (var cb = 0; cb < codeBlocks.length; cb++) {
                    var blockContent = codeBlocks[cb].replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
                    if (blockContent.length > 100) substantialBlocks++;
                }
                if (substantialBlocks > 0) {
                    fileCount = substantialBlocks;
                    console.log('[MultiAgent] Coder validation: ' + fileCount + ' file blocks (code block format, ' + codeBlocks.length + ' total blocks)');
                    return { valid: true, fileCount: fileCount };
                }
            }

            var textWithoutMarkup = text.replace(/<[^>]+>/g, '').replace(/```/g, '').trim();
            if (textWithoutMarkup.length > 2000) {
                var codeIndicators = (textWithoutMarkup.match(/[{};]/g) || []).length;
                if (codeIndicators > 20) {
                    console.log('[MultiAgent] Coder validation: accepting raw code output (' + textWithoutMarkup.length + ' chars, ' + codeIndicators + ' code indicators)');
                    return { valid: true, fileCount: 1 };
                }
            }

            return { valid: false, error: 'No file blocks found' };
        }
    },

    critic: {
        name: 'Critic',
        description: 'Code review and quality gate',
        defaultModel: '',
        fallbackModels: [],
        maxTokens: 8192,
        prompt: 'You are S.ai\'s Critic agent - the FINAL quality gate.\n\nOutput format: EXACTLY one of these:\n\nAPPROVED\n[Brief validation]\n\nREJECTED\n[Detailed reasons, numbered]\n\nIf in doubt, REJECT.',

        parseDecision: function(text) {
            if (!text) return { approved: false, feedback: 'No response from critic' };
            var cleaned = text.trim();
            cleaned = cleaned.replace(/^<\|[^>]*\|\s*/, '');
            cleaned = cleaned.replace(/^\*{1,3}/, '');
            cleaned = cleaned.replace(/^#+\s*/, '');
            cleaned = cleaned.replace(/^`+/, '');
            cleaned = cleaned.replace(/^\[/, '');
            cleaned = cleaned.trim();
            var firstWord = cleaned.split(/[\s\n:.\-]+/)[0].toUpperCase();
            var isApproved = (firstWord === 'APPROVED' || firstWord === 'APPROVE' || firstWord === 'ACCEPT' || firstWord === 'PASS' || firstWord === 'YES');
            if (!isApproved) { var earlyText = text.substring(0, 50).toUpperCase(); isApproved = earlyText.indexOf('APPROVED') > -1; }
            var reasons = cleaned.replace(/^(APPROVED|REJECTED|APPROVE|REJECT|ACCEPT|DENY|PASS|FAIL|YES|NO)\s*/i, '').trim();
            return { approved: isApproved, feedback: reasons || (isApproved ? 'Code approved' : 'Code rejected') };
        }
    },

    tester: {
        name: 'Tester',
        description: 'Validation and testing',
        defaultModel: '',
        fallbackModels: [],
        maxTokens: 8192,
        prompt: 'You are S.ai\'s Tester agent.\n\nOutput format:\n\n## VALIDATION RESULT\nPASS | FAIL | NEEDS_REVIEW\n\n[Reasoning]',

        parseResult: function(text) {
            var resultMatch = text.match(/##\s*VALIDATION RESULT\s+(PASS|FAIL|NEEDS_REVIEW)/i);
            if (!resultMatch) { var earlyText = (text || '').substring(0, 100).toUpperCase(); if (earlyText.indexOf('PASS') > -1) return { status: 'PASS', details: text }; if (earlyText.indexOf('FAIL') > -1) return { status: 'FAIL', details: text }; }
            return { status: resultMatch ? resultMatch[1].toUpperCase() : 'UNKNOWN', details: text.replace(/## VALIDATION RESULT[\s\S]*/, '').trim() };
        }
    }
};

/* ── Multi-agent state ── */
export var multiAgentState = {
    isActive: false,
    currentAgent: null,
    currentTask: null,
    plan: null,
    coderAttempts: 0,
    maxCoderAttempts: 3,
    criticRejections: 0,
    maxCriticRejections: 3,
    conversationHistory: [],
    taskQueue: [],
    activeLoop: null,
    triedModels: new Set(),
    targetFileContents: ''
};

/* ═══════════════════════════════════════
   API HELPERS
   ═══════════════════════════════════════ */
function getApiUrl() {
    var endpoint = (state.settings.endpoint || '').replace(/\/+$/, '');
    var provider = state.settings.provider;
    if (provider === 'ollama') return endpoint + '/api/chat';
    if (provider === 'openrouter') return 'https://openrouter.ai/api/v1/chat/completions';
    if (provider === 'google-ai') return endpoint + '/chat/completions';
    return endpoint.replace(/\/v1$/, '') + '/v1/chat/completions';
}

function isOllamaProvider() { return state.settings.provider === 'ollama'; }

function buildAgentPayload(messages, model, maxTokens) {
    if (isOllamaProvider()) return { model: model, messages: messages, stream: true, options: { temperature: 0.7, num_predict: maxTokens } };
    return { model: model, messages: messages, stream: true, temperature: 0.7, max_tokens: maxTokens };
}

function buildAgentHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (state.settings.provider === 'google-ai') { if (state.settings.apiKey) h['Authorization'] = 'Bearer ' + state.settings.apiKey; }
    else if (!isOllamaProvider() && state.settings.apiKey) h['Authorization'] = 'Bearer ' + state.settings.apiKey;
    if (state.settings.provider === 'openrouter') { h['HTTP-Referer'] = window.location.href; h['X-Title'] = 'S.ai Coding Agent'; }
    return h;
}

/* ═══════════════════════════════════════════════════
   READ TARGET FILE CONTENTS

   After the Planner identifies which files to modify,
   we read the FULL content of each file so the Coder
   agent sees what it's working with instead of inventing
   new contents from scratch.
   ═══════════════════════════════════════════════════ */
async function readTargetFileContents(filePaths) {
    if (!filePaths || filePaths.length === 0) return '';
    var contents = [];
    var readCount = 0;
    for (var i = 0; i < filePaths.length; i++) {
        var path = filePaths[i].trim();
        if (!path || path.indexOf('.') === -1) continue;
        try {
            var content = await readFile(path);
            if (content && content.length > 0) {
                contents.push('--- EXISTING FILE: ' + path + ' ---\n' + content + '\n--- END FILE: ' + path + ' ---');
                readCount++;
                console.log('[MultiAgent] Read target file: ' + path + ' (' + content.length + ' chars)');
            }
        } catch (e) {
            console.warn('[MultiAgent] Could not read file: ' + path + ' — ' + (e.message || e));
        }
    }
    console.log('[MultiAgent] Read ' + readCount + '/' + filePaths.length + ' target files');
    return contents.join('\n\n');
}

/* ═══════════════════════════════════════
   SMART FILE CONTEXT
   ═══════════════════════════════════════ */
function getSmartFileContext(agentName) {
    var fullCtx = getFileContext();
    if (!fullCtx) return '';
    if (agentName === 'planner') {
        var lines = fullCtx.split('\n'); var treeLines = [];
        for (var i = 0; i < lines.length; i++) { if (lines[i].indexOf('--- FILE:') > -1) break; treeLines.push(lines[i]); }
        var tree = treeLines.join('\n').trim();
        if (tree.length < 50) return '';
        return tree + '\n\nNote: Full file contents will be provided to the Coder agent.';
    }
    if (agentName === 'coder') {
        var MAX_CODER_CTX = 80000;
        if (fullCtx.length <= MAX_CODER_CTX) return fullCtx;
        var fileSections = fullCtx.split(/(?=--- FILE: )/);
        var treeSection = '';
        if (fileSections.length > 0 && fileSections[0].indexOf('--- FILE:') === -1) { treeSection = fileSections[0]; fileSections = fileSections.slice(1); }
        var budgetRemaining = MAX_CODER_CTX - treeSection.length - 200;
        var includedFiles = [], omittedFiles = [];
        for (var fi = 0; fi < fileSections.length; fi++) {
            if (fileSections[fi].length <= budgetRemaining) { includedFiles.push(fileSections[fi]); budgetRemaining -= fileSections[fi].length; }
            else { var nm = fileSections[fi].match(/--- FILE: (.+?) ---/); omittedFiles.push(nm ? nm[1] : 'file ' + (fi + 1)); }
        }
        var result = treeSection + includedFiles.join('');
        if (omittedFiles.length > 0) result += '\n\n--- TRUNCATED: ' + omittedFiles.length + ' files omitted ---\n' + omittedFiles.join('\n');
        return result;
    }
    return '';
}

/* ═══════════════════════════════════════
   CHAT RENDERING
   ═══════════════════════════════════════ */
var AGENT_ICONS = { planner: 'fa-map', coder: 'fa-code', critic: 'fa-gavel', tester: 'fa-flask-vial', system: 'fa-flag-checkered' };
var AGENT_NAMES = { planner: 'Planner', coder: 'Coder', critic: 'Critic', tester: 'Tester', system: 'Result' };
var STATUS_HTML = {
    success: '<span style="color:#00d4aa;font-size:0.75rem;font-weight:700"><i class="fas fa-check-circle"></i> Done</span>',
    warning: '<span style="color:#f0c040;font-size:0.75rem;font-weight:700"><i class="fas fa-triangle-exclamation"></i> Rejected</span>',
    error:   '<span style="color:#ff4757;font-size:0.75rem;font-weight:700"><i class="fas fa-circle-xmark"></i> Failed</span>'
};

function scrollMessages() { var msgs = document.getElementById('messages'); msgs.scrollTop = msgs.scrollHeight; }

function showAgentWorking(agentName) {
    removeWelcome();
    var msgs = document.getElementById('messages');
    var div = document.createElement('div'); div.className = 'message bot';
    var uid = 'aw-' + agentName + '-' + Date.now(); div.id = uid;
    div.innerHTML = '<div class="msg-avatar" style="background:rgba(0,212,170,0.12)"><i class="fas ' + (AGENT_ICONS[agentName] || 'fa-robot') + '"></i></div><div class="msg-body"><div class="msg-meta"><span class="msg-name" style="color:var(--accent)">' + (AGENT_NAMES[agentName] || agentName) + ' Agent</span><span style="color:var(--yellow);font-size:0.75rem;font-weight:600"><i class="fas fa-spinner fa-spin"></i> Working...</span><span class="msg-time">' + getTimeStr() + '</span></div><div class="msg-content"><div class="typing-indicator"><span></span><span></span><span></span></div></div></div>';
    msgs.appendChild(div); scrollMessages(); return uid;
}

function removeWorking(uid) { if (!uid) return; var el = document.getElementById(uid); if (el) el.remove(); }

/* ═══════════════════════════════════════════════════
   FORMAT CODER OUTPUT — Convert file: blocks to
   markdown code fences so parseMarkdown() renders
   them with Apply buttons.
   
   The parseMarkdown() line-by-line parser tracks
   fence length and only closes on >= matching length.
   ═══════════════════════════════════════════════════ */
function formatCoderOutput(text) {
    if (!text || text.indexOf('file:') === -1) return text;

    /* Remove integration check markers */
    var cleaned = text.replace(/<\|INTEGRATION_CHECK\|>/g, '').trimEnd();

    /* Split on file: markers (must be at start of line) */
    var parts = cleaned.split(/(?=^file:)/m);
    var output = [];

    for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (!part || !part.trim()) continue;

        /* Check if this part starts with file: */
        var trimmed = part.trimStart();
        if (trimmed.startsWith('file:')) {
            /* Find the first newline — everything before is the path, after is content */
            var firstNewline = trimmed.indexOf('\n');
            if (firstNewline === -1) {
                /* Just a path with no content — skip */
                continue;
            }

            var filePath = trimmed.substring(5, firstNewline).trim();
            var content = trimmed.substring(firstNewline + 1).trimEnd();

            /* ═══════════════════════════════════════════════════════
               ADAPTIVE FENCE LENGTH
               
               If the file content contains ``` (e.g. a README.md
               with code examples), using ``` for the outer fence
               would cause the inner ``` to prematurely close the
               code block, breaking the display.
               
               Solution: count the longest backtick run in the
               content and use one more backtick for the fence.
               
               Example:
               Content has ``` → we use ```` (4 backticks)
               Content has ```` → we use ````` (5 backticks)
               
               The parseMarkdown() parser tracks fence length and
               only closes when it sees >= matching backticks, so
               ``` inside a ```` block is treated as literal text.
               ═══════════════════════════════════════════════════════ */
            var maxBackticksInContent = 0;
            var btMatches = content.match(/`{3,}/g);
            if (btMatches) {
                for (var b = 0; b < btMatches.length; b++) {
                    if (btMatches[b].length > maxBackticksInContent) {
                        maxBackticksInContent = btMatches[b].length;
                    }
                }
            }
            var fenceLen = Math.max(3, maxBackticksInContent + 1);
            var fence = '';
            for (var f = 0; f < fenceLen; f++) fence += '`';

            /* Build markdown code fence with adaptive length */
            output.push(fence + 'file:' + filePath + '\n' + content + '\n' + fence);
        } else {
            /* Non-file content (commentary, etc.) — keep as-is */
            output.push(part.trim());
        }
    }

    return output.join('\n\n');
}

/* ═══════════════════════════════════════════════════
   RENDER AGENT MESSAGE
   ═══════════════════════════════════════════════════ */
function renderAgentMessage(agentName, content, status) {
    removeWelcome();
    var msgs = document.getElementById('messages');
    var div = document.createElement('div');
    div.className = 'message bot';

    var displayContent = content;
    if (agentName === 'coder') {
        displayContent = formatCoderOutput(content);
    }

    div.innerHTML =
        '<div class="msg-avatar" style="background:rgba(0,212,170,0.12)"><i class="fas ' + (AGENT_ICONS[agentName] || 'fa-robot') + '"></i></div>' +
        '<div class="msg-body"><div class="msg-meta">' +
        '<span class="msg-name" style="color:var(--accent)">' + (AGENT_NAMES[agentName] || agentName) + ' Agent</span>' +
        (STATUS_HTML[status] || '') +
        '<span class="msg-time">' + getTimeStr() + '</span>' +
        '</div><div class="msg-content">' + parseMarkdown(displayContent) + '</div></div>';
    msgs.appendChild(div);
    highlightCodeBlocks(div);
    scrollMessages();
}

/* ═══════════════════════════════════════════════════
   TRIVIAL TASK DETECTION
   ═══════════════════════════════════════════════════ */
function isTrivialPlan(plan) {
    if (!plan) return true;
    if ((!plan.files || plan.files.length === 0) &&
        (!plan.steps || plan.steps.length === 0)) return true;
    var obj = (plan.objective || '').toLowerCase();
    if (/\b(greet|acknowledge|respond to|say hello|welcome|no files|no code|nothing to|chat|conversation)\b/i.test(obj)) return true;
    if (plan.steps && plan.steps.length <= 2 && (!plan.files || plan.files.length === 0)) return true;
    return false;
}

function isTrivialMessage(text) {
    if (!text) return true;
    var t = text.trim().toLowerCase();
    var trivial = ['hi','hello','hey','hola','yo','sup','howdy','thanks','thx','ty','ok','okay','bye','goodbye','lol','nice','cool','yes','no'];
    for (var i = 0; i < trivial.length; i++) { if (t === trivial[i]) return true; }
    return false;
}

/* ── Orchestrator ── */
export function MultiAgentOrchestrator() {
    this.agentOrder = ['planner', 'coder', 'critic', 'tester'];
    this.currentAgentIndex = 0;
    this.taskContext = null;
    this.abortController = null;
}

function getInterAgentDelay() {
    var rlCount = countRateLimitedModels();
    if (rlCount >= 5) return 8000;
    if (rlCount >= 3) return 5000;
    if (rlCount >= 1) return 3000;
    return 1500;
}

MultiAgentOrchestrator.prototype.startMultiAgentTask = async function(userPrompt) {
    if (multiAgentState.isActive) { toast('Multi-agent task already running', 'error'); return false; }

    /* ═══════════════════════════════════════════════════════
       PRE-CHECK: If the global daily limit is active, abort
       immediately with a helpful message instead of wasting
       time on requests that will all fail.
       ═══════════════════════════════════════════════════════ */
    if (isGlobalDailyLimitActive() && state.settings.provider === 'openrouter') {
        var resetDate = new Date(_globalDailyLimitReset).toLocaleTimeString();
        var limitMsg = 'Daily free model limit reached on OpenRouter. Add $10 credits to unlock 1000 requests/day, or wait until ' + resetDate + '.';
        toast(limitMsg, 'error', 10000);
        renderAgentMessage('system', '**Daily Limit Reached**\n\n' + limitMsg, 'error');
        return false;
    }

    if (isTrivialMessage(userPrompt)) {
        renderAgentMessage('system', 'Hello! 👋 How can I help you today? Give me a coding task and the multi-agent team will get to work.', 'success');
        return true;
    }

    if (state.settings.provider === 'openrouter') {
        try {
            await fetchAvailableFreeModels();
            if (_verifiedFreeModels && _verifiedFreeModels.length > 0) console.log('[MultiAgent] Using ' + _verifiedFreeModels.length + ' dynamically discovered models');
            else console.warn('[MultiAgent] No free models found');
        } catch (e) { console.warn('[MultiAgent] Model discovery failed:', e.message); }
    }

    multiAgentState.isActive = true;
    multiAgentState.triedModels = new Set();
    clearRateLimits();
    multiAgentState.targetFileContents = '';
    multiAgentState.currentTask = { id: Date.now(), userPrompt: userPrompt, startTime: Date.now(), status: 'initializing', logs: [], agentsUsed: [], coderModelsUsed: [] };
    this.abortController = new AbortController();
    this.currentAgentIndex = 0;
    this.taskContext = null;
    multiAgentState.criticRejections = 0;
    multiAgentState.coderAttempts = 0;

    setConnectionStatus('connecting', 'Multi-Agent: Starting...');

    try {
        while (multiAgentState.isActive && this.currentAgentIndex < this.agentOrder.length) {
            if (this.currentAgentIndex === 1 && multiAgentState.plan && isTrivialPlan(multiAgentState.plan)) {
                console.log('[MultiAgent] Trivial plan detected — skipping coder/critic/tester');
                toast('No code needed for this task — plan only', 'info');
                break;
            }

            if (this.currentAgentIndex > 0) {
                var delay = getInterAgentDelay();
                console.log('[MultiAgent] Waiting ' + (delay / 1000) + 's before ' + this.agentOrder[this.currentAgentIndex] + ' (rate-limited: ' + countRateLimitedModels() + ')');
                setConnectionStatus('connecting', 'Cooling down ' + (delay / 1000) + 's...');
                await this.delay(delay);
            }

            var agentName = this.agentOrder[this.currentAgentIndex];
            var prompt = (this.currentAgentIndex === 0) ? userPrompt : null;
            var result = await this.runAgent(agentName, prompt);

            if (!result) throw new Error('Agent ' + agentName + ' returned no result');
            if (!result.success) throw new Error('Agent ' + agentName + ' failed: ' + (result.error || 'no details'));

            if (agentName === 'planner' && result.plan) {
                multiAgentState.plan = result.plan;
                if (result.plan.files && result.plan.files.length > 0 && isConnected()) {
                    try {
                        multiAgentState.targetFileContents = await readTargetFileContents(result.plan.files);
                        if (multiAgentState.targetFileContents) {
                            console.log('[MultiAgent] Injected ' + multiAgentState.targetFileContents.length + ' chars of target file contents for Coder');
                            toast('Read ' + result.plan.files.length + ' target files for Coder context', 'info');
                        }
                    } catch (e) {
                        console.warn('[MultiAgent] Could not read target files:', e.message);
                    }
                }
            }

            this.currentAgentIndex++;
        }

        this.completeTask('success');
        return true;
    } catch (error) {
        console.error('Multi-agent task failed:', error);
        this.completeTask('failed', error.message);
        return false;
    }
};

MultiAgentOrchestrator.prototype.selectModelForAgent = function(agent, agentName) {
    if (state.settings.agentModels) { var configured = state.settings.agentModels[agentName]; if (configured) return ensureFreeModel(configured); }
    if (state.settings.provider !== 'openrouter') return state.settings.model;
    if (_verifiedFreeModels && _verifiedFreeModels.length > 0) {
        var dynamicModel = pickModelForRole(agentName, _verifiedFreeModels);
        if (dynamicModel) { console.log('[MultiAgent] Selected dynamic model for ' + agentName + ': ' + dynamicModel); return dynamicModel; }
    }
    return null;
};

MultiAgentOrchestrator.prototype.getNextCoderFallback = function(agent, currentModel) {
    var configuredFallback = (state.settings.agentModels || {}).coderFallback;
    if (configuredFallback && configuredFallback !== currentModel && !isRateLimited(configuredFallback)) return ensureFreeModel(configuredFallback);
    if (state.settings.provider !== 'openrouter') return null;
    var nextModel = getNextAvailableModel(currentModel, 'coder');
    if (nextModel) { console.log('[MultiAgent] Coder fallback: ' + nextModel); return nextModel; }
    return null;
};

function ensureFreeModel(model) {
    if (!model) return model;
    if (state.settings.provider !== 'openrouter') return model;
    if (model.indexOf(':free') > -1) return model;
    if (model.indexOf('/') === -1) return model;
    return model + ':free';
}

/* ═══════════════════════════════════════════════════
   RUN AGENT
   ═══════════════════════════════════════════════════ */
MultiAgentOrchestrator.prototype.runAgent = async function(agentName, customPrompt) {
    var agent = AGENTS[agentName];
    if (!agent) return { success: false, error: 'Unknown agent: ' + agentName };
    multiAgentState.currentAgent = agentName;
    setConnectionStatus('connecting', 'Multi-Agent: Running ' + agent.name + '...');
    var model = this.selectModelForAgent(agent, agentName);
    if (!model) return { success: false, error: 'No available model for ' + agentName };
    var prompt = customPrompt || this.buildAgentPrompt(agentName);
    if (this.taskContext) prompt = this.taskContext + '\n\n' + prompt;

    var result = null, lastError = 'No response from ' + agentName, attempts = 0, maxAttempts = 6;
    var workingId = showAgentWorking(agentName);

    try {
        while (attempts < maxAttempts && !(result && result.success)) {
            attempts++; lastError = 'Attempt ' + attempts + ' failed';
            try {
                result = await this.executeAgentCall(agentName, model, prompt);
                if (!result.success && !result.error) result.error = agentName + ' returned failure with no details';
                lastError = result.error || lastError;

                if (agentName === 'coder' && !result.success && attempts < maxAttempts) {
                    model = this.getNextCoderFallback(agent, model);
                    if (model) { toast('Coder failed, switching to ' + model, 'info'); continue; }
                }

                if (agentName === 'critic' && result.decision === 'REJECTED') {
                    removeWorking(workingId); workingId = null;
                    renderAgentMessage('critic', result.content, 'warning');
                    multiAgentState.criticRejections++;
                    var maxRejections = state.settings.maxCriticRejections || multiAgentState.maxCriticRejections;
                    if (multiAgentState.criticRejections >= maxRejections) {
                        if (this.taskContext && (this.taskContext.indexOf('file:') > -1 || this.taskContext.indexOf('```') > -1) && this.taskContext.length > 500) {
                            toast('Critic rejected but code exists — accepting anyway', 'info');
                            result.success = true; result.decision = 'APPROVED';
                            renderAgentMessage('critic', '**Accepted (Override)**\n\nCritic rejected but code files were produced.', 'success');
                            break;
                        }
                        toast('Critic rejected ' + maxRejections + ' times — task failed', 'error');
                        return { success: false, error: 'Critic rejected ' + maxRejections + ' times.' };
                    }
                    toast('Critic rejected — sending back to Coder', 'info');
                    this.currentAgentIndex = 1;
                    var coderPrompt = this.buildAgentPrompt('coder', null, result.feedback);
                    return await this.runAgent('coder', coderPrompt);
                }

            } catch (error) {
                lastError = error.message || error.name || String(error);
                console.warn('Agent ' + agentName + ' attempt ' + attempts + ' error:', lastError);
                if (error.name === 'AbortError') return { success: false, error: 'Task aborted by user' };

                /* ═══════════════════════════════════════════════════════
                   429 RATE LIMIT HANDLING
                   
                   Two types of 429 from OpenRouter:
                   1. Per-model rate limit → switch to another model
                   2. Global "free-models-per-day" limit → ALL models
                      are blocked until the reset time. No switching helps.
                      We extract X-RateLimit-Reset to tell the user when
                      they can resume, and abort immediately.
                   ═══════════════════════════════════════════════════════ */
                if (lastError.indexOf('HTTP 429') > -1) {
                    // Parse the exact reset timestamp from the error
                    var resetTimestamp = parse429ResetTimestamp(lastError);

                    // Detect global daily limit (account-wide, not per-model)
                    var isGlobalDailyLimit = lastError.indexOf('free-models-per-day') > -1;

                    if (isGlobalDailyLimit) {
                        // Mark ALL free models as rate-limited until the reset time
                        markGlobalDailyLimit(resetTimestamp);

                        var resetDate = resetTimestamp ? new Date(resetTimestamp).toLocaleTimeString() : 'later today';
                        var dailyLimitMsg = 'Daily free model limit reached on OpenRouter. Add $10 credits to unlock 1000 requests/day, or wait until ' + resetDate + '.';

                        toast(dailyLimitMsg, 'error', 10000);
                        result = { success: false, error: dailyLimitMsg };
                        break; // Stop retrying — no model will work
                    }

                    // Per-model rate limit — try switching models
                    var cooldownMs = resetTimestamp ? Math.max(resetTimestamp - Date.now(), 5000) : RATE_LIMIT_COOLDOWN_MS;
                    markRateLimited(model, cooldownMs);

                    var backoffDelay = Math.min(2000 * attempts, 10000);
                    console.log('[MultiAgent] 429 backoff: ' + (backoffDelay / 1000) + 's');
                    await this.delay(backoffDelay);
                    var nextOn429 = getNextAvailableModel(model, agentName);
                    if (nextOn429) { model = nextOn429; toast(agentName + ' rate-limited, switching to ' + model, 'info'); continue; }
                    var shortestWait = findShortestRateLimitWait();
                    if (shortestWait > 0 && attempts < maxAttempts) {
                        var waitSecs = Math.ceil(shortestWait / 1000);
                        toast('All models rate-limited. Waiting ' + waitSecs + 's...', 'info');
                        setConnectionStatus('connecting', 'Rate-limited — waiting ' + waitSecs + 's...');
                        await this.delay(Math.min(shortestWait, 30000));
                        clearRateLimits();
                        model = this.selectModelForAgent(agent, agentName);
                        if (model) continue;
                    }
                    result = { success: false, error: 'All models rate-limited. Try again in a few minutes.' }; break;
                }

                if (lastError.indexOf('HTTP 402') > -1 || lastError.indexOf('credits') > -1) {
                    if (model) multiAgentState.triedModels.add(model);
                    var nextOn402 = getNextAvailableModel(model, agentName);
                    if (nextOn402 && attempts < maxAttempts) { model = nextOn402; toast('Credits issue, switching to ' + model, 'info'); continue; }
                    return { success: false, error: lastError };
                }

                if (lastError.indexOf('is not a valid model ID') > -1 || lastError.indexOf('HTTP 404') > -1) {
                    if (model) multiAgentState.triedModels.add(model);
                    pruneDeadModel(model);
                    var nextOn404 = getNextAvailableModel(model, agentName);
                    if (nextOn404) { model = nextOn404; toast(agentName + ' model unavailable, switching to ' + model, 'info'); if (attempts < maxAttempts) continue; }
                    if (attempts < maxAttempts) { await this.delay(1000 * attempts); } else { result = { success: false, error: lastError }; }
                }

                if (attempts < maxAttempts && !result) { toast(agentName + ' attempt ' + attempts + ' failed, retrying...', 'info'); await this.delay(1000 * attempts); }
                else if (!result) { result = { success: false, error: lastError }; }
            }
        }

        if (!result) result = { success: false, error: lastError };
        if (result.success) {
            removeWorking(workingId); workingId = null;
            renderAgentMessage(agentName, result.content, 'success');
            this.taskContext = this.accumulateContext(agentName, result.content);
        }
    } finally { removeWorking(workingId); }
    return result;
};

function findShortestRateLimitWait() {
    var shortest = Infinity, now = Date.now();
    for (var key in _rateLimitedModels) { var remaining = _rateLimitedModels[key] - now; if (remaining > 0 && remaining < shortest) shortest = remaining; }
    return shortest < Infinity ? Math.min(shortest, 30000) : 0;
}

/* ═══════════════════════════════════════
   EXECUTE
   ═══════════════════════════════════════ */
MultiAgentOrchestrator.prototype.executeAgentCall = async function(agentName, model, prompt) {
    var self = this, agent = AGENTS[agentName], timeoutMs = 120000;
    var systemContent = agent.prompt;
    var projectCtx = document.getElementById('project-context');
    if (projectCtx && projectCtx.value.trim()) systemContent += '\n\n--- PROJECT CONTEXT ---\n' + projectCtx.value.trim() + '\n--- END CONTEXT ---';
    var fileCtx = getSmartFileContext(agentName);
    if (fileCtx) systemContent += '\n\n' + fileCtx;

    if (agentName === 'coder' && multiAgentState.targetFileContents) {
        systemContent += '\n\n--- EXISTING FILES YOU MUST MODIFY (FULL CONTENT) ---\n';
        systemContent += 'IMPORTANT: These are the CURRENT contents of files you need to modify.\n';
        systemContent += 'You MUST preserve ALL existing code and only add/modify the parts needed by the plan.\n';
        systemContent += 'Do NOT invent new structure. Do NOT drop existing elements.\n\n';
        systemContent += multiAgentState.targetFileContents;
        systemContent += '\n--- END EXISTING FILES ---';
    }

    var userMax = state.settings.maxTokens || 4096, agentBudget = agent.maxTokens || 8192;
    var startTokens = Math.max(agentBudget, Math.min(userMax, 32768));
    var fileCount = fileCtx ? (fileCtx.match(/--- FILE:/g) || []).length : 0;
    console.log('[MultiAgent] ' + agentName + ' model=' + model + ' startTokens=' + startTokens + ' fileCtx=' + fileCtx.length + ' chars ' + fileCount + ' files' + (agentName === 'coder' && multiAgentState.targetFileContents ? ' targetFileCtx=' + multiAgentState.targetFileContents.length + ' chars' : ''));
    var MAX_402_RETRIES = 4, currentTokens = startTokens;
    for (var retry402 = 0; retry402 < MAX_402_RETRIES; retry402++) {
        try {
            var result = await this._doFetch(agentName, model, systemContent, prompt, currentTokens, timeoutMs);
            if (retry402 > 0) toast(agentName + ' succeeded with ' + currentTokens + ' tokens', 'success');
            return result;
        } catch (error) {
            var errMsg = error.message || '';
            if (errMsg.indexOf('HTTP 402') > -1 && retry402 < MAX_402_RETRIES - 1) {
                currentTokens = Math.max(100, Math.floor(currentTokens / 2));
                toast('Credits low — reducing tokens to ' + currentTokens, 'info');
                await this.delay(500); continue;
            }
            throw error;
        }
    }
    throw new Error(agentName + ' failed after ' + MAX_402_RETRIES + ' attempts');
};

MultiAgentOrchestrator.prototype._doFetch = function(agentName, model, systemContent, prompt, maxTokens, timeoutMs) {
    var self = this;
    return new Promise(function(resolve, reject) {
        var timeoutId = setTimeout(function() { reject(new Error(agentName + ' timeout')); }, timeoutMs);
        var agentMessages = [{ role: 'system', content: systemContent }];
        var recentCtx = multiAgentState.conversationHistory.slice(-6);
        for (var i = 0; i < recentCtx.length; i++) agentMessages.push(recentCtx[i]);
        agentMessages.push({ role: 'user', content: prompt });
        var payload = buildAgentPayload(agentMessages, model, maxTokens);
        var headers = buildAgentHeaders();
        var url = getApiUrl();
        var useOllama = isOllamaProvider();
        var controller = new AbortController();
        var fetchTimeout = setTimeout(function() { controller.abort(); }, 110000);

        fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(payload), signal: controller.signal }).then(function(response) {
            clearTimeout(fetchTimeout); clearTimeout(timeoutId);
            if (!response.ok) {
                return response.text().then(function(errText) {
                    throw new Error('HTTP ' + response.status + ': ' + errText.substring(0, 500));
                });
            }
            var reader = response.body.getReader(),
                decoder = new TextDecoder(),
                fullContent = '',
                streamDone = false;  // ← FIX: track stream completion

            function readChunk() {
                return reader.read().then(function(result) {
                    if (result.done) {
                        finishStream();
                        return;
                    }
                    var chunk = decoder.decode(result.value, { stream: true });

                    if (useOllama) {
                        var lines = chunk.split('\n').filter(function(l) { return l.trim(); });
                        for (var i = 0; i < lines.length; i++) {
                            try {
                                var d = JSON.parse(lines[i]);
                                if (d.message && d.message.content) fullContent += d.message.content;
                                if (d.done) {
                                    streamDone = true;
                                    break;  // ← FIX: break inner loop
                                }
                            } catch (e) {}
                        }
                    } else {
                        var sseLines = chunk.split('\n');
                        for (var j = 0; j < sseLines.length; j++) {
                            if (!sseLines[j].startsWith('data:')) continue;
                            var data = sseLines[j].replace(/^data:\s*/, '').trim();

                            if (data === '[DONE]') {
                                streamDone = true;
                                break;  // ← FIX: break inner SSE loop
                            }

                            if (!data) continue;

                            try {
                                var parsed = JSON.parse(data);
                                if (!parsed.choices || !parsed.choices[0]) continue;
                                var delta = parsed.choices[0].delta;
                                var content = delta && delta.content ? delta.content : null;
                                if (content) fullContent += content;

                                /* FIX: Also break on finish_reason */
                                if (parsed.choices[0].finish_reason 
                                    && parsed.choices[0].finish_reason !== 'null') {
                                    streamDone = true;
                                    break; 
                                }
                            } catch (e) {}
                        }
                    }

                    if (streamDone) {
                        finishStream();
                        return;
                    }

                    readChunk();
                });
            }

            function finishStream() {
                multiAgentState.conversationHistory.push(
                    { role: 'user', content: prompt },
                    { role: 'assistant', content: fullContent }
                );
                if (multiAgentState.conversationHistory.length > 20) {
                    multiAgentState.conversationHistory = 
                        multiAgentState.conversationHistory.slice(-10);
                }
                resolve(self.parseAgentResult(agentName, fullContent));
            }

            readChunk();
        }).catch(function(error) {
            clearTimeout(fetchTimeout); clearTimeout(timeoutId);
            reject(error);
        });
    });
};

MultiAgentOrchestrator.prototype.parseAgentResult = function(agentName, content) {
    switch (agentName) {
        case 'planner':
            var plan = AGENTS.planner.parsePlan(content);
            if (!plan) return { success: false, content: content, agent: agentName, error: 'Planner could not extract a valid plan.' };
            if (!plan.steps || plan.steps.length === 0) return { success: false, content: content, plan: plan, agent: agentName, error: 'Plan has no actionable steps.' };
            return { success: true, content: content, plan: plan, agent: agentName };
        case 'coder':
            var validation = AGENTS.coder.validateOutput(content);
            return { success: validation.valid, content: content, fileCount: validation.fileCount, agent: agentName, error: validation.error || 'Coder validation failed' };
        case 'critic':
            var decision = AGENTS.critic.parseDecision(content);
            return { success: true, content: content, decision: decision.approved ? 'APPROVED' : 'REJECTED', feedback: decision.feedback, agent: agentName };
        case 'tester':
            var testResult = AGENTS.tester.parseResult(content);
            return { success: testResult.status === 'PASS', content: content, testStatus: testResult.status, agent: agentName, error: testResult.status !== 'PASS' ? 'Tests ' + testResult.status : null };
        default: return { success: true, content: content, agent: agentName };
    }
};

MultiAgentOrchestrator.prototype.buildAgentPrompt = function(agentName, plan, criticFeedback) {
    switch (agentName) {
        case 'planner': return 'Create an implementation plan for this task:\n\n' + (multiAgentState.currentTask ? multiAgentState.currentTask.userPrompt : 'No task');
        case 'coder':
            var prompt = 'Implement the code according to this plan:\n\n';
            if (plan) { prompt += '## PLAN\nObjective: ' + plan.objective + '\n\nSteps:\n'; for (var i = 0; i < plan.steps.length; i++) prompt += (i + 1) + '. ' + plan.steps[i] + '\n'; prompt += '\n'; if (plan.files.length) prompt += 'Files to create/modify:\n' + plan.files.join('\n') + '\n\n'; }
            if (multiAgentState.targetFileContents) {
                prompt += '## EXISTING FILES TO MODIFY (FULL CURRENT CONTENT)\n';
                prompt += 'Below is the FULL current content of each file you must modify.\n';
                prompt += 'You MUST preserve ALL existing code and only add/modify the parts needed.\n\n';
                prompt += multiAgentState.targetFileContents + '\n\n';
            }
            if (criticFeedback) prompt += '## CRITIC FEEDBACK — FIX THESE ISSUES\n' + criticFeedback + '\n\n';
            if (this.taskContext) prompt += '## WORKSPACE CONTEXT\n' + this.taskContext + '\n\n';
            prompt += 'REMEMBER: Output COMPLETE files. No "...", no "// unchanged". You are MODIFYING existing files — preserve ALL existing code, only add/change what the plan requires.\n\nUse format:\nfile:path/to/filename.ext\nCOMPLETE code here\n\nEnd with <|INTEGRATION_CHECK|>';
            return prompt;
        case 'critic':
            var cp = 'Review this code:\n\n'; if (this.taskContext) cp += this.taskContext + '\n\n'; cp += 'APPROVE if production-ready. REJECT with numbered issues if not.'; return cp;
        case 'tester': return 'Validate the code:\n\n' + (this.taskContext || 'No code') + '\n\nReport PASS/FAIL.';
        default: return multiAgentState.currentTask ? multiAgentState.currentTask.userPrompt : 'No task';
    }
};

MultiAgentOrchestrator.prototype.accumulateContext = function(agentName, content) {
    if (agentName === 'coder') {
        var fileBlocks = content.match(/file:([^\n]+)\n([\s\S]*?)(?=\nfile:|<\|INTEGRATION_CHECK\|>|$)/g) || [];
        if (fileBlocks.length > 0) {
            var filesContext = fileBlocks.map(function(block) { var lines = block.split('\n'); var filePath = lines[0].replace('file:', '').trim(); var code = lines.slice(1).join('\n'); return 'file:' + filePath + '\n' + code; }).join('\n\n');
            return '## IMPLEMENTED CODE\n' + filesContext + '\n\n';
        }
        return '## IMPLEMENTED CODE\n' + content + '\n\n';
    }
    return '## ' + agentName.toUpperCase() + ' OUTPUT\n' + content + '\n\n';
};

MultiAgentOrchestrator.prototype.completeTask = function(status, error) {
    multiAgentState.isActive = false;
    if (multiAgentState.currentTask) {
        multiAgentState.currentTask.status = status;
        multiAgentState.currentTask.endTime = Date.now();
        multiAgentState.currentTask.error = error || null;
        var duration = multiAgentState.currentTask.endTime - multiAgentState.currentTask.startTime;
        if (status === 'success') {
            toast('Multi-agent task completed in ' + (duration / 1000).toFixed(1) + 's', 'success');
            renderAgentMessage('system', '**Task Complete**\n\nAll agents finished in ' + (duration / 1000).toFixed(1) + 's.', 'success');
        } else {
            toast('Multi-agent task failed: ' + (error || 'unknown'), 'error');
            renderAgentMessage('system', '**Task Failed**\n\n' + (error || 'Unknown error'), 'error');
        }
    }
    setConnectionStatus('connected', 'Connected — ' + state.settings.model);
    removeMultiAgentStatus();
    setTimeout(function() { multiAgentState.currentTask = null; multiAgentState.conversationHistory = []; multiAgentState.criticRejections = 0; multiAgentState.coderAttempts = 0; multiAgentState.triedModels = new Set(); multiAgentState.plan = null; multiAgentState.targetFileContents = ''; }, 1000);
};

MultiAgentOrchestrator.prototype.abort = function() { if (this.abortController) this.abortController.abort(); this.completeTask('aborted', 'Task aborted by user'); };
MultiAgentOrchestrator.prototype.delay = function(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); };

export var multiAgentOrchestrator = new MultiAgentOrchestrator();

/* ── UI Integration ── */
export function startMultiAgentMode() {
    var input = document.getElementById('msg-input');
    var prompt = input.value.trim();
    if (!prompt) { toast('Enter a task description for the multi-agent team', 'error'); input.focus(); return; }
    if (!isConnected()) toast('No workspace folder connected. Agents will work without file context.', 'info');
    input.value = ''; input.style.height = 'auto'; autoResize(input);
    addUserMessage(prompt);
    showMultiAgentStatus();
    multiAgentOrchestrator.startMultiAgentTask(prompt);
}

function showMultiAgentStatus() {
    var header = document.getElementById('chat-header');
    var existing = document.getElementById('multiagent-status'); if (existing) existing.remove();
    var actionsEl = header.querySelector('.header-actions'); if (!actionsEl) return;
    var statusEl = document.createElement('div'); statusEl.id = 'multiagent-status';
    statusEl.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(0,212,170,0.1);border:1px solid rgba(0,212,170,0.2);border-radius:6px;font-size:0.75rem;color:var(--accent);font-weight:600;';
    actionsEl.insertAdjacentElement('beforebegin', statusEl);
    var updateLoop = setInterval(function() {
        if (!multiAgentState.isActive) { clearInterval(updateLoop); return; }
        var agent = multiAgentState.currentAgent ? AGENTS[multiAgentState.currentAgent] : null;
        var name = agent ? agent.name : 'Initializing';
        statusEl.innerHTML = '<i class="fas fa-network-wired" style="animation:sai-spin 1s linear infinite"></i> <span>Multi-Agent: ' + name + '</span>';
    }, 500);
}

function removeMultiAgentStatus() { var el = document.getElementById('multiagent-status'); if (el) el.remove(); }

if (!document.getElementById('sai-spin-style')) { var spinStyle = document.createElement('style'); spinStyle.id = 'sai-spin-style'; spinStyle.textContent = '@keyframes sai-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}'; document.head.appendChild(spinStyle); }