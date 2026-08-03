/**
 * finalize-gate.ts — pure completion-gate logic for the Dynamic Job Builder.
 * Ports web `dynamic-job-builder.js` (`isRequiredDocumentationComplete`,
 * `canProceed`, `finalizeBlockedReason`). Previously mobile only gated a sale on
 * the appointment and (incorrectly) claimed web did not gate documentation — web
 * blocks a sale without a signed agreement and a demo without an order sheet.
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
  if (i.isSale) return i.hasAgreementDoc;
  if (i.isDemo) return i.hasOrderSheetDoc;
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
  if (i.isSale && !i.hasAgreementDoc) return 'A signed agreement is required to finish this sale.';
  if (i.isDemo && !i.hasOrderSheetDoc) return 'An order sheet is required to finish this demo.';
  return '';
}
