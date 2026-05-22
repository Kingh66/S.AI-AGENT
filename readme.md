```markdown
# S.ai — Autonomous AI Coding Assistant

A fully client-side, browser-based AI coding agent that plans, reads, writes, and iterates across your local codebase with zero manual intervention between steps. Built by **Sizwe Mthembu**.

**Repository**: [github.com/Kingh66/S.AI-AGENT](https://github.com/Kingh66/S.AI-AGENT)
**Live Demo**: [saiagent.netlify.app](https://saiagent.netlify.app/)

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [AI Providers](#ai-providers)
- [Modes](#modes)
- [Multi-Agent Pipeline](#multi-agent-pipeline)
- [Workspace & Context](#workspace--context)
- [Voice Chat](#voice-chat)
- [Slash Commands](#slash-commands)
- [Settings](#settings)
- [Project Architecture](#project-architecture)
- [Browser Compatibility](#browser-compatibility)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

---

## Features

- **Autonomous Multi-File Coding** — The agent analyzes your workspace, creates a structured plan, then generates complete files one at a time. No copy-pasting required — click "Apply" to write files directly to disk.

- **Local Workspace Integration** — Connect any local folder via the File System Access API. The app reads your file tree, includes relevant files in the AI context, and can write changes back.

- **Multi-Agent Pipeline** — For complex tasks, deploy a team of specialized AI agents: a **Planner** decomposes the task, a **Coder** implements it, a **Critic** reviews quality, and a **Tester** verifies correctness. Each role can use a different model.

- **6 AI Providers** — OpenRouter (recommended), Google AI Studio, Ollama, LM Studio, OpenAI, and any OpenAI-compatible endpoint.

- **Free Model Auto-Discovery** — Fetches the live list of free models from OpenRouter at runtime. When a model hits rate limits (429), the system automatically rotates to the next available free model. Global daily limits are detected instantly to avoid pointless retries.

- **Smart Context Budgeting** — Dynamically calculates how much of your workspace fits within token limits. The user's budget setting is the hard cap — the system never sends more than you can afford.

- **Target-Aware Code Modification** — When modifying existing files, the Coder agent is injected with the full current content of those files, ensuring it preserves existing code rather than inventing structure from scratch.

- **Streaming Responses** — Real-time token streaming with markdown rendering, adaptive code fences for nested blocks, and syntax highlighting via Prism.js.

- **Voice Chat** — Speech-to-text input and text-to-speech output using the Web Speech API.

- **8 Operating Modes** — Documentation Writer, Code Reviewer, Code Improver, Debug Assistant, Code Explainer, Self-Improve, System Architect, and Multi-Agent.

- **Persistent State** — Settings, runtime state, and verified free model lists survive page reloads via localStorage.

- **Safety Guards** — Blocks file writes when AI output is significantly shorter than the original (prevents accidental truncation). Dead model IDs are automatically cleaned from saved settings.

---

## How It Works

### The Agent Workflow (Custom / System Architect Mode)

When you send a coding request, the agent follows a strict 3-phase workflow:

**Phase 1: PLAN**
1. Reads all relevant workspace files
2. Outputs a structured plan with checkboxes naming exact files and changes

**Phase 2: EXECUTE**
1. Works on one file at a time
2. For modifications: shows what was read, what's changing, and why
3. For new files: explains why it's needed
4. Outputs the **complete** file — every single line
5. Marks each file as ✅ DONE before moving to the next

**Phase 3: REVIEW**
1. Lists all files ready to apply
2. Provides a summary of changes
3. User clicks "Apply" on each file to write to disk

### Context Injection

When a workspace folder is connected, the system builds a context string containing:
- File tree with sizes and modification status
- Full contents of readable files (respecting the context budget)
- System prompt and conversation history

Binary files and files over 800KB are skipped. Hidden directories (`.git`, `node_modules`, `.venv`, etc.) are excluded from scanning.

---

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/Kingh66/S.AI-AGENT.git
cd S.AI-AGENT
```

### 2. Serve the Application

This is a client-side app — it needs to be served via HTTP (not opened as a `file://` URL):

```bash
# Python 3
python -m http.server 8000

# Node.js
npx serve .

# PHP
php -S localhost:8000

# VS Code: Install "Live Server" extension → click "Go Live"
```

Open `http://localhost:8000` in Chrome or Edge.

### 3. Configure Your AI Provider

1. Click the gear icon (⚙️ Settings) in the sidebar
2. Select a provider (OpenRouter recommended for free tier)
3. Enter your API key
4. Select a model (or leave empty for auto-detect)

### 4. Connect a Workspace (Optional)

1. Click "📁 Connect Folder" in the sidebar
2. Select a local project folder
3. The app scans all files and displays them in the file tree
4. Click any file to load it into the input area

### 5. Start Coding

Type a request and press `Enter`:

```text
Build a REST API with Express.js for a todo app with CRUD operations
```

---

## AI Providers

| Provider          | Default Endpoint                     | Free Tier     | Notes                                                                                     |
|-------------------|--------------------------------------|---------------|-------------------------------------------------------------------------------------------|
| OpenRouter        | `https://openrouter.ai/api/v1`       | ✅ Yes         | Access hundreds of models through one API. Free models rotate daily.                      |
| Google AI Studio  | Generative Language API              | ✅ Yes         | Generous free tier for Gemini models. No credit card needed.                              |
| Ollama            | `http://localhost:11434`             | ✅ Unlimited   | Runs entirely on your machine. Private and free.                                          |
| LM Studio         | `http://localhost:1234`              | ✅ Unlimited   | Download and serve models locally.                                                        |
| OpenAI            | `https://api.openai.com/v1`          | ❌ Paid        | Requires paid API key.                                                                    |
| OpenAI-Compatible | `http://localhost:8080`              | Varies        | Any server with an OpenAI-compatible `/v1/chat/completions` endpoint.                     |

### Getting API Keys

- **OpenRouter**: [openrouter.ai/keys](https://openrouter.ai/keys) — free signup
- **Google AI Studio**: [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — free with Google account

---

## Modes

Each mode changes the system prompt to specialize the AI's behavior:

| Mode                 | Slash Command  | Description                                                                                          | Min Output Tokens |
|----------------------|----------------|------------------------------------------------------------------------------------------------------|-------------------|
| Documentation Writer | `/doc`         | Generates comprehensive docs: purpose, parameters, return values, examples, error handling           | 4096              |
| Code Reviewer        | `/review`      | Analyzes code for bugs, security, performance, style, best practices. Rates issues by severity.      | 4096              |
| Code Improver        | `/improve`     | Refactors code for readability, efficiency, modern patterns, error handling. Explains every change.  | 8192              |
| Debug Assistant      | `/debug`       | Systematic debugging: understand intent, trace execution, identify bug, explain root cause, fix.     | 4096              |
| Code Explainer       | `/explain`     | Breaks down complex code with high-level summary, step-by-step walkthrough, data flow, and analogies | 4096              |
| Self-Improve         | `/selfimprove` | Analyzes and improves the app's own codebase safely (preserves exports and signatures)               | 8192              |
| System Architect     | `/custom`      | Full autonomous multi-file coding agent. Plans, reads, writes, and iterates.                         | 8192              |
| Multi-Agent          | `/multiagent`  | Planner → Coder → Critic → Tester pipeline with separate models per role                             | 8192              |

---

## Multi-Agent Pipeline

When Multi-Agent mode is enabled, the task is processed by a team of specialized agents:

```text
User Request
     │
     ▼
┌──────────┐
│ Planner  │  Decomposes the task into structured steps
└────┬─────┘
     │
     ▼
┌──────────┐
│  Coder   │  Implements the plan (injected with full target file contents)
└────┬─────┘
     │
     ▼
┌──────────┐
│  Critic  │  Reviews code quality
└────┬─────┘
     │
┌────┴─────┐
│ Approved? │
└────┬─────┘
 Yes │  No (retry up to max)
     ▼
┌──────────┐
│  Tester  │  Verifies correctness
└──────────┘
```

### Agent Model Selection

Each agent role can be assigned a specific model, or left on **Auto-detect** (empty string). Auto-detect works by:

1. Fetching the live list of free models from OpenRouter's `/v1/models` API
2. Filtering for models where `pricing.prompt === '0'` and `pricing.completion === '0'`
3. Matching against preference patterns per role:

| Role     | Prefers (in order)                                                              |
|----------|---------------------------------------------------------------------------------|
| Planner  | mimo, minimax, qwen3, deepseek, nemotron, llama-4, gemma, step, glm            |
| Coder    | minimax, qwen3, deepseek, mimo, llama-4, gemma, nemotron, step, glm            |
| Critic   | nemotron, minimax, mimo, qwen3, gemma, deepseek, llama-4, step, glm            |
| Tester   | gemma, qwen3, mimo, minimax, deepseek, llama-4, nemotron, step, glm            |

### Fallback Behavior

- If the Coder fails, the Coder Fallback model is used (up to `maxCoderAttempts`, default 3)
- If the Critic rejects code, the Coder is sent back with feedback (up to `maxCriticRejections`, default 3)
- If a model returns **429 (rate limit)**, the system rotates to the next verified free model automatically
- If OpenRouter returns a **global daily limit** 429 (`free-models-per-day`), all models are marked as rate-limited until the reset timestamp, and the task fails gracefully with exact wait time
- Dead model IDs (404) are automatically pruned from the verified list and settings

---

## Workspace & Context

### Connecting a Folder

The app uses the File System Access API (Chrome/Edge only) to:
- Read files from your local project
- Write files back when you click "Apply"
- Create new folders

### What Gets Scanned

**Included**: All readable text files under 800KB

**Excluded**:
- Hidden directories (`.git`, `.vscode`, `.idea`, `.DS_Store`)
- Build directories (`node_modules`, `dist`, `build`, `.next`, `vendor`, `.venv`, `__pycache__`)
- Binary files (images, fonts, archives, executables, etc.)

### Context Budget

The context budget is the maximum characters of workspace content sent per request. This is the hard cap — the system never exceeds it regardless of the model's theoretical context window.

| Preset      | Characters | ~Tokens | Best For                                      |
|-------------|-----------|---------|-----------------------------------------------|
| Ultra Safe  | 15,000    | ~4K     | Minimal context, safest for free tiers        |
| Free Safe   | 25,000    | ~7K     | Recommended for free models                   |
| Standard    | 60,000    | ~17K    | Good for most projects                        |
| Large Folder| 120,000   | ~34K    | Bigger codebases                              |
| Maximum     | 500,000   | ~143K   | Full workspace (requires paid credits)        |

The actual context used is: `budget = maxChars - systemPrompt - conversationHistory - 2000 (overhead)`

If conversation history exceeds 70% of the budget, a warning toast is shown.

### File Tree Display

The sidebar shows:
- File names with type-specific icons (JS, Python, CSS, HTML, etc.)
- Modified files highlighted
- Binary files grayed out (not clickable)
- Click any readable file to load it into the input area

---

## Voice Chat

Powered by the Web Speech API (Chrome/Edge only):
- **Speech-to-Text**: Click the microphone button to dictate your message
- **Text-to-Speech**: Click the speaker icon on any assistant message to hear it read aloud
- **Language**: Configurable (default: `en-US`)
- **Speech Rate**: Adjustable from 0.5x to 2.0x

---

## Slash Commands

Type `/` in the input area to see available commands:

| Command       | Action                                       |
|---------------|----------------------------------------------|
| `/doc`        | Switch to Documentation Writer mode          |
| `/review`     | Switch to Code Reviewer mode                 |
| `/improve`    | Switch to Code Improver mode                 |
| `/debug`      | Switch to Debug Assistant mode               |
| `/explain`    | Switch to Code Explainer mode                |
| `/selfimprove`| Analyze and improve the app's own codebase   |
| `/custom`     | Full autonomous System Architect mode        |
| `/multiagent` | Enable multi-agent pipeline                  |

---

## Settings

Access settings via the gear icon (⚙️) in the sidebar:

| Setting         | Type     | Default    | Description                                              |
|-----------------|----------|------------|----------------------------------------------------------|
| Provider        | select   | openrouter | AI provider                                              |
| Endpoint        | text     | Provider default | API endpoint URL                                   |
| API Key         | password | empty      | Your API key                                             |
| Model           | text     | empty      | Model ID (e.g., `qwen/qwen3-235b-a22b:free`)            |
| Temperature     | range    | 0.7        | Randomness (0.0 = deterministic, 2.0 = creative)        |
| Max Tokens      | number   | 8192       | Maximum response length                                  |
| Context Budget  | range    | 25,000     | Max workspace chars per request                          |
| System Prompt   | textarea | Mode default | Custom system prompt                                   |
| Voice Language  | select   | en-US      | Speech recognition language                              |
| Voice Rate      | range    | 1.0        | Speech playback speed                                    |

### Settings Persistence

All settings are saved to `localStorage` under the key `sai_settings`. The settings version is tracked — when the app updates and the version increments, old settings are migrated automatically while preserving API keys and provider choices.

---

## Project Architecture

```text
S.AI-AGENT/
├── index.html                          # Main HTML shell
├── css/
│   ├── styles.css                      # Entry point (imports all components)
│   └── components/
│       ├── background.css              # Background effects
│       ├── boot-screen.css             # Boot animation styles
│       ├── chat.css                    # Chat area layout
│       ├── code-blocks.css             # Code block styling + Prism overrides
│       ├── input-area.css              # Textarea + send button
│       ├── message-rendering.css       # Message bubbles, markdown content
│       ├── modals.css                  # Settings/prompt/model modals
│       ├── responsive.css              # Mobile/tablet breakpoints
│       ├── sidebar.css                 # Sidebar layout, file tree
│       ├── streaming.css               # Streaming cursor animation
│       ├── toasts.css                  # Toast notification styles
│       └── voice-status.css            # Voice chat indicator
└── js/
    ├── main.js                         # Entry point, window exports
    └── modules/
        ├── boot.js                     # Boot sequence animation
        ├── commands.js                 # Slash command handlers
        ├── config.js                   # Constants, system prompts, provider defaults,
        │                               #   model lists, agent preferences, boot lines
        ├── connection.js               # API communication, streaming, rate limit
        │                               #   recovery, fallback model rotation
        ├── effects.js                  # Visual effects
        ├── events.js                   # All event listeners
        ├── filesystem.js               # File System Access API, context building,
        │                               #   file tree, safety checks
        ├── markdown.js                 # Markdown parsing (state-machine parser with
        │                               #   adaptive fence length for nested code blocks)
        ├── messages.js                 # Message rendering, code/file block buttons
        ├── modes.js                    # Mode switching logic
        ├── multiagent.js               # Multi-agent orchestration pipeline,
        │                               #   target file injection, global 429 handling
        ├── smart-context.js            # File relevance scoring
        ├── state.js                    # Central state object, runtime persistence
        ├── storage.js                  # localStorage save/load, settings migration,
        │                               #   dead model cleanup, endpoint repair
        ├── ui.js                       # Toasts, modals, settings UI, helpers
        └── voice.js                    # Web Speech API (recognition + synthesis)
```

### Module Dependencies

```text
main.js
  ├── storage.js ──▶ state.js, config.js, ui.js
  ├── state.js
  ├── events.js ──▶ (all modules via dynamic imports)
  ├── boot.js ──▶ config.js
  └── voice.js ──▶ state.js

connection.js ──▶ state.js, config.js, ui.js, storage.js
filesystem.js ──▶ state.js, ui.js
messages.js ──▶ ui.js, markdown.js
commands.js ──▶ state.js, modes.js, ui.js
multiagent.js ──▶ state.js, config.js, connection.js, filesystem.js
```

---

## Browser Compatibility

| Feature             | Chrome | Edge | Firefox | Safari |
|---------------------|--------|------|---------|--------|
| Core Chat           | ✅     | ✅   | ✅      | ✅     |
| Streaming           | ✅     | ✅   | ✅      | ✅     |
| Markdown Rendering  | ✅     | ✅   | ✅      | ✅     |
| Syntax Highlighting | ✅     | ✅   | ✅      | ✅     |
| Settings Persistence| ✅     | ✅   | ✅      | ✅     |
| File System Access  | ✅     | ✅   | ❌      | ❌     |
| Voice Chat          | ✅     | ✅   | ❌      | ❌     |

> **Recommendation**: Use Chrome or Edge for full functionality. Firefox and Safari support core chat but cannot connect local folders or use voice features.

---

## Troubleshooting

### "File access requires Chrome or Edge browser"
The File System Access API is only available in Chromium-based browsers. Use Chrome or Edge to connect local folders.

### "No API key detected — configure in settings"
1. Open Settings (gear icon)
2. Select your provider
3. Enter your API key
4. For free options: OpenRouter ([openrouter.ai/keys](https://openrouter.ai/keys)) or Google AI Studio ([aistudio.google.com/apikey](https://aistudio.google.com/apikey))

### Rate Limit Errors (429)
The app handles this automatically:
1. Enters a cooldown period
2. Tries the next verified free model
3. Detects global daily limits (`free-models-per-day`) and stops retrying to avoid wasting time
4. If all free models are exhausted, wait for the daily reset or switch to a paid provider / Ollama

### "Context filled — X/Y files included"
Your workspace exceeds the context budget. Solutions:
1. Increase the Context Budget slider in Settings (if you have paid credits)
2. Start a new chat to reduce conversation history overhead
3. Connect a smaller or more focused folder
4. Use a model with a larger context window

### "SAFETY BLOCK: Original file is X lines, but AI output is only Y lines"
The safety system detected that the AI's output is less than 30% of the original file length (for files over 20 lines). This prevents accidental data loss from truncated responses. Solutions:
1. Ask the AI to regenerate the specific file
2. Increase Max Tokens in Settings
3. Use `/continue` to get the rest of the response

### Settings Not Persisting
- Check that `localStorage` is not disabled in your browser
- Check that you're not in private/incognito mode (`localStorage` may be cleared on close)
- The app validates and repairs settings on load — corrupted values are automatically reset

### Model Not Found (404)
Dead model IDs are automatically cleaned from settings on load. If you manually entered a model that no longer exists on OpenRouter:
1. Clear the model field in Settings
2. Select a fresh model from the dropdown
3. Or leave it empty for auto-detection

---

## Development

### Adding a New Mode

1. Add the system prompt in `js/modules/config.js`:
```javascript
export const SYSTEM_PROMPTS = {
    // ...existing modes
    mymode: `You are S.ai, a specialist in...`,
};
```

2. Add mode info:
```javascript
export const MODE_INFO = {
    // ...existing modes
    mymode: { title: 'My Mode', desc: 'What it does' },
};
```

3. Optionally set a max tokens floor:
```javascript
export const MODE_MAX_TOKENS_FLOOR = {
    // ...existing modes
    mymode: 8192,
};
```

4. Add the slash command handler in `js/modules/commands.js`

### Adding a New AI Provider

1. Add provider defaults in `js/modules/config.js`:
```javascript
export const PROVIDER_DEFAULTS = {
    // ...existing providers
    myprovider: {
        endpoint: 'https://api.example.com/v1',
        hint: 'Description of this provider',
        keyPlaceholder: 'Key format hint',
        keyHint: 'Where to get the key',
    },
};
```

2. Add the option to the provider `<select>` dropdown in `index.html`

---

## License

MIT

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

Built by **Sizwe Mthembu**
```