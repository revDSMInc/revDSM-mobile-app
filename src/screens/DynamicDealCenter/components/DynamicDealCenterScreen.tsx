import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCalculatorSchema } from '../hooks/useCalculatorSchema';
import { useDynamicCalculators } from '../hooks/useDynamicCalculators';
import { useDynamicCalculatorSchemas } from '../hooks/useDynamicCalculatorSchemas';
import { useDealPricing } from '../hooks/useDealPricing';
import { CalculatorView } from './CalculatorView';
import { RolloutView } from './RolloutView';
import { ResultJobModal } from './ResultJobModal';
import { DynamicJobBuilderScreen } from '../DynamicJobBuilderScreen';
import { DynamicDealEditScreen } from './DynamicDealEditScreen';
import { BuildFromExistingModal } from './BuildFromExistingModal';
import { extractCalculatorOutcome, hasSavedJobBuild } from '../utils/saved-job-build';
import { createRehashDraftLatch, latchRehashDrafts, releaseRehashDrafts, isRehashDraftCalculator } from '../utils/rehash-draft-calculators';
import { buildDealCenterData } from '../utils/build-deal-center-data';
import { resolveSubmittedCalculatorId } from '../utils/job-builder-submission';
import { FlashMessage } from '../../../config/message';
import { buildSectionLabelMap } from '../utils/item-format';
import { resolveFundingSource } from '../../../utils/activity-log/funding-log';
import { LeadService, resolveLeadCalculatorId } from '../../../services/api/leads';
import { FundingService } from '../../../services/api/FundingService';
import { ConfirmDialog } from './ConfirmDialog';
import { canResumeJobBuild } from '../utils/funding';
import { Storage } from '../../../utils/storage';
import { fundingOwnerKey, shouldAdoptSavedFunding } from '../../../utils/funding-owner';
import { useAuth } from '../../../hooks/useAuth';
import { logViewAllCalculators, logBuildJobInitiated } from '../../../utils/activity-log/calculator-log';
import { useQueryClient } from '@tanstack/react-query';
import { markLeadRolloutsConfirmed } from '../../../hooks/useLeadCalculatorStatus';
import { allRolloutsConfirmed } from '../../../utils/rollout-status';
import { isOnline } from '../../../services/connectivity';

type FlowStep = 'calculator' | 'rollout' | 'result' | 'jobBuilder';

/**
 * Sale vs demo for a deep link that SKIPS the Result modal (the `agreement-signed`
 * push). `isSale` in the builder gates which cards render, the Complete Job
 * enablement and the `result` the submit payload reports, so an empty `resultType`
 * reads as NEITHER sale nor demo and the rep lands on a job they cannot submit.
 *
 * `lead.status` is the same field `JobDocsSection`'s `hasContract` reads, and a lead
 * whose agreement was just signed is resulted by definition — so sale is the right
 * default and only an explicit demo status moves off it.
 */
const resultTypeFromLead = (lead: any): 'sale' | 'demo' => {
  const status = String(lead?.status || '').toLowerCase().replace(/[^a-z]/g, '');
  return status === 'demo' || status === 'demonosale' ? 'demo' : 'sale';
};

interface DynamicDealCenterScreenProps {
  navigation?: NativeStackNavigationProp<any>;
  route?: {
    params?: {
      lead?: any;
      initialVerticalId?: string;
      // 'edit' bypasses the calculator/rollout/result steps and opens the saved
      // deal straight in the dynamic job builder (web PortalDynamicJobBuilderModal).
      mode?: 'new' | 'edit';
      calculatorResultData?: any;
      // Opt-in handoff from the Investment Center — opens the Result Lead (Sale)
      // modal for this calculator with the secured price/plan/down payment.
      resultOptIn?: { calculatorId?: string; price?: number; paymentMethod?: string; downPayment?: number };
      // Deep link from the `agreement-signed` notification — open straight on the
      // Job Builder's Summary step so the rep can Complete Job. Honoured only once
      // the calculators and job-builder config have loaded.
      openJobBuilder?: boolean;
    };
  };
}

export default function DynamicDealCenterScreen({ navigation, route }: DynamicDealCenterScreenProps) {
  // useAuth sits ABOVE the edit-mode branch so it runs unconditionally (its result
  // is simply unused in the edit branch) — the activity-log user id, without adding
  // another hook after the early return.
  const { user } = useAuth();
  // Same reason as `useAuth` above the branch: needed by `onRolloutsConfirmedDone`
  // to prime the Investment Center's status cache.
  const queryClient = useQueryClient();
  // Edit flow is a distinct screen (its own hooks/loading). Branch BEFORE any hook
  // below runs — `mode` is stable for a navigated screen instance, so this keeps
  // hook order consistent across renders.
  if (route?.params?.mode === 'edit') {
    return <DynamicDealEditScreen navigation={navigation} route={route} />;
  }

  const lead = route?.params?.lead;
  const [flowStep, setFlowStep] = useState<FlowStep>('calculator');
  // Raised when a sibling calculator already has a submitted funding (see `handleResultJob`).
  const [fundingBlock, setFundingBlock] = useState<{ ownerTitle: string } | null>(null);
  const [resultModal, setResultModal] = useState<{ visible: boolean; calculatorId?: string; resultType?: 'sale' | 'demo'; price?: number; paymentMethod?: string; downPayment?: number; startOnFunding?: boolean }>({ visible: false });
  const [calculatorResultData, setCalculatorResultData] = useState<any>(null);
  const [currentCalculatorId, setCurrentCalculatorId] = useState<string | undefined>();
  // Rehash only (web `pendingJobBuild` / `jobBuilderData.startFresh`): whether the
  // reuse-or-rebuild prompt is up, and the rep's answer. Inert on a normal lead.
  // Kept as ONE state object deliberately — every hook in this component sits after
  // the edit-mode branch above, so each additional one widens that compromise.
  const [rehashBuild, setRehashBuild] = useState<{ prompt: boolean; startFresh: boolean }>({
    prompt: false,
    startFresh: false,
  });
  // Ticket 409 - the rep reset the job builder in THIS session. `lead` is a nav param,
  // so it still carries the old `jobBuilder` until the rep leaves and comes back; without
  // this the tabs would stay locked immediately after the reset that was meant to unlock
  // them. Web does the same thing locally (`setLead({ ...currentLead, jobBuilder: null })`).
  const [jobResetLocally, setJobResetLocally] = useState(false);

  const {
    config: jobBuilderConfig,
    isConfigured: hasJobBuilderConfig,
    isLoading: isJobBuilderConfigLoading,
    refetch: refetchJobBuilderConfig,
  } = useDynamicCalculatorSchemas();

  const {
    configuredSchemas,
    isConfigured: hasCalculatorSchema,
    isLoading: isSchemaLoading,
    pricingConfig,
  } = useCalculatorSchema();
  // Backend-driven payment plans + discount tiers (web parity), static fallback.
  const pricing = useDealPricing(lead);
  // The top scroller lists the configured verticals (products). No mock fallback:
  // when nothing is configured this is empty and we render a not-configured state.
  const verticals = useMemo(() => configuredSchemas, [configuredSchemas]);

  // Calculators are persisted to the backend (list/create/save/delete) via this
  // hook; entries auto-save (debounced) on every field change.
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    appointmentId,
    loading: isCalcLoading,
    offlineUnavailable,
    isSaving,
    lastUpdated,
    handleEntryChange,
    handleClearSection,
    handleAddTab,
    handleDuplicateTab,
    handleDeleteTab,
    handleRenameTab,
    handleReorderTabs,
    handleConfirmRollouts,
    handleSetPaymentMethod,
    handleSetDrops,
    handleSetDiscount,
    handleSetDownPayment,
    handleSetRenders,
    handleSetOneYearMonthly,
    handleSetPrice,
    handleAckScopeWarning,
  } = useDynamicCalculators(lead, verticals);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  /**
   * REHASH: which calculators the rep may still BUILD in this session — a rehash that
   * arrived with nothing scoped opens the entry form instead of an empty locked
   * receipt. The rule, and why it has to be latched rather than re-read from the live
   * entries, is documented on `rehash-draft-calculators.ts`.
   *
   * Latched during render, not in an effect: an effect lands one frame late and the
   * rep would see the locked receipt flash before the form replaced it. The latch is
   * idempotent, so a repeated or discarded render reaches the same verdict.
   *
   * One ref holds both sets for the reason given on `rehashBuild` above — every hook
   * here sits after the edit-mode early return, so each extra one widens that
   * compromise.
   */
  const rehashLatchRef = useRef(createRehashDraftLatch());
  if (lead?.isRehashed === true && !isCalcLoading) latchRehashDrafts(rehashLatchRef.current, tabs);
  // Only ever true on a rehash — the latch stays empty on every other lead.
  const isRehashDraftTab = isRehashDraftCalculator(rehashLatchRef.current, activeTab?.id);

  // sectionId → label for the Result Lead Job Summary rows (web parity).
  const sectionLabelMap = useMemo(() => buildSectionLabelMap(verticals), [verticals]);

  /**
   * WHICH FLOW any funding activity on this screen belongs to.
   *
   * A plain const, not a `useMemo`: it resolves to a STRING, so there is no
   * identity to stabilise, and every hook in this component sits after the
   * edit-mode early return — adding one more would widen that compromise for
   * nothing. Derived here rather than inside the sheet because the screen is the
   * only thing that knows how it was entered.
   * that knows how it was entered. `module_type` still goes up as `funding` — this
   * only composes the flow onto `meta.action` (`rehash_funding_card_charged`) so
   * the backend can display rehash, sale and my-deals money under their own
   * headings. See `resolveFundingSource`.
   *
   * NOTE: `mode: 'edit'` never reaches this line — it returns `DynamicDealEditScreen`
   * above — so in practice this resolves to `rehash` or `sale`. It is passed
   * through the resolver anyway so all three flows answer the question identically
   * if the deal-edit wizard ever grows a funding step.
   */
  const fundingSource = resolveFundingSource({ lead, mode: route?.params?.mode });

  // Header shows the LEAD (customer name + lead time), matching the regular
  // DealCenter header (`src/screens/DealCenter/index.tsx`). The active calculator
  // name lives in the bottom tab bar, not the header.
  const cd = lead?.customerDetails || {};
  const customerName = cd.firstName
    ? `${cd.firstName} ${cd.lastName || ''}`.trim()
    : lead?.title || lead?.customerName || 'Lead Center';
  // The customer's name ALONE — no `'Lead Center'` fallback, because this one labels the
  // first calculator tab and a generic word there would read as a calculator name.
  // Empty string when the lead has no name, which leaves the tab blank as before.
  const customerTabName = `${cd.firstName || ''} ${cd.lastName || ''}`.trim();
  const leadTime = lead?.leadTime || '';

  /**
   * The resume path's two pieces of mutable state, in ONE ref.
   *
   * ⚠️ Combined for the reason on `rehashBuild`: every hook in this component sits
   * after the edit-mode early return, so each additional one widens that compromise.
   *
   * `confirm` points at `handleResultConfirm`, which is defined further down and
   * cannot be re-ordered above here — the result-opt-in effect already depends on
   * `handleResultJob`, so moving that below would put the effect in its own temporal
   * dead zone. Routing through the ONE function is also what stops the resume path
   * drifting from the normal one on the timeline PATCH, the `build_job_initiated`
   * log and the rehash "reuse the saved build?" prompt.
   *
   * `checking` guards a second Sale tap while the lookup is in flight. A ref rather
   * than state because nothing renders from it, and a state flag would be read from
   * whichever closure RolloutView is holding — the render before the flag flipped.
   */
  const resumeRef = useRef<{ confirm: (data: any, calcIdOverride?: string) => void; checking: boolean }>({
    confirm: () => {},
    checking: false,
  });

  const handleResultJob = useCallback(
    async (calculatorId: string, result: 'sale' | 'demo', price?: number, paymentMethod?: string, downPayment?: number) => {
      const openSheet = (startOnFunding?: boolean) => {
        setResultModal({ visible: true, calculatorId, resultType: result, price, paymentMethod, downPayment, startOnFunding });
        setCurrentCalculatorId(calculatorId);

        /**
         * The portal's Forever Record turns the **Lead Resulted** step in-progress here.
         *
         * ⚠️ That step is the one sales-phase milestone with NO log-derived fallback —
         * the backend reads `lead.timelineProgress[cycle].leadResulted` and nothing else
         * (`SalesPhaseBuilder`), and the field is created `pending`. Its neighbours look
         * alive without help (Sales Process is created `active`; Funding is derived from
         * the `JobFunding` doc), so before this the dynamic flow left it reading
         * "Pending… / Result: N/A" while Funding beside it showed green — on a lead that
         * had plainly been resulted. It only ever jumped straight to `completed`, at
         * Build Job.
         *
         * ⚠️ Web parity, and the same moment: `deal-center/components/ResultJobModal.js`
         * sends this exact pair from the Sale **and** Demo buttons of the chooser, which
         * is the press that lands here. Mobile's own static flow does it too
         * (`useDealOutcome.handleStatusSelect`). Tapping **Result Lead** to open the
         * chooser still changes nothing — only picking an outcome does.
         *
         * ⚠️ Safe to repeat: `canAdvanceStatus` is FORWARD-ONLY (`pending → active →
         * completed`), so re-opening the sheet on an already-built lead cannot knock the
         * step back, and the Build Job write below still wins.
         *
         * ⚠️ Deliberately NOT awaited, matching the Build Job site: nothing the rep is
         * about to see reads these flags, and a failed PATCH must never block resulting
         * a lead.
         */
        const progressLeadId = lead?._id || lead?.leadId || lead?.id;
        if (progressLeadId) {
          LeadService.updateLeadTimelineProgress(progressLeadId, {
            salesProcess: 'completed',
            leadResulted: 'active',
          }).catch((e: any) =>
            console.warn('[DynamicDealCenter] timeline progress (result opened) failed:', e?.message || e)
          );
        }
      };

      const resumeLeadId = lead?._id || lead?.leadId || lead?.id;
      // A DEMO has nothing to fund, and a lead with no id has nothing to read.
      if (result !== 'sale' || !resumeLeadId || resumeRef.current.checking) {
        openSheet();
        return;
      }

      /**
       * The rep already submitted the funding on an earlier visit and only abandoned
       * the BUILD — take them straight back to it.
       *
       * ⚠️ Any failure falls through to the sheet. A lookup problem must never block
       * the rep from resulting a lead, which is the same rule the rehash
       * `openJobBuilder` lookup below already follows.
       */
      resumeRef.current.checking = true;
      try {
        const res = await FundingService.getFunding(
          resumeLeadId,
          lead?.companyId || user?.companyId,
          user?._id || user?.id
        );
        const record = res.data?.data?.funding ?? null;
        // ⚠️ A submitted funding no longer jumps to the Job Builder: the rep lands on the
        // FUNDING screen (collected money shown locked, financing still swappable) and
        // continues to the build from there. `resumeOutcomeFromRecord` is now unused.
        const owner = Storage.getItem(fundingOwnerKey(resumeLeadId));
        // ⚠️ Funding already SUBMITTED against a DIFFERENT calculator: this one cannot be
        // resulted until that job is refunded. Stop here — no sheet, no Job Builder.
        if (record?.status === 'submitted' && owner && String(owner) !== String(calculatorId)) {
          const ownerTitle = tabs.find((t) => String(t.id) === String(owner))?.title || 'another calculator';
          setFundingBlock({ ownerTitle });
          return;
        }
        if (canResumeJobBuild(record) && shouldAdoptSavedFunding(owner, calculatorId)) {
          resumeRef.current.checking = false;
          openSheet(true);
          return;
        }
      } catch (err) {
        if (__DEV__) console.warn('[DynamicDealCenter] resume check failed:', err);
      } finally {
        resumeRef.current.checking = false;
      }
      openSheet();
    },
    [lead, user, pricing.plans, tabs]
  );

  /**
   * Ticket 409 - the calculator this lead was already resulted from, or null.
   *
   * `jobResetLocally` short-circuits it because `lead` is a nav-param snapshot: the PUT
   * clears the result on the server, but nothing re-reads the lead while the rep is still
   * in the deal center.
   */
  // A plain const, NOT a `useMemo`: the resolver is a handful of `||`s, and every hook
  // in this component sits after the edit-mode early return (see `rehashBuild`), so one
  // that buys nothing is pure cost.
  const submittedCalculatorId = jobResetLocally ? null : resolveSubmittedCalculatorId(lead);

  /**
   * Reset Job Builder - the only way out of the locked state.
   *
   * Confirmation copy and the direct `LeadService.resetLead` call are lifted from the
   * CLASSIC deal center's `handleResetJobBuilder` (`screens/DealCenter/index.tsx`), so the
   * two deal centers ask the same question and hit the same endpoint. Calling the service
   * directly rather than `useResetLeadMutation` is deliberate: every hook in this component
   * sits after the edit-mode early return (see `rehashBuild`), and `queryClient` is already
   * in scope above that branch, so this costs no extra hook. A plain function for the same
   * reason — `PremiumQuoteCard` is not memoised, so a stable identity buys nothing here.
   */
  const handleResetJobBuilder = () => {
    const resetLeadId = lead?._id || lead?.leadId || lead?.id;
    Alert.alert(
      'Reset Job Builder',
      'Are you sure you want to reset this lead result? This will clear the current result and allow you to re-enter the lead',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              if (resetLeadId) await LeadService.resetLead(resetLeadId);
              // Unlock immediately - see `jobResetLocally`.
              setJobResetLocally(true);
              // The lead list and the Lead Center both render the resulted state.
              queryClient.invalidateQueries({ queryKey: ['leads'] });
              if (resetLeadId) queryClient.invalidateQueries({ queryKey: ['lead', resetLeadId] });
              FlashMessage.success('Success', 'Job builder reset successfully');
            } catch (err) {
              console.error('[DynamicDealCenter] Reset job builder failed:', err);
              FlashMessage.error('Error', 'Could not reset job builder. Please try again.');
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  // Opt-in handoff from the Investment Center: once the calculators have loaded,
  // open the Result Lead (Sale) modal for the opted-in calculator with the secured
  // price/plan/down payment (web parity: TabbedCalculator `readPendingOptIn`). Runs
  // once per navigation so it doesn't reopen after the rep closes the modal.
  const optInHandledRef = useRef(false);
  useEffect(() => {
    const optIn = route?.params?.resultOptIn;
    if (!optIn?.calculatorId || optInHandledRef.current) return;
    if (isCalcLoading) return;
    const calc = tabs.find((t) => t.id === optIn.calculatorId);
    if (!calc) return;
    optInHandledRef.current = true;
    setActiveTabId(optIn.calculatorId);
    handleResultJob(optIn.calculatorId, 'sale', optIn.price, optIn.paymentMethod, optIn.downPayment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.resultOptIn, isCalcLoading, tabs]);

  /**
   * Deep link from the `agreement-signed` notification: open straight on the Job
   * Builder's Summary so the rep can Complete Job, skipping calculator + rollout.
   *
   * ⚠️ GATED ON THE DATA, not just the param. `DynamicJobBuilderScreen` takes nine
   * props this screen assembles from four hooks (`jobBuilderConfig`, `verticals`,
   * `consolidatedDealCenterData`, the calculator `tabs`). Flipping `flowStep`
   * before those resolve mounts the builder against empty state and the summary
   * renders blank — which is exactly the "opened but nothing populated" failure
   * this deep link exists to avoid. Waiting costs a spinner; not waiting costs the
   * rep their build.
   *
   * ⚠️ Also waits for `jobBuilderConfig`. `isCalcLoading` only covers System A
   * (the calculators); the System B job-builder config is a separate fetch and is
   * what actually renders the tabs.
   *
   * Runs once per navigation — `setFlowStep` is a one-way handoff, and re-firing
   * would yank the rep back to Summary after they pressed Back.
   */
  /**
   * Latched rather than read from the param, because the effect below CLEARS the
   * param once handled — reading it live would flip this back to false on the very
   * next render and the builder would fall back to step 1.
   */
  const [openedViaNotification, setOpenedViaNotification] = useState(false);
  const openJobBuilderHandledRef = useRef(false);
  useEffect(() => {
    if (!route?.params?.openJobBuilder || openJobBuilderHandledRef.current) return;
    if (isCalcLoading || !jobBuilderConfig || tabs.length === 0) return;

    openJobBuilderHandledRef.current = true;
    setOpenedViaNotification(true);
    if (__DEV__) {
      console.log(
        `[DynamicDealCenter] openJobBuilder → Summary (tabs=${tabs.length}, calcId=${
          route?.params?.calculatorResultData?.calculatorId || 'NONE'
        })`
      );
    }

    // ⚠️ THE NOTIFICATION'S calculatorId HAS TO LAND IN STATE, NOT JUST IN THE PARAM.
    // `calculatorResultData` is LOCAL STATE seeded to null — the normal flow fills it
    // from the Result modal — and the route param of the same name is read ONLY by the
    // edit branch at the top of this file. So the deep link mounted the builder with
    // `calcId` undefined, its `GET lead/v1/{id}/outcome/{calcId}` query stayed DISABLED
    // (`enabled: Boolean(leadId && calcId)`), and the rep landed on an EMPTY build
    // reading `Avail 1234 / Used 0` — the calculator's budget resolved from the tab's
    // entries, the saved job state never loaded at all.
    //
    // Batched with `setFlowStep` below, so the builder mounts with it already set
    // rather than mounting empty and refetching a frame later.
    const pushedResult = route?.params?.calculatorResultData;
    const pushedCalcId = pushedResult?.calculatorId ? String(pushedResult.calculatorId) : '';
    if (pushedCalcId) {
      // Never clobber a real Result-modal payload: if the rep resulted the deal in
      // THIS session, that object carries the contract price and payment methods the
      // push does not have.
      setCalculatorResultData((prev: any) =>
        prev?.calculatorId
          ? prev
          : { ...pushedResult, resultType: resultTypeFromLead(lead) }
      );
    }

    // Prefer the calculator the notification named; fall back to the lead's own
    // selected one, which is what the Lead Center's auto-open uses.
    const targetId = pushedCalcId || resolveLeadCalculatorId(lead) || undefined;
    if (targetId && tabs.some((t) => t.id === targetId)) setActiveTabId(targetId);

    // Same reason as `openJobBuilder` below: this path opens the builder without
    // remounting anything, so the config has to be re-read explicitly.
    refetchJobBuilderConfig();
    setFlowStep('jobBuilder');
    // Clear it so a later re-render (or a Back into this screen) cannot re-trigger.
    navigation?.setParams({ openJobBuilder: undefined } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.openJobBuilder, isCalcLoading, jobBuilderConfig, tabs]);

  /**
   * Rendered alongside BOTH result-modal mounts (calculator step and rollout step) —
   * `handleResultConfirm` can fire from either, so a single mount would leave the
   * prompt invisible on one of the two paths and the rep stuck on the result step.
   * Inert unless `rehashBuild.prompt`, which only a rehash can set.
   */
  const buildFromExistingPrompt = (
    <BuildFromExistingModal
      visible={rehashBuild.prompt}
      onReuse={() => {
        setRehashBuild({ prompt: false, startFresh: false });
        setFlowStep('jobBuilder');
      }}
      onStartFresh={() => {
        setRehashBuild({ prompt: false, startFresh: true });
        setFlowStep('jobBuilder');
      }}
    />
  );

  const handleResultConfirm = useCallback((data: any, calcIdOverride?: string) => {
    setResultModal({ visible: false });
    // ⚠️ `calcIdOverride` is for the RESUME path, which reaches this in the same tick
    // as its `setCurrentCalculatorId` — the state is not readable yet, so the id has
    // to travel as an argument. The sheet passes nothing and behaves exactly as before.
    const resultCalcId = calcIdOverride || currentCalculatorId;

    // Persist the down payment the rep typed IN THIS MODAL back onto the calculator.
    //
    // ⚠️ Without this the figure lives only in `calculatorResultData`, which is screen
    // state: Build Job → back → reopen Result Lead and the field reads $0.00 again,
    // because `initialDownPayment` comes from the SAVED calculator and nothing ever wrote
    // it there. Reported as "down payment not saved when entered in lead result modal".
    // `handleSetDownPayment` marks the tab dirty, so it rides the same debounced
    // `PUT /lfcalculators/{id}` as the rollout card's own down-payment input and hydrates
    // on the next load. A demo has no down payment, so only a sale writes.
    //
    // ⚠️ Keyed on `resultCalcId`, NOT `currentCalculatorId`: on the resume path the
    // state id is a tick stale, so writing against it would save the down payment onto
    // the PREVIOUSLY selected calculator — and silently, since both writes succeed.
    if (resultCalcId && data?.resultType === 'sale') {
      handleSetDownPayment(resultCalcId, Number(data?.downPayment) || 0);
    }

    // Attach the calculator snapshot + appointment so the outcome payload can send
    // `LFCalculator` and `selectedAppointmentId` (web parity — every outcome save
    // carries the associated calculator object; previously omitted on mobile).
    const calc: any = tabs.find((t) => t.id === resultCalcId);
    setCalculatorResultData({
      ...data,
      calculatorId: resultCalcId,
      LFCalculator: calc || {},
      selectedAppointmentId: calc?.appointmentId,
    });

    // Web parity (result-lead-modal.js:3192 "Build Job" click): tapping Build Job
    // COMPLETES the lead-result milestone and moves the job build to active —
    // `{ leadResulted: 'completed', jobBuild: 'active' }` (salesProcess already done).
    // This previously sent `leadResulted: 'active'`, which is the value the WEB sends
    // at the earlier Sale/Demo PICK, not at Build Job — so the portal's Forever Record
    // showed "Lead Resulted — in progress / Pending / Result: N/A" and never flipped to
    // Complete (the milestone's Complete gate is `status === 'completed'`). The job
    // builder's finalize (DynamicJobBuilderScreen) still sets jobBuild:'complete' after.
    const leadIdForProgress = lead?._id || lead?.leadId || lead?.id;
    if (leadIdForProgress) {
      LeadService.updateLeadTimelineProgress(leadIdForProgress, {
        salesProcess: 'completed',
        leadResulted: 'completed',
        jobBuild: 'active',
      }).catch((e: any) => console.warn('[DynamicDealCenter] timeline progress failed:', e?.message || e));
    }
    // Web parity (result-lead-modal.js:1748): "Build Job" clicked → transition into
    // the job builder. Fires ONLY here (the LeadCenter build_job_initiated calls are
    // for the legacy JobBuilder navigation, not this dynamic step).
    const uId = user?._id || user?.id;
    if (uId && leadIdForProgress) {
      logBuildJobInitiated({
        userId: uId,
        leadId: leadIdForProgress,
        result: data?.resultType || data?.result || undefined,
        calculatorId: resultCalcId || undefined,
        appointmentId: calc?.appointmentId || appointmentId || undefined,
        calculatorType: 'dynamic',
      }).catch(() => {});
    }
    /**
     * Web `TabbedCalculator.startJobBuild`.
     *
     * Opening the job builder normally reuses any saved build for the calculator
     * without saying so. On a REHASH the rep is picking up a lead they already
     * worked, so that reuse has to be their explicit call — ask before applying it.
     *
     * The extra GET is web's too (its `loadCalculatorDraft` re-reads the same endpoint
     * a moment later). On any non-404 failure it falls through and opens as normal: a
     * lookup problem must never block the rep from building.
     *
     * Inlined rather than lifted into its own `useCallback` for the reason on
     * `rehashBuild` above — the deps it would need (`lead`, `currentCalculatorId`) are
     * already this callback's.
     */
    const openJobBuilder = (startFresh: boolean) => {
      // ⚠️ Re-read the published config EVERY time the builder is opened.
      //
      // `refetchOnMount: 'always'` on the query only fires when a new OBSERVER
      // mounts, and this screen owns the only one — `DynamicJobBuilderScreen`
      // receives the config as the `initialConfig` prop rather than calling the
      // hook. Opening the builder just flips `flowStep`, and closing it with the ✕
      // flips it back, so the Deal Center never unmounts and the config was fetched
      // exactly once per visit to Tools. A portal edit made while the rep sat on
      // this screen was therefore never picked up.
      //
      // The refetch is deliberately NOT awaited: React Query serves the cached
      // config synchronously so the builder opens with no delay, then re-renders if
      // the refetch actually returns something different.
      refetchJobBuilderConfig();
      setRehashBuild({ prompt: false, startFresh });
      setFlowStep('jobBuilder');
    };

    if (lead?.isRehashed !== true || !resultCalcId || !leadIdForProgress) {
      openJobBuilder(false);
      return;
    }

    LeadService.getLeadOutcomeByCalculator(leadIdForProgress, resultCalcId)
      .then((res: any) => {
        if (hasSavedJobBuild(extractCalculatorOutcome(res.data))) {
          setRehashBuild({ prompt: true, startFresh: false });
        } else {
          openJobBuilder(false);
        }
      })
      .catch((e: any) => {
        // 404 means there's no prior build to offer — expected, not a failure.
        if (e?.httpStatus !== 404) {
          console.warn('[DynamicDealCenter] existing job-build check failed:', e?.message || e);
        }
        openJobBuilder(false);
      });
    // Both `handleSetDownPayment` (the down-payment write above) and
    // `refetchJobBuilderConfig` (the config re-read in `openJobBuilder`) are called by this
    // callback, so both belong here. They arrived from opposite sides of a merge and the
    // conflict resolution kept the union -- dropping either reintroduces a stale closure.
  }, [currentCalculatorId, tabs, lead, user, appointmentId, handleSetDownPayment, refetchJobBuilderConfig]);

  // Assigned every render so the resume path always fires the CURRENT closure. A
  // `useEffect` would land a render late, and this is invoked from an async handler
  // that can resolve before an effect for the same render has run.
  resumeRef.current.confirm = handleResultConfirm;

  const handleJobBuilderBack = useCallback(() => {
    setFlowStep('calculator');
  }, []);

  const handleJobBuilderComplete = useCallback((config: any, state: any) => {
    navigation?.reset({
      index: 1,
      routes: [
        { name: 'Leads' },
        {
          name: 'LeadCenter',
          // `justCompleted` tells LeadCenter the lead was just resulted so it force-
          // refetches (a few times, to beat backend replication lag) instead of
          // showing the stale `lead` we pass here — previously the rep had to leave
          // the lead and come back before the result status / docs updated.
          params: { lead, tab: 'job_docs', justCompleted: true },
        },
      ],
    });
  }, [navigation, lead]);

  // Build the dealCenterData map using the same algorithm as the web's
  // buildDealCenterSessionData — extracts field-option aliases from the
  // calculator form schemas so that tab.dcField references (which may use
  // a field's legacy name rather than its id) are correctly resolved.
  //
  // Source the entries from the RESULTED calculator (the one the job builder
  // belongs to), NOT `activeTab` — they can differ, and the job builder's
  // LOCKED, dcField-driven fields (e.g. gutter Extras: Wedges/Straps/Modify
  // Height) resolve their values from THIS map on reopen. If it were built from
  // the wrong/empty tab, those locked fields resolve to their blank default and
  // the saved values are wiped on load (confirmed against live data). Falls back
  // to the active tab, then the resulted calc snapshot carried on resultData.
  const consolidatedDealCenterData = useMemo(() => {
    const resultedId = calculatorResultData?.calculatorId || currentCalculatorId;
    const resultedTab = resultedId ? tabs.find((t) => t.id === resultedId) : undefined;
    const entries =
      resultedTab?.entries ||
      calculatorResultData?.LFCalculator?.entries ||
      activeTab?.entries ||
      {};
    return buildDealCenterData({
      entries,
      resultData: calculatorResultData || {},
      schemas: verticals,   // CalculatorSchema[] — same array used by the calculator
      lead: lead || {},
    });
  }, [lead, calculatorResultData, currentCalculatorId, tabs, activeTab, verticals]);

  /**
   * Every calculator on the appointment, in the BACKEND shape, for the
   * `rollout_and_drop_summary` activity log the portal board reads. Web hands that log
   * its whole `appointmentsCalculator` list; passing only the resulted calculator made
   * a lead worked across four rollouts log as one, with only its own drops counted.
   *
   * A plain const, not a `useMemo`: every hook in this component sits after the
   * edit-mode early return, so each new one widens that compromise — and the only
   * consumer is a submit-time callback, where identity churn costs nothing.
   */
  const summaryCalculators = tabs.map((t) => ({
    _id: t.id,
    title: t.title,
    appointmentId,
    price: t.price,
    dropPrice: t.dropPrice || [],
    paymentMethod: t.paymentMethod,
    totals: t.totals,
    entries: t.entries,
  }));

  if (flowStep === 'jobBuilder') {
    return (
      <DynamicJobBuilderScreen
        navigation={navigation}
        initialConfig={jobBuilderConfig ?? undefined}
        // System A calculator schemas — the summary tab resolves each card's
        // header colour from the matching schema CATEGORY's colour (web parity:
        // `resolveTabAccentColor` → `findTabCategoryColorFromSchemas`). These are
        // NOT on `initialConfig`, which is the System B job-builder config.
        calculatorSchemas={verticals}
        dealCenterData={consolidatedDealCenterData}
        calculatorResultData={calculatorResultData}
        leadId={lead?._id || lead?.leadId || lead?.id}
        // Read only by the job-tracker auto-add on Sale: the rep initials that
        // build the job number, and the Lowe's admin-fee waiver.
        lead={lead}
        // Web sends the calculator's OWN appointment id on every outcome write and names
        // it in the rollout/drop summary log. Without it the log shipped
        // `appointmentId: undefined` and the outcome fell back to the LEAD id, which is
        // why mobile-created jobs read `jobBuilder.appointmentId === lead._id`.
        appointmentId={appointmentId || undefined}
        // The whole rollout list for the summary log (web `appointmentsCalculator`).
        allCalculators={summaryCalculators}
        // Rehash + "Start Fresh": load the outcome but not its saved build.
        startFresh={rehashBuild.startFresh}
        // Deep-linked from the `agreement-signed` notification — land on Summary,
        // one tap from Complete Job, rather than on step 1.
        openOnSummary={openedViaNotification}
        onGoBack={handleJobBuilderBack}
        onJobComplete={handleJobBuilderComplete}
      />
    );
  }

  if (flowStep === 'rollout') {
    // The outcome modal must be mounted alongside the rollout view too — the
    // rollout's "Result Lead" button and the drop modal's "Secure This Price"
    // both open it (otherwise the visibility state toggles with nothing to show).
    return (
      <>
        <RolloutView
          calculators={tabs}
          verticals={verticals}
          pricingConfig={pricingConfig}
          pricing={pricing}
          isLowesLead={lead?.lowesLead === true}
          isRehashed={lead?.isRehashed === true}
          leadId={lead?._id || lead?.leadId || lead?.id}
          appointmentId={appointmentId || undefined}
          onBack={() => setFlowStep('calculator')}
          onConfirmRollouts={(confirmed) => {
            // A rehash draft the rep has just priced and confirmed is an ordinary
            // confirmed calculator now, so it locks on the way back to the calculator
            // step. Driven by the confirm ACTION, not by re-reading `isRolloutConfirmed`
            // — on a rehash that flag can already be true on arrival, so it cannot mark
            // the transition. Inline (not a `useCallback`) because `RolloutView` holds
            // this in a ref, and because another hook here would widen the compromise
            // noted on `rehashBuild`.
            releaseRehashDrafts(rehashLatchRef.current, confirmed.map((c) => c.id));
            handleConfirmRollouts(confirmed);

            // ⚠️ Arm the tools list's local-confirmation grace HERE, at the moment of
            // confirmation — not only on "Jobs Built — Back to Tools" below.
            //
            // The confirmation is written by the DEBOUNCED save engine
            // (`SAVE_DEBOUNCE_MS = 1500` plus the round trip), and the Investment Center
            // tile reads the server on focus. `markLeadRolloutsConfirmed` is what bridges
            // that gap, but it used to fire only on that one button — so every other way
            // out of here raced the PUT: the header back arrow, hardware back, and the
            // 10-minute AUTO-confirm (`checkAndAutoConfirm`, which the rep never sees).
            // Win the race on a fast connection and the tile is open; lose it on weak LTE
            // and it reads "Please Fully Build ALL jobs first". That is the intermittent
            // "confirmed rollouts but Investment Center not ready" report — it is a
            // timing bug, which is exactly why it reproduces on some devices and not
            // others.
            //
            // Guarded on the confirm completing the WHOLE set, because the override
            // asserts `allConfirmed` outright; confirming one of three must not unlock
            // anything. `handleConfirmRollouts`' state update hasn't landed yet, so the
            // set is projected from `confirmed` rather than re-read from `tabs`.
            const justConfirmed = new Set(confirmed.map((c) => c.id));
            const afterConfirm = tabs.map((t) =>
              justConfirmed.has(t.id) ? { ...t, isRolloutConfirmed: true } : t
            );
            if (allRolloutsConfirmed(afterConfirm)) {
              markLeadRolloutsConfirmed(queryClient, lead);
            }
          }}
          onResultJob={handleResultJob}
          // Persist the entered end price live (survives back-to-calculator edits) and
          // let the rep dismiss the "job scope changed" warning once reviewed.
          onPriceCommit={handleSetPrice}
          onDismissScopeWarning={handleAckScopeWarning}
          onPaymentMethodChange={handleSetPaymentMethod}
          onDropChange={handleSetDrops}
          onDiscountChange={handleSetDiscount}
          onDownPaymentChange={handleSetDownPayment}
          onRendersChange={handleSetRenders}
          onOneYearMonthlyChange={handleSetOneYearMonthly}
          onRolloutsConfirmedDone={() => {
            // This button only renders once every rollout is confirmed — the exact
            // condition the Investment Center tile gates on. Prime the tools list's
            // status cache here so the tile is live the moment the rep lands, instead
            // of after two GETs it doesn't need to wait for.
            markLeadRolloutsConfirmed(queryClient, lead);
            navigation?.navigate('LeadCenter', { lead, tab: 'tools' });
          }}
          activeTabId={activeTabId}
          onTabSelect={setActiveTabId}
          submittedCalculatorId={submittedCalculatorId}
          onResetJobBuilder={handleResetJobBuilder}
        />
        <ResultJobModal
          visible={resultModal.visible}
          lead={lead}
          calculatorTitle={tabs.find((t) => t.id === resultModal.calculatorId)?.title}
          // Display never uses it — it links every funding log row back to the quote.
          calculatorId={resultModal.calculatorId}
          fundingSource={fundingSource}
          resultType={resultModal.resultType}
          initialPrice={resultModal.price}
          initialPaymentMethod={resultModal.paymentMethod}
          initialDownPayment={resultModal.downPayment}
          startOnFunding={resultModal.startOnFunding}
          entries={tabs.find((t) => t.id === resultModal.calculatorId)?.entries || {}}
          verticals={verticals}
          sectionLabelMap={sectionLabelMap}
          isLowesLead={lead?.lowesLead === true}
          pricing={pricing}
          onClose={() => setResultModal({ visible: false })}
          onConfirm={handleResultConfirm}
        />
        {buildFromExistingPrompt}
        <ConfirmDialog
          visible={!!fundingBlock}
          tone="warn"
          hideCancel
          title="Funding already submitted"
          message={`You already submitted a funding against the calculator "${fundingBlock?.ownerTitle || ''}".`}
          note="To submit another calculator against this lead, first run the refund process against that submitted job."
          confirmLabel="OK"
          onConfirm={() => setFundingBlock(null)}
          onCancel={() => setFundingBlock(null)}
        />
      </>
    );
  }

  const isLoading = isSchemaLoading || isCalcLoading || isJobBuilderConfigLoading;
  // Web parity (isDynamicJobBuilderEnabled): the dynamic flow requires BOTH a
  // configured calculator schema AND a published job-builder config. There is no
  // mock fallback — if either is missing we surface a not-configured state.
  const isDynamicConfigured = hasCalculatorSchema && hasJobBuilderConfig;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['bottom']}>
      {/* Compact header — back button + lead name + save status, matching the regular deal center */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
        <TouchableOpacity
          onPress={() => navigation?.goBack()}
          style={{ width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
        >
          <Ionicons name="arrow-back" size={16} color="#637381" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 18, fontWeight: '900', color: '#1C252E' }} numberOfLines={1}>
             {customerName}
            {leadTime ? <Text style={{ fontSize: 18, fontWeight: '900', color: '#1C252E' }}> - {leadTime} Lead</Text> : ''}
          </Text>
          {isSaving ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 1 }}>
              <ActivityIndicator size={8} color="#4CBB17" />
              <Text style={{ fontSize: 10, fontWeight: '900', color: '#16a34a', marginLeft: 4 }}>Syncing…</Text>
            </View>
          ) : (
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#94A3B8', marginTop: 1 }}>
              {lastUpdated ? `Last updated at ${lastUpdated}` : 'No changes to save'}
            </Text>
          )}
        </View> 
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#4CBB17" />
          <Text style={{ marginTop: 12, fontSize: 13, color: '#94A3B8' }}>Loading calculator…</Text>
        </View>
      ) : offlineUnavailable ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Ionicons name="cloud-offline-outline" size={40} color="#CBD5E1" />
          <Text style={{ marginTop: 12, fontSize: 15, fontWeight: '800', color: '#475569', textAlign: 'center' }}>
            This quote isn’t saved on your device
          </Text>
          <Text style={{ marginTop: 6, fontSize: 12, color: '#94A3B8', textAlign: 'center', lineHeight: 18 }}>
            This lead may already have calculators on the server, and starting a new one here
            {'\n'}would file it alongside them.
            {'\n'}{'\n'}Open the Deal Center once with a connection and it will be available offline.
          </Text>
          <TouchableOpacity
            onPress={() => navigation?.goBack()}
            style={{ marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#4CBB17' }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Back to Tools</Text>
          </TouchableOpacity>
        </View>
      ) : !isDynamicConfigured && !isOnline() ? (
        // ⚠️ Offline, a missing config means "never downloaded to this device", NOT "not
        // configured". Telling a rep at a door to ask an admin is wrong and unactionable. The
        // configs are cached once read online — the Leads list warms them (`useWarmDealCenterConfig`).
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Ionicons name="cloud-offline-outline" size={40} color="#CBD5E1" />
          <Text style={{ marginTop: 12, fontSize: 15, fontWeight: '800', color: '#475569', textAlign: 'center' }}>
            Deal Center isn’t saved on this device yet
          </Text>
          <Text style={{ marginTop: 6, fontSize: 12, color: '#94A3B8', textAlign: 'center', lineHeight: 18 }}>
            Open the Leads list or the Deal Center once with a connection and it will be available offline.
          </Text>
          <TouchableOpacity
            onPress={() => navigation?.goBack()}
            style={{ marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#4CBB17' }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Back</Text>
          </TouchableOpacity>
        </View>
      ) : !isDynamicConfigured ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Ionicons name="construct-outline" size={40} color="#CBD5E1" />
          <Text style={{ marginTop: 12, fontSize: 15, fontWeight: '800', color: '#475569', textAlign: 'center' }}>
            Deal Center isn’t configured yet
          </Text>
          <Text style={{ marginTop: 6, fontSize: 12, color: '#94A3B8', textAlign: 'center', lineHeight: 18 }}>
            {!hasCalculatorSchema
              ? 'No calculator form schema has been published for this company.'
              : 'No job-builder configuration has been published for this company.'}
            {'\n'}Ask an admin to configure it in the web portal. In the meantime, use
            {'\n'}“Classic Deal Center” on the previous screen.
          </Text>
          <TouchableOpacity
            onPress={() => navigation?.goBack()}
            style={{ marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#4CBB17' }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Use Classic Deal Center</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <CalculatorView
          verticals={verticals}
          customerTabName={customerTabName}
          pricingConfig={pricingConfig}
          entries={activeTab?.entries || {}}
          onEntryChange={handleEntryChange}
          onClearSection={handleClearSection}
          totals={activeTab?.totals || { cost: 0, par: 0, retail: 0 }}
          /**
           * A REHASH opens on the locked receipt view whenever the calculator ALREADY
           * holds a job scope, whatever the stored `isRolloutConfirmed` says.
           *
           * A rehash is a second run at a job that was already scoped and sold: the
           * rep is renegotiating the PRICE, not re-measuring the house. Dropping them
           * into the product-entry form (what mobile did) invites edits to gutter /
           * LeafFilter quantities that would silently re-scope the original sale.
           *
           * Not gated on `isRolloutConfirmed` because that flag is the ORIGINAL
           * appointment's and cannot be relied on to survive the rehash — `isRehashed`
           * is the fact we actually have.
           *
           * It is NOT sufficient on its own, though: a rehash whose calculator was
           * never built (`isRehashDraftTab` — see the latch above) has nothing to
           * protect and must open editable, or the rep is stuck on an empty $0 receipt
           * with no way to enter the job. That case is the only way a rehash reaches
           * the entry form; once the calculator carries a scope it locks as before.
           *
           * ⚠️ The draft verdict out-ranks `isRolloutConfirmed` TOO, which is why it
           * wraps the whole expression rather than sitting beside the rehash arm: a
           * rehash can inherit a `true` flag on a calculator holding no dynamic scope,
           * and that stale confirmation is what pinned the rep to the locked $0 receipt.
           * A confirm made in THIS session re-locks it — `releaseRehashDrafts` on the
           * rollout's `onConfirmRollouts` below.
           *
           * The end price stays LOCKED here, exactly as on any confirmed calculator.
           * Re-pricing a rehash happens one screen along, on the rollout step (the blue
           * grid button), where `PremiumQuoteCard.priceLocked` opens that one field —
           * so there is a single place a price is entered rather than two.
           */
          readOnly={!isRehashDraftTab && (activeTab?.isRolloutConfirmed || lead?.isRehashed === true)}
          price={activeTab?.price || 0}
          drops={activeTab?.dropPrice || []}
          tabs={tabs}
          activeTabId={activeTabId}
          onTabSelect={setActiveTabId}
          onAddTab={handleAddTab}
          onRenameTab={handleRenameTab}
          onDuplicateTab={handleDuplicateTab}
          onDeleteTab={handleDeleteTab}
          onReorderTabs={handleReorderTabs}
          onViewAll={() => {
            // Web parity (TabbedCalculator.js:667): view-all/rollout entry event.
            const uId = user?._id || user?.id;
            if (uId) logViewAllCalculators(uId).catch(() => {});
            setFlowStep('rollout');
          }}
          appointmentId={appointmentId || undefined}
          isLowesLead={lead?.lowesLead === true}
          plans={pricing.plans}
          defaultMethod={pricing.defaultMethod}
        />
      )}

        <ResultJobModal
          visible={resultModal.visible}
          lead={lead}
          calculatorTitle={tabs.find((t) => t.id === resultModal.calculatorId)?.title}
          // Display never uses it — it links every funding log row back to the quote.
          calculatorId={resultModal.calculatorId}
          fundingSource={fundingSource}
          resultType={resultModal.resultType}
          initialPrice={resultModal.price}
          initialPaymentMethod={resultModal.paymentMethod}
          initialDownPayment={resultModal.downPayment}
          startOnFunding={resultModal.startOnFunding}
          entries={tabs.find((t) => t.id === resultModal.calculatorId)?.entries || {}}
          verticals={verticals}
          sectionLabelMap={sectionLabelMap}
          isLowesLead={lead?.lowesLead === true}
          pricing={pricing}
          onClose={() => setResultModal({ visible: false })}
          onConfirm={handleResultConfirm}
        />
        {buildFromExistingPrompt}
        <ConfirmDialog
          visible={!!fundingBlock}
          tone="warn"
          hideCancel
          title="Funding already submitted"
          message={`You already submitted a funding against the calculator "${fundingBlock?.ownerTitle || ''}".`}
          note="To submit another calculator against this lead, first run the refund process against that submitted job."
          confirmLabel="OK"
          onConfirm={() => setFundingBlock(null)}
          onCancel={() => setFundingBlock(null)}
        />
    </SafeAreaView>
  );
}
