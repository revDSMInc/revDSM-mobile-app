export interface CalculatorLockState {
  isSubmittedTab: boolean;
  isAnySubmitted: boolean;
  isLockedByOtherTab: boolean;
}

export function resolveSubmittedCalculatorId(lead: any): string | null {
  const jb = lead?.jobBuilder;
  const candidate =
    jb?.leadData?.selectedCalculatorId ||
    jb?.selectedCalculatorId ||
    jb?.calculatorId ||
    lead?.selectedCalculatorId ||
    lead?.leadData?.selectedCalculatorId ||
    null;
  const id = candidate == null ? '' : String(candidate).trim();
  return id ? id : null;
}

export function describeCalculatorLock(
  lead: any,
  calculatorId: string | null | undefined,
  resetLocally = false
): CalculatorLockState {
  const submittedId = resetLocally ? null : resolveSubmittedCalculatorId(lead);
  if (!submittedId) {
    return { isSubmittedTab: false, isAnySubmitted: false, isLockedByOtherTab: false };
  }
  const thisId = calculatorId == null ? '' : String(calculatorId).trim();
  const isSubmittedTab = !!thisId && thisId === submittedId;
  return {
    isSubmittedTab,
    isAnySubmitted: true,
    isLockedByOtherTab: !isSubmittedTab,
  };
}
