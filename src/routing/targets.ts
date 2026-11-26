import type { MemberRole, MemberStatus, Target } from './schema.js';

export interface Member {
  id: string;
  name: string;
  phone: string | null;
  role: MemberRole;
  status: MemberStatus;
  active: boolean;
  backupMemberId: string | null;
}

/**
 * Finds the team member a target points at, relative to a salesperson.
 * Returns null if nobody suitable is found. People on leave or inactive are never picked.
 */
export function resolveTarget(target: Target, relativeTo: Member | null, members: Member[]): Member | null {
  const usable = (m: Member | undefined | null): Member | null => (m && m.active && m.status !== 'on_leave' ? m : null);
  switch (target.kind) {
    case 'assigned':
      return usable(relativeTo);
    case 'backup':
      return relativeTo?.backupMemberId ? usable(members.find((m) => m.id === relativeTo.backupMemberId)) : null;
    case 'member':
      return usable(members.find((m) => m.id === target.memberId));
    case 'role': {
      const candidates = members.filter((m) => m.role === target.role && m.id !== relativeTo?.id).map(usable).filter((m): m is Member => m !== null);
      return candidates.find((m) => m.status === 'available') ?? candidates[0] ?? null;
    }
  }
}

export function describeTarget(target: Target, members: Member[]): string {
  switch (target.kind) {
    case 'assigned':
      return 'the assigned salesperson';
    case 'backup':
      return "the salesperson's backup person";
    case 'role':
      return `the ${target.role}`;
    case 'member':
      return members.find((m) => m.id === target.memberId)?.name ?? 'a removed team member';
  }
}
