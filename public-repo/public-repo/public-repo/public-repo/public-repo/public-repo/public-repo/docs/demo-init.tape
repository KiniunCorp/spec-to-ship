# VHS tape — s2s init quick start demo
# Generate: vhs docs/demo.tape
# Requires:  brew install vhs  (needs ffmpeg + ttyd)
# Output:    docs/demo-init.gif

Output "/Users/gustavochiriboga/repos/personal/spec-to-ship/docs/demo-init.gif"

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

# Prompt 1: "Initialize Spec-To-Ship in this project now? [Y/n]:"
Enter
Sleep 1500ms

# Project root path
Enter
Sleep 1500ms

# Prompt 2: "Project alias"
Enter
Sleep 1500ms

# Prompt 3: "Accept defaults?" (backup policy)
Enter
Sleep 5s
