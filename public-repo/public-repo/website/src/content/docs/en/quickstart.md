---
title: "Quick Start"
description: "Initialize a project with s2s init, then work from your AI chat client using intent-driven stage routing and isolated execution workspaces."
---

This guide gets you from zero to a running s2s project in about ten minutes. By the end, you will have initialized a project, opened your AI chat session with s2s governance active, and submitted your first work request.

## Step 1: Install s2s

```bash
brew install kiniuncorp/tap/s2s
```

Verify the install:

```bash
s2s --version
```

If you do not use Homebrew, see [Manual Setup](/en/manual-setup/).

## Step 2: Make sure your AI client is ready

s2s works with Claude Code and Codex CLI. You need at least one of them installed and authenticated before running `s2s init`.

```bash
# Verify Claude Code is available
claude --version

# Or verify Codex
codex --version
```

If neither is installed, install and authenticate one now. s2s will ask you which client to use during initialization.

## Step 3: Initialize your project

Navigate to your application's root directory — the same place your `package.json`, `go.mod`, or equivalent lives.

```bash
cd /path/to/your-app
s2s init
```

The guided setup asks you a few questions:

- Which AI client to use (Claude Code or Codex)
- Whether to use CLI mode or desktop app mode
- Your preferred execution settings

When it finishes, s2s has created a `.s2s/` workspace in your project directory. This is where all project state, artifacts, and governance files live. It also writes three files to your project root: `AGENTS.md`, `CLAUDE.md`, and `CODEX.md`. These are governance shims — your AI client reads them automatically at the start of every session.

Your existing code is untouched.

## Step 4: Open your AI chat session

```bash
s2s
```

This launches your configured AI client against the current project. At startup, s2s prints a session banner showing the project, the active client, and the current state.

```
[s2s] session started · project: your-app · client: claude-cli · status: none
```

`status: none` means there is no active work. You are ready to submit your first request.

If you prefer to open the desktop app instead of the CLI, s2s will show you guidance for that too. Either way, the governance files your AI client reads are identical — the session behavior is the same.

## Step 5: Submit your first work request

Inside your AI chat session, tell the AI to submit a request. You can phrase it naturally:

> "Submit a request to add rate limiting to the API."

Your AI client will run:

```bash
s2s request "add rate limiting to the API"
```

The orchestrator classifies the intent, selects the minimum stage route, and tells you exactly what happens next:

```
[s2s] request received
intent: new_feature · confidence: 0.91
route: pm → design → engineering → engineering_exec
approval required: yes (before engineering_exec)

next: s2s stage pm
```

For a new feature, s2s plans a full route: product requirements, design, engineering spec, then execution. For a bug fix, it would route straight to engineering. The orchestrator decides based on what you asked.

## Step 6: Work through the stages

Each stage follows the same two-step pattern.

**First, get the task package:**

```bash
s2s stage pm
```

s2s outputs a structured task package — objective, prior context, artifact requirements, exact file path to write. No LLM call is made. This runs in the binary at zero token cost.

Your AI reads the task package and generates the artifact (in this case, a PRD at the specified path). Then it submits:

```bash
s2s stage pm --submit
```

s2s reads the artifact, checks quality, advances the project state, and tells you what comes next:

```
[s2s] pm submitted · quality 91% · next: s2s stage design
```

Repeat for each stage in the route. When a stage requires human review, s2s creates an approval gate and pauses:

```
[s2s] pm submitted · quality 88% · gate created (gate_abc123)
waiting for: s2s approve gate_abc123
```

You review the artifact, then run:

```bash
s2s approve gate_abc123
```

Work resumes.

## Step 7: Check state any time

If you ever lose track of where things are — session restarted, long break, scrolled context — read the live state file:

```bash
cat .s2s/live.md
```

This file is always current. It shows the active feature, current stage, status, and exactly what to do next. You do not need to re-run commands or reconstruct context from the chat history.

You can also run:

```bash
s2s status        # human-readable project state
s2s show change   # the active change and its route
s2s show slices   # execution slices and their status
s2s doctor        # validate configuration and guardrail consistency
```

## What happens during engineering execution

When engineering execution runs (`s2s stage engineering_exec`), s2s creates an isolated git worktree — a separate working directory on a dedicated branch. The AI agent implements the code there. Your main working directory is untouched until you review and merge.

Branches follow the pattern `s2s-<provider>/<change-id>`:

```
s2s-claude/add-rate-limiting
s2s-codex/add-rate-limiting
```

After execution, s2s records the result, updates the live state, and tells you whether to open a PR or whether there is more work to do.

## Troubleshooting

**`No local .s2s context found`** — Run the command from inside your project directory, or pass the project name explicitly: `s2s status my-project`.

**`Command not found in PATH: claude`** — Install and authenticate Claude Code before running s2s.

**`stage blocked by strict guardrail policy`** — Run `s2s doctor` to see what conflicts exist. Resolve them or switch to `warn` mode temporarily with `s2s config edit`.

**Orchestrator routing looks wrong** — Re-submit with a clearer prompt: `s2s request "..."`. The orchestrator uses keyword signals; more specific language helps classification.

For more, see the full troubleshooting reference in [Operations & Security](/en/technical-operations-security/).
