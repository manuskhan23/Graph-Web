/**
 * Phase 6 — Terminal and process manager.
 *
 * Security model:
 *  - hard-blocked commands are refused outright (see security/invariants).
 *  - approval-requiring commands must be granted by a human before they run.
 *  - cwd is resolved inside the owning project root.
 *  - every process is owned by this manager: we can list it, stream it, stop it,
 *    and we kill the whole tree on shutdown.
 *  - one-shot commands have a timeout and an output cap.
 *
 * Windows support: powershell/cmd are selected from settings; on POSIX systems the
 * shell defaults to /bin/bash. `shellExecutable()` is the single place that decides.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { config } from '../config.js';
import { NexusError } from '../errors.js';
import { assertCommandAllowed, commandNeedsApproval } from '../security/invariants.js';
import { resolveInsideProject } from '../security/paths.js';
import type { Database } from '../storage/db.js';
import type { EventBus } from '../events/bus.js';
import { id } from '../storage/driver.js';

export interface RunCommandInput {
  projectId: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  /** Set by the approval flow once a human approved a destructive command. */
  approved?: boolean;
  approvedBy?: string;
}

export interface CommandResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
  requiresApproval?: false;
}

/** Structural type used to narrow both run() and start() results. */
export interface ApprovalRequiredResult {
  requiresApproval: true;
  command: string;
  reason: string;
  risk: 'low' | 'medium' | 'high';
}

export interface ManagedProcessInfo {
  id: string;
  projectId: string;
  command: string;
  cwd: string;
  pid: number | null;
  status: 'running' | 'exited' | 'stopped' | 'failed';
  exitCode: number | null;
  startedAt: number;
  finishedAt: number | null;
  output: string;
  error: string;
  restarts: number;
}

interface ManagedProcess extends ManagedProcessInfo {
  child: ChildProcess | null;
  timeout: NodeJS.Timeout | null;
  bufferLimit: number;
}

const MAX_OUTPUT_CHARS = 200_000;

export class TerminalManager {
  private processes = new Map<string, ManagedProcess>();
  private history: { at: number; projectId: string; command: string; status: string }[] = [];
  /** Set on shutdown: late exit/output events must not touch a closed database. */
  private disposed = false;

  constructor(
    private readonly db: Database,
    private readonly events?: EventBus,
  ) {}

  /** Shell used for command execution on the current platform / settings. */
  shellExecutable(configured: 'powershell' | 'cmd' | 'bash' = 'bash'): string {
    if (platform() === 'win32') {
      if (configured === 'cmd') return 'cmd.exe';
      return 'powershell.exe';
    }
    return existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
  }

  private shellArgs(command: string, configured: 'powershell' | 'cmd' | 'bash'): string[] {
    if (platform() === 'win32') {
      return configured === 'cmd' ? ['/d', '/s', '/c', command] : ['-NoProfile', '-Command', command];
    }
    return ['-lc', command];
  }

  /**
   * Validation stage shared by run/start: returns the resolved cwd and whether a
   * human approval is required. Never executes anything.
   */
  validate(input: { projectId: string; command: string; cwd?: string }): {
    absCwd: string;
    needsApproval: boolean;
    reason: string;
    risk: 'low' | 'medium' | 'high';
  } {
    const project = this.db.projects.get(input.projectId);
    if (!project) throw new NexusError('NOT_FOUND', `Project not found: ${input.projectId}`);
    const command = input.command.trim();
    assertCommandAllowed(command);
    const absCwd = input.cwd ? resolveInsideProject(project.rootPath, input.cwd) : project.rootPath;
    if (!existsSync(absCwd)) throw new NexusError('PATH_NOT_FOUND', `Working directory does not exist: ${absCwd}`);

    const needsApproval = commandNeedsApproval(command);
    const installs = /\b(npm|pnpm|yarn)\s+(i|install|add)\b/i.test(command);
    const risk: 'low' | 'medium' | 'high' = needsApproval
      ? 'high'
      : installs
        ? 'medium'
        : 'low';
    return {
      absCwd,
      needsApproval,
      reason: needsApproval ? 'Command can modify or delete project data' : '',
      risk,
    };
  }

  /** One-shot command with captured output. */
  async run(input: RunCommandInput): Promise<CommandResult | ApprovalRequiredResult> {
    const checked = this.validate(input);
    if (checked.needsApproval && !input.approved) {
      return {
        requiresApproval: true,
        command: input.command,
        reason: checked.reason,
        risk: checked.risk,
      };
    }
    const settings = this.shellShellFromSettings();
    const timeoutMs = Math.min(input.timeoutMs ?? settings.timeoutMs, 15 * 60 * 1000);
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let truncated = false;
      let settled = false;

      let child: ChildProcess;
      try {
        child = spawn(this.shellExecutable(settings.shell), this.shellArgs(input.command, settings.shell), {
          cwd: checked.absCwd,
          env: this.safeEnv(),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        reject(new NexusError('TOOL_FAILED', `Failed to spawn command: ${(err as Error).message}`, { cause: err }));
        return;
      }

      const append = (chunk: Buffer, target: 'out' | 'err') => {
        if (target === 'out') {
          if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk.toString('utf8');
          else truncated = true;
        } else {
          if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk.toString('utf8');
          else truncated = true;
        }
      };

      child.stdout?.on('data', (chunk: Buffer) => append(chunk, 'out'));
      child.stderr?.on('data', (chunk: Buffer) => append(chunk, 'err'));

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        killTree(child);
        this.record(input, 'timeout');
        resolve({
          command: input.command,
          cwd: checked.absCwd,
          exitCode: null,
          stdout,
          stderr: `${stderr}\n[nexus] command timed out after ${timeoutMs} ms`.trim(),
          durationMs: Date.now() - startedAt,
          timedOut: true,
          truncated,
        });
      }, timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        this.record(input, 'failed');
        reject(new NexusError('TOOL_FAILED', `Command failed to start: ${err.message}`, { cause: err }));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        this.record(input, code === 0 ? 'success' : 'failed');
        resolve({
          command: input.command,
          cwd: checked.absCwd,
          exitCode: code,
          stdout: truncate(stdout),
          stderr: truncate(stderr),
          durationMs: Date.now() - startedAt,
          timedOut: false,
          truncated,
        });
      });
    });
  }

  /** Long-running process (dev server, watcher) with streamed output. */
  start(input: RunCommandInput & { label?: string }): ManagedProcessInfo | ApprovalRequiredResult {
    const checked = this.validate(input);
    if (checked.needsApproval && !input.approved) {
      return { requiresApproval: true, command: input.command, reason: checked.reason, risk: checked.risk };
    }
    const settings = this.shellShellFromSettings();
    const processId = id('proc');
    const child = spawn(this.shellExecutable(settings.shell), this.shellArgs(input.command, settings.shell), {
      cwd: checked.absCwd,
      env: this.safeEnv(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: platform() !== 'win32',
    });

    const entry: ManagedProcess = {
      id: processId,
      projectId: input.projectId,
      command: input.command,
      cwd: checked.absCwd,
      pid: child.pid ?? null,
      status: 'running',
      exitCode: null,
      startedAt: Date.now(),
      finishedAt: null,
      output: '',
      error: '',
      restarts: 0,
      child,
      timeout: null,
      bufferLimit: MAX_OUTPUT_CHARS,
    };
    this.processes.set(processId, entry);

    this.events?.emit('process.started', `Started: ${input.command}`, { processId, pid: child.pid }, {
      projectId: input.projectId,
    });
    this.db.observability.addActivity({
      kind: 'process',
      level: 'info',
      title: `Process started`,
      detail: input.command,
      projectId: input.projectId,
      taskId: null,
      provider: null,
      status: 'running',
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      entry.output = appendBounded(entry.output, chunk.toString('utf8'), entry.bufferLimit);
      this.events?.emit('process.output', chunk.toString('utf8').slice(0, 4000), { processId, stream: 'stdout' }, {
        projectId: input.projectId,
      });
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      entry.error = appendBounded(entry.error, chunk.toString('utf8'), entry.bufferLimit);
      this.events?.emit('process.output', chunk.toString('utf8').slice(0, 4000), { processId, stream: 'stderr' }, {
        projectId: input.projectId,
      });
    });
    child.on('exit', (code, signal) => {
      entry.exitCode = code;
      entry.finishedAt = Date.now();
      entry.status = entry.status === 'stopped' ? 'stopped' : code === 0 ? 'exited' : 'failed';
      entry.child = null;
      if (this.disposed) return;
      this.events?.emit('process.exited', `Process ${entry.status} (code ${code ?? signal ?? 'null'})`, {
        processId,
        code,
      }, { projectId: input.projectId });
      try {
        if (entry.status === 'failed') {
          this.db.observability.addNotification({
            title: 'Process crashed',
            body: `${input.command} exited with code ${code}`,
            level: 'error',
          });
        }
        this.db.observability.addActivity({
        kind: 'process',
        level: entry.status === 'failed' ? 'error' : 'info',
        title: `Process ${entry.status}`,
        detail: `${input.command} (code ${code ?? 'null'})`,
        projectId: input.projectId,
        taskId: null,
        provider: null,
        status: entry.status,
        });
      } catch (err) {
        // The store may be gone during shutdown; a process exit must not throw.
        if (!this.disposed) console.error('[nexus][terminal] exit handler error:', err);
      }
    });

    // Watchdog: never let an orphaned dev server live forever.
    entry.timeout = setTimeout(() => {
      if (entry.status === 'running') this.stop(processId);
    }, 60 * 60 * 1000);

    return this.publicInfo(entry);
  }

  list(projectId?: string): ManagedProcessInfo[] {
    return [...this.processes.values()]
      .filter((p) => !projectId || p.projectId === projectId)
      .map((p) => this.publicInfo(p))
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  get(processId: string): ManagedProcessInfo {
    const entry = this.processes.get(processId);
    if (!entry) throw new NexusError('NOT_FOUND', `Process not found: ${processId}`);
    return this.publicInfo(entry);
  }

  output(processId: string, tail = 20_000): { stdout: string; stderr: string } {
    const entry = this.processes.get(processId);
    if (!entry) throw new NexusError('NOT_FOUND', `Process not found: ${processId}`);
    return {
      stdout: entry.output.slice(-tail),
      stderr: entry.error.slice(-tail),
    };
  }

  stop(processId: string): ManagedProcessInfo {
    const entry = this.processes.get(processId);
    if (!entry) throw new NexusError('NOT_FOUND', `Process not found: ${processId}`);
    if (entry.child) {
      entry.status = 'stopped';
      killTree(entry.child);
    }
    if (entry.timeout) clearTimeout(entry.timeout);
    entry.finishedAt = entry.finishedAt ?? Date.now();
    return this.publicInfo(entry);
  }

  restart(processId: string): ManagedProcessInfo {
    const entry = this.processes.get(processId);
    if (!entry) throw new NexusError('NOT_FOUND', `Process not found: ${processId}`);
    const { command, projectId, cwd } = entry;
    this.stop(processId);
    const restarted = this.start({ projectId, command, cwd, approved: true });
    if ('requiresApproval' in restarted) {
      throw new NexusError('APPROVAL_REQUIRED', 'Restart requires approval');
    }
    this.processes.get(restarted.id)!.restarts = entry.restarts + 1;
    return this.get(restarted.id);
  }

  historyEntries(limit = 50) {
    return this.history.slice(-limit).reverse();
  }

  /** Kill everything we own. Called on shutdown so no dev server survives. */
  shutdown(): void {
    this.disposed = true;
    for (const entry of this.processes.values()) {
      if (entry.child) {
        entry.child.stdout?.removeAllListeners();
        entry.child.stderr?.removeAllListeners();
        entry.child.removeAllListeners('exit');
        entry.child.on('error', () => {
          /* swallow post-shutdown errors */
        });
        killTree(entry.child);
        entry.status = 'stopped';
      }
      if (entry.timeout) clearTimeout(entry.timeout);
      entry.child = null;
    }
  }

  /** Reset the disposed flag — used by tests that reuse a manager. */
  revive(): void {
    this.disposed = false;
  }

  /* --------------------------------------------------------------- private */

  private publicInfo(entry: ManagedProcess): ManagedProcessInfo {
    const { child: _child, timeout: _timeout, bufferLimit: _limit, ...info } = entry;
    return { ...info, output: info.output.slice(-20_000), error: info.error.slice(-20_000) };
  }

  private record(input: RunCommandInput, status: string) {
    this.history.push({ at: Date.now(), projectId: input.projectId, command: input.command, status });
    if (this.history.length > 300) this.history.shift();
  }

  private shellShellFromSettings(): { shell: 'powershell' | 'cmd' | 'bash'; timeoutMs: number } {
    const stored = this.db.observability.getSetting<{ shell: 'powershell' | 'cmd' | 'bash'; timeoutMs: number } | null>(
      'app.settings',
      null,
    );
    const terminal = (stored as { app?: { terminal?: { shell: 'powershell' | 'cmd' | 'bash'; timeoutMs: number } } } | null)
      ?.app?.terminal;
    return {
      shell: terminal?.shell ?? 'bash',
      timeoutMs: terminal?.timeoutMs ?? 120_000,
    };
  }

  /** Minimal environment: no secrets from the parent process leak into shells. */
  private safeEnv(): NodeJS.ProcessEnv {
    const keep = ['PATH', 'HOME', 'USER', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP', 'SHELL', 'LANG', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT'];
    const env: NodeJS.ProcessEnv = {};
    for (const key of keep) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    env.NEXUS_MANAGED = '1';
    env.CI = '1';
    return env;
  }
}

function appendBounded(existing: string, chunk: string, limit: number): string {
  const next = existing + chunk;
  return next.length > limit ? next.slice(next.length - limit) : next;
}

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… output truncated` : text;
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (platform() === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true });
    } else {
      // Negative pid targets the detached process group (shell + children).
      process.kill(-child.pid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }, 2500).unref?.();
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

export const SHELL_TIMEOUT_MS = config.limits.maxDurationMs;
