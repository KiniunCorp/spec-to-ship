# VHS tape — s2s init quick start demo
# Generate: vhs docs/demo.tape
# Requires:  brew install vhs  (needs ffmpeg + ttyd)
# Output:    docs/demo-init.gif

Output docs/demo-init.gif

Set Shell "bash"
Set FontSize 14
Set FontFamily "JetBrains Mono"
Set Theme "Dracula"
Set Width 1100
Set Height 680
Set Padding 20
Set TypingSpeed 65ms
Set PlaybackSpeed 0.9

# ── Setup: fresh git repo in /tmp (hidden from recording) ───────────────────
Hide
Type "cd /tmp && rm -rf s2s-demo && mkdir s2s-demo && cd s2s-demo && git init -q"
Enter
Sleep 800ms
Show

# ── s2s init ─────────────────────────────────────────────────────────────────
Type "s2s init"
Enter
Sleep 2000ms

# Prompt 1: "Initialize Spec-To-Ship in this project now? [Y/n]:"
Type "y"
Enter
Sleep 1200ms

# Prompt 2: "Project alias"
Type "my-project"
Enter
Sleep 1200ms

# Prompt 3: "Accept defaults?" (backup policy)
Type "y"
Enter
Sleep 4500ms

# ── Confirmation ─────────────────────────────────────────────────────────────
Sleep 2s

Type "s2s doctor"
Enter
Sleep 4500ms

Sleep 3s
