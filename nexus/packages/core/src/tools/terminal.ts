/** Terminal / process tools exposed to the agent. */
import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import type { TerminalManager } from '../terminal/manager.js';
import { NexusError } from '../errors.js';

export function createTerminalTools(terminal: TerminalManager): ToolDefinition<unknown, unknown>[] {
  const runCommand: ToolDefinition<{ command: string; cwd?: string; timeoutMs?: number }, unknown> = {
    descriptor: {
      id: 'terminal.run',
      name: 'Run command',
      description:
        'Run a single shell command inside the project and return stdout/stderr/exit code. Destructive commands require user approval; some are blocked entirely.',
      risk: 'medium',
      category: 'terminal',
      timeoutMs: 180_000,
      requiresProject: true,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command, single line' },
          cwd: { type: 'string', description: 'Optional working directory relative to project root' },
          timeoutMs: { type: 'number' },
        },
        required: ['command'],
      },
      outputSchema: {
        type: 'object',
        properties: { exitCode: { type: 'number' }, stdout: { type: 'string' }, stderr: { type: 'string' } },
      },
    },
    schema: z.object({
      command: z.string().min(1).max(4000),
      cwd: z.string().optional(),
      timeoutMs: z.number().int().min(500).max(180_000).optional(),
    }),
    outputSchema: z.object({
      exitCode: z.number().nullable(),
      stdout: z.string(),
      stderr: z.string(),
      timedOut: z.boolean(),
    }),
    allowedRoles: ['coding', 'debugging', 'testing', 'documentation'],
    /** Risk is decided per command so trivial reads stay frictionless. */
    async preflight(input, ctx) {
      const checked = terminal.validate({ projectId: ctx.projectId ?? '', command: input.command, cwd: input.cwd });
      if (checked.needsApproval) return { reason: checked.reason, risk: 'high' };
      if (/^\s*(cat|ls|pwd|git (status|diff|log)|node --version|npm --version)\b/.test(input.command)) return null;
      return checked.risk === 'medium' ? { reason: 'Installs or modifies project dependencies', risk: 'medium' } : null;
    },
    async execute(input, ctx) {
      if (!ctx.projectId) throw new NexusError('VALIDATION_FAILED', 'A project is required to run commands');
      const result = await terminal.run({
        projectId: ctx.projectId,
        command: input.command,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs,
        approved: ctx.approved,
        approvedBy: ctx.approved ? 'user' : undefined,
      });
      if ('requiresApproval' in result) {
        throw new NexusError('APPROVAL_REQUIRED', ('reason' in result && result.reason) || 'This command requires approval');
      }
      const ok = result.exitCode === 0;
      const observation = [
        `$ ${input.command}`,
        `exit code: ${result.exitCode ?? 'null'}${result.timedOut ? ' (timed out)' : ''}`,
        result.stdout.trim() ? `stdout:\n${result.stdout.trim().slice(0, 6000)}` : '',
        result.stderr.trim() ? `stderr:\n${result.stderr.trim().slice(0, 4000)}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      return {
        ok,
        summary: ok ? `Command succeeded` : `Command failed with exit code ${result.exitCode}`,
        data: {
          exitCode: result.exitCode,
          stdout: result.stdout.slice(0, 20_000),
          stderr: result.stderr.slice(0, 20_000),
          timedOut: result.timedOut,
          durationMs: result.durationMs,
        },
        observation,
      };
    },
  };

  const startProcess: ToolDefinition<{ command: string; cwd?: string }, unknown> = {
    descriptor: {
      id: 'terminal.startProcess',
      name: 'Start process',
      description: 'Start a long-running process (dev server, watcher, test runner in watch mode) and return its managed process id.',
      risk: 'medium',
      category: 'terminal',
      timeoutMs: 20_000,
      requiresProject: true,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: { command: { type: 'string' }, cwd: { type: 'string' } },
        required: ['command'],
      },
      outputSchema: { type: 'object', properties: { processId: { type: 'string' }, pid: { type: 'number' } } },
    },
    schema: z.object({ command: z.string().min(1).max(2000), cwd: z.string().optional() }),
    outputSchema: z.object({ processId: z.string(), pid: z.number().nullable(), status: z.string() }),
    allowedRoles: ['coding', 'debugging', 'testing'],
    async execute(input, ctx) {
      if (!ctx.projectId) throw new NexusError('VALIDATION_FAILED', 'A project is required');
      const result = terminal.start({
        projectId: ctx.projectId,
        command: input.command,
        cwd: input.cwd,
        approved: ctx.approved,
      });
      if ('requiresApproval' in result) {
        throw new NexusError('APPROVAL_REQUIRED', ('reason' in result && result.reason) || 'This command requires approval');
      }
      return {
        ok: true,
        summary: `Started process ${result.id} (pid ${result.pid})`,
        data: { processId: result.id, pid: result.pid, status: result.status },
        observation: `Process started: id=${result.id} pid=${result.pid}. Use terminal.processOutput to read its output.`,
      };
    },
  };

  const processOutput: ToolDefinition<{ processId: string; tail?: number }, unknown> = {
    descriptor: {
      id: 'terminal.processOutput',
      name: 'Read process output',
      description: 'Read the most recent stdout/stderr of a managed process, plus its status and exit code.',
      risk: 'low',
      category: 'terminal',
      timeoutMs: 10_000,
      requiresProject: true,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: { processId: { type: 'string' }, tail: { type: 'number' } },
        required: ['processId'],
      },
      outputSchema: { type: 'object', properties: { stdout: { type: 'string' }, stderr: { type: 'string' } } },
    },
    schema: z.object({ processId: z.string().min(1), tail: z.number().int().min(100).max(100_000).optional() }),
    outputSchema: z.object({ stdout: z.string(), stderr: z.string(), status: z.string(), exitCode: z.number().nullable() }),
    allowedRoles: [],
    async execute(input) {
      const info = terminal.get(input.processId);
      const output = terminal.output(input.processId, input.tail ?? 8000);
      return {
        ok: true,
        summary: `Process ${input.processId}: ${info.status}`,
        data: { ...output, status: info.status, exitCode: info.exitCode },
        observation: `Process ${input.processId} — status ${info.status}, exit ${info.exitCode ?? 'n/a'}\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`,
      };
    },
  };

  const stopProcess: ToolDefinition<{ processId: string }, unknown> = {
    descriptor: {
      id: 'terminal.stopProcess',
      name: 'Stop process',
      description: 'Stop a process previously started by NEXUS. Kills the whole process tree.',
      risk: 'medium',
      category: 'terminal',
      timeoutMs: 15_000,
      requiresProject: false,
      requiresApproval: false,
      inputSchema: { type: 'object', properties: { processId: { type: 'string' } }, required: ['processId'] },
      outputSchema: { type: 'object', properties: { status: { type: 'string' } } },
    },
    schema: z.object({ processId: z.string().min(1) }),
    outputSchema: z.object({ status: z.string(), processId: z.string() }),
    allowedRoles: ['coding', 'debugging', 'testing'],
    async execute(input) {
      const stopped = terminal.stop(input.processId);
      return {
        ok: true,
        summary: `Stopped process ${input.processId}`,
        data: { status: stopped.status, processId: input.processId },
        observation: `Process ${input.processId} is now ${stopped.status}.`,
      };
    },
  };

  const listProcesses: ToolDefinition<{ projectId?: string }, unknown> = {
    descriptor: {
      id: 'terminal.listProcesses',
      name: 'List processes',
      description: 'List processes started by NEXUS with status, pid and command.',
      risk: 'low',
      category: 'terminal',
      timeoutMs: 10_000,
      requiresProject: false,
      requiresApproval: false,
      inputSchema: { type: 'object', properties: { projectId: { type: 'string' } } },
      outputSchema: { type: 'object', properties: { processes: { type: 'array' } } },
    },
    schema: z.object({ projectId: z.string().optional() }),
    outputSchema: z.object({ processes: z.array(z.unknown()) }),
    allowedRoles: [],
    async execute(input, ctx) {
      const processes = terminal.list(input.projectId ?? ctx.projectId ?? undefined);
      return {
        ok: true,
        summary: `${processes.length} managed process(es)`,
        data: {
          processes: processes.map((p) => ({
            id: p.id,
            command: p.command,
            status: p.status,
            pid: p.pid,
            exitCode: p.exitCode,
          })),
        },
        observation: processes.length
          ? processes.map((p) => `${p.id} [${p.status}] pid=${p.pid} ${p.command}`).join('\n')
          : 'No managed processes are running.',
      };
    },
  };

  return [runCommand, startProcess, processOutput, stopProcess, listProcesses] as ToolDefinition<unknown, unknown>[];
}
