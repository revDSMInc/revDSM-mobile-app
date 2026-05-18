import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Feather from 'react-native-vector-icons/Feather';
import JobService from '../../../services/api/JobService';
import { Section, SubHeader, InputField } from './SharedElements';
import { pricing } from '../../../utils/calculator/pricing-data';

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
}: any) => {
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
  const hasAdditionalData = Number(inputs.extraLabor) > 0 || Number(inputs.ckToInstallers) > 0;

  return (
    <ScrollView className="flex-1 bg-background" showsVerticalScrollIndicator={false}>
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
                  onUpdate({
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
            onUpdate={onUpdate}
          />
          <InputField
            label={'6" Gutter/DS/Elbows'}
            value={inputs.gutter6Ft1}
            keyName="gutter6Ft1"
            price={pricing.gutters['6_inch_all_stories']}
            onUpdate={onUpdate}
          />
          <InputField
            label={'7" Gutter/DS/Elbows'}
            value={inputs.gutter7DsE}
            keyName="gutter7DsE"
            price={pricing.gutters['7_inch_all_stories']}
            onUpdate={onUpdate}
          />
          <SubHeader title="Extras" />
          <InputField
            label="Wedges"
            value={extras.wedges}
            keyName="wedges"
            price={pricing.extras.wedges}
            onUpdate={onUpdate}
            isExtra
            highlighted={hasGutterInput}
          />
          <InputField
            label="Straps"
            value={extras.straps}
            keyName="straps"
            price={pricing.extras.straps}
            onUpdate={onUpdate}
            isExtra
          />
          <InputField
            label="Modify Height/R&R"
            value={extras.modifyHeight}
            keyName="modifyHeight"
            price={pricing.extras.modifyHeight}
            onUpdate={onUpdate}
            isExtra
          />
          <InputField
            label="Replace Corner Miter"
            value={extras.replaceCorner}
            keyName="replaceCorner"
            price={pricing.extras.replaceCorner}
            onUpdate={onUpdate}
            isExtra
          />
          <InputField
            label="GroundSpout"
            value={extras.groundSpout}
            keyName="groundSpout"
            price={pricing.extras.groundSpout}
            onUpdate={onUpdate}
            isExtra
          />
          <InputField
            label="Extended Splash Guard"
            value={extras.extendedSplashGuard}
            keyName="extendedSplashGuard"
            price={pricing.extras.extendedSplashGuard}
            onUpdate={onUpdate}
            isExtra
          />
          <InputField
            label="Extended .032 Splash Guard"
            value={extras.extendedSplashGuard032}
            keyName="extendedSplashGuard032"
            price={pricing.extras.extendedSplashGuard032}
            onUpdate={onUpdate}
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
                  onUpdate({
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
            onUpdate={onUpdate}
          />
          <InputField
            label={'C-S-R'}
            value={extras.csr}
            keyName="csr"
            price={pricing.extras.csr}
            onUpdate={onUpdate}
            isExtra
          />
          <SubHeader title="1st Story" />
          <InputField
            label={'6" Versa (1st Story)'}
            value={inputs.versa6Ft1}
            keyName="versa6Ft1"
            price={pricing.filters.versa_6['1']}
            onUpdate={onUpdate}
          />
          <InputField
            label={'7" Versa (1st Story)'}
            value={inputs.versa7Ft1}
            keyName="versa7Ft1"
            price={pricing.filters.versa_7['1']}
            onUpdate={onUpdate}
          />
          <InputField
            label={'4" & 5" Versa (1st Story)'}
            value={inputs.filter45Ft1}
            keyName="filter45Ft1"
            price={pricing.filters.filter_4_5['1']}
            onUpdate={onUpdate}
          />
          <SubHeader title="2nd Story" />
          <InputField
            label={'6" Versa (2nd Story)'}
            value={inputs.versa6Ft2}
            keyName="versa6Ft2"
            price={pricing.filters.versa_6['2']}
            onUpdate={onUpdate}
          />
          <InputField
            label={'7" Versa (2nd Story)'}
            value={inputs.versa7Ft2}
            keyName="versa7Ft2"
            price={pricing.filters.versa_7['2']}
            onUpdate={onUpdate}
          />
          <InputField
            label={'4" & 5" Versa (2nd Story)'}
            value={inputs.filter45Ft2}
            keyName="filter45Ft2"
            price={pricing.filters.filter_4_5['2']}
            onUpdate={onUpdate}
          />
          <SubHeader title="3rd Story" />
          <InputField
            label={'6" Versa (3rd Story)'}
            value={inputs.versa6Ft3}
            keyName="versa6Ft3"
            price={pricing.filters.versa_6['3']}
            onUpdate={onUpdate}
          />
          <InputField
            label={'7" Versa (3rd Story)'}
            value={inputs.versa7Ft3}
            keyName="versa7Ft3"
            price={pricing.filters.versa_7['3']}
            onUpdate={onUpdate}
          />
          <InputField
            label={'4" & 5" Versa (3rd Story)'}
            value={inputs.filter45Ft3}
            keyName="filter45Ft3"
            price={pricing.filters.filter_4_5['3']}
            onUpdate={onUpdate}
          />
          <SubHeader title="Extras" />
          <InputField
            label="Corners (Filter)"
            value={extras.cornersFilter}
            keyName="cornersFilter"
            price={pricing.extras.cornersFilter}
            onUpdate={onUpdate}
            isExtra
            highlighted={hasVersaOrFilter}
          />
          <InputField
            label="Sawzall Hanger"
            value={extras.sawzallHanger}
            keyName="sawzallHanger"
            price={pricing.extras.sawzallHanger}
            onUpdate={onUpdate}
            isExtra
            highlighted={hasVersaOrFilter}
          />
          <InputField
            label="Remove Protection"
            value={extras.removeProtection}
            keyName="removeProtection"
            price={pricing.extras.removeProtection}
            onUpdate={onUpdate}
            isExtra
            highlighted={hasVersaOrFilter}
          />
          <InputField
            label="Ribbed Roof"
            value={extras.ribbedRoof}
            keyName="ribbedRoof"
            price={pricing.extras.ribbedRoof}
            onUpdate={onUpdate}
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
                  onUpdate({
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
            onUpdate={onUpdate}
            isExtra
          />
          <InputField
            label="Porch Ceiling Soffit (sqft)"
            value={extras.porchCeiling}
            keyName="porchCeiling"
            price={pricing.extras.porchCeiling}
            onUpdate={onUpdate}
            isExtra
          />
          <InputField
            label="Nailer Build Out"
            value={extras.nailerBuildOut}
            keyName="nailerBuildOut"
            price={pricing.extras.nailerBuildOut}
            onUpdate={onUpdate}
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
                  onUpdate({
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
            onUpdate={onUpdate}
            isExtra
          />
          <InputField
            label="Fascia Board"
            value={extras.fasciaBoard}
            keyName="fasciaBoard"
            price={pricing.extras.fasciaBoard}
            onUpdate={onUpdate}
            isExtra
          />
          <InputField
            label={'Aluminum 2"x2" Fascia Board'}
            value={extras.aluminumFasciaBoard}
            keyName="aluminumFasciaBoard"
            price={pricing.extras.aluminumFasciaBoard}
            onUpdate={onUpdate}
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
              ? () => onUpdate({ inputs: { extraLabor: '', ckToInstallers: '' } })
              : null
          }
        >
          <InputField
            label="Extra Labor"
            value={inputs.extraLabor}
            keyName="extraLabor"
            price={pricing.extras.extraLabor}
            onUpdate={onUpdate}
          />
          <InputField
            label="Number of screens $75"
            value={inputs.ckToInstallers}
            keyName="ckToInstallers"
            price={75}
            onUpdate={onUpdate}
          />
        </Section>

        <View className="mb-8 bg-[#F8F7FF] rounded-[32px] border border-[#E5D9FF] overflow-hidden">
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
