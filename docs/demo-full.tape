Output "/Users/gustavochiriboga/repos/personal/spec-to-ship/docs/demo-full.mp4"

Set Shell "bash"
Set FontSize 14
Set Theme { "name": "s2s", "background": "#131822", "foreground": "#56AA8C", "selection": "#3d3c58", "cursor": "#b3b0d6" }
Set Width 1100
Set Height 720
Set Padding 10
Set TypingSpeed 65ms
Set PlaybackSpeed 0.9
Set WindowBar Colorful

# ── s2s init ─────────────────────────────────────────────────────────────────
Type "s2s init"
Enter
Sleep 2s

Enter
Sleep 1500ms

Enter
Sleep 1500ms

Enter
Sleep 1500ms

Enter
Sleep 5s

# ── tree ───────────────────────────────
Type "ls -a"
Enter
Sleep 1s

Type "tree .s2s"
Enter
Sleep 5s

# ── Status ─────────────────────────────────────────────────────────────
Type "s2s status"
Enter
Sleep 6s

# ── Doctor ─────────────────────────────────────────────────────────────
Type "s2s doctor"
Enter
Sleep 6s

# ── Launch Claude Code ────────────────────────────────────────────────────────
# Claude Code reads CLAUDE.md + .s2s/guardrails/CLAUDE.md at session start
Type "claude"
Enter
Sleep 2s

# ── First request — Claude Code routes it through s2s automatically ───────────
Type "I want to create a new dog training website"
Enter
Sleep 14s
Enter
Sleep 7s
Enter
Sleep 7s
Enter
Sleep 23s
Enter
Sleep 5s
Enter
Sleep 14s