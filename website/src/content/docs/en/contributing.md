---
title: "Contributing"
description: "How to contribute to spec-to-ship — bug reports, feature ideas, documentation, and code."
---

## Welcome

spec-to-ship is an open-source project and contributions are welcome. This page explains how to get involved.

---

## Ways to contribute

### Report bugs

If something isn't working, open an issue on GitHub with:
- What you ran and what you expected
- What actually happened (copy the output)
- Your OS, Node version, and s2s version (`s2s --version`)

Good bug reports get fixed faster. Minimal reproduction steps help most.

### Suggest features

Feature requests are welcome as GitHub issues. The more specific the use case, the better — describe the problem you're solving, not just the solution you have in mind.

Not all requests will be implemented. The project prioritizes keeping the core workflow simple and reliable over adding surface area.

### Improve the docs

Documentation fixes, clarifications, and improvements are always appreciated. The docs source lives in the `docs/` folder of the repository.

### Contribute code

Before working on a substantial change, open an issue first to discuss the approach. This avoids wasted effort if the direction doesn't fit the project.

For small fixes (typos, obvious bugs, minor improvements), a PR without a prior issue is fine.

---

## Development setup

```bash
git clone https://github.com/KiniunCorp/spec-to-ship
cd spec-to-ship
npm install
npm run build
```

Run tests with:
```bash
npm test
```

---

## Pull request guidelines

- Keep PRs focused — one concern per PR
- Write a clear description of what changed and why
- If the PR fixes a bug, include a test that would have caught it
- Run `npm run check` before opening the PR

---

## Code of conduct

Be respectful. Disagreements about technical direction are fine; personal attacks are not.

---

## Questions

For general questions about using s2s, open a GitHub Discussion rather than an issue.
