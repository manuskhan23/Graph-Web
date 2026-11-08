/**
 * Cross-cutting security invariants enforced regardless of what the AI asks for.
 * These are intentionally blunt: the agent must never rewrite git history or
 * drop the audit trail to "make tests pass".
 */
import { NexusError } from '../errors.js';

const PROTECTED_SEGMENTS = ['.git', '.hg', '.svn'];

export function assertNoGitMetadata(relPath: string): void {
  const normalized = relPath.replace(/\\/g, '/');
  for (const segment of PROTECTED_SEGMENTS) {
    if (normalized.split('/').includes(segment)) {
      throw new NexusError('PERMISSION_DENIED', `Repository metadata is protected: ${relPath}`, {
        details: { rule: 'protected-vcs-path' },
      });
    }
  }
}

/** Commands the terminal manager refuses outright, regardless of approval. */
const HARD_BLOCKED_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\brm\s+(-[a-z]*[rf][a-z]*\s+)*\/(\s|$)/i, reason: 'refuses to delete filesystem root' },
  { re: /\bmkfs(\.|\s)/i, reason: 'filesystem formatting is never allowed' },
  { re: /:\(\)\s*\{.*\};\s*:/, reason: 'fork bomb' },
  { re: /\bdd\s+if=.*of=\/dev\//i, reason: 'raw device write' },
  { re: />\s*\/dev\/(sd|nvme|disk)/i, reason: 'raw device write' },
  { re: /\bchmod\s+-R\s+777\s+\/(\s|$)/i, reason: 'permissions on filesystem root' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: 'host power control' },
  { re: /\buserdel\b|\bpasswd\s+root\b/i, reason: 'account management' },
  { re: /curl[^|]*\|\s*(ba)?sh/i, reason: 'piping remote content into a shell' },
  { re: /\bgit\s+push\s+.*--force\b/i, reason: 'force push rewrites remote history' },
  { re: /\bgit\s+reset\s+--hard\b/i, reason: 'destroys uncommitted work' },
  { re: /\bgit\s+clean\s+-[a-z]*f/i, reason: 'deletes untracked files' },
  { re: /\/etc\/(passwd|shadow)/i, reason: 'system credential files' },
  { re: /\bhistory\s+-c\b|\bunset\s+HISTFILE\b/i, reason: 'audit trail tampering' },
  { re: /\b(sqlite3?|psql|mysql)\b.*\b(DROP|TRUNCATE)\b/i, reason: 'destructive database statement' },
];

export function assertCommandAllowed(command: string): void {
  const trimmed = command.trim();
  if (trimmed.length === 0) throw new NexusError('VALIDATION_FAILED', 'Command is empty');
  if (trimmed.length > 4000) throw new NexusError('VALIDATION_FAILED', 'Command is too long');
  if (/[\0\r\n]/.test(trimmed)) {
    throw new NexusError('COMMAND_BLOCKED', 'Commands must be a single line without control characters');
  }
  for (const { re, reason } of HARD_BLOCKED_PATTERNS) {
    if (re.test(trimmed)) {
      throw new NexusError('COMMAND_BLOCKED', `Blocked by security policy: ${reason}`, {
        details: { command: trimmed, rule: reason },
      });
    }
  }
}

/** Commands that always require explicit human approval. */
const APPROVAL_REQUIRED_PATTERNS: RegExp[] = [
  /\brm\s+-/i,
  /\brmdir\b|\bdel\s+/i,
  /\bnpm\s+(uninstall|remove)\b/i,
  /\bpnpm\s+(remove|uninstall)\b/i,
  /\byarn\s+remove\b/i,
  /\bgit\s+(push|reset|revert|checkout\s+--)\b/i,
  /\bdocker\s+(rm|rmi|system\s+prune)\b/i,
  /\bkill\b|\bpkill\b|\btaskkill\b/i,
  /\bmv\s+.*\s+\/(\s|$)/i,
];

export function commandNeedsApproval(command: string): boolean {
  return APPROVAL_REQUIRED_PATTERNS.some((re) => re.test(command));
}

/** Secret-looking values must never be written into memory or logs. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bAIza[0-9A-Za-z_-]{30,}\b/, // Google API key
  /\bgsk_[0-9A-Za-z]{20,}\b/, // Groq key
  /\bsk-[0-9A-Za-z]{20,}\b/,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[0-9A-Za-z._-]{20,}\b/,
  /\b(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*\S{6,}/i,
];

export function containsSecretValue(text: string): boolean {
  return SECRET_VALUE_PATTERNS.some((re) => re.test(text));
}

export function assertNoSecretValue(text: string, context: string): void {
  if (containsSecretValue(text)) {
    throw new NexusError('SENSITIVE_DATA_BLOCKED', `Refusing to persist a secret-like value (${context})`);
  }
}
