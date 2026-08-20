# ADR-002: Safe-command filtering for bash in architecture mode

**Date:** 2026-05-30  

## Context

Architecture mode blocks known destructive bash commands. This is a supervised collaboration guardrail: the agent should explore and discuss, while the user remains present and can stop the session if the agent goes off-track.

The filtering uses a **blocklist-only approach**: any command matching a destructive pattern is blocked; everything else passes. This keeps exploratory commands such as `gh pr view`, `curl`, and build/status checks usable without constantly extending an allowlist.

## Decision

A bash command is blocked if it matches any destructive pattern:

| Check | Logic |
|---|---|
| **DESTRUCTIVE_PATTERNS** (blocklist) | Command must NOT match any destructive pattern |

Commands not matching any destructive pattern pass through. This is intentionally different from a security sandbox: it blocks common accidental or agent-driven mutations, not every possible shell side effect.

### DESTRUCTIVE_PATTERNS (blocklist)

Patterns that are always rejected:

| Category | Examples |
|---|---|
| File removal | `rm`, `rmdir`, `shred` |
| File modification | `mv`, `cp`, `mkdir`, `touch`, `chmod`, `chown`, `chgrp`, `ln`, `tee`, `truncate`, `dd` |
| Scripted or in-place mutation | `sed -i`, `python`, `python3`, `perl`, `node -e` |
| Package managers (write ops) | `npm install`, `pip install`, `brew install`, `apt-get install` |
| Git (write ops) | `git commit`, `git push`, `git merge`, `git rebase`, `git reset`, `git restore`, `git checkout`, `git switch`, `git clean`, `git apply`, `git stash` |
| Privilege escalation | `sudo`, `su` |
| Process termination | `kill`, `pkill`, `killall` |
| System control | `reboot`, `shutdown`, `systemctl start/stop`, `service start/stop` |
| Editors | `vim`, `nano`, `emacs`, `code`, `subl` |

## What changed from the dual-pattern approach

The SAFE_PATTERNS allowlist was removed. The previous approach required every command to match a known safe pattern, which caused false positives on read-only commands like `gh pr view`. The blocklist alone is sufficient since users interactively supervise the agent in architecture mode.

## What changed from plan-mode

Two patterns were removed from the blocklist because `edit` and `write` are now available in architecture mode, making shell redirection unnecessary to gate:

| Removed pattern | Reason |
|---|---|
| `/(^|[^<])>(?!>)/` | `>` redirection is equivalent to `write` tool |
| `/>>/` | `>>` append is equivalent to `edit`/`write` tool |

All other patterns are retained unchanged.

## Update: ignore hyphen-prefixed option fragments (2026-08-20)

Each destructive word is now matched with a negative lookbehind that skips a
word preceded by a hyphen, via the `destructiveWord()` helper. The read of
`-ln` in `grep -ln …` / `-su` in `sort -su …` as the `ln` / `su` commands was a
false positive that blocked legitimate read-only commands. A hyphen-prefixed
fragment is an option/option cluster, not a command word.

Destructive words elsewhere are still matched as before, so shell prefixes do
not bypass the blocklist: `/bin/ln a b`, `FOO=1 ln a b`, `xargs ln a b`,
`sh -c 'ln a b'`, and `if …; then rm …` all remain blocked.

Along the same lines, the `sed` lookahead no longer treats a `(` inside a
quoted extended-regex script as a boundary, so `sed -E 's/(foo)/bar/' -i file`
is still blocked.

**Scope boundary:** this is a narrow fix for the hyphen-prefix class, not
command-position parsing. Destructive words in quoted strings, redirect
targets, or arguments (`echo 'x; rm …'`, `grep 'x|rm' …`, `cat < rm`) are
still blocked — they were before this change too. Distinguishing those
requires quote-aware parsing (a shell parser / AST) and is explicitly out of
scope for this regex blocklist.

## Consequences

- Commands with harmless redirections (`pwd 2>/dev/null`, `echo foo > /tmp/bar`) no longer trigger false positives.
- Previously unknown but harmless commands (e.g., `gh`, `rg` with uncommon flags) are no longer blocked.
- False negatives are possible because this is a guardrail, not a sandbox. Mitigation: block known mutation paths, set stand-down on blocked commands, and rely on interactive user supervision for extreme cases.

## Related

- `extensions/guardrail.ts` — `DESTRUCTIVE_PATTERNS`, `isSafeCommand()`
- `extensions/arch-mode.ts` — imports `isSafeCommand` from guardrail
