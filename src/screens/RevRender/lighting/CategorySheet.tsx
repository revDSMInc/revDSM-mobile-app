import React from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { categoriesForTab, looksInCategory } from '../../../utils/revrender-lighting/catalog';
import { LightingState, selectedCountIn } from '../../../utils/revrender-lighting/selection';
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

/**
 * Teams group the same way (the handoff's "PRO" / "COLLEGE · POWER 4" /
 * "COLLEGE · MORE" headings).
 *
 * ⚠️ Order here is the DISPLAY order, and it is deliberate — the catalogue
 * returns categories in whatever order it happens to hold them. Anything not
 * listed falls through to "More", so a new league added to the catalogue
 * appears without editing this file.
 */
const TEAM_GROUPS: { title: string; categories: string[] }[] = [
  { title: 'Pro', categories: ['NFL', 'MLB', 'NHL', 'NBA', 'MLS', 'WNBA'] },
  { title: 'College · Power 4', categories: ['SEC', 'Big Ten', 'Big 12', 'ACC'] },
  { title: 'College · More', categories: ['Other FBS', 'HBCU'] },
];

/**
 * College rows are counted in "schools", pro rows in "teams" — the handoff is
 * explicit about this ("16 schools" under SEC, "32 teams" under NFL), and a
 * conference of teams is a thing reps would notice.
 */
const SCHOOL_GROUPS = ['College · Power 4', 'College · More'];

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
  const sub = isDark ? '#919EAB' : '#637381';
  const label = isDark ? '#fff' : '#212B36';

  // ⚠️ No filter field, deliberately (and the mock has none): teams has 12
  // categories and themes 4, all visible in two or three flicks. A search box
  // over a list that short is a control the rep has to dismiss to get at the
  // thing they can already see.
  const categories = categoriesForTab(tab, customs);

  // Teams and themes both list under headings; a filtered list goes flat so the
  // matches are not scattered across headings the rep did not ask for.
  const groups = tab === 'teams' ? TEAM_GROUPS : tab === 'themes' ? THEME_GROUPS : null;
  const sections =
    groups
      ? [
          ...groups.map((g) => ({
            title: g.title,
            // Ordered BY THE GROUP, not by the catalogue, so "NFL, MLB, NHL…"
            // reads as the handoff has it rather than in storage order.
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
          // ⚠️ 85%, not 70%: the Close button is pinned BELOW the scroll area,
          // so a shorter sheet spends its height on chrome and leaves only a
          // few of twelve leagues visible.
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
                  // A list, not a stack of cards: a hairline divider and no
                  // fill, so 12 leagues read as one scannable column. The
                  // selected row is named by COLOUR and a tick, which does not
                  // change the row's height and so cannot shift the list.
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
