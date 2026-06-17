# Releasing

This document is the source of truth for publishing `@kkkiio/pi-arch-mode` to npm.

## Release Policy

- Publish from `main`. The maintainer bypasses branch protection for the release commit.
- `main` branch protection requires PR + 1 approval for contributors. Admin can merge their own PRs without approval.
- No build step — `extensions/` contains the TypeScript sources directly. Pi loads them with jiti at runtime.
- `npm version` automatically creates the version bump commit and tag. Push both after publish succeeds.

## Prerequisites

```bash
node --version      # >= 18
npm --version
npm whoami          # must be authenticated to publish @kkkiio/*
```

## Pre-Release Checks

```bash
git status --short   # clean working tree
git branch --show-current   # should be main
```

Confirm current published version:

```bash
npm view @kkkiio/pi-arch-mode version
```

Run project checks:

```bash
just check
```

## Versioning

Bump the version according to semver:

```bash
npm version patch     # bug fixes
npm version minor     # new features (most common)
npm version major     # breaking changes
```

`npm version` does three things in one command:
1. Updates `version` in `package.json`
2. Creates a git commit (`<new-version>`)
3. Creates an annotated git tag (`v<new-version>`)

Review the commit before publishing:

```bash
git show HEAD
```

## Package Media

- `README.md` references `./logo.png`. This file must be included in `package.json.files` and present in the published tarball.
- `pi.image` points to the GitHub raw URL for the logo. pi.dev uses this for the search result card.

## Dry Run

Inspect what will be included in the npm tarball:

```bash
npm pack --dry-run
```

The output must include at minimum:
- `package.json`
- `README.md`
- `logo.png`
- `extensions/arch-mode.ts`
- `extensions/guardrail.ts`

## Publish

```bash
npm publish --access public
```

If publish fails before the version is registered on npm, fix the issue and retry.
If publish succeeds, push the commit and tag:

```bash
git push origin HEAD
git push origin v<version>
```

## Post-Publish Verification

Confirm npm registry metadata:

```bash
npm view @kkkiio/pi-arch-mode version name pi files --json
```

Confirm the logo is available through jsDelivr. Replace `<version>` with the published version:

```bash
curl -I -L https://cdn.jsdelivr.net/npm/@kkkiio/pi-arch-mode@<version>/logo.png
```

Check the pi.dev package page and verify the card image and README logo both render (may take a few minutes for caches to refresh):

```
https://pi.dev/packages/@kkkiio/pi-arch-mode
```

## Failed or Bad Release

If a bad version is already on npm:

1. Do NOT overwrite or unpublish the bad version.
2. Fix the issue in a new commit on `main`.
3. Bump to a new patch version and publish.
4. Deprecate the bad version:

```bash
npm deprecate @kkkiio/pi-arch-mode@<bad-version> "Use @kkkiio/pi-arch-mode@<fixed-version> instead."
```
