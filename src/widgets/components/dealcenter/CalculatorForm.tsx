import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Feather from 'react-native-vector-icons/Feather';
import JobService from '../../../services/api/JobService';
import { Section, SubHeader, InputField } from './SharedElements';
import { pricing } from '../../../utils/calculator/pricing-data';

const CATEGORY_STYLES: Record<string, { color: string; icon: string; bg: string }> = {
  Gutters: { color: '#00B8D9', icon: 'home', bg: '#E0F8FB' },
  LeafFilter: { color: '#4CBB17', icon: 'shield-checkmark', bg: '#EBF9E1' },
  Soffit: { color: '#00B8D9', icon: 'build', bg: '#E0F8FB' },
  Fascia: { color: '#8E33FF', icon: 'layers', bg: '#F2E8FF' },
  Lighting: { color: '#FFAB00', icon: 'bulb', bg: '#FFF8E6' },
  'Additional Services': { color: '#FFAB00', icon: 'add-circle', bg: '#FFF8E6' },
  Miscellaneous: { color: '#637381', icon: 'ellipsis-horizontal-circle', bg: '#F4F6F8' },
};

const CATEGORY_ORDER = [
  'Gutters', 'LeafFilter', 'Soffit', 'Fascia', 'Lighting', 'Additional Services', 'Miscellaneous',
];

export const LockedCalculatorView = ({
  inputs, extras, results, active, lead, onClose, isDark, colors, isAutoSaving, lastUpdatedAt,
  showWarning = true,
}: any) => {
  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  const rolloutEndPrice = Number(active?.price) || 0;
  const acceptedDrop = (active?.dropPrice || []).find((d: any) => d.status === 'accepted');

  /* ── Derived data ── */
  const categoryCounts: Record<string, number> = {};
  results.items.forEach((item: any) => {
    const cat = item.category || 'Additional Services';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });

  const uniqueCategories: string[] = (
    Array.from(new Set(results.items.map((i: any) => i.category || 'Additional Services')))
  ).sort((a: any, b: any) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia > -1 ? ia : 999) - (ib > -1 ? ib : 999);
  }) as string[];

  const sortedItems = [...results.items].sort((a: any, b: any) => {
    const ia = CATEGORY_ORDER.indexOf(a.category || 'Additional Services');
    const ib = CATEGORY_ORDER.indexOf(b.category || 'Additional Services');
    return (ia > -1 ? ia : 999) - (ib > -1 ? ib : 999);
  });

  const visibleItems = selectedCat
    ? sortedItems.filter((i: any) => (i.category || 'Additional Services') === selectedCat)
    : sortedItems;

  const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;

  const calcName =
    active?.name && active.name !== '.'
      ? active.name
      : lead?.customerDetails?.firstName
        ? `${lead.customerDetails.firstName} ${lead.customerDetails.lastName}`
        : lead?.title || 'Calculator';

  return (
    <View style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 48 }}
      >
        {/* ── Top header: back button + lead name ── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
          <TouchableOpacity
            onPress={onClose}
            style={{
              marginRight: 10, width: 34, height: 34,
              borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Feather name="arrow-left" size={14} color={isDark ? colors.text : colors.textSecondary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 15, fontWeight: '900', color: '#1C252E' }} numberOfLines={1}>
              {lead?.customerDetails?.firstName
                ? `${lead.customerDetails.firstName} ${lead.customerDetails.lastName}`
                : lead?.title || 'Lead Center'}
              <Text style={{ fontSize: 15, fontWeight: '900', color: '#1C252E' }}>
                {' '}- {lead?.leadTime || ''} Lead
              </Text>
            </Text>
            {isAutoSaving ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                <ActivityIndicator size={8} color="#4CBB17" />
                <Text style={{ fontSize: 10, fontWeight: '900', color: '#16A34A', marginLeft: 4 }}>Syncing...</Text>
              </View>
            ) : lastUpdatedAt ? (
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#94A3B8', marginTop: 2 }}>
                Last updated at {lastUpdatedAt}
              </Text>
            ) : null}
          </View>
        </View>

        {/* ── Warning Banner (hidden when opened from Summary) ── */}
        {showWarning && (
          <View style={{
            backgroundColor: '#FFFBEB',
            borderWidth: 1, borderColor: '#FDE68A',
            borderRadius: 14, padding: 14, marginBottom: 14,
            flexDirection: 'row', alignItems: 'center',
          }}>
            <Ionicons name="lock-closed" size={16} color="#D97706" style={{ marginRight: 10 }} />
            <Text style={{ flex: 1, fontSize: 12, fontWeight: '600', color: '#92400E', lineHeight: 18 }}>
              Rollout price confirmed — this calculator is locked and cannot be edited. You can duplicate job tab or create new for easy editing for new job scope.
            </Text>
          </View>
        )}

        {/* ── ONE single container wrapping name + pills + items ── */}
        <View style={{
          backgroundColor: '#FFFFFF',
          borderWidth: 1.5,
          borderColor: '#4CBB17',
          borderRadius: 20,
          overflow: 'hidden',
          marginBottom: 16,
        }}>
          {/* Calculator name */}
          <View style={{ paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14 }}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: '#1C252E' }}>
              {calcName}
            </Text>
          </View>

          {/* Category filter pills — wrapping (no horizontal scroll) */}
          <View style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            paddingHorizontal: 14,
            paddingBottom: 14,
            gap: 8,
          }}>
            {uniqueCategories.map((cat: string) => {
              const s = CATEGORY_STYLES[cat] || { color: '#637381', icon: 'list', bg: '#F4F6F8' };
              const isActive = selectedCat === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  onPress={() => setSelectedCat(isActive ? null : cat)}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingHorizontal: 10, paddingVertical: 5,
                    borderRadius: 20,
                    backgroundColor: isActive ? s.color : s.bg,
                  }}
                >
                  <Ionicons name={s.icon} size={11} color={isActive ? '#FFF' : s.color} style={{ marginRight: 4 }} />
                  <Text style={{ fontSize: 11, fontWeight: '900', color: isActive ? '#FFF' : s.color }}>
                    {cat} {categoryCounts[cat]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Flat item rows — all inside the same container, divided by thin lines */}
          {visibleItems.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 28 }}>
              <Ionicons name="cube-outline" size={32} color="#CBD5E1" />
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#94A3B8', marginTop: 8 }}>
                No items in this category
              </Text>
            </View>
          ) : (
            visibleItems.map((item: any, i: number) => {
              const s = CATEGORY_STYLES[item.category] || { color: '#637381', icon: 'list', bg: '#F4F6F8' };
              return (
                <View key={i}>
                  {/* Top divider before each item (replaces individual borders) */}
                  <View style={{ height: 1, backgroundColor: '#F1F5F9' }} />
                  <View style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingHorizontal: 18, paddingVertical: 13,
                  }}>
                    {/* Circular icon */}
                    <View style={{
                      width: 38, height: 38, borderRadius: 19,
                      backgroundColor: s.bg,
                      alignItems: 'center', justifyContent: 'center',
                      marginRight: 14,
                    }}>
                      <Ionicons name={s.icon} size={18} color={s.color} />
                    </View>
                    {/* Quantity + label */}
                    <Text style={{ fontSize: 14, fontWeight: '600', color: '#1C252E', flex: 1 }}>
                      <Text style={{ fontWeight: '900' }}>{item.value}{item.unit || "'"}</Text>
                      {'  '}{item.label}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
          {/* Bottom padding inside container */}
          <View style={{ height: 8 }} />
        </View>

        {/* ── Pricing section — scrollable at the bottom, NOT fixed ── */}
        {/* COST / LIST / TOTAL boxes */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
          {[
            { label: 'COST', value: results.price50, highlight: false },
            { label: 'LIST', value: results.price65, highlight: false },
            { label: 'TOTAL', value: results.price100, highlight: true },
          ].map((tier, i) => (
            <View
              key={i}
              style={{
                flex: 1, alignItems: 'center', paddingVertical: 12,
                borderRadius: 14, borderWidth: 1,
                backgroundColor: tier.highlight ? '#DCFCE7' : '#F8FAFC',
                borderColor: tier.highlight ? '#86EFAC' : '#E2E8F0',
              }}
            >
              <Text style={{
                fontSize: 9, fontWeight: '900', letterSpacing: 1, marginBottom: 4,
                color: tier.highlight ? '#15803D' : '#94A3B8',
              }}>
                {tier.label}
              </Text>
              <Text style={{
                fontSize: 15, fontWeight: '900',
                color: tier.highlight ? '#15803D' : '#1C252E',
              }}>
                {fmt(tier.value)}
              </Text>
            </View>
          ))}
        </View>

        {/* Rollout End Price + LOCKED badge */}
        <View style={{
          backgroundColor: '#F0FDF4', borderRadius: 20,
          borderWidth: 2, borderColor: '#4CBB17',
          padding: 16,
        }}>
          {/* Rollout End Price Row */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ fontSize: 10, fontWeight: '900', color: '#15803D', letterSpacing: 1, marginBottom: 2 }}>
                Rollout End Price
              </Text>
              <Text style={{ fontSize: 24, fontWeight: '900', color: '#15803D' }}>
                {rolloutEndPrice > 0 ? fmt(rolloutEndPrice) : '—'}
              </Text>
            </View>
            <View style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: '#DCFCE7', paddingHorizontal: 14, paddingVertical: 7,
              borderRadius: 20,
            }}>
              <Ionicons name="lock-closed" size={12} color="#D97706" style={{ marginRight: 5 }} />
              <Text style={{ fontSize: 12, fontWeight: '900', color: '#15803D', letterSpacing: 0.5 }}>LOCKED</Text>
            </View>
          </View>

          {acceptedDrop && (
            <>
              <View style={{ height: 1, backgroundColor: isDark ? '#FFFFFF10' : '#E2E8F0', marginVertical: 12 }} />
              {/* Updated End Price Row */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ fontSize: 10, fontWeight: '900', color: '#15803D', letterSpacing: 1, marginBottom: 2 }}>
                    Updated End Price
                  </Text>
                  <Text style={{ fontSize: 24, fontWeight: '900', color: '#15803D' }}>
                    {fmt(acceptedDrop.dropedPrice)}
                  </Text>
                </View>
                <View style={{
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: '#DCFCE7', paddingHorizontal: 14, paddingVertical: 7,
                  borderRadius: 20,
                }}>
                  <Ionicons name="lock-closed" size={12} color="#D97706" style={{ marginRight: 5 }} />
                  <Text style={{ fontSize: 12, fontWeight: '900', color: '#15803D', letterSpacing: 0.5 }}>LOCKED</Text>
                </View>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
};

export const CalculatorForm = ({
  inputs,
  extras,
  expanded,
  onToggle,
  onUpdate,
  results,
  onClose,
  setShowTrackerModal,
  isAlreadyInTracker,
  handleAddJobToTracker,
  onGoToTracker,
  refresh,
  active,
  lead,
  isDark,
  colors,
  isAutoSaving,
  lastUpdatedAt,
  readOnly = false,
}: any) => {
  const guardedUpdate = (patch: any) => {
    if (readOnly) return;
    onUpdate(patch);
  };
  const hasGutterInput =
    Number(inputs.gutter5DsE) > 0 || Number(inputs.gutter6Ft1) > 0 || Number(inputs.gutter7DsE) > 0;
  const hasGutterData =
    hasGutterInput ||
    ['miters', 'endCaps', 'spoutSavers'].some((k) => Number(inputs[k]) > 0) ||
    [
      'wedges',
      'straps',
      'modifyHeight',
      'replaceCorner',
      'groundSpout',
      'extendedSplashGuard',
      'extendedSplashGuard032',
    ].some((k) => Number(extras[k]) > 0);

  const hasVersaOrFilter = [1, 2, 3].some(
    (s) =>
      Number(inputs[`versa6Ft${s}`]) > 0 ||
      Number(inputs[`versa7Ft${s}`]) > 0 ||
      Number(inputs[`filter45Ft${s}`]) > 0
  );
  const hasVersaMax = Number(inputs.versaMaxFt1) > 0;
  const hasProtectionData =
    hasVersaMax ||
    hasVersaOrFilter ||
    ['csr', 'cornersFilter', 'sawzallHanger', 'removeProtection', 'ribbedRoof'].some(
      (k) => Number(extras[k]) > 0
    );

  const hasSoffitData = ['vinylSoffit', 'porchCeiling', 'nailerBuildOut'].some(
    (k) => Number(extras[k]) > 0
  );
  const hasFasciaData = ['trimWrap', 'fasciaBoard', 'aluminumFasciaBoard'].some(
    (k) => Number(extras[k]) > 0
  );
  const hasLightingData = [
    'lighting1stStory',
    'lighting2ndStory',
    'lighting3rdStory',
    'lightingWifiExtender',
    'lightingBoosterBox',
    'lightingElectricalOutlet',
  ].some((k) => Number(extras[k]) > 0);
  const hasAdditionalData = Number(inputs.extraLabor) > 0 || Number(inputs.ckToInstallers) > 0;

  /* ── If locked, render the read-only locked view ── */
  if (readOnly) {
    return (
      <LockedCalculatorView
        inputs={inputs}
        extras={extras}
        results={results}
        active={active}
        lead={lead}
        onClose={onClose}
        isDark={isDark}
        colors={colors}
        isAutoSaving={isAutoSaving}
        lastUpdatedAt={lastUpdatedAt}
      />
    );
  }

  return (
    <ScrollView className="flex-1 bg-background" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View className="px-5 pt-6 pb-40">
        <View className="flex-row items-center justify-between pb-6">
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={onClose}
              className="mr-3 p-1 items-center justify-center w-8 h-8 border border-border rounded-lg"
            >
              <Feather
                name="arrow-left"
                size={14}
                color={isDark ? colors.text : colors.textSecondary}
              />
            </TouchableOpacity>
            <View>
              <Text className="text-lg font-black text-text-primary">
                {lead?.customerDetails?.firstName
                  ? `${lead.customerDetails.firstName} ${lead.customerDetails.lastName}`
                  : lead?.title || 'Lead Center'}{' '}
                <Text className="text-lg font-black text-text-primary">
                  - {lead.leadTime || ''} Lead
                </Text>
              </Text>
              <View className="flex-row items-center mt-0.5">
                <View className="mx-2 w-1 h-1 rounded-full bg-slate-300" />
                {isAutoSaving ? (
                  <View className="flex-row items-center">
                    <ActivityIndicator size={8} color="#4CBB17" />
                    <Text className="text-[10px] font-black text-green-600  ml-1">Syncing...</Text>
                  </View>
                ) : lastUpdatedAt ? (
                  <Text className="text-[10px] font-bold text-text-secondary ">
                    Last updated at {lastUpdatedAt}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        </View>

        <Section
          title="Gutters"
          id="gutters"
          icon="home"
          color="#00B8D9"
          desc="Gutter installation and accessories"
          expanded={expanded}
          onToggle={onToggle}
          onClear={
            hasGutterData
              ? () =>
                guardedUpdate({
                  inputs: {
                    gutter5DsE: '',
                    gutter6Ft1: '',
                    gutter7DsE: '',
                    miters: '',
                    endCaps: '',
                    spoutSavers: '',
                  },
                  extras: {
                    wedges: '',
                    straps: '',
                    modifyHeight: '',
                    replaceCorner: '',
                    groundSpout: '',
                    extendedSplashGuard: '',
                    extendedSplashGuard032: '',
                  },
                })
              : null
          }
        >
          <SubHeader title="All Stories" />
          <InputField
            label={'5" Gutter/DS/E'}
            value={inputs.gutter5DsE}
            keyName="gutter5DsE"
            price={pricing.gutters['5_inch_all_stories']}
            onUpdate={guardedUpdate}
            editable={!readOnly}
          />
          <InputField
            label={'6" Gutter/DS/Elbows'}
            value={inputs.gutter6Ft1}
            keyName="gutter6Ft1"
            price={pricing.gutters['6_inch_all_stories']}
            onUpdate={guardedUpdate}
            editable={!readOnly}
          />
          <InputField
            label={'7" Gutter/DS/Elbows'}
            value={inputs.gutter7DsE}
            keyName="gutter7DsE"
            price={pricing.gutters['7_inch_all_stories']}
            onUpdate={guardedUpdate}
            editable={!readOnly}
          />
          <SubHeader title="Extras" />
          <InputField
            label="Wedges"
            value={extras.wedges}
            keyName="wedges"
            price={pricing.extras.wedges}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
            highlighted={hasGutterInput}
          />
          <InputField
            label="Straps"
            value={extras.straps}
            keyName="straps"
            price={pricing.extras.straps}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
          <InputField
            label="Modify Height/R&R"
            value={extras.modifyHeight}
            keyName="modifyHeight"
            price={pricing.extras.modifyHeight}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
          <InputField
            label="Replace Corner Miter"
            value={extras.replaceCorner}
            keyName="replaceCorner"
            price={pricing.extras.replaceCorner}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
          <InputField
            label="GroundSpout"
            value={extras.groundSpout}
            keyName="groundSpout"
            price={pricing.extras.groundSpout}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
          <InputField
            label="Extended Splash Guard"
            value={extras.extendedSplashGuard}
            keyName="extendedSplashGuard"
            price={pricing.extras.extendedSplashGuard}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
          <InputField
            label="Extended .032 Splash Guard"
            value={extras.extendedSplashGuard032}
            keyName="extendedSplashGuard032"
            price={pricing.extras.extendedSplashGuard032}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
        </Section>

        <Section
          title="LeafFilter"
          id="protection"
          icon="shield-checkmark"
          color="#4CBB17"
          desc="Gutter protection system"
          expanded={expanded}
          onToggle={onToggle}
          onClear={
            hasProtectionData
              ? () =>
                guardedUpdate({
                  inputs: {
                    versaMaxFt1: '',
                    versa6Ft1: '',
                    versa7Ft1: '',
                    filter45Ft1: '',
                    versa6Ft2: '',
                    versa7Ft2: '',
                    filter45Ft2: '',
                    versa6Ft3: '',
                    versa7Ft3: '',
                    filter45Ft3: '',
                  },
                  extras: {
                    csr: '',
                    cornersFilter: '',
                    sawzallHanger: '',
                    removeProtection: '',
                    ribbedRoof: '',
                  },
                })
              : null
          }
        >
          <SubHeader title="All Stories" />
          <InputField
            label={'Versa Max'}
            value={inputs.versaMaxFt1}
            keyName="versaMaxFt1"
            price={pricing.filters.versa_max_all_stories}
            onUpdate={guardedUpdate}
            editable={!readOnly}
          />
          <InputField
            label={'C-S-R'}
            value={extras.csr}
            keyName="csr"
            price={pricing.extras.csr}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
          <SubHeader title="1st Story" />
          <InputField
            label={'6" Versa (1st Story)'}
            value={inputs.versa6Ft1}
            keyName="versa6Ft1"
            price={pricing.filters.versa_6['1']}
            onUpdate={guardedUpdate}
            editable={!readOnly}
          />
          <InputField
            label={'7" Versa (1st Story)'}
            value={inputs.versa7Ft1}
            keyName="versa7Ft1"
            price={pricing.filters.versa_7['1']}
            onUpdate={guardedUpdate}
            editable={!readOnly}
          />
          <InputField
            label={'4" & 5" Versa (1st Story)'}
            value={inputs.filter45Ft1}
            keyName="filter45Ft1"
            price={pricing.filters.filter_4_5['1']}
            onUpdate={guardedUpdate}
            editable={!readOnly}
          />
          <SubHeader title="2nd Story" />
          <InputField
            label={'6" Versa (2nd Story)'}
            value={inputs.versa6Ft2}
            keyName="versa6Ft2"
            price={pricing.filters.versa_6['2']}
            onUpdate={guardedUpdate}
            editable={!readOnly}
          />
          <InputField
            label={'7" Versa (2nd Story)'}
            value={inputs.versa7Ft2}
            keyName="versa7Ft2"
            price={pricing.filters.versa_7['2']}
            onUpdate={guardedUpdate}
            editable={!readOnly}
          />
          <InputField
            label={'4" & 5" Versa (2nd Story)'}
            value={inputs.filter45Ft2}
            keyName="filter45Ft2"
            price={pricing.filters.filter_4_5['2']}
            onUpdate={guardedUpdate}
            editable={!readOnly}
          />
          <SubHeader title="3rd Story" />
          <InputField
            label={'6" Versa (3rd Story)'}
            value={inputs.versa6Ft3}
            keyName="versa6Ft3"
            price={pricing.filters.versa_6['3']}
            onUpdate={guardedUpdate}
            editable={!readOnly}
          />
          <InputField
            label={'7" Versa (3rd Story)'}
            value={inputs.versa7Ft3}
            keyName="versa7Ft3"
            price={pricing.filters.versa_7['3']}
            onUpdate={guardedUpdate}
            editable={!readOnly}
          />
          <InputField
            label={'4" & 5" Versa (3rd Story)'}
            value={inputs.filter45Ft3}
            keyName="filter45Ft3"
            price={pricing.filters.filter_4_5['3']}
            onUpdate={guardedUpdate}
            editable={!readOnly}
          />
          <SubHeader title="Extras" />
          <InputField
            label="Corners (Filter)"
            value={extras.cornersFilter}
            keyName="cornersFilter"
            price={pricing.extras.cornersFilter}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
            highlighted={hasVersaOrFilter}
          />
          <InputField
            label="Sawzall Hanger"
            value={extras.sawzallHanger}
            keyName="sawzallHanger"
            price={pricing.extras.sawzallHanger}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
            highlighted={hasVersaOrFilter}
          />
          <InputField
            label="Remove Protection"
            value={extras.removeProtection}
            keyName="removeProtection"
            price={pricing.extras.removeProtection}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
            highlighted={hasVersaOrFilter}
          />
          <InputField
            label="Ribbed Roof"
            value={extras.ribbedRoof}
            keyName="ribbedRoof"
            price={pricing.extras.ribbedRoof}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
            highlighted={hasVersaMax}
          />
        </Section>

        <Section
          title="Soffit"
          id="structural"
          icon="build"
          color="#00B8D9"
          desc="Soffit installation services"
          expanded={expanded}
          onToggle={onToggle}
          onClear={
            hasSoffitData
              ? () =>
                guardedUpdate({
                  extras: { vinylSoffit: '', porchCeiling: '', nailerBuildOut: '' },
                })
              : null
          }
        >
          <InputField
            label="Vinyl Soffit"
            value={extras.vinylSoffit}
            keyName="vinylSoffit"
            price={pricing.extras.vinylSoffit}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
          <InputField
            label="Porch Ceiling Soffit (sqft)"
            value={extras.porchCeiling}
            keyName="porchCeiling"
            price={pricing.extras.porchCeiling}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
          <InputField
            label="Nailer Build Out"
            value={extras.nailerBuildOut}
            keyName="nailerBuildOut"
            price={pricing.extras.nailerBuildOut}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
        </Section>

        <Section
          title="Fascia"
          id="maintenance"
          icon="layers"
          color="#8E33FF"
          desc="Fascia board and trim services"
          expanded={expanded}
          onToggle={onToggle}
          onClear={
            hasFasciaData
              ? () =>
                guardedUpdate({
                  extras: { trimWrap: '', fasciaBoard: '', aluminumFasciaBoard: '' },
                })
              : null
          }
        >
          <InputField
            label="Trim Wrap (Fascia)"
            value={extras.trimWrap}
            keyName="trimWrap"
            price={pricing.extras.trimWrap}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
          <InputField
            label="Fascia Board"
            value={extras.fasciaBoard}
            keyName="fasciaBoard"
            price={pricing.extras.fasciaBoard}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
          <InputField
            label={'Aluminum 2"x2" Fascia Board'}
            value={extras.aluminumFasciaBoard}
            keyName="aluminumFasciaBoard"
            price={pricing.extras.aluminumFasciaBoard}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
        </Section>

        <Section
          title="LeafFilter Lighting"
          id="lighting"
          icon="bulb"
          color="#FFAB00"
          desc="LeafFilter lighting services"
          expanded={expanded}
          onToggle={onToggle}
          onClear={
            hasLightingData
              ? () =>
                guardedUpdate({
                  extras: {
                    lighting1stStory: '',
                    lighting2ndStory: '',
                    lighting3rdStory: '',
                    lightingControlBox: '',
                    lightingWifiExtender: '',
                    lightingBoosterBox: '',
                    lightingElectricalOutlet: '',
                  },
                })
              : null
          }
        >
          <InputField
            label="Lighting 1st Story"
            value={extras.lighting1stStory}
            keyName="lighting1stStory"
            price={pricing.extras.lighting1stStory}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
          <InputField
            label="Lighting 2nd Story"
            value={extras.lighting2ndStory}
            keyName="lighting2ndStory"
            price={pricing.extras.lighting2ndStory}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
          <InputField
            label="Lighting 3rd Story"
            value={extras.lighting3rdStory}
            keyName="lighting3rdStory"
            price={pricing.extras.lighting3rdStory}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
          {/* Control Box — auto-calculated, read-only */}
          <View className="relative mt-2 mb-3">
            <View className="absolute -top-[7px] left-3 z-10 px-1" style={{ backgroundColor: '#F4F6F8' }}>
              <Text className="text-[10px] font-black text-[#1C252E]">Control Box</Text>
            </View>
            <View
              className="flex-row items-center border rounded-lg"
              style={{
                borderColor: '#919EAB33',
                backgroundColor: '#F4F6F8',
                paddingVertical: 2,
                paddingHorizontal: 14,
              }}
            >
              <Text className="flex-1 h-11 text-sm font-black text-[#919EAB]" style={{ lineHeight: 44 }}>
                {String(extras.lightingControlBox || '').trim() === '0' || String(extras.lightingControlBox || '').trim() === '' ? '' : extras.lightingControlBox}
              </Text>
              <View className="flex-row items-center">
                <View className="border-l border-[#919EAB33] pl-3 ml-1 flex-row items-center">
                  <Text className="text-[10px] font-bold text-green-600">${pricing.extras.lightingControlBox}</Text>
                </View>
              </View>
            </View>
            <Text className="text-[8px] font-semibold text-slate-400 ml-1 mt-0.5">
              Auto-set to 1 when any lighting story footage is entered
            </Text>
          </View>
          <InputField
            label="WiFi Extender"
            value={extras.lightingWifiExtender}
            keyName="lightingWifiExtender"
            price={pricing.extras.lightingWifiExtender}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
          <InputField
            label="Booster Box(s)"
            value={extras.lightingBoosterBox}
            keyName="lightingBoosterBox"
            price={pricing.extras.lightingBoosterBox}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
          <InputField
            label="Electrical Outlet"
            value={extras.lightingElectricalOutlet}
            keyName="lightingElectricalOutlet"
            price={pricing.extras.lightingElectricalOutlet}
            onUpdate={guardedUpdate}
            editable={!readOnly}
            isExtra
          />
        </Section>

        <Section
          title="Additional Services"
          id="finance"
          icon="add-circle"
          color="#FFAB00"
          desc="Extra labor and services"
          expanded={expanded}
          onToggle={onToggle}
          onClear={
            hasAdditionalData
              ? () => guardedUpdate({ inputs: { extraLabor: '', ckToInstallers: '' } })
              : null
          }
        >
          <InputField
            label="Extra Labor"
            value={inputs.extraLabor}
            keyName="extraLabor"
            price={pricing.extras.extraLabor}
            onUpdate={guardedUpdate}
            editable={!readOnly}
          />
          <InputField
            label="Number of screens $75"
            value={inputs.ckToInstallers}
            keyName="ckToInstallers"
            price={75}
            onUpdate={guardedUpdate}
            editable={!readOnly}
          />
        </Section>

        <View className="mb-8 bg-[#F8F7FF] rounded-[32px] border border-[#E5D9FF]">
          <View className="p-5 flex-row items-center justify-between">
            <View className="flex-row items-center">
              <View className="w-12 h-12 rounded-2xl bg-[#E5D9FF] items-center justify-center mr-4">
                <Ionicons name="receipt" size={24} color="#6B46C1" />
              </View>
              <View>
                <Text className="text-xl font-extrabold text-[#1C252E]">Job Summary</Text>
                <Text className="text-sm text-[#637381] font-medium">
                  {results.items.length} items
                </Text>
              </View>
            </View>
            <View className="bg-[#E5D9FF] px-4 py-2 rounded-xl">
              <Text className="text-[12px] font-extrabold text-[#6B46C1]  tracking-wider">
                {results.items.length} Items
              </Text>
            </View>
          </View>

          <View className="px-5 pb-6">
            {Object.entries(
              results.items.reduce((acc: any, item: any) => {
                const cat = item.category || 'Additional Services';
                if (!acc[cat]) acc[cat] = [];
                acc[cat].push(item);
                return acc;
              }, {})
            ).map(([category, items]: any) => {
              const categoryStyles: Record<string, { color: string; icon: string; bg: string }> = {
                Gutters: { color: '#00B8D9', icon: 'home', bg: '#E0F8FB' },
                LeafFilter: { color: '#4CBB17', icon: 'shield-checkmark', bg: '#EBF9E1' },
                Soffit: { color: '#00B8D9', icon: 'build', bg: '#E0F8FB' },
                Fascia: { color: '#8E33FF', icon: 'layers', bg: '#F2E8FF' },
                Lighting: { color: '#FFAB00', icon: 'bulb', bg: '#FFF8E6' },
                'Additional Services': { color: '#FFAB00', icon: 'add-circle', bg: '#FFF8E6' },
                Miscellaneous: { color: '#FFAB00', icon: 'ellipsis-horizontal-circle', bg: '#FFF8E6' },
              };
              const style = categoryStyles[category] || {
                color: '#637381',
                icon: 'list',
                bg: '#F4F6F8',
              };

              return (
                <View key={category} className="mb-6">
                  <View className="flex-row mb-3">
                    <View
                      className="flex-row items-center px-3 py-1.5 rounded-full"
                      style={{ backgroundColor: style.bg }}
                    >
                      <Ionicons name={style.icon} size={14} color={style.color} />
                      <Text
                        className="ml-2 text-[10px] font-black  tracking-tight"
                        style={{ color: style.color }}
                      >
                        {category}
                      </Text>
                    </View>
                  </View>

                  <View className="gap-3">
                    {items.map((item: any, i: number) => (
                      <View
                        key={i}
                        className="flex-row items-center bg-white rounded-2xl p-4 shadow-sm border border-[#F4F6F8]"
                      >
                        <View
                          className="w-10 h-10 rounded-xl items-center justify-center mr-4"
                          style={{ backgroundColor: style.bg }}
                        >
                          <Ionicons name={style.icon} size={18} color={style.color} />
                        </View>
                        <View className="flex-1">
                          <Text className="text-sm font-bold text-[#1C252E]">
                            {item.value}
                            {item.unit || "'"} {item.label}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        <View className="pb-24">
          {isAlreadyInTracker ? (
            <View className="gap-3">
              <TouchableOpacity
                onPress={async () => {
                  try {
                    const jobs = await JobService.getJobs();
                    const jobToRemove = jobs.find((j: any) => j.calculatorId === active?._id);
                    if (jobToRemove?._id || jobToRemove?.id) {
                      await JobService.deleteJob((jobToRemove._id || jobToRemove.id)!);
                      if (refresh) refresh();
                    }
                  } catch (e) {
                    console.error('Failed to remove job', e);
                  }
                }}
                className="w-full bg-[#FF5630] py-4 rounded-xl items-center justify-center border border-red-200"
              >
                <Text className="text-white font-black text-sm text-center px-4">
                  {active?.name || ''} has already been added to job tracker. Click to remove.
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onGoToTracker}
                className="w-full h-12 bg-[#4CBB17] rounded-xl flex-row items-center justify-center"
              >
                <Text className="text-white font-black text-sm mr-2">Go to Job Tracker</Text>
                <Feather name="arrow-right" size={18} color="white" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={handleAddJobToTracker}
              className="w-full h-12 bg-[#4CBB17] rounded-xl items-center justify-center"
            >
              <Text className="text-white font-black text-sm">Add This Job to Job Tracker</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={onClose}
            className="w-full h-12 bg-[#4CBB17] rounded-xl items-center justify-center mt-3"
          >
            <View className="flex-row items-center">
              <Feather name="arrow-left" size={18} color="white" />
              <Text className="text-white font-black text-sm ml-2">Back</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
};
