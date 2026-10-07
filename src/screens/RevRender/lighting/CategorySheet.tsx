import React from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { categoriesForTab, looksInCategory } from '../../../utils/revrender-lighting/catalog';
import { LightingState, selectedCountIn } from '../../../utils/revrender-lighting/selection';
import { Look, LookTab } from '../../../utils/revrender-lighting/types';

const THEME_GROUPS: { title: string; categories: string[] }[] = [
  { title: 'Heroes', categories: ['Marvel', 'DC'] },
  { title: 'Armed forces', categories: ['Military'] },
  { title: 'World', categories: ['Countries'] },
];

const TEAM_GROUPS: { title: string; categories: string[] }[] = [
  { title: 'Pro', categories: ['NFL', 'MLB', 'NHL', 'NBA', 'MLS', 'WNBA'] },
  { title: 'College · Power 4', categories: ['SEC', 'Big Ten', 'Big 12', 'ACC'] },
  { title: 'College · More', categories: ['Other FBS', 'HBCU'] },
];

const SCHOOL_GROUPS = ['College · Power 4', 'College · More'];

const GREEN = '#2EDE56';

export function CategorySheet({
  tab,
  visible,
  current,
  state,
  customs,
  isDark,
  onPick,
  onClose,
}: {
  tab: LookTab;
  visible: boolean;
  current: string;
  state: LightingState;
  customs: Look[];
  isDark: boolean;
  onPick: (category: string) => void;
  onClose: () => void;
}) {
  const sub = isDark ? '#919EAB' : '#637381';
  const label = isDark ? '#fff' : '#212B36';

  const categories = categoriesForTab(tab, customs);

  const groups = tab === 'teams' ? TEAM_GROUPS : tab === 'themes' ? THEME_GROUPS : null;
  const sections =
    groups
      ? [
          ...groups.map((g) => ({
            title: g.title,
            items: g.categories
              .map((name) => categories.find((c) => c.name === name))
              .filter((c): c is { name: string; count: number } => Boolean(c)),
          })),
          {
            title: 'More',
            items: categories.filter((c) => !groups.some((g) => g.categories.includes(c.name))),
          },
        ].filter((sec) => sec.items.length > 0)
      : [{ title: '', items: categories }];

  const unit = tab === 'teams' ? 'teams' : 'looks';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <TouchableOpacity className="flex-1" activeOpacity={1} onPress={onClose} accessibilityLabel="Close" />
        <View
          className="rounded-t-[24px] px-5 pt-3 pb-8"
          style={{ backgroundColor: isDark ? '#1E1E1E' : '#fff', maxHeight: '85%' }}
        >
          <View className="items-center mb-3">
            <View className="rounded-full" style={{ width: 36, height: 4, backgroundColor: sub }} />
          </View>

          <Text className="text-[20px] font-black" style={{ color: label }}>
            {tab === 'teams' ? 'Browse teams' : 'Browse categories'}
          </Text>
          <Text className="text-[13px] mb-3" style={{ color: sub }}>
            {tab === 'teams' ? 'Pick a league or conference' : 'Pick a category'}
          </Text>

          {/* `shrink` so the pinned Close button always has its space; without
              it a long list pushes the button past the bottom of the sheet. */}
          <ScrollView className="shrink" showsVerticalScrollIndicator={false}>
            {sections.map((section) => (
            <View key={section.title || 'all'}>
            {section.title ? (
              <Text className="text-[12px] font-black tracking-widest mb-1 mt-4 uppercase" style={{ color: sub }}>
                {section.title}
              </Text>
            ) : null}
            {section.items.map((c) => {
              const active = c.name === current;
              const picked = selectedCountIn(state, looksInCategory(tab, c.name, customs));
              return (
                <TouchableOpacity
                  key={c.name}
                  onPress={() => { onPick(c.name); onClose(); }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className="flex-row items-center justify-between"
                  style={{ minHeight: 56, borderBottomWidth: 1, borderBottomColor: isDark ? '#2A2F36' : '#F0F2F5' }}
                >
                  <Text className="text-[17px] font-black" style={{ color: active ? GREEN : label }}>
                    {c.name}
                  </Text>

                  <View className="flex-row items-center">
                    {picked > 0 && (
                      <View className="rounded-full px-2 mr-2" style={{ backgroundColor: GREEN }}>
                        <Text className="text-[11px] font-black text-white">{picked} selected</Text>
                      </View>
                    )}
                    <Text className="text-[15px]" style={{ color: sub }}>
                      {c.count} {tab === 'teams' && SCHOOL_GROUPS.includes(section.title) ? 'schools' : unit}
                    </Text>
                    {active && <Icon name="check" size={18} color={GREEN} style={{ marginLeft: 8 }} />}
                  </View>
                </TouchableOpacity>
              );
            })}
            </View>
            ))}

            {categories.length === 0 && (
              <Text className="text-[13px] text-center py-6" style={{ color: sub }}>
                No {tab === 'teams' ? 'leagues' : 'categories'} available
              </Text>
            )}
          </ScrollView>

          {/*
            Outside the ScrollView, so Close is reachable without scrolling to
            the end of twelve leagues. Picking a row already closes the sheet —
            this is the way out for a rep who opened it to look.
          */}
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            className="rounded-full items-center justify-center mt-3"
            style={{ minHeight: 52, borderWidth: 1, borderColor: isDark ? '#2A2F36' : '#DFE3E8' }}
          >
            <Text className="text-[16px] font-black" style={{ color: label }}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
