
/* ═══════════════════════════════════════
   SMART CONTEXT — Relevance-scored file injection
   ═══════════════════════════════════════ */
import { getTree, readFile, isConnected } from './filesystem.js';

var STOP = new Set([
    'the','a','an','is','are','was','were','be','been','being','have','has','had',
    'do','does','did','will','would','could','should','may','might','shall','can',
    'to','of','in','for','on','with','at','by','from','as','into','through',
    'during','before','after','above','below','between','out','off','over','under',
    'again','further','then','once','here','there','when','where','why','how',
    'all','both','each','few','more','most','other','some','such','no','nor','not',
    'only','own','same','so','than','too','very','just','because','but','and','or',
    'if','while','about','up','it','its','this','that','these','those','i','me','my',
    'we','you','your','he','she','they','what','which','who','whom','them','their',
    'him','her','his','please','help','fix','check','look','see','want','need',
    'make','get','give','tell','show','find','try','use','work','code','file',
    'files','folder','project','whole','entire','debug','error','issue','problem',
    'thing','something','anything','now','way','going','using','doesn','didn','won',
    'getting','got','been','being','having','doing','does','done','doing'
]);

var CONFIG_FILES = new Set([
    'package.json','package-lock.json','tsconfig.json','.eslintrc','.eslintrc.json',
    '.eslintrc.js','webpack.config.js','vite.config.js','vite.config.ts',
    'next.config.js','next.config.mjs','tailwind.config.js','tailwind.config.ts',
    'postcss.config.js','requirements.txt','setup.py','pyproject.toml','Pipfile',
    'Cargo.toml','go.mod','go.sum','pom.xml','build.gradle','Makefile',
    'Dockerfile','docker-compose.yml','.env','.env.local','.env.example',
    'composer.json','Gemfile','angular.json','nuxt.config.js','svelte.config.js',
    'jest.config.js','vitest.config.js','cypress.config.js','.babelrc',
    'babel.config.js','rollup.config.js','index.html'
]);

var EXT_TOPICS = {
    js:   ['javascript','js','node','script','npm','express','react','vue'],
    mjs:  ['javascript','js','node','esm','module'],
    cjs:  ['javascript','js','node','commonjs'],
    ts:   ['typescript','ts','angular','deno'],
    tsx:  ['react','tsx','component','typescript'],
    jsx:  ['react','jsx','component'],
    py:   ['python','py','django','flask','fastapi','pip','conda'],
    java: ['java','spring','android','maven','gradle'],
    css:  ['css','style','stylesheet','tailwind','scss','sass'],
    html: ['html','template','view','page','dom'],
    json: ['json','config','data','settings'],
    sql:  ['sql','database','query','db','mysql','postgres','sqlite'],
    go:   ['go','golang'],
    rs:   ['rust','rs','cargo'],
    rb:   ['ruby','rails','sinatra'],
    php:  ['php','laravel','wordpress'],
    vue:  ['vue','vuejs','nuxt'],
    svelte:['svelte','sveltekit'],
    dart: ['dart','flutter'],
    kt:   ['kotlin','android','jetpack'],
    swift:['swift','ios','xcode'],
    c:    ['c','gcc','clang','embedded'],
    cpp:  ['c++','cpp','gcc','clang'],
    h:    ['c','c++','header','gcc'],
    sh:   ['shell','bash','script','linux','unix','zsh'],
    yml:  ['yaml','yml','config','docker','compose'],
    yaml: ['yaml','yml','config','docker','compose'],
    md:   ['readme','markdown','doc','documentation'],
    xml:  ['xml','android','manifest','svg'],
    toml: ['toml','config','cargo','pyproject'],
    graphql: ['graphql','gql','query','mutation'],
    gql:  ['graphql','gql','query','mutation']
};

var ENTRY_POINTS = new Set([
    'index.js','index.ts','index.mjs','index.jsx','index.tsx',
    'main.js','main.ts','main.py','main.go','main.rs','main.java',
    'app.js','app.ts','app.py','app.go','app.rb','app.php',
    'server.js','server.ts','server.py','server.go',
    'cli.js','cli.ts','script.js'
]);

var SOURCE_CODE_EXTS = new Set([
    'js','mjs','cjs','ts','tsx','jsx','py','java','css','html','htm',
    'json','sql','go','rs','rb','php','vue','svelte','dart','kt',
    'swift','c','cpp','h','sh','bash','yml','yaml','toml','graphql','gql'
]);

function isDebugOrReviewIntent(userMessage) {
    var t = userMessage.toLowerCase();
    var intentWords = [
        'debug', 'bug', 'bugs', 'fix', 'error', 'errors', 'issue', 'issues',
        'problem', 'problems', 'review', 'analyze', 'analyse', 'analysis',
        'check', 'inspect', 'audit', 'find', 'read', 'look', 'examine',
        'improve', 'refactor', 'optimize', 'optimise', 'cleanup', 'clean up',
        'scan', 'detect', 'identify', 'diagnose', 'troubleshoot',
        'what wrong', 'what broken', 'what error', 'what bug',
        'any issue', 'any bug', 'any problem', 'any error',
        'tell me', 'show me', 'list all', 'find all'
    ];
    for (var i = 0; i < intentWords.length; i++) {
        if (t.indexOf(intentWords[i]) > -1) return true;
    }
    /* Also detect "read this/that/the folder" or "read folder" */
    if (/\bread\s+(this|that|the|my|our|whole|entire|all)\s*(folder|project|code|files|workspace|repo|directory)/i.test(t)) return true;
    if (/\bread\s+(folder|project|code|files|workspace|repo|directory)/i.test(t)) return true;
    return false;
}

/* ═══════════════════════════════════════
   KEYWORD EXTRACTION
   ═══════════════════════════════════════ */
function extractKeywords(text) {
    var quoted = [];
    var qMatch;
    var qRe = /["'`]([^"'`]{2,80})["'`]/g;
    while ((qMatch = qRe.exec(text)) !== null) {
        quoted.push(qMatch[1].toLowerCase());
    }

    var words = text
        .toLowerCase()
        .replace(/[^a-z0-9_\-./@#]/g, ' ')
        .split(/\s+/)
        .filter(function(w) { return w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w); });

    var seen = new Set();
    var unique = [];
    for (var i = 0; i < words.length; i++) {
        if (!seen.has(words[i])) { seen.add(words[i]); unique.push(words[i]); }
    }

    return { words: unique, quoted: quoted };
}

/* ═══════════════════════════════════════
   METADATA SCORING
   ═══════════════════════════════════════ */
function scoreFileMetadata(filePath, keywords, userMessage) {
    var score = 0;
    var fileName = filePath.split('/').pop().toLowerCase();
    var fileExt = fileName.split('.').pop();
    var lowerPath = filePath.toLowerCase();
    var lowerMsg = userMessage.toLowerCase();

    if (CONFIG_FILES.has(fileName)) score += 5;
    if (ENTRY_POINTS.has(fileName)) score += 3;

    for (var i = 0; i < keywords.words.length; i++) {
        var kw = keywords.words[i];
        if (fileName.includes(kw)) score += 15;
        if (lowerPath.includes('/' + kw + '/') || lowerPath.includes('/' + kw + '-') || lowerPath.startsWith(kw + '/')) {
            score += 8;
        }
    }

    var topics = EXT_TOPICS[fileExt] || [];
    for (var t = 0; t < topics.length; t++) {
        if (lowerMsg.includes(topics[t])) { score += 4; break; }
    }

    if ((fileName.includes('.test.') || fileName.includes('.spec.') || fileName.includes('_test.') || fileName.includes('_spec.')) &&
        keywords.words.some(function(kw) { return fileName.includes(kw); })) {
        score += 10;
    }

    return score;
}

/* ═══════════════════════════════════════
   CONTENT SCORING
   ═══════════════════════════════════════ */
function scoreFileContent(filePath, content, keywords, userMessage) {
    if (!content) return 0;
    var score = 0;
    var lowerContent = content.toLowerCase();

    for (var q = 0; q < keywords.quoted.length; q++) {
        var qs = keywords.quoted[q];
        if (qs.length > 3 && lowerContent.includes(qs)) {
            score += 25;
        }
    }

    for (var k = 0; k < keywords.words.length; k++) {
        var word = keywords.words[k];
        if (word.length < 3) continue;
        var count = 0;
        var idx = 0;
        while ((idx = lowerContent.indexOf(word, idx)) !== -1) {
            count++;
            idx += word.length;
            if (count > 20) break;
        }
        score += Math.min(count * 0.4, 6);
    }

    var nameCandidates = userMessage.match(/\b([a-zA-Z_][a-zA-Z0-9_]{2,})\b/g) || [];
    var nameSeen = new Set();
    for (var n = 0; n < nameCandidates.length; n++) {
        var name = nameCandidates[n];
        if (name.length < 3 || STOP.has(name.toLowerCase()) || nameSeen.has(name)) continue;
        nameSeen.add(name);
        var nameLower = name.toLowerCase();

        if (lowerContent.indexOf('function ' + nameLower) > -1 ||
            lowerContent.indexOf('class ' + nameLower) > -1 ||
            lowerContent.indexOf('const ' + nameLower + ' =') > -1 ||
            lowerContent.indexOf('let ' + nameLower + ' =') > -1 ||
            lowerContent.indexOf('var ' + nameLower + ' =') > -1 ||
            lowerContent.indexOf('def ' + nameLower) > -1 ||
            lowerContent.indexOf('async function ' + nameLower) > -1 ||
            lowerContent.indexOf('export function ' + nameLower) > -1 ||
            lowerContent.indexOf('export default function ' + nameLower) > -1 ||
            lowerContent.indexOf('export const ' + nameLower) > -1) {
            score += 14;
        }
    }

    return score;
}

/* ═══════════════════════════════════════
   IMPORT GRAPH
   ═══════════════════════════════════════ */
function buildImportMap(contentMap) {
    var imports = {};
    var paths = Object.keys(contentMap);

    for (var i = 0; i < paths.length; i++) {
        var path = paths[i];
        var content = contentMap[path];
        if (!content) continue;

        var deps = [];

        var jsImp = content.match(/(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g);
        if (jsImp) {
            for (var j = 0; j < jsImp.length; j++) {
                var m = jsImp[j].match(/['"]([^'"]+)['"]/);
                if (m) {
                    var resolved = m[1]
                        .replace(/^\.\//, '')
                        .replace(/^\.\.\//, '')
                        .replace(/\/index(\.js|\.ts|\.jsx|\.tsx)?$/, '')
                        .replace(/(\.js|\.ts|\.jsx|\.tsx)$/, '');
                    deps.push(resolved);
                }
            }
        }

        var pyImp = content.match(/^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm);
        if (pyImp) {
            for (var p = 0; p < pyImp.length; p++) {
                var pm = pyImp[p].match(/(?:from|import)\s+([\w.]+)/);
                if (pm) deps.push(pm[1].replace(/\./g, '/'));
            }
        }

        var goImp = content.match(/import\s+\(?[^)]*"([^"]+)"/g);
        if (goImp) {
            for (var g = 0; g < goImp.length; g++) {
                var gm = goImp[g].match(/"([^"]+)"/);
                if (gm) deps.push(gm[1].split('/').pop());
            }
        }

        imports[path] = deps;
    }

    return imports;
}

function applyImportBoost(scores, importMap) {
    var paths = Object.keys(scores);
    for (var i = 0; i < paths.length; i++) {
        var fromPath = paths[i];
        if ((scores[fromPath] || 0) < 12) continue;

        var deps = importMap[fromPath] || [];
        for (var d = 0; d < deps.length; d++) {
            var dep = deps[d];
            if (dep.length < 2) continue;
            for (var j = 0; j < paths.length; j++) {
                var toPath = paths[j];
                if (toPath === fromPath) continue;
                if (toPath.toLowerCase().includes(dep.toLowerCase()) ||
                    dep.toLowerCase().endsWith(toPath.split('/').pop().replace(/\.\w+$/, ''))) {
                    scores[toPath] = (scores[toPath] || 0) + Math.min((scores[fromPath] || 0) * 0.25, 5);
                    break;
                }
            }
        }
    }
}

/* ═══════════════════════════════════════
   MAIN EXPORT — async
   ═══════════════════════════════════════ */
export async function getSmartFileContext(userMessage, maxChars) {
    if (!isConnected()) return '';

    maxChars = maxChars || 25000;
    var tree = getTree();
    var readableFiles = tree.filter(function(f) { return f.hasContent; });

    if (readableFiles.length === 0) return '';

    var projectName = 'project';
    if (readableFiles.length > 0) {
        var firstSegment = readableFiles[0].path.split('/')[0];
        if (firstSegment) projectName = firstSegment;
    }

    /* ≤3 files: send all */
    if (readableFiles.length <= 3) {
        return await buildRawContext(readableFiles, maxChars, projectName);
    }

    var isDebugIntent = isDebugOrReviewIntent(userMessage);

    /* Phase 1: Score by metadata */
    var keywords = extractKeywords(userMessage);
    var scores = {};

    for (var i = 0; i < readableFiles.length; i++) {
        var filePath = readableFiles[i].path;
        var fileName = filePath.split('/').pop().toLowerCase();
        var fileExt = fileName.split('.').pop();

        scores[filePath] = scoreFileMetadata(filePath, keywords, userMessage);

        if (isDebugIntent && SOURCE_CODE_EXTS.has(fileExt)) {
            scores[filePath] += 50;

            /* Extra boost for JS/TS modules — they contain the actual logic */
            if (['js','mjs','cjs','ts','tsx','jsx','py','java','go','rs','rb','php'].indexOf(fileExt) > -1) {
                scores[filePath] += 20;
            }

            /* Extra boost for entry points */
            if (ENTRY_POINTS.has(fileName)) {
                scores[filePath] += 15;
            }

            /* Extra boost for config files */
            if (CONFIG_FILES.has(fileName)) {
                scores[filePath] += 10;
            }
        }

        /* ── FIX: Penalize binary/asset files for debug intent ── */
        if (isDebugIntent && !SOURCE_CODE_EXTS.has(fileExt)) {
            scores[filePath] -= 10;
        }
    }

    /* Phase 2: Read content for top candidates, re-score with content */
    var sorted = readableFiles.slice().sort(function(a, b) {
        return (scores[b.path] || 0) - (scores[a.path] || 0);
    });

    var candidateCount = isDebugIntent
        ? Math.min(sorted.length, 40)
        : Math.min(sorted.length, 20);
    var contentMap = {};

    for (var c = 0; c < candidateCount; c++) {
        var content = await readFile(sorted[c].path);
        if (content) {
            contentMap[sorted[c].path] = content;
            scores[sorted[c].path] += scoreFileContent(sorted[c].path, content, keywords, userMessage);
        }
    }

    /* Phase 3: Import graph boost */
    var importMap = buildImportMap(contentMap);
    applyImportBoost(scores, importMap);

    /* Phase 4: Final sort */
    sorted.sort(function(a, b) {
        return (scores[b.path] || 0) - (scores[a.path] || 0);
    });

    /* Build relevance-sorted tree header */
    var header = '--- WORKSPACE: ' + projectName + ' [sorted by relevance to your message] ---\n';
    for (var h = 0; h < sorted.length; h++) {
        var sc = Math.round(scores[sorted[h].path] || 0);
        var icon = sc >= 20 ? '>>>' : sc >= 12 ? '>>' : sc >= 5 ? '>' : ' ';
        header += icon + ' [' + sc + '] ' + sorted[h].path + '\n';
    }
    header += '---\n';

    var effectiveMaxChars = maxChars;
    if (isDebugIntent) {
        effectiveMaxChars = Math.max(maxChars, 80000);
        console.log('[SmartContext] Debug/review intent detected — expanded budget to ' + effectiveMaxChars + ' chars');
    }

    /* Fill budget with top-scoring files */
    var context = header;
    var used = context.length;
    var included = 0;
    var omitted = [];

    for (var s = 0; s < sorted.length; s++) {
        var file = sorted[s];
        var fileContent = contentMap[file.path];
        if (!fileContent) {
            fileContent = await readFile(file.path);
        }
        if (!fileContent) continue;

        var overhead = file.path.length + 50;
        if (used + fileContent.length + overhead > effectiveMaxChars) {
            if (isDebugIntent && fileContent.length > 5000) {
                var truncatedContent = fileContent.substring(0, Math.min(fileContent.length, effectiveMaxChars - used - overhead - 200));
                if (truncatedContent.length > 500) {
                    context += '\n--- FILE: ' + file.path + ' [TRUNCATED to ' + truncatedContent.length + ' of ' + fileContent.length + ' chars] ---\n' + truncatedContent + '\n\n// ... [file truncated, ' + Math.round((1 - truncatedContent.length / fileContent.length) * 100) + '% omitted] ...\n--- END FILE ---\n';
                    used += truncatedContent.length + overhead + 200;
                    included++;
                    continue;
                }
            }
            omitted.push(file.path);
            continue;
        }

        context += '\n--- FILE: ' + file.path + ' ---\n' + fileContent + '\n--- END FILE ---\n';
        used += fileContent.length + overhead;
        included++;
    }

    if (omitted.length > 0) {
        context += '\n[OMITTED ' + omitted.length + ' files. ';
        context += 'Included: ' + included + '/' + readableFiles.length + '. ';
        context += 'Omitted: ' + omitted.slice(0, 8).join(', ');
        if (omitted.length > 8) context += ' +' + (omitted.length - 8) + ' more';
        context += ']';
    }

    console.log('[SmartContext] Final context: ' + context.length + ' chars, ' + included + '/' + readableFiles.length + ' files included, intent=' + (isDebugIntent ? 'debug/review' : 'general'));

    return context;
}

async function buildRawContext(files, maxChars, projectName) {
    var ctx = '--- WORKSPACE: ' + (projectName || 'project') + ' ---\n';
    var used = ctx.length;

    for (var i = 0; i < files.length; i++) {
        var content = await readFile(files[i].path);
        if (!content) continue;
        var overhead = files[i].path.length + 40;
        if (used + content.length + overhead > maxChars) break;
        ctx += '\n--- FILE: ' + files[i].path + ' ---\n' + content + '\n--- END FILE ---\n';
        used += content.length + overhead;
    }
    return ctx;
}