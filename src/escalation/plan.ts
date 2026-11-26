import type { RoutingConfig } from '../routing/schema.js';
import { resolveTarget, type Member } from '../routing/targets.js';

export interface EscalatableTask {
  escalationLevel: number;
  originalMemberId: string | null;
  assignedMemberId: string | null;
}

export type EscalationStep =
  | { kind: 'escalate'; level: number; levelName: string; member: Member; dueAt: Date | null; skipped: string[] }
  | { kind: 'exhausted'; skipped: string[] };

/**
 * Works out where an overdue callback goes next. Level 0 is the salesperson; escalation level N
 * is config.escalation.levels[N - 1]. Levels with nobody available (or the same person again) are skipped.
 */
export function planEscalation(task: EscalatableTask, cfg: RoutingConfig, members: Member[], now: Date): EscalationStep {
  const original = members.find((m) => m.id === task.originalMemberId) ?? null;
  const skipped: string[] = [];
  for (let i = task.escalationLevel; i < cfg.escalation.levels.length; i++) {
    const level = cfg.escalation.levels[i]!;
    const member = resolveTarget(level.target, original, members);
    if (!member) {
      skipped.push(`${level.name}: nobody available`);
      continue;
    }
    if (member.id === task.assignedMemberId) {
      skipped.push(`${level.name}: same person as now`);
      continue;
    }
    const dueAt = level.deadlineMinutes === null ? null : new Date(now.getTime() + level.deadlineMinutes * 60_000);
    return { kind: 'escalate', level: i + 1, levelName: level.name, member, dueAt, skipped };
  }
  return { kind: 'exhausted', skipped };
}
