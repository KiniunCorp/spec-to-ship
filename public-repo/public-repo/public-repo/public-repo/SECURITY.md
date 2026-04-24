# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues using [GitHub Security Advisories](https://github.com/KiniunCorp/spec-to-ship/security/advisories/new). This keeps the report private until a fix is ready.

Include in your report:

- A description of the vulnerability and its potential impact
- Steps to reproduce the issue
- Your `s2s --version` output
- Any relevant logs or artifacts (redact sensitive data)

We will acknowledge receipt within 5 business days and provide a resolution timeline once the issue is confirmed.

## Supported versions

Only the latest published version on npm receives security fixes.

| Version | Supported |
|---------|-----------|
| latest  | yes       |
| older   | no        |

## Scope

`s2s` is a CLI tool that manages governance files and invokes LLM APIs. Relevant security concerns include:

- Command injection via user-supplied prompts or config values
- Credential exposure in logs or output
- Path traversal in file operations
- Unsafe handling of LLM API keys stored in project config
