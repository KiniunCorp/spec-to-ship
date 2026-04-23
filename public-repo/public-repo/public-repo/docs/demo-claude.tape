# VHS tape — s2s + Claude Code integration demo
# Generate:  vhs docs/demo-claude.tape
# Requires:
#   - vhs installed: brew install vhs
#   - Claude Code CLI: npm install -g @anthropic-ai/claude-code
#   - ANTHROPIC_API_KEY set in environment
# Output:    docs/demo-claude.gif
#
# What this shows:
#   1. A project already initialized with s2s init
#   2. claude launches — reads .s2s/guardrails/CLAUDE.md automatically
#   3. User types a plain request; Claude Code calls s2s request and routes it

Output docs/demo-claude.gif

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
Type "cd /tmp && rm -rf s2s-claude-demo && mkdir s2s-claude-demo && cd s2s-claude-demo && git init -q"
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

# ── Launch Claude Code ────────────────────────────────────────────────────────
# Claude Code reads CLAUDE.md + .s2s/guardrails/CLAUDE.md at session start
Type "claude"
Enter
Sleep 4000ms

# ── First request — Claude Code routes it through s2s automatically ───────────
Type "add rate limiting to the API"
Enter
Sleep 12000ms

Sleep 4s
