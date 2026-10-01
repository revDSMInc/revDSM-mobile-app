import React, { useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { categoriesForTab, looksInCategory } from '../../../utils/revrender-lighting/catalog';
import { LightingState, selectedCountIn } from '../../../utils/revrender-lighting/selection';
import { normalize } from '../../../utils/revrender-lighting/search';
import { Look, LookTab } from '../../../utils/revrender-lighting/types';

/**
 * Themes are grouped in the sheet rather than listed flat (483 §4b).
 * A category not named here falls under "More", so adding one to the catalogue
 * does not require touching this file.
 */
const THEME_GROUPS: { title: string; categories: string[] }[] = [
  { title: 'Heroes', categories: ['Marvel', 'DC'] },
  { title: 'Armed forces', categories: ['Military'] },
  { title: 'World', categories: ['Countries'] },
];

const GREEN = '#2EDE56';

/**
 * Bottom sheet listing each league / conference (or theme category) with its
 * team count. Replaced a horizontal scrolling rail, which wobbled and
 * overflowed on small phones (483 §5).
 *
 * Shows how many looks in each group are already selected, so a rep flipping
 * between leagues can see what they have without leaving the sheet.
 */
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
  const [query, setQuery] = useState('');
  const sub = isDark ? '#919EAB' : '#637381';
  const label = isDark ? '#fff' : '#212B36';

  const all = categoriesForTab(tab, customs);
  const q = normalize(query);
  const categories = q ? all.filter((c) => normalize(c.name).includes(q)) : all;

  // Themes list under headings; everything else stays a flat list.
  const sections =
    tab === 'themes' && !q
      ? [
          ...THEME_GROUPS.map((g) => ({
            title: g.title,
            items: categories.filter((c) => g.categories.includes(c.name)),
          })),
          { title: 'More', items: categories.filter((c) => !THEME_GROUPS.some((g) => g.categories.includes(c.name))) },
        ].filter((sec) => sec.items.length > 0)
      : [{ title: '', items: categories }];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <TouchableOpacity className="flex-1" activeOpacity={1} onPress={onClose} accessibilityLabel="Close" />
        <View
          className="rounded-t-[24px] px-5 pt-3 pb-8"
          style={{ backgroundColor: isDark ? '#1E1E1E' : '#fff', maxHeight: '70%' }}
        >
          <View className="items-center mb-3">
            <View className="rounded-full" style={{ width: 36, height: 4, backgroundColor: sub }} />
          </View>

          <Text className="text-[17px] font-black mb-3" style={{ color: label }}>
            {tab === 'teams' ? 'Leagues & conferences' : 'Categories'}
          </Text>

          <View
            className="flex-row items-center rounded-full px-4 mb-3"
            style={{ minHeight: 44, backgroundColor: isDark ? '#15191E' : '#F4F6F8' }}
          >
            <Icon name="magnify" size={18} color={sub} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={tab === 'teams' ? 'Filter leagues' : 'Filter categories'}
              placeholderTextColor={sub}
              accessibilityLabel="Filter categories"
              className="flex-1 ml-2 text-[14px]"
              style={{ color: label, paddingVertical: 0 }}
            />
            {query.length > 0 && (
              <TouchableOpacity onPress={() => setQuery('')} accessibilityLabel="Clear filter">
                <Icon name="close-circle" size={18} color={sub} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView>
            {sections.map((section) => (
            <View key={section.title || 'all'}>
            {section.title ? (
              <Text className="text-[11px] font-black tracking-widest mb-2 mt-1 uppercase" style={{ color: sub }}>
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
                  className="flex-row items-center justify-between rounded-[14px] px-4 mb-2"
                  style={{
                    minHeight: 52,
                    backgroundColor: active ? `${GREEN}1A` : isDark ? '#15191E' : '#F4F6F8',
                    borderWidth: active ? 1 : 0,
                    borderColor: GREEN,
                  }}
                >
                  <View className="flex-row items-center">
                    <Text className="text-[14px] font-black" style={{ color: active ? GREEN : label }}>
                      {c.name}
                    </Text>
                    <Text className="text-[13px] ml-2" style={{ color: sub }}>{c.count}</Text>
                  </View>

                  <View className="flex-row items-center">
                    {picked > 0 && (
                      <View className="rounded-full px-2 mr-2" style={{ backgroundColor: GREEN }}>
                        <Text className="text-[11px] font-black text-white">{picked} selected</Text>
                      </View>
                    )}
                    {active && <Icon name="check" size={18} color={GREEN} />}
                  </View>
                </TouchableOpacity>
              );
            })}
            </View>
            ))}

            {categories.length === 0 && (
              <Text className="text-[13px] text-center py-6" style={{ color: sub }}>
                No {tab === 'teams' ? 'leagues' : 'categories'} match
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
