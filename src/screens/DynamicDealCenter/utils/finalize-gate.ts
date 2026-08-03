/**
 * finalize-gate.ts — pure completion-gate logic for the Dynamic Job Builder.
 * Ports web `dynamic-job-builder.js` (`isRequiredDocumentationComplete`,
 * `canProceed`, `finalizeBlockedReason`). Previously mobile only gated a sale on
 * the appointment and (incorrectly) claimed web did not gate documentation — web
 * blocks a sale without a signed agreement and a demo without an order sheet.
 *
 * An ORDER SHEET is now required to finish ANY job (Sale or Demo) — a frontend
 * gate mirrored by a backend validation. A Sale additionally requires a signed
 * agreement and the scheduled install appointment.
 */

export interface GateInput {
  portalUnrestrictedEdit?: boolean;
  areAllTabsComplete: boolean;
  isSale: boolean;
  isDemo: boolean;
  isAppointmentSet: boolean;
  hasAgreementDoc: boolean;
  hasOrderSheetDoc: boolean;
}

export function isRequiredDocumentationComplete(i: Pick<GateInput, 'isSale' | 'isDemo' | 'hasAgreementDoc' | 'hasOrderSheetDoc'>): boolean {
  // An order sheet is required to finish ANY job.
  if (!i.hasOrderSheetDoc) return false;
  // A Sale additionally requires a signed agreement.
  if (i.isSale) return i.hasAgreementDoc;
  return true;
}

export function canCompleteJobBuilder(i: GateInput): boolean {
  if (i.portalUnrestrictedEdit) return true;
  if (!i.areAllTabsComplete) return false;
  if (i.isSale && !i.isAppointmentSet) return false;
  return isRequiredDocumentationComplete(i);
}

export function finalizeBlockedReason(i: GateInput): string {
  if (i.portalUnrestrictedEdit || canCompleteJobBuilder(i)) return '';
  if (!i.areAllTabsComplete) return 'Complete all product tabs to finish.';
  if (i.isSale && !i.isAppointmentSet) return 'Schedule the install appointment to finish this sale.';
  if (!i.hasOrderSheetDoc) return 'An order sheet is required to finish this job.';
  if (i.isSale && !i.hasAgreementDoc) return 'A signed agreement is required to finish this sale.';
  return '';
}
