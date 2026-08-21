/**
 * Ticket 409 — "Disable Other Lead Tabs After Lead Is Resulted and Show Reset Job Builder".
 *
 * Once a lead has been resulted from one calculator, every calculator's Result Lead and
 * Add-Drop actions lock, and the resulted one swaps Result Lead for a red **Reset Job
 * Builder**. Resetting clears the result and unlocks the rest.
 *
 * Pure and RN-free, for the reason `utils/rehash-draft-calculators.ts` and
 * `utils/addendum-drafts.ts` exist: `RolloutView.tsx` pulls in React Native and is
 * untestable under jest here, and "which tab owns the result" must mean ONE thing to the
 * button that locks and the button that resets — otherwise a rep can be locked out with
 * no tab offering the way back.
 */

export interface CalculatorLockState {
  /** This calculator is the one the lead was resulted from → show Reset Job Builder. */
  isSubmittedTab: boolean;
  /** SOME calculator owns the result → every tab's Result Lead / Add Drop is locked. */
  isAnySubmitted: boolean;
  /** A DIFFERENT calculator owns it → locked, and no way back from this tab. */
  isLockedByOtherTab: boolean;
}

/**
 * The calculator the lead was resulted from, or `null`.
 *
 * ⚠️ Web's chain (`TabbedCalculator.js` "Derive submittedCalculatorId directly from
 * currentLead.jobBuilder") deliberately does NOT require `jobBuilder.status === 'submitted'`
 * — the ticket is *"after lead is resulted"*, and a lead is resulted the moment the outcome
 * modal writes `selectedCalculatorId`, which is BEFORE the job builder is completed. Gating
 * on the submitted status would leave the window between Result and Complete wide open,
 * which is exactly the window a rep would use to result a second tab.
 *
 * The `jobBuilder.calculatorId` arm is web's SECOND source
 * (`PremiumQuoteCard.isJobBuilderSubmittedTab`) and is what the classic mobile deal center
 * reads (`CalculatorSummary.resultedCalculatorId`); it covers a lead whose result predates
 * `selectedCalculatorId`.
 */
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

/**
 * How one calculator should behave given the lead's resulted calculator.
 *
 * ⚠️ Ids are compared as STRINGS. A calculator id arrives as an ObjectId-ish string from
 * the calculators list and off the lead record, and those two are not guaranteed to be the
 * same reference or even the same type — an `===` on the raw values silently reports "no
 * tab owns this result", which unlocks every tab and defeats the whole ticket.
 */
export function describeCalculatorLock(
  lead: any,
  calculatorId: string | null | undefined,
  /** Set once the rep resets in this session, before the lead record catches up. */
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
