# Pre-publish checklist

Execute top to bottom before flipping the repo public and running the first
`npm publish`. Nothing here may be skipped.

## 1. Git history audit — secrets, LAN IPs, hostnames

The whole history must be free of real tokens, LAN addresses, and
home-identifying hostnames. Run each grep over **all reachable history**:

```sh
# Long-lived access tokens (HA tokens are base64-ish, ~180 chars after "eyJ...")
git log -p --all | grep -nE "eyJhbGciOi|access_token\s*[:=]\s*['\"][A-Za-z0-9_-]{20,}"

# Generic assignment of secrets in code/docs/fixtures
git log -p --all | grep -nEi "(token|password|secret|api_key)['\"]?\s*[:=]\s*['\"][^'\"\$\{]{8,}"

# LAN/private addresses (RFC1918, link-local, .home domains)
git log -p --all | grep -nE "https?://(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.|[a-z0-9-]+\.local|[^/\s]*\.home\b)"

# Internal hostnames accidentally used instead of hass.example
git log -p --all | grep -nvE "hass\.example" | grep -nEi "https?://[a-z0-9.-]+:8123"
```

Expected result: only synthetic examples (`https://hass.example`,
`light.kitchen`, `<long-lived-access-token>` placeholders). Any hit → redact,
and if already public consider the secret burned: revoke the token regardless.

## 2. Redaction sweep of issues/fixtures/docs

```sh
grep -rnE "(192\.168\.|10\.[0-9]+\.|172\.(1[6-9]|2[0-9]|3[01])\.|\.local\b)" issues/ docs/ tests/ skills/ README.md CONTEXT.md 2>/dev/null
grep -rn "hass.example" tests/ docs/ README.md | wc -l   # synthetic URLs should be the norm
```

Check GitHub issues too (`gh issue list --state all`, `gh pr list --state all`)
for pasted tokens or real URLs; edit/redact anything found.

## 3. LICENSE present

```sh
test -f LICENSE && head -3 LICENSE   # MIT, copyright holder correct
```

## 4. CI green on the public runner

Before flipping visibility, confirm the latest `main` run of every workflow is
green (tests + build-skill drift gate). After flipping, re-run once so the
public run history starts green.

## 5. npm name free

```sh
npm view ha-axi          # must 404 until first publish; if taken, stop and rename
```

Also verify the npm account has **trusted publishing** configured for
`github.com/batamire/ha-axi` with the GitHub Actions environment/OIDC settings
the publish workflow relies on (`id-token: write`, provenance).

## 6. Flip visibility BEFORE first publish

1. `gh repo edit batamire/ha-axi --visibility public` (add `--accept-visibility-change-consequences` when prompted).
2. Re-check step 1 greps once more on the now-public history.
3. Tag/publish via release-please merge; watch the `publish` workflow use OIDC
   (no `NODE_AUTH_TOKEN` secret should exist or be needed).
