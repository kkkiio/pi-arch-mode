/**
 * Safety guardrails for architecture mode.
 *
 * Two categories of protection:
 *   1. Bash command filtering — blocklist pattern matching
 *   2. File write filtering — extension allowlist for edit/write tools
 */

// ═══════════════════════════════════════════════
//  Bash Command Filtering
// ═══════════════════════════════════════════════
//
// A command is blocked if it matches ANY destructive pattern.
// Everything else passes — users are interactively supervising.

// Destructive words are matched as bare words anywhere in the command, except
// that a word preceded by a hyphen (`-`) is treated as part of an option or
// option cluster (e.g. `-ln` in `grep -ln …`) rather than a command word.
//
// The original `\b…\b` match read `ln`/`su` inside `-ln`/`-su` as destructive
// commands and blocked read-only commands like `grep -ln`; the lookbehind is a
// narrow fix for that hyphen-prefix class.
//
// Note: this is NOT command-position parsing. Destructive words elsewhere are
// still matched as bare words, which keeps shell prefixes blocked (`/bin/ln a
// b`, `FOO=1 ln a b`, `xargs ln`, `sh -c 'ln a b'`, `then rm …`) — and which
// also means words inside quoted strings, redirect targets, or arguments
// (`echo 'x; rm …'`, `grep 'x|rm' …`, `cat < rm`) are still blocked. Correctly
// distinguishing those requires quote-aware parsing (a shell parser / AST),
// which is out of scope for this regex blocklist.
function destructiveWord(inner: string): RegExp {
	// `inner` is the regex source of a word or phrase, e.g. "ln" or "sed(?=…)".
	return new RegExp(`(?<!-)\\b(?:${inner})\\b`, "i");
}

// ── Destructive Patterns (blocklist) ──

const DESTRUCTIVE_PATTERNS = [
	// File removal
	destructiveWord("rm"),
	destructiveWord("rmdir"),
	destructiveWord("shred"),
	// File modification
	destructiveWord("mv"),
	destructiveWord("cp"),
	destructiveWord("mkdir"),
	destructiveWord("touch"),
	destructiveWord("chmod"),
	destructiveWord("chown"),
	destructiveWord("chgrp"),
	destructiveWord("ln"),
	destructiveWord("tee"),
	destructiveWord("truncate"),
	destructiveWord("dd"),
	// Scripted or in-place mutation. The lookahead scans for the in-place
	// option (`-i` / `--in-place`) without treating a `(` inside a quoted
	// extended-regex script as a boundary (`sed -E 's/(foo)/bar/' -i file`).
	destructiveWord("sed(?=[^;&|]*\\s-[^\\s;&|]*i)"),
	destructiveWord("python3?"),
	destructiveWord("perl"),
	destructiveWord("node\\s+-e"),
	// Package managers (write operations)
	destructiveWord("npm\\s+(install|uninstall|update|ci|link|publish)"),
	destructiveWord("yarn\\s+(add|remove|install|publish)"),
	destructiveWord("pnpm\\s+(add|remove|install|publish)"),
	destructiveWord("pip\\s+(install|uninstall)"),
	destructiveWord("apt(-get)?\\s+(install|remove|purge|update|upgrade)"),
	destructiveWord("brew\\s+(install|uninstall|upgrade)"),
	// Git (write operations)
	destructiveWord(
		"git\\s+(add|commit|push|pull|merge|rebase|reset|restore|checkout|switch|clean|apply|branch\\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)",
	),
	// Privilege escalation
	destructiveWord("sudo"),
	destructiveWord("su"),
	// Process termination
	destructiveWord("kill"),
	destructiveWord("pkill"),
	destructiveWord("killall"),
	// System control
	destructiveWord("reboot"),
	destructiveWord("shutdown"),
	destructiveWord("systemctl\\s+(start|stop|restart|enable|disable)"),
	destructiveWord("service\\s+\\S+\\s+(start|stop|restart)"),
	// Editors
	destructiveWord("vim?|nano|emacs|code|subl"),
];

// ── API ──

/** Returns true if the command is safe to execute in architecture mode. */
export function isSafeCommand(command: string): boolean {
	const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
	return !isDestructive;
}

// ═══════════════════════════════════════════════
//  File Write Filtering
// ═══════════════════════════════════════════════

/** File extensions that can be edited/written in architecture mode. */
export const WRITEABLE_EXTENSIONS = [".md", ".mdx", ".txt", ".html", ".yaml", ".yml", ".json"];

/** Returns true if the path is allowed for edit/write in architecture mode. */
export function isWriteablePath(path: string): boolean {
	return WRITEABLE_EXTENSIONS.some((ext) => path.endsWith(ext));
}
