/**
 * Phase 9 — Specialised agent roles.
 *
 * Roles are logical roles over one orchestrator, not separate providers. Each
 * role carries a tool allow-list (enforced by the tool registry) and an
 * instruction block. File-write conflicts are prevented by the orchestrator's
 * file lease, not by agent politeness.
 */
import type { AgentDescriptor, AgentRole } from '../types.js';

export const AGENT_DESCRIPTORS: AgentDescriptor[] = [
  {
    role: 'planning',
    name: 'Planning Agent',
    description: 'Breaks requests into verifiable steps, identifies dependencies and coordinates execution.',
    allowedTools: ['project.scan', 'project.analyze', 'project.dependencies', 'file.list', 'file.search', 'file.read', 'memory.recall'],
    mayWriteFiles: false,
  },
  {
    role: 'coding',
    name: 'Coding Agent',
    description: 'Writes and refactors code, manages imports and keeps changes minimal and verifiable.',
    allowedTools: [
      'project.scan', 'project.analyze', 'file.list', 'file.search', 'file.read',
      'file.edit', 'file.applyEdit', 'file.restoreSnapshot',
      'terminal.run', 'terminal.startProcess', 'terminal.processOutput', 'terminal.stopProcess', 'terminal.listProcesses',
      'memory.recall', 'memory.remember',
    ],
    mayWriteFiles: true,
  },
  {
    role: 'debugging',
    name: 'Debugging Agent',
    description: 'Reproduces failures, analyses logs and stack traces, and applies minimal root-cause fixes.',
    allowedTools: [
      'project.scan', 'project.analyze', 'file.list', 'file.search', 'file.read',
      'file.edit', 'file.applyEdit',
      'terminal.run', 'terminal.startProcess', 'terminal.processOutput', 'terminal.stopProcess', 'terminal.listProcesses',
      'browser.open', 'browser.goto', 'browser.inspect', 'browser.screenshot',
      'memory.recall',
    ],
    mayWriteFiles: true,
  },
  {
    role: 'testing',
    name: 'Testing Agent',
    description: 'Generates and runs tests, analyses failures and verifies functionality end to end.',
    allowedTools: [
      'project.scan', 'project.analyze', 'file.list', 'file.search', 'file.read', 'file.edit', 'file.applyEdit',
      'terminal.run', 'terminal.startProcess', 'terminal.processOutput', 'terminal.stopProcess',
      'browser.open', 'browser.goto', 'browser.interact', 'browser.inspect', 'browser.screenshot',
      'memory.recall', 'memory.remember',
    ],
    mayWriteFiles: true,
  },
  {
    role: 'analyst',
    name: 'Project Analyst Agent',
    description: 'Explains architecture, dependencies and technical debt without modifying files.',
    allowedTools: [
      'project.scan', 'project.analyze', 'project.dependencies', 'file.list', 'file.search', 'file.read',
      'memory.recall', 'memory.remember', 'browser.inspect',
    ],
    mayWriteFiles: false,
  },
  {
    role: 'browser',
    name: 'Browser Agent',
    description: 'Drives Playwright to test interfaces, validate flows and capture screenshots.',
    allowedTools: [
      'browser.open', 'browser.goto', 'browser.interact', 'browser.inspect', 'browser.screenshot',
      'ai.analyzeImage', 'file.read', 'memory.recall',
    ],
    mayWriteFiles: false,
  },
  {
    role: 'documentation',
    name: 'Documentation Agent',
    description: 'Generates and maintains documentation, READMEs and architectural guides.',
    allowedTools: [
      'project.scan', 'project.analyze', 'project.dependencies', 'file.list', 'file.search', 'file.read',
      'file.edit', 'file.applyEdit', 'memory.recall', 'memory.remember',
    ],
    mayWriteFiles: true,
  },
];

export const AgentRoles = {
  all(): AgentDescriptor[] {
    return AGENT_DESCRIPTORS;
  },

  get(role: AgentRole): AgentDescriptor | undefined {
    return AGENT_DESCRIPTORS.find((a) => a.role === role);
  },

  /** Route a request to the most appropriate role using intent signals. */
  selectRole(message: string): AgentRole {
    const text = message.toLowerCase();
    if (/\b(browser|click|screenshot|page|website|playwright|visual|layout|ui test)\b/.test(text)) return 'browser';
    if (/\b(test|tests|spec|coverage|assert|vitest|jest)\b/.test(text)) return 'testing';
    if (/\b(error|bug|crash|stack trace|debug|fails|broken|exception)\b/.test(text)) return 'debugging';
    if (/\b(document|readme|documentation|guide|explain the project|docs)\b/.test(text)) return 'documentation';
    if (/\b(architecture|analyse|analyze|review|tech debt|dependencies|overview|how does)\b/.test(text)) return 'analyst';
    if (/\b(add|implement|create|write|fix|refactor|update|change|rename|migrate|build)\b/.test(text)) return 'coding';
    return 'planning';
  },

  instructionFor(role: AgentRole): string {
    const descriptor = AgentRoles.get(role);
    const base = descriptor
      ? `You are acting as the ${descriptor.name}: ${descriptor.description}`
      : 'You are acting as the orchestrator.';
    const write = descriptor?.mayWriteFiles
      ? 'You may stage and apply file changes, but only after inspecting the current content.'
      : 'You may NOT modify files. If a change is required, describe it and let a coding agent stage it.';
    return `${base}\n${write}`;
  },
};
