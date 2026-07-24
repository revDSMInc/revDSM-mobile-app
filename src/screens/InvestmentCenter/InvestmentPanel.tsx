import React, { useMemo, useState } from 'react';
import { View, Text, Image, ScrollView } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { resolveS3Url } from '../../utils/s3-utils';
import {
  DealPricing,
  calcMonthly,
  planLabelOf,
  isFinancing,
} from '../DynamicDealCenter/hooks/useDealPricing';
import {
  computeRolloutResult,
  screensCountFromEntries,
  screenUnitPriceFromSchemas,
} from '../DynamicDealCenter/utils/dynamic-rollout-pricing';
import { buildInvestmentJobScope } from '../DynamicDealCenter/utils/investment-job-scope';
import { ProgramCard } from './ProgramCard';
import { OptInConfirmModal } from './OptInConfirmModal';

/**
 * One calculator's Investment Center panel (web parity: `investment-panel.js`),
 * with the FIX for the web bug: the "Includes the Following" list is the DYNAMIC
 * per-product job-scope matrix (footages/colors stripped), not a hardcoded gutter
 * list. Shows the renders bound to this calculator, the scope matrix, the total
 * investment, and the In-Home vs 1-Year program branches (opting into 1-Year
 * crosses off In-Home; opting into In-Home fires the Result Lead handoff).
 */

const fmt = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;

interface Props {
  calculator: any;
  pricing: DealPricing;
  verticals: any[];
  pricingConfig: any;
  jobBuilderConfig: any;
  descriptionSchemas: any[];
  lead: any;
  onOptIn: (calculatorId: string, opts: { price: number; paymentMethod?: string; downPayment?: number }) => void;
}

const imgUri = (pair: any) =>
  pair?.generatedUrl || (pair?.s3UrlGenerated ? resolveS3Url(pair.s3UrlGenerated) : '') || '';
const beforeUri = (pair: any) =>
  pair?.originalUrl || (pair?.s3UrlOriginal ? resolveS3Url(pair.s3UrlOriginal) : '') || '';

export function InvestmentPanel({ calculator, pricing, verticals, pricingConfig, jobBuilderConfig, descriptionSchemas, lead, onOptIn }: Props) {
  const [selectedProgram, setSelectedProgram] = useState<'inhome' | 'oneyear' | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const plans = pricing.plans;
  const method = calculator.paymentMethod || pricing.defaultMethod || 'check';
  // Mirror the rollout's locked breakdown EXACTLY: it computes MSRP/programs from the
  // confirmed END PRICE (`calculator.price`) and the calculator's own down payment —
  // NOT the drop price (drops have their own breakdown). Using the same inputs as
  // RolloutView guarantees the Investment Center cards match what the rep confirmed.
  const endPrice = Number(calculator.price) || 0;
  const downPay = Number(calculator.downPayment) || 0;
  const discountPct = calculator.discountPercentage || pricing.defaultPreOrder;
  const seniorVetPct = pricing.seniorVetPct;

  const screensCount = useMemo(() => screensCountFromEntries(calculator.entries), [calculator.entries]);
  const screenUnitPrice = useMemo(() => screenUnitPriceFromSchemas(verticals, pricingConfig), [verticals, pricingConfig]);

  const result = useMemo(
    () =>
      computeRolloutResult({
        endPrice,
        screensCount,
        screenUnitPrice,
        discountConfig: pricing.discountConfig,
        discountPct,
        seniorVetPct,
        downPayment: downPay,
        plan: plans[method],
      }),
    [endPrice, screensCount, screenUnitPrice, pricing.discountConfig, discountPct, seniorVetPct, downPay, plans, method],
  );

  const msrp = result.msrp;
  const inHomeProgram = result.programs.find((p: any) => p.isHighlighted) || result.programs[result.programs.length - 1];
  const oneYearProgram = result.programs.find((p: any) => !p.isHighlighted) || result.programs[0];
  const inHomeGrandTotal = inHomeProgram?.grandTotal ?? msrp;
  const oneYearGrandTotal = oneYearProgram?.grandTotal ?? msrp;
  const inHomeMonthly = result.monthly;
  // Discount lines shown in each card (same formulas as RolloutView:1335/1349/1350).
  const srVetDiscount = msrp * (seniorVetPct / 100);
  const preOrderDiscountVal = msrp * (discountPct / 100);

  // 1-Year monthly resolved from the saved oneYearMonthlyPlan selection.
  const defaultOneYearKey = useMemo(() => {
    const fin = Object.keys(plans).filter((k) => isFinancing(plans, k));
    return fin.find((k) => Math.round((plans[k]?.apr || 0) * 100) / 100 === 9.99) || fin.find((k) => (plans[k]?.apr || 0) > 0) || fin[0] || method;
  }, [plans, method]);
  const oneYear = calculator.oneYearMonthlyPlan;
  const oneYearKey = oneYear?.mode === 'match' ? method : oneYear?.mode === 'custom' ? (oneYear?.planKey || defaultOneYearKey) : defaultOneYearKey;
  const oneYearMonthly = useMemo(() => calcMonthly(plans, oneYearGrandTotal, oneYearKey), [plans, oneYearGrandTotal, oneYearKey]);

  // Dynamic per-product job-scope matrix (no footages/colors) — the corrected data.
  const jobScope = useMemo(
    () =>
      buildInvestmentJobScope({
        entries: calculator.entries || {},
        calculatorSchemas: verticals,
        jobBuilderConfig,
        descriptionSchemas,
        lead,
      }),
    [calculator.entries, verticals, jobBuilderConfig, descriptionSchemas, lead],
  );

  const renders: any[] = Array.isArray(calculator.selectedRenders) ? calculator.selectedRenders : [];

  const confirmInHome = () => {
    setShowConfirm(false);
    onOptIn(calculator.id, { price: endPrice, paymentMethod: method, downPayment: downPay });
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
      {/* Product / brand heading */}
      <View style={{ alignItems: 'center', marginBottom: 14 }}>
        <Text style={{ fontSize: 18, fontWeight: '900', color: '#1C252E', textAlign: 'center' }}>Your Investment</Text>
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#637381', marginTop: 2, textAlign: 'center' }}>{calculator.title}</Text>
      </View>

      {/* Selected renders */}
      {renders.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingBottom: 4 }} style={{ marginBottom: 16 }}>
          {renders.map((pair, i) => (
            <View key={pair?.runId || i} style={{ width: 220, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0' }}>
              <View style={{ flexDirection: 'row' }}>
                <View style={{ flex: 1 }}>
                  <Image source={{ uri: beforeUri(pair) }} style={{ width: '100%', height: 110, backgroundColor: '#F1F5F9' }} resizeMode="cover" />
                  <Text style={{ fontSize: 8, fontWeight: '900', color: '#94A3B8', textAlign: 'center', paddingVertical: 3 }}>BEFORE</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Image source={{ uri: imgUri(pair) }} style={{ width: '100%', height: 110, backgroundColor: '#F1F5F9' }} resizeMode="cover" />
                  <Text style={{ fontSize: 8, fontWeight: '900', color: '#4CBB17', textAlign: 'center', paddingVertical: 3 }}>AFTER</Text>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Includes the Following — the DYNAMIC job scope matrix */}
      <View style={{ marginBottom: 18 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: '#94A3B8', textAlign: 'center', marginBottom: 12 }}>Includes the Following:</Text>
        {jobScope.length === 0 ? (
          <Text style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', fontStyle: 'italic' }}>
            Job scope will appear once products are configured.
          </Text>
        ) : (
          jobScope.map((line, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10, paddingHorizontal: 4 }}>
              <Ionicons name="checkmark-circle" size={16} color="#4CBB17" style={{ marginTop: 1, marginRight: 8 }} />
              <Text style={{ flex: 1, fontSize: 14, color: '#1C252E', lineHeight: 20 }}>{line}</Text>
            </View>
          ))
        )}
      </View>

      {/* Total Investment (MSRP) */}
      <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0' }}>
        <View style={{ backgroundColor: '#1E293B', paddingVertical: 12, alignItems: 'center' }}>
          <Text style={{ fontSize: 13, fontWeight: '900', color: '#fff', letterSpacing: 1 }}>TOTAL INVESTMENT</Text>
        </View>
        <View style={{ backgroundColor: '#fff', paddingVertical: 22, alignItems: 'center' }}>
          <Text style={{ fontSize: 34, fontWeight: '900', color: '#15803D' }}>{fmt(msrp)}</Text>
        </View>
      </View>

      {/* Branch connector: stem down from Total Investment, splitting to each program. */}
      <View style={{ height: 26 }}>
        <View style={{ position: 'absolute', top: 0, left: '50%', width: 2, height: 13, backgroundColor: '#CBD5E1' }} />
        <View style={{ position: 'absolute', top: 13, left: '25%', right: '25%', height: 2, backgroundColor: '#CBD5E1' }} />
        <View style={{ position: 'absolute', top: 13, left: '25%', width: 2, height: 13, backgroundColor: '#CBD5E1' }} />
        <View style={{ position: 'absolute', top: 13, right: '25%', width: 2, height: 13, backgroundColor: '#CBD5E1' }} />
      </View>

      {/* Program branches */}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <ProgramCard
          title="1 YEAR PROGRAM"
          // Same rows as the rollout's 1-Year box: Total (MSRP) + Sr+Vet (no pre-order discount).
          rows={[
            { label: 'Total', value: fmt(msrp) },
            { label: `${seniorVetPct}% Sr + Vet`, value: `-${fmt(srVetDiscount)}`, green: true },
          ]}
          grandTotal={oneYearGrandTotal}
          monthly={oneYearMonthly}
          planLabel={oneYearMonthly > 0 ? planLabelOf(plans, oneYearKey) : undefined}
          selected={selectedProgram === 'oneyear'}
          crossedOff={selectedProgram === 'inhome'}
          optInLabel="Opt In (1-Yr)"
          // 1-Year is visual-only: opting in just crosses off In-Home (web parity).
          onOptIn={() => setSelectedProgram(selectedProgram === 'oneyear' ? null : 'oneyear')}
          onRevert={() => setSelectedProgram(null)}
        />
        <ProgramCard
          title="IN-HOME PRE ORDER"
          highlighted
          // Same rows as the rollout's In-Home box: Total + Sr+Vet + Pre-Order Discount.
          rows={[
            { label: 'Total', value: fmt(msrp) },
            { label: `${seniorVetPct}% Sr + Vet`, value: `-${fmt(srVetDiscount)}`, green: true },
            { label: `${discountPct}% Discount`, value: `-${fmt(preOrderDiscountVal)}`, green: true },
          ]}
          grandTotal={inHomeGrandTotal}
          monthly={inHomeMonthly}
          planLabel={inHomeMonthly > 0 ? planLabelOf(plans, method) : undefined}
          downPayment={downPay}
          selected={selectedProgram === 'inhome'}
          crossedOff={selectedProgram === 'oneyear'}
          optInLabel="Opt In"
          onOptIn={() => { setSelectedProgram('inhome'); setShowConfirm(true); }}
          onRevert={() => setSelectedProgram(null)}
        />
      </View>

      <OptInConfirmModal
        visible={showConfirm}
        price={inHomeGrandTotal}
        monthly={inHomeMonthly}
        planLabel={inHomeMonthly > 0 ? planLabelOf(plans, method) : undefined}
        downPayment={downPay}
        method={method}
        isLowesLead={lead?.lowesLead === true}
        onConfirm={confirmInHome}
        onClose={() => { setShowConfirm(false); setSelectedProgram(null); }}
      />
    </ScrollView>
  );
}
