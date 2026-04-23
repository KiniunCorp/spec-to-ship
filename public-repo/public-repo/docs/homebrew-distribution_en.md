# Homebrew Distribution (EN)

`s2s` can be installed on macOS via Homebrew using the official tap.

## Quick install

```bash
brew tap kiniuncorp/s2s
brew install s2s
```

## Upgrade

```bash
brew upgrade s2s
```

## Artifact naming convention

Release assets follow this naming scheme:

| Asset | Pattern |
|-------|---------|
| arm64 tarball | `s2s-{semver}-macos-arm64.tar.gz` |
| x64 tarball | `s2s-{semver}-macos-x64.tar.gz` |
| Checksums | `sha256sums.txt` |
| Release tag | `v{semver}` (e.g. `v0.2.38`) |

Each tarball contains a single executable named `s2s`.

---

## Maintainer release workflow

The release pipeline is fully automated. Publishing a GitHub release is the only
manual step — the workflow builds the binaries and updates the Homebrew formula
without any further action required.

### One-time setup — HOMEBREW_TAP_TOKEN

The workflow needs write access to the `KiniunCorp/homebrew-s2s` tap repository.
This is a one-time step per machine/account.

1. Go to **GitHub.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Click **Generate new token**
3. Set:
   - **Token name**: `homebrew-tap-writer`
   - **Expiration**: your preference (1 year is reasonable)
   - **Repository access**: Only selected repositories → `KiniunCorp/homebrew-s2s`
   - **Permissions**: Repository permissions → Contents → **Read and write**
4. Click **Generate token** and copy the value
5. Go to **github.com/KiniunCorp/spec-to-ship → Settings → Secrets and variables → Actions**
6. Click **New repository secret**
   - **Name**: `HOMEBREW_TAP_TOKEN`
   - **Value**: paste the token
7. Click **Add secret**

This only needs to be done once. The token survives across releases until it expires.

### Releasing a new version

Once the token is set up, the full release process is:

**Step 1 — Tag and publish the release**

```bash
# In the spec-to-ship repo, on main after all changes are merged
git tag v0.2.39
git push origin v0.2.39
```

Then on GitHub: **Releases → Draft a new release** → select the tag → add release
notes → click **Publish release**.

**Step 2 — Done**

The `.github/workflows/release-binaries.yml` workflow triggers automatically and:

1. Compiles TypeScript → bundles via esbuild → packages standalone binaries via `@yao-pkg/pkg`
2. Creates `s2s-{version}-macos-arm64.tar.gz`, `s2s-{version}-macos-x64.tar.gz`, `sha256sums.txt`
3. Uploads all three as release assets
4. Parses the checksums and pushes a commit to `KiniunCorp/homebrew-s2s` that updates `Formula/s2s.rb` with the new version and real SHA256s

Monitor the run at: `https://github.com/KiniunCorp/spec-to-ship/actions`

Users running `brew update && brew upgrade s2s` will get the new version once the
formula commit lands in the tap (usually within a minute of the workflow completing).

### Manual fallback

If the `update-formula` job fails (e.g. expired token), update the formula manually:

```bash
# Get the checksums from the release
curl -sL https://github.com/KiniunCorp/spec-to-ship/releases/download/v0.2.39/sha256sums.txt
```

Then edit `Formula/s2s.rb` in the `KiniunCorp/homebrew-s2s` repo:

```diff
-  version "0.2.38"
+  version "0.2.39"

   on_arm do
-    url ".../v0.2.38/s2s-0.2.38-macos-arm64.tar.gz"
-    sha256 "<old>"
+    url ".../v0.2.39/s2s-0.2.39-macos-arm64.tar.gz"
+    sha256 "<arm64 hash from sha256sums.txt>"
   end
   on_intel do
-    url ".../v0.2.38/s2s-0.2.38-macos-x64.tar.gz"
-    sha256 "<old>"
+    url ".../v0.2.39/s2s-0.2.39-macos-x64.tar.gz"
+    sha256 "<x64 hash from sha256sums.txt>"
   end
```

```bash
git add Formula/s2s.rb
git commit -m "chore: update s2s formula to v0.2.39"
git push origin main
```

---

## Validation commands

```bash
# Syntax and style check (passes with any valid SHA256 string)
brew audit s2s

# Strict audit with online asset verification (requires real release to be live)
brew audit --strict --new --online s2s

# Test the installed binary
brew test s2s

# Check installed version
s2s --version
```

## Triggering the pipeline manually (for testing)

The workflow supports `workflow_dispatch` for testing the build without publishing a
real release. Note: the `update-formula` job does **not** run on manual dispatch —
only the binary build and upload run.

1. Create a **draft** release with the target tag (e.g. `v0.2.38`) on GitHub
2. Go to `https://github.com/KiniunCorp/spec-to-ship/actions`
3. Select **"Build and Upload Release Binaries"**
4. Click **"Run workflow"**, enter the version tag, run
5. Check the release page for uploaded assets

## Troubleshooting

**`update-formula` job fails with "Bad credentials"**

The `HOMEBREW_TAP_TOKEN` secret is missing, expired, or lacks write access to
`KiniunCorp/homebrew-s2s`. Regenerate the token and update the secret (see
One-time setup above).

**Formula audit fails with "checksum mismatch"**

The SHA256 in the formula does not match the downloaded tarball. This should not
happen with the automated workflow, but if it does, re-download and recompute:

```bash
curl -L -O https://github.com/KiniunCorp/spec-to-ship/releases/download/v0.2.38/s2s-0.2.38-macos-arm64.tar.gz
shasum -a 256 s2s-0.2.38-macos-arm64.tar.gz
```

**`brew install s2s` reports "no bottle available"**

The formula uses pre-built binary tarballs, not Homebrew bottles. This is expected.
The `bin.install "s2s"` line extracts the binary and places it in the Homebrew bin
directory. No compilation happens.

**Release pipeline fails at the pkg step**

Ensure the `bundle.cjs` was produced by esbuild. If esbuild fails, check that
`dist/cli.js` exists after `npm run build`. The TypeScript compiler must succeed
before esbuild runs.

**Binary not found after install**

Run `brew doctor` and check that the Homebrew bin directory is in `PATH`:

```bash
echo $PATH | tr ':' '\n' | grep homebrew
```
