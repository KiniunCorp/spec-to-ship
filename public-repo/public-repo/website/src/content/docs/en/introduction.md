---
title: "Introduction"
description: "s2s is a CLI tool that adds structure, governance, and state management to AI-assisted software development alongside Claude Code and Codex."
---

## The problem with ungoverned AI development

AI coding tools are fast. That is genuinely useful. But fast and ungoverned is a combination that creates a specific kind of debt.

You ask your AI assistant to "add the login feature." Two hours later there is a 400-line PR with a database migration, three new API endpoints, and no tests. Nobody planned this. Nobody approved it. The reasoning that led to it is gone — it lived in a chat window that has since been closed or compacted.

Now multiply that across a team. Across a quarter. Across a codebase that is moving faster than anyone can review.

The bottleneck is no longer writing code. It is governing what the AI produces.

## What s2s is

Spec-To-Ship (`s2s`) is a CLI tool that sits between your AI client and your codebase. It handles orchestration — intent classification, stage routing, state management, quality checks, approval gates — entirely inside the binary, spending zero AI tokens on governance overhead.

When you send a request, s2s figures out what kind of work it is and plans the minimum set of stages that request actually needs. A bug fix routes straight to engineering. A new feature goes through product, design, and engineering — in that order, with your review at each handoff. The orchestrator decides. You approve. The AI generates. Nothing ships without a deliberate decision.

Every request produces a persistent record: what was asked, how it was classified, what stages ran, what artifacts were produced, who approved what. Close the chat window. Come back a week later. The state is exactly where you left it.

## Who it is for

If you use Claude Code, Codex, or any AI coding client and you have started to notice that the output is fast but hard to reason about, hard to review, or hard to explain to anyone else — s2s is built for you.

More specifically:

**Solo developers and technical founders** who ship with AI every day and want the output to be something they can stand behind. The audit trail matters. The scope boundaries matter. The paper trail that a future team member or investor can read matters.

**Small engineering teams** (roughly 3–30 people) who have adopted AI tooling and are starting to feel the consequences of inconsistent, ungoverned output: PRs no one fully understands, features that grew beyond their scope, no record of what was actually decided.

**Engineering leads** who need to introduce AI tooling without surrendering the process controls their team already relies on — approvals, documented decisions, reviewable artifacts before code runs.

The common thread is people who find AI coding tools genuinely useful and want the output to be something they can trust in production.

## How it works at a high level

You initialize s2s once in your project with `s2s init`. It sets up a `.s2s/` workspace, installs governance files that your AI client reads automatically at the start of every session, and registers the project. This takes a few minutes and does not change any existing code.

From there, you work inside your AI chat the same way you always have. The difference is that s2s is handling everything underneath: classifying what you asked for, routing it through the right stages, packaging exactly the context the AI needs for each stage, checking the artifact quality when it is submitted, managing the approval gates, running code changes in isolated git worktrees so your main branch stays clean.

The AI generates the artifacts. s2s runs the process. You make the decisions.

## What makes this different from just using an AI client directly

The key difference is that s2s makes orchestration decisions locally, in the binary, at zero token cost. Your AI chat budget goes entirely to generating PRDs, technical specs, and code — not to figuring out what stage to run next, reconstructing what was decided in a prior session, or reasoning about whether this request needs a design review.

The governance is also real. s2s writes governance files into `.s2s/guardrails/` and root compatibility shims (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`). Your AI client reads these files automatically at the start of every session. The AI's behavior is shaped by versioned, conflict-detected governance — not a prompt you paste into a chat and hope persists.

And the state persists. The conversation window is not the source of truth. `.s2s/` is.

## Where to go next

If you are ready to set up your first project, go to [Quick Start](/en/quickstart/).

If you want to understand the workflow before you install anything, read [Chat-Native Workflow](/en/chat-native-workflow/).

If you want the technical details on how the pieces fit together, see [Technical Architecture](/en/technical-architecture/).
