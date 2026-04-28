Output "/Users/gustavochiriboga/repos/personal/spec-to-ship/docs/demo-tree.gif"

Set Shell "bash"
Set FontSize 14
Set Theme { "name": "s2s", "background": "#131822", "foreground": "#56AA8C", "selection": "#3d3c58", "cursor": "#b3b0d6" }
Set Width 700
Set Height 600
Set Padding 10
Set TypingSpeed 65ms
Set PlaybackSpeed 0.9
Set WindowBar Colorful

# ── Show current directory so context is clear ───────────────────────────────
Type "ls -a"
Enter
Sleep 1s
Type "tree .s2s"
Enter
Sleep 5s
