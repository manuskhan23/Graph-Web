/**
 * Task state machine. Illegal transitions throw instead of silently corrupting
 * task state, which is what makes resume/cancel/recovery trustworthy.
 */
import { NexusError } from '../errors.js';
import type { TaskStatus } from '../types.js';

const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['planning', 'cancelled', 'failed'],
  planning: ['awaiting_approval', 'running', 'failed', 'cancelled', 'pending'],
  awaiting_approval: ['running', 'cancelled', 'failed', 'paused'],
  running: ['completed', 'failed', 'paused', 'cancelled', 'awaiting_approval'],
  paused: ['running', 'cancelled', 'failed'],
  failed: ['running', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const TERMINAL_STATES: TaskStatus[] = ['completed', 'cancelled'];

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new NexusError('TASK_STATE_INVALID', `Cannot move task from ${from} to ${to}`, {
      details: { from, to, allowed: TRANSITIONS[from] },
    });
  }
}

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATES.includes(status);
}

export function nextStatuses(status: TaskStatus): TaskStatus[] {
  return TRANSITIONS[status];
}
