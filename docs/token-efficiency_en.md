# Token Efficiency

## The overhead problem

When an AI coding session runs without external orchestration, the AI spends tokens on things that aren't artifact generation:

- "What stage am I in?" — re-reading prior conversation to reconstruct state
- "What has been decided so far?" — re-summarizing prior specs and decisions
- "What command should I run next?" — reasoning about workflow position
- "Did that artifact get recorded?" — uncertainty about whether prior work persists

In a typical unguided session for a feature that goes through PM → Engineering, a large fraction of the AI's token budget goes to orientation and workflow reasoning rather than to the PRD or TechSpec itself.

## What s2s handles in the binary (zero tokens)

Every operation that s2s performs in the CLI binary costs zero AI tokens:

| Operation | Token cost |
|-----------|-----------|
| Intent classification | 0 |
| Stage route planning | 0 |
| Stage context package construction | 0 |
| `.s2s/live.md` state update | 0 |
| Artifact quality assessment | 0 |
| Ledger advancement | 0 |
| Gate creation and lifecycle | 0 |
| Worktree setup and isolation | 0 |
| Git delivery (branch, push, PR) | 0 |

## What the AI handles (focused tokens)

Each stage gives the AI a context package with exactly what it needs. The AI's job in each stage is narrow and well-defined:

| Stage | AI's task | Token efficiency |
|-------|-----------|-----------------|
| `pm` | Write PRD.md from the context package | High: no state reconstruction needed |
| `research` | Write Research.md with focused investigation | High: prior decisions are in the package |
| `design` | Write PrototypeSpec.md | High: PRD and research are summarized |
| `engineering` | Write TechSpec.md + Backlog.md | High: full prior context delivered |

The AI doesn't need to remember where it is in the workflow. It reads the context package, generates the artifact, and submits. `live.md` holds the state between stages.

## Approximate comparison

For a medium-complexity feature going through `pm → engineering`:

**Without s2s (unguided session):**
- Tokens to orient at session start: ~500–1000
- Tokens per stage to reconstruct prior decisions: ~300–800
- Tokens on workflow reasoning: ~200–500 per stage
- Total overhead: ~1500–3000 tokens for two stages

**With s2s (chat-native):**
- Orientation: read `live.md` (~150 tokens)
- Per stage: receive focused context package, generate artifact
- Total overhead: ~200 tokens across both stages

The difference scales with project complexity. Long-running projects with many prior decisions benefit most — the AI never needs to re-read the full conversation history because `live.md` and the context package contain exactly what's needed.

## Configuring quality threshold

Quality checks run on `--submit`. The threshold controls when auto-approve fires vs. when a review gate is created:

```json
{
  "quality": {
    "enabled": true,
    "minAutoApproveScore": 0.85,
    "blockOnFailure": false
  }
}
```

- `minAutoApproveScore`: 0.0–1.0. Default 0.85. Scores below this trigger a quality failure message; the AI must fix and re-submit.
- `blockOnFailure`: if true, quality failure exits with a non-zero code (useful in CI). Default false.

Update with `s2s config edit`.

## Verbose mode

By default, s2s prints `[s2s]` prefix lines before and after stage output. To suppress them:

```json
{ "verbose": false }
```

in `runtime.json`, or run `s2s stage <stage> --no-verbose`. Prefix lines are informational and do not affect the context package content.
