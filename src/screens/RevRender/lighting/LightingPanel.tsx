import React, { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, useWindowDimensions, Vibration, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  allLooks, catalogueVersion, categoriesForTab, findLook, looksForTab, looksInCategory, seasonsSections, tagForLook,
} from '../../../utils/revrender-lighting/catalog';
import { nearYou, NearYouOrigin } from '../../../utils/revrender-lighting/near-you';
import { searchLooks } from '../../../utils/revrender-lighting/search';
import {
  addButtonLabel, canAdd, isFavourite, isSelected, LightingState, recentsToShow,
  selectedCountIn, takeSelection, toggleFavourite, toggleSelected,
} from '../../../utils/revrender-lighting/selection';
import { Look, LookTab } from '../../../utils/revrender-lighting/types';
import { CategorySheet } from './CategorySheet';
import { FavouritePopover, PopoverAnchor } from './FavouritePopover';
import { CustomLookSheet } from './CustomLookSheet';
import { LightStrip } from './LightStrip';
import { LookTile, TILE_COLUMNS, TILE_WIDTH } from './LookTile';

const GREEN = '#2EDE56';

/** Activity-log hook supplied by the screen, which adds user / lead / photo context. */
export type LightingLog = (action: string, meta: Record<string, any>) => void;

const lookMeta = (look?: Look | null) =>
  look ? { lookId: look.id, lookName: look.name, lookGroup: look.group, lookCategory: look.category } : {};
const TABS: { key: LookTab; label: string }[] = [
  { key: 'seasons', label: 'Seasons' },
  { key: 'teams', label: 'Teams' },
  { key: 'themes', label: 'Themes' },
  { key: 'custom', label: 'Custom' },
];

export function LightingPanel({
  state,
  setState,
  isDark,
  onOpenCustomBuilder,
  onToggleFavourite,
  onSaveCustomLook,
  onSelectLook,
  onLog,
  nearYouOrigin,
}: {
  state: LightingState;
  setState: (s: LightingState) => void;
  isDark: boolean;
  onOpenCustomBuilder?: () => void;
  onToggleFavourite?: (lookId: string) => void;
  onSaveCustomLook?: (look: Look) => void;
  onSelectLook?: (look: Look, nowSelected: boolean) => void;
  onLog?: LightingLog;
  /** Job → device → office, resolved by the screen. Null hides the Near you row (§10). */
  nearYouOrigin?: NearYouOrigin | null;
}) {
  const [tab, setTab] = useState<LookTab>('seasons');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Record<string, string>>({ teams: 'NFL', themes: 'Marvel' });
  const [sheetOpen, setSheetOpen] = useState(false);
  // Teams opens on the nearby teams only; the league grid appears once the rep chooses to browse.
  const [browsingTeams, setBrowsingTeams] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [popover, setPopover] = useState<PopoverAnchor | null>(null);
  const { width: screenWidth } = useWindowDimensions();

  const sub = isDark ? '#919EAB' : '#637381';
  const cardBg = isDark ? '#1E1E1E' : '#fff';
  const label = isDark ? '#fff' : '#212B36';

  const select = (look: Look) => {
    const nextState = toggleSelected(state, look.id);
    setState(nextState);
    onSelectLook?.(look, isSelected(nextState, look.id));
  };

  const favourite = (id: string) => {
    const nextState = toggleFavourite(state, id);
    setState(nextState);
    onToggleFavourite?.(id);
    onLog?.('change', {
      fieldName: 'look_favourite',
      ...lookMeta(findLook(id, state.customs)),
      oldValue: isFavourite(state, id),
      newValue: isFavourite(nextState, id),
    });
  };

  const tile = (look: Look, showTag = false) => (
    <LookTile
      key={look.id}
      look={look}
      isDark={isDark}
      selected={isSelected(state, look.id)}
      favourite={isFavourite(state, look.id)}
      tag={showTag ? tagForLook(look) : null}
      onPress={() => select(look)}
      onLongPress={(frame) => {
        Vibration.vibrate(18);
        setPopover({ lookId: look.id, ...frame });
      }}
    />
  );

  const grid = (looks: Look[], render: (l: Look) => React.ReactNode) => {
    const pad = (TILE_COLUMNS - (looks.length % TILE_COLUMNS)) % TILE_COLUMNS;
    return (
      <View className="flex-row flex-wrap justify-between">
        {looks.map(render)}
        {Array.from({ length: pad }).map((_, i) => (
          <View key={`sp${i}`} style={{ width: TILE_WIDTH }} />
        ))}
      </View>
    );
  };

  const { everyday, holidays } = useMemo(() => seasonsSections(), []);

  // Keyed on the catalogue version so a refresh that brings the team locations in recomputes it.
  const near = useMemo(
    () => nearYou(nearYouOrigin, allLooks()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nearYouOrigin, catalogueVersion(), allLooks().length],
  );
  // Typing is logged once the rep pauses, not per keystroke.
  useEffect(() => {
    const q = query.trim();
    if (!q) return undefined;
    const t = setTimeout(() => {
      onLog?.('change', {
        fieldName: 'team_search',
        newValue: q,
        resultCount: searchLooks(looksForTab('teams', state.customs), q).length,
      });
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const showNearOnly = tab === 'teams' && !query && !!near && near.looks.length > 0 && !browsingTeams;

  if (__DEV__ && tab === 'teams') {
    const located = allLooks().filter((l) => Number.isFinite(l.lat)).length;
    console.log('[NearYou]', {
      origin: nearYouOrigin,
      locatedTeams: located,
      result: near?.looks.map((l) => l.id),
      label: near?.label,
    });
  }

  const quickFavourites = state.fav.map((id) => findLook(id, state.customs)).filter((l): l is Look => Boolean(l));
  const quickRecents = recentsToShow(state).map((id) => findLook(id, state.customs)).filter((l): l is Look => Boolean(l));

  const SectionLabel = ({ children, hint }: { children: React.ReactNode; hint?: string }) => (
    <View className="flex-row items-baseline justify-between mb-3">
      <Text className="text-[11px] font-black tracking-widest uppercase" style={{ color: sub }}>
        {children}
      </Text>
      {hint ? (
        <Text className="text-[11px]" style={{ color: sub }}>{hint}</Text>
      ) : null}
    </View>
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
              onPress={() => {
                onLog?.('change', {
                  fieldName: 'browse_looks_tab',
                  componentLabel: text,
                  oldValue: tab,
                  newValue: key,
                  selectedCount: count,
                });
                setTab(key);
              }}
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
          {/* ⚠️ "SEASONS & HOLIDAYS", not "Holidays", with the "by month" hint —
              both the handover (§4) and the plan (§5) specify it. The hint is not
              decoration: this list is ordered by CALENDAR MONTH rather than
              alphabetically, which is otherwise unexplained when a rep scrolls
              past New Year's into Mardi Gras and Valentine's. */}
          <SectionLabel hint="by month">Seasons &amp; Holidays</SectionLabel>
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

          {/* Near you (483 §10) — computed on device. Hidden with no location or no team
              locations in the catalogue; never a fake default. */}
          {tab === 'teams' && !query && near && near.looks.length > 0 && (
            <View className="mb-4">
              <SectionLabel>{near.label}</SectionLabel>
              {grid(near.looks, (l) => tile(l))}
            </View>
          )}

          {/* Category selector — the sheet replaced a horizontal rail that
              overflowed on small phones (483 §5). */}
          {!query && (
            <TouchableOpacity
              onPress={() => {
                onLog?.('click', {
                  componentLabel: showNearOnly ? 'Browse all teams' : 'Browse all',
                  tab,
                  currentCategory: category[tab],
                });
                setSheetOpen(true);
              }}
              className="flex-row items-center justify-between rounded-[14px] px-4 mb-4"
              style={{ minHeight: 48, backgroundColor: cardBg, borderWidth: 1, borderColor: isDark ? '#2A2F36' : '#DFE3E8' }}
            >
              <Text className="text-[14px] font-black" style={{ color: label }}>
                {showNearOnly ? 'Browse all teams' : category[tab]}{' '}
                <Text className="font-normal" style={{ color: sub }}>
                  ({showNearOnly
                    ? looksForTab(tab, state.customs).length
                    : categoriesForTab(tab, state.customs).find((c) => c.name === category[tab])?.count ?? 0})
                </Text>
              </Text>
              <View className="flex-row items-center">
                <Text className="text-[12px] font-bold mr-1" style={{ color: GREEN }}>Browse all</Text>
                <Icon name="chevron-right" size={18} color={GREEN} />
              </View>
            </TouchableOpacity>
          )}

          {!query && tab === 'teams' && browsingTeams && near && near.looks.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                onLog?.('click', { componentLabel: 'Show only teams near you', tab });
                setBrowsingTeams(false);
              }}
              className="mb-3 self-start"
              style={{ minHeight: 44, justifyContent: 'center' }}
              accessibilityLabel="Show only teams near you"
            >
              <Text className="text-[12px] font-bold" style={{ color: GREEN }}>Show only teams near you</Text>
            </TouchableOpacity>
          )}

          {!showNearOnly && grid(
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
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-[11px] font-black tracking-widest uppercase" style={{ color: sub }}>
              Your custom looks
            </Text>
            {/* Only once there is something to hold — a hint about editing looks
                you have not made yet is noise. */}
            {state.customs.length > 0 && (
              <Text className="text-[11px]" style={{ color: sub }}>Hold one to edit</Text>
            )}
          </View>

          {/*
            ⚠️ The "New custom look" tile comes FIRST, before the saved looks,
            as the mock has it. Appended last it drifts further away with every
            look a rep saves, and making a new one is the reason this tab exists.
          */}
          <View className="flex-row flex-wrap justify-between">
            <TouchableOpacity
              onPress={() => {
                onLog?.('click', { componentLabel: 'New custom look', tab, savedCustomLooks: state.customs.length });
                setBuilderOpen(true);
                onOpenCustomBuilder?.();
              }}
              accessibilityRole="button"
              accessibilityLabel="New custom look"
              style={{ width: TILE_WIDTH, minHeight: 44, marginBottom: 14 }}
            >
              <View
                className="items-center justify-center rounded-[14px] border-2"
                style={{ height: 64, borderStyle: 'dashed', borderColor: GREEN }}
              >
                <Icon name="plus" size={22} color={GREEN} />
              </View>
              <Text className="text-[11px] font-bold mt-1.5 text-center" style={{ color: GREEN }}>
                New custom look
              </Text>
            </TouchableOpacity>

            {state.customs.map((l) => tile(l))}

            {/* The new tile occupies one column, so pad around IT too or a
                single saved look spreads across the row. */}
            {Array.from({
              length: (TILE_COLUMNS - ((state.customs.length + 1) % TILE_COLUMNS)) % TILE_COLUMNS,
            }).map((_, i) => (
              <View key={`sp${i}`} style={{ width: TILE_WIDTH }} />
            ))}
          </View>

          {state.customs.length === 0 && (
            <Text className="text-[13px] mt-4 text-center" style={{ color: sub }}>
              Pick any colors for a high school, a business or a party. Presets stay locked so team
              and holiday colors stay accurate.
            </Text>
          )}
        </>
      )}

      <CustomLookSheet
        visible={builderOpen}
        isDark={isDark}
        existing={state.customs}
        onClose={() => setBuilderOpen(false)}
        onSave={(look) => {
          setState({ ...state, customs: [...state.customs, look] });
          onSaveCustomLook?.(look);
          onLog?.('add', {
            fieldName: 'custom_look',
            ...lookMeta(look),
            colorsCount: look.colors.length,
            pattern: look.pattern,
          });
        }}
      />

      <FavouritePopover
        anchor={popover}
        isFavourite={popover ? isFavourite(state, popover.lookId) : false}
        screenWidth={screenWidth}
        onToggle={() => {
          if (popover) favourite(popover.lookId);
          setPopover(null);
        }}
        onClose={() => setPopover(null)}
      />

      <CategorySheet
        tab={tab}
        visible={sheetOpen}
        current={category[tab]}
        state={state}
        customs={state.customs}
        isDark={isDark}
        onPick={(name) => {
          onLog?.('change', {
            fieldName: 'look_category',
            tab,
            oldValue: category[tab],
            newValue: name,
          });
          setCategory({ ...category, [tab]: name });
          if (tab === 'teams') setBrowsingTeams(true);
        }}
        onClose={() => setSheetOpen(false)}
      />

    </View>
  );
}

export function LightingFooter({
  state,
  setState,
  isDark,
  corePending = false,
  onAdd,
  onToggleFavourite,
  onLog,
}: {
  state: LightingState;
  setState: (s: LightingState) => void;
  isDark: boolean;
  corePending?: boolean;
  onAdd: (looks: Look[]) => void;
  onToggleFavourite?: (lookId: string) => void;
  onLog?: LightingLog;
}) {
  const sub = isDark ? '#919EAB' : '#637381';
  const label = isDark ? '#fff' : '#212B36';
  const favourite = (id: string) => {
    const nextState = toggleFavourite(state, id);
    setState(nextState);
    onToggleFavourite?.(id);
    onLog?.('change', {
      fieldName: 'look_favourite',
      ...lookMeta(findLook(id, state.customs)),
      oldValue: isFavourite(state, id),
      newValue: isFavourite(nextState, id),
      source: 'selected_list',
    });
  };
  const select = (id: string) => {
    setState(toggleSelected(state, id));
    onLog?.('select', {
      ...lookMeta(findLook(id, state.customs)),
      selected: false,
      source: 'selected_list_remove',
    });
  };

  const selectedLooks = state.sel
    .map((id) => findLook(id, state.customs))
    .filter((l): l is Look => Boolean(l));

  const enabled = canAdd(state) || corePending;

  return (
    <View className="mb-6">
      {selectedLooks.length > 0 && (
        <View
          className="rounded-[20px] p-4 mb-3"
          style={{ backgroundColor: isDark ? '#15191E' : '#F4F6F8' }}
        >
          <Text className="text-[15px] font-black mb-3" style={{ color: GREEN }}>
            {selectedLooks.length} render{selectedLooks.length === 1 ? '' : 's'} selected
          </Text>

          {selectedLooks.map((l) => (
            <View
              key={l.id}
              className="flex-row items-center rounded-[14px] p-2 mb-2"
              style={{ backgroundColor: isDark ? '#1E1E1E' : '#fff' }}
            >
              <View style={{ width: 56 }}>
                <LightStrip colors={l.colors} pucks={3} rows={1} size={7} height={34} radius={8} />
              </View>
              <View className="flex-1 ml-3">
                <Text className="text-[14px] font-black" style={{ color: label }} numberOfLines={1}>
                  {l.name}
                </Text>
                <Text className="text-[12px]" style={{ color: sub }}>
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
                <Icon
                  name={isFavourite(state, l.id) ? 'star' : 'star-outline'}
                  size={20}
                  color={isFavourite(state, l.id) ? '#FFC94D' : sub}
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => select(l.id)} accessibilityLabel={`Remove ${l.name}`} style={{ padding: 8 }}>
                <Icon name="close" size={20} color={sub} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/*
        The empty state is a BOX in the same slot the selected list occupies,
        not an absence. Without it the Add button floats under the grid with
        nothing explaining why it is greyed out, and a disabled control with no
        stated reason reads as broken rather than as "not yet".
      */}
      {selectedLooks.length === 0 && (
        <View
          className="rounded-[20px] p-4 mb-3"
          style={{ backgroundColor: isDark ? '#15191E' : '#F4F6F8' }}
        >
          <Text className="text-[15px] font-black mb-1" style={{ color: sub }}>
            {corePending ? 'Core products ready' : 'Nothing selected yet'}
          </Text>
          <Text className="text-[13px]" style={{ color: sub }}>
            {corePending
              ? 'Add now for the core render on its own, or pick a look to add both.'
              : 'Pick one or more looks above.'}
          </Text>
        </View>
      )}

      {selectedLooks.length > 0 && (
        <Text className="text-[12px] text-center mb-3" style={{ color: sub }}>
          {selectedLooks.length} look{selectedLooks.length === 1 ? '' : 's'} · matches existing trim
        </Text>
      )}

      <TouchableOpacity
        disabled={!enabled}
        onPress={() => {
          const { looks, state: cleared } = takeSelection(state, (id) => findLook(id, state.customs));
          setState(cleared);
          onAdd(looks);
        }}
        accessibilityRole="button"
        accessibilityState={{ disabled: !enabled }}
        className="rounded-full items-center justify-center"
        style={{ minHeight: 56, backgroundColor: enabled ? GREEN : isDark ? '#2A2F36' : '#DFE3E8' }}
      >
        <Text className="text-[16px] font-black" style={{ color: enabled ? '#fff' : sub }}>
          {addButtonLabel(state)}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
