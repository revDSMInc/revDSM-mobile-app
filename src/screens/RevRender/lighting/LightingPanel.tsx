import React, { useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  categoriesForTab, findLook, looksForTab, looksInCategory, seasonsSections, tagForLook,
} from '../../../utils/revrender-lighting/catalog';
import { searchLooks } from '../../../utils/revrender-lighting/search';
import {
  addButtonLabel, canAdd, isFavourite, isSelected, LightingState, recentsToShow,
  selectedCountIn, takeSelection, toggleFavourite, toggleSelected,
} from '../../../utils/revrender-lighting/selection';
import { Look, LookTab } from '../../../utils/revrender-lighting/types';
import { CategorySheet } from './CategorySheet';
import { CustomLookSheet } from './CustomLookSheet';
import { LightStrip } from './LightStrip';
import { LookTile } from './LookTile';

const GREEN = '#2EDE56';
const TABS: { key: LookTab; label: string }[] = [
  { key: 'seasons', label: 'Seasons' },
  { key: 'teams', label: 'Teams' },
  { key: 'themes', label: 'Themes' },
  { key: 'custom', label: 'Custom' },
];

/**
 * The Lighting configuration area (483 §2). Swaps in below the mode switch;
 * the photo, header and bottom action bar above and below stay put.
 *
 * The rep picks a look and nothing else — no components, cover type, channel
 * colour, time of day or Lights Off anywhere on this screen.
 */
export function LightingPanel({
  state,
  setState,
  isDark,
  onAdd,
  onOpenCustomBuilder,
}: {
  state: LightingState;
  setState: (s: LightingState) => void;
  isDark: boolean;
  onAdd: (looks: Look[]) => void;
  onOpenCustomBuilder?: () => void;
}) {
  const [tab, setTab] = useState<LookTab>('seasons');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Record<string, string>>({ teams: 'NFL', themes: 'Marvel' });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);

  const sub = isDark ? '#919EAB' : '#637381';
  const cardBg = isDark ? '#1E1E1E' : '#fff';
  const label = isDark ? '#fff' : '#212B36';

  const select = (id: string) => setState(toggleSelected(state, id));
  const favourite = (id: string) => setState(toggleFavourite(state, id));

  const tile = (look: Look, showTag = false) => (
    <LookTile
      key={look.id}
      look={look}
      isDark={isDark}
      selected={isSelected(state, look.id)}
      favourite={isFavourite(state, look.id)}
      tag={showTag ? tagForLook(look) : null}
      onPress={() => select(look.id)}
      onLongPress={() => favourite(look.id)}
    />
  );

  /**
   * justify-between spreads a partial row across the full width, so a group of 3
   * (Everyday) would not share columns with a group of 18 (Holidays) below it.
   * Pad to a multiple of 4 with invisible tiles so every grid lines up.
   */
  const grid = (looks: Look[], render: (l: Look) => React.ReactNode) => {
    const pad = (4 - (looks.length % 4)) % 4;
    return (
      <View className="flex-row flex-wrap justify-between">
        {looks.map(render)}
        {Array.from({ length: pad }).map((_, i) => (
          <View key={`sp${i}`} style={{ width: '23%' }} />
        ))}
      </View>
    );
  };

  const { everyday, holidays } = useMemo(() => seasonsSections(), []);
  const selectedLooks = useMemo(
    () => state.sel.map((id) => findLook(id, state.customs)).filter((l): l is Look => Boolean(l)),
    [state.sel, state.customs],
  );

  const quickFavourites = state.fav.map((id) => findLook(id, state.customs)).filter((l): l is Look => Boolean(l));
  const quickRecents = recentsToShow(state).map((id) => findLook(id, state.customs)).filter((l): l is Look => Boolean(l));

  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <Text className="text-[11px] font-black tracking-widest mb-3 uppercase" style={{ color: sub }}>
      {children}
    </Text>
  );

  return (
    <View>
      {/* ── Quick picks ──────────────────────────────────────────────────── */}
      {(quickFavourites.length > 0 || quickRecents.length > 0) && (
        <View className="rounded-[20px] p-4 mb-4" style={{ backgroundColor: isDark ? '#15191E' : '#F4F6F8' }}>
          {quickFavourites.length > 0 && (
            <>
              <View className="flex-row items-center justify-between mb-3">
                <View className="flex-row items-center">
                  <Icon name="star" size={15} color="#FFC94D" />
                  <Text className="text-[13px] font-black ml-1.5" style={{ color: label }}>Favorites</Text>
                </View>
                <Text className="text-[11px]" style={{ color: sub }}>Hold a look to favorite</Text>
              </View>
              {grid(quickFavourites, (l) => tile(l))}
            </>
          )}

          {quickRecents.length > 0 && (
            <>
              <View className="flex-row items-center mb-3 mt-1">
                <Icon name="clock-outline" size={15} color={sub} />
                <Text className="text-[13px] font-black ml-1.5" style={{ color: label }}>Recently Rendered</Text>
              </View>
              {grid(quickRecents, (l) => tile(l))}
            </>
          )}
        </View>
      )}

      {/* ── Browse Looks ─────────────────────────────────────────────────── */}
      <SectionLabel>Browse Looks</SectionLabel>

      <View className="flex-row mb-4 rounded-full p-1" style={{ backgroundColor: isDark ? '#1E1E1E' : '#F4F6F8' }}>
        {TABS.map(({ key, label: text }) => {
          const active = tab === key;
          const count = selectedCountIn(state, looksForTab(key, state.customs));
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setTab(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              className="flex-1 flex-row items-center justify-center rounded-full"
              style={{ minHeight: 40, backgroundColor: active ? (isDark ? '#2A2F36' : '#fff') : 'transparent' }}
            >
              <Text className="text-[12px] font-black" style={{ color: active ? label : sub }}>{text}</Text>
              {count > 0 && (
                <View className="ml-1 rounded-full px-1.5" style={{ backgroundColor: GREEN }}>
                  <Text className="text-[10px] font-black text-white">{count}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      {tab === 'seasons' && (
        <>
          <SectionLabel>Everyday</SectionLabel>
          <View className="mb-2">{grid(everyday, (l) => tile(l))}</View>
          <SectionLabel>Holidays</SectionLabel>
          {grid(holidays, (l) => tile(l, true))}
        </>
      )}

      {(tab === 'teams' || tab === 'themes') && (
        <>
          {tab === 'teams' && (
            <View
              className="flex-row items-center rounded-full px-4 mb-4"
              style={{ minHeight: 44, backgroundColor: isDark ? '#1E1E1E' : '#F4F6F8' }}
            >
              <Icon name="magnify" size={18} color={sub} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search teams, cities, schools"
                placeholderTextColor={sub}
                className="flex-1 ml-2 text-[14px]"
                style={{ color: label, paddingVertical: 0 }}
                accessibilityLabel="Search teams"
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')} accessibilityLabel="Clear search">
                  <Icon name="close-circle" size={18} color={sub} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Category selector — the sheet replaced a horizontal rail that
              overflowed on small phones (483 §5). */}
          {!query && (
            <TouchableOpacity
              onPress={() => setSheetOpen(true)}
              className="flex-row items-center justify-between rounded-[14px] px-4 mb-4"
              style={{ minHeight: 48, backgroundColor: cardBg, borderWidth: 1, borderColor: isDark ? '#2A2F36' : '#DFE3E8' }}
            >
              <Text className="text-[14px] font-black" style={{ color: label }}>
                {category[tab]}{' '}
                <Text className="font-normal" style={{ color: sub }}>
                  ({categoriesForTab(tab, state.customs).find((c) => c.name === category[tab])?.count ?? 0})
                </Text>
              </Text>
              <View className="flex-row items-center">
                <Text className="text-[12px] font-bold mr-1" style={{ color: GREEN }}>Browse all</Text>
                <Icon name="chevron-right" size={18} color={GREEN} />
              </View>
            </TouchableOpacity>
          )}

          {grid(
            query
              ? searchLooks(looksForTab(tab, state.customs), query)
              : looksInCategory(tab, category[tab], state.customs),
            (l) => tile(l),
          )}

          {query.length > 0 && searchLooks(looksForTab(tab, state.customs), query).length === 0 && (
            <Text className="text-[13px] text-center py-6" style={{ color: sub }}>No teams match</Text>
          )}
        </>
      )}

      {tab === 'custom' && (
        <>
          <View className="flex-row flex-wrap justify-between">
            {state.customs.map((l) => tile(l))}
            <TouchableOpacity
              onPress={() => { setBuilderOpen(true); onOpenCustomBuilder?.(); }}
              accessibilityRole="button"
              accessibilityLabel="New custom look"
              style={{ width: '23%', marginBottom: 14 }}
            >
              <View
                className="items-center justify-center rounded-[14px] border-2"
                style={{ height: 62, borderStyle: 'dashed', borderColor: GREEN }}
              >
                <Icon name="plus" size={22} color={GREEN} />
              </View>
              <Text className="text-[11px] font-bold mt-1.5 text-center" style={{ color: sub }}>
                New custom look
              </Text>
            </TouchableOpacity>
          </View>
          {state.customs.length === 0 && (
            <Text className="text-[12px] mt-2" style={{ color: sub }}>
              Build a one-off look — for a high school, or anything not in the lists.
            </Text>
          )}
        </>
      )}

      <CustomLookSheet
        visible={builderOpen}
        isDark={isDark}
        onClose={() => setBuilderOpen(false)}
        onSave={(look) => setState({ ...state, customs: [...state.customs, look] })}
      />

      <CategorySheet
        tab={tab}
        visible={sheetOpen}
        current={category[tab]}
        state={state}
        customs={state.customs}
        isDark={isDark}
        onPick={(name) => setCategory({ ...category, [tab]: name })}
        onClose={() => setSheetOpen(false)}
      />

      {/* ── Renders selected ─────────────────────────────────────────────── */}
      {selectedLooks.length > 0 && (
        <View className="rounded-[20px] p-4 mt-4" style={{ backgroundColor: cardBg, borderWidth: 1, borderColor: isDark ? '#2A2F36' : '#DFE3E8' }}>
          <Text className="text-[13px] font-black mb-3" style={{ color: label }}>
            {selectedLooks.length} render{selectedLooks.length === 1 ? '' : 's'} selected
          </Text>

          {selectedLooks.map((l) => (
            <View key={l.id} className="flex-row items-center mb-2.5">
              <View style={{ width: 44 }}>
                <LightStrip colors={l.colors} pucks={3} rows={1} size={7} height={24} radius={6} />
              </View>
              <View className="flex-1 ml-3">
                <Text className="text-[13px] font-bold" style={{ color: label }} numberOfLines={1}>{l.name}</Text>
                <Text className="text-[11px]" style={{ color: sub }}>
                  {l.pattern === 'single' ? 'Single color' : 'Alternating'}
                </Text>
              </View>
              {/* Visible star: the discoverable path, and the accessible one —
                  long-press alone is not reachable by a screen reader. */}
              <TouchableOpacity
                onPress={() => favourite(l.id)}
                accessibilityLabel={isFavourite(state, l.id) ? `Unfavorite ${l.name}` : `Favorite ${l.name}`}
                style={{ padding: 8 }}
              >
                <Icon name={isFavourite(state, l.id) ? 'star' : 'star-outline'} size={18} color={isFavourite(state, l.id) ? '#FFC94D' : sub} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => select(l.id)} accessibilityLabel={`Remove ${l.name}`} style={{ padding: 8 }}>
                <Icon name="close" size={18} color={sub} />
              </TouchableOpacity>
            </View>
          ))}

          <Text className="text-[11px] mt-1" style={{ color: sub }}>
            {selectedLooks.length} look{selectedLooks.length === 1 ? '' : 's'} · matches existing trim
          </Text>
        </View>
      )}

      {/* ── Add ──────────────────────────────────────────────────────────── */}
      <TouchableOpacity
        disabled={!canAdd(state)}
        onPress={() => {
          const { looks, state: cleared } = takeSelection(state, (id) => findLook(id, state.customs));
          setState(cleared);
          onAdd(looks);
        }}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canAdd(state) }}
        className="rounded-full items-center justify-center mt-5"
        style={{ minHeight: 52, backgroundColor: canAdd(state) ? GREEN : isDark ? '#2A2F36' : '#DFE3E8' }}
      >
        <Text className="text-[15px] font-black" style={{ color: canAdd(state) ? '#fff' : sub }}>
          {addButtonLabel(state)}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
