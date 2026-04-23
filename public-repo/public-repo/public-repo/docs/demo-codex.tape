# VHS tape — s2s + Codex CLI integration demo
# Generate:  vhs docs/demo-codex.tape
# Requires:
#   - vhs installed: brew install vhs
#   - Codex CLI: npm install -g @openai/codex
#   - OPENAI_API_KEY set in environment
# Output:    docs/demo-codex.gif
#
# What this shows:
#   1. A project already initialized with s2s init
#   2. codex launches — reads CODEX.md + .s2s/guardrails/CODEX.md automatically
#   3. User types a plain request; Codex calls s2s request and routes it

Output docs/demo-codex.gif

Set Shell "bash"
Set FontSize 14
Set FontFamily "JetBrains Mono"
Set Theme "Dracula"
Set Width 1100
Set Height 720
Set Padding 20
Set TypingSpeed 70ms
Set PlaybackSpeed 0.9

# ── Setup: init a project (hidden — main demo is the chat session) ───────────
Hide
Type "cd /tmp && rm -rf s2s-codex-demo && mkdir s2s-codex-demo && cd s2s-codex-demo && git init -q"
Enter
Sleep 500ms
Type "printf 'y\nmy-project\ny\n' | s2s init"
Enter
Sleep 8000ms
Type "clear"
Enter
Sleep 400ms
Show

# ── Show current directory so context is clear ───────────────────────────────
Type "ls .s2s/guardrails/"
Enter
Sleep 1500ms

Type "clear"
Enter
Sleep 300ms

# ── Launch Codex ──────────────────────────────────────────────────────────────
# Codex reads CODEX.md + .s2s/guardrails/CODEX.md at session start
Type "codex"
Enter
Sleep 4000ms

# ── First request — Codex routes it through s2s automatically ────────────────
Type "add rate limiting to the API"
Enter
Sleep 12000ms

Sleep 4s
