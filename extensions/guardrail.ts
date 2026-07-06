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

// ── Destructive Patterns (blocklist) ──

const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/\bsed\b(?=[^;&|]*\s-[^\s;&|]*i)/i,
	/\bpython3?\b/i,
	/\bperl\b/i,
	/\bnode\s+-e\b/i,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|restore|checkout|switch|clean|apply|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
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
