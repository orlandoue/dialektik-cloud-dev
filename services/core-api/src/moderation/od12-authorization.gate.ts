import type { UserRole } from '@dialektik/database';

export const MODERATION_CAPABILITIES = [
  'inspect_queue',
  'inspect_candidate',
  'claim_task',
  'release_task',
  'propose_decision',
  'confirm_decision',
  'refuse_decision',
  'reassign_task',
  'escalate_task',
] as const;

export type ModerationCapability = (typeof MODERATION_CAPABILITIES)[number];

export class Od12AuthorizationError extends Error {
  public readonly code = 'MOD_FORBIDDEN' as const;

  public constructor(
    public readonly role: UserRole,
    public readonly capability: ModerationCapability,
  ) {
    super(`MOD_FORBIDDEN: ${capability}`);
    this.name = 'Od12AuthorizationError';
  }
}

export class Od12AuthorizationGate {
  public assertAuthorized(
    role: UserRole,
    capability: ModerationCapability,
    singleEditorAuthorized = false,
  ): void {
    const moderatorCapabilities: readonly ModerationCapability[] = [
      'inspect_queue',
      'inspect_candidate',
      'claim_task',
      'release_task',
      'propose_decision',
      'escalate_task',
    ];
    const editorCapabilities: readonly ModerationCapability[] = [
      'inspect_queue',
      'inspect_candidate',
      'release_task',
      'confirm_decision',
      'refuse_decision',
      'reassign_task',
    ];
    const allowed =
      (role === 'moderator' && moderatorCapabilities.includes(capability)) ||
      (role === 'editor' &&
        (editorCapabilities.includes(capability) ||
          (singleEditorAuthorized &&
            (capability === 'claim_task' || capability === 'propose_decision'))));
    if (!allowed) throw new Od12AuthorizationError(role, capability);
  }
}
