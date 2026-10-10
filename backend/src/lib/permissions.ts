import type { StaffRole } from '@prisma/client';

const ANY: readonly StaffRole[] = ['STAFF', 'SUPERVISOR'];
const SUPERVISOR: readonly StaffRole[] = ['SUPERVISOR'];

/**
 * Who may do what: action → allowed roles. The only place authorization is decided;
 * routes name an action, and /auth/me sends the caller's allowed actions to the frontend.
 */
export const PERMISSIONS = {
  // counter console
  'call-next': ANY,
  recall: ANY,
  ack: ANY,
  complete: ANY,
  miss: ANY,
  redirect: ANY,
  // tokens
  'issue-priority': ANY, // set a priority class at the kiosk
  'view-token': ANY, // open any customer's status without their key
  reactivate: SUPERVISOR,
  // appointments
  'view-appointments': ANY, // today's bookings list
  'cancel-appointment': ANY, // cancel a booking that has not checked in
  // supervisor
  'counter-update': SUPERVISOR, // open / pause / close / skills
  whatif: SUPERVISOR,
  'view-suggestions': SUPERVISOR,
  'apply-suggestion': SUPERVISOR,
  'staff-stats': SUPERVISOR,
  'lab-run': SUPERVISOR,
  demo: SUPERVISOR, // spawn / reset
} as const satisfies Record<string, readonly StaffRole[]>;

export type Action = keyof typeof PERMISSIONS;

export const can = (role: StaffRole, action: Action) => PERMISSIONS[action].includes(role);

export const allowedActions = (role: StaffRole) => (Object.keys(PERMISSIONS) as Action[]).filter((a) => can(role, a));

export const ROLE_LABEL: Record<StaffRole, string> = { STAFF: 'Staff', SUPERVISOR: 'Supervisor' };
