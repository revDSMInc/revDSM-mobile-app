import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTabStripAutoScroll } from '../../../hooks/useTabStripAutoScroll';

/**
 * The floating dock at the bottom of the Pitch Book's fullscreen presentation.
 *
 * Ticket: *"update the bottom bar like this style … remove the interactive button and add
 * that functionality when pressing the new icon. Actually adding two new icons on the
 * bottom: one is a layer icon that will open the bottom bar in which LeafFilter Story,
 * Problems & Risk, Rules & Elimination etc are shown, and the other icon press shows the
 * bar that is currently shown on pressing Interactive Tools."*
 *
 * ONE bar with TWO modes, chosen by the leading icon pair:
 *
 *   layers (⬓)  → `slides` — the deck's category tabs
 *   wand   (✨) → `tools`  — Inspection / Risk / Videos / Notes, over their content
 *
 * ⚠️ **The two leading icons are always visible, in both modes.** They are the only way
 * between them, so hiding either behind its own mode would strand the rep — which is
 * exactly what the old right-edge "Interactive Tools" tab did once it was replaced.
 */

export const GREEN = '#72BD00';

export type DockMode = 'slides' | 'tools';

export interface DockCategory {
  id: string;
  label: string;
}

export interface DockTool {
  id: string;
  label: string;
  icon: string;
}

/** The tool tabs, in the order the design shows them. */
export const DOCK_TOOLS: DockTool[] = [
  { id: 'inspection', label: 'Inspection', icon: 'camera' },
  { id: 'risk', label: 'Risk', icon: 'alert' },
  { id: 'videos', label: 'Videos', icon: 'video' },
  { id: 'notes', label: 'Notes', icon: 'file-document-outline' },
];

interface Props {
  mode: DockMode;
  onModeChange: (mode: DockMode) => void;
  categories: DockCategory[];
  activeCategory: string;
  onSelectCategory: (id: string) => void;
  activeTool: string;
  onSelectTool: (id: string) => void;
  /** Rendered under the tool tabs, in `tools` mode only. */
  toolContent: React.ReactNode;
  /**
   * Hide the tool half entirely — Homeowner mode has no interactive tools, so the wand
   * would open an empty panel. The layers half, and the deck, stay.
   */
  showTools: boolean;
  /**
   * The tool panel's height — FIXED, not a cap.
   *
   * ⚠️ Every tool gets the same area, so switching tabs never resizes the dock: a short
   * body (Notes, Risk) used to collapse the panel while Inspection filled it, which read
   * as four differently-sized screens. Tall content scrolls inside this height instead.
   * It is still well under the slide, so the deck is never swallowed.
   */
  toolHeight: number;
  left: number;
  right: number;
  bottom: number;
}

function ModeIcon({
  icon,
  active,
  onPress,
  label,
}: {
  icon: string;
  active: boolean;
  onPress: () => void;
  label: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      activeOpacity={0.85}
      style={[styles.modeIcon, active && styles.modeIconActive]}
    >
      <Icon name={icon} size={19} color="#fff" />
    </TouchableOpacity>
  );
}

export function PresentationDock({
  mode,
  onModeChange,
  categories,
  activeCategory,
  onSelectCategory,
  activeTool,
  onSelectTool,
  toolContent,
  showTools,
  toolHeight,
  left,
  right,
  bottom,
}: Props) {
  const toolsMode = showTools && mode === 'tools';
  const activeId = toolsMode ? activeTool : activeCategory;

  /*
    ── The bar follows the deck ──────────────────────────────────────────────────
    Paging past a section's last slide advances `activeCategory` (`handleNext` in the
    screen), but the tab row is a horizontal scroller and nothing moved it — so a rep on
    page 15 saw the bar still parked on the FIRST section with the live tab off-screen.
    The `scope` argument matters here: this ONE scroller renders categories or tools
    depending on the mode.
  */
  const strip = useTabStripAutoScroll(activeId, toolsMode ? 'tool' : 'cat');

  return (
    <View style={[styles.wrap, { left, right, bottom }]} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.bar}>
          {/* ── the two mode icons, in their own darker well ── */}
          <View style={styles.modeWell}>
            <ModeIcon
              icon="layers"
              label="Slides"
              active={!toolsMode}
              onPress={() => onModeChange('slides')}
            />
            {showTools && (
              <ModeIcon
                icon="auto-fix"
                label="Interactive tools"
                active={toolsMode}
                onPress={() => onModeChange('tools')}
              />
            )}
          </View>

          <View style={styles.divider} />

          {/*
            ⚠️ `flex: 1` on the wrapper and NOT on the scroller's content, so a deck with few
            categories still left-aligns against the divider instead of the tabs
            stretching. Horizontal because the deck's category count is authored in the
            portal and six of them already fill a phone in landscape.
          */}
          <View style={styles.tabStrip}>
            <ScrollView
              ref={strip.ref}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabScrollContent}
              keyboardShouldPersistTaps="handled"
              onLayout={strip.onLayout}
              onContentSizeChange={strip.onContentSizeChange}
              onScroll={strip.onScroll}
              scrollEventThrottle={16}
            >
              {toolsMode
                ? DOCK_TOOLS.map((tool) => {
                    const active = activeTool === tool.id;
                    return (
                      <TouchableOpacity
                        key={tool.id}
                        onPress={() => onSelectTool(tool.id)}
                        onLayout={strip.onTabLayout(tool.id)}
                        activeOpacity={0.85}
                        style={[styles.tab, active && styles.tabActive]}
                      >
                        <Icon
                          name={tool.icon}
                          size={14}
                          color={active ? '#fff' : 'rgba(255,255,255,0.72)'}
                          style={styles.tabIcon}
                        />
                        <Text
                          numberOfLines={1}
                          style={[styles.tabText, active && styles.tabTextActive]}
                        >
                          {tool.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                : categories.map((cat) => {
                    const active = activeCategory === cat.id;
                    return (
                      <TouchableOpacity
                        key={cat.id}
                        onPress={() => onSelectCategory(cat.id)}
                        onLayout={strip.onTabLayout(cat.id)}
                        activeOpacity={0.85}
                        style={[styles.tab, active && styles.tabActive]}
                      >
                        <Text style={[styles.tabText, active && styles.tabTextActive]}>
                          {cat.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
            </ScrollView>

            {/*
              Edge arrows: more tabs exist that way. Shown only while the strip can actually
              scroll in that direction, so at either end — or when every tab fits — there is
              nothing on screen claiming otherwise.

              ⚠️ Overlays, not flex siblings. As siblings they would take width only while
              visible, so the visible strip would resize every time one appeared at an end,
              re-measuring the tabs mid-scroll and moving the rep's target under their finger.
            */}
            {strip.canScrollBack && (
              <TouchableOpacity
                onPress={() => strip.step('back')}
                accessibilityRole="button"
                accessibilityLabel="Show earlier tabs"
                activeOpacity={0.85}
                style={[styles.edgeArrow, styles.edgeArrowBack]}
              >
                <Icon name="chevron-left" size={22} color="#fff" />
              </TouchableOpacity>
            )}
            {strip.canScrollForward && (
              <TouchableOpacity
                onPress={() => strip.step('forward')}
                accessibilityRole="button"
                accessibilityLabel="Show more tabs"
                activeOpacity={0.85}
                style={[styles.edgeArrow, styles.edgeArrowForward]}
              >
                <Icon name="chevron-right" size={22} color="#fff" />
              </TouchableOpacity>
            )}
          </View>

          {/* Closing the tool panel returns to the slides tabs rather than hiding the
              dock: the bar is also how the rep changes section, so a ✕ that dismissed the
              whole thing would take the deck's navigation with it. */}
          {toolsMode && (
            <TouchableOpacity
              onPress={() => onModeChange('slides')}
              accessibilityRole="button"
              accessibilityLabel="Close tools"
              activeOpacity={0.85}
              style={styles.close}
            >
              <Icon name="close" size={20} color="#fff" />
            </TouchableOpacity>
          )}
        </View>

        {toolsMode && (
          <View style={[styles.toolPanel, { height: toolHeight }]}>{toolContent}</View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', zIndex: 20 },
  card: {
    backgroundColor: 'rgba(24,26,27,0.96)',
    borderRadius: 22,
    overflow: 'hidden',
  },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10 },

  modeWell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 4,
  },
  modeIcon: { width: 36, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  modeIconActive: { backgroundColor: GREEN },

  divider: {
    width: 1,
    alignSelf: 'stretch',
    marginHorizontal: 8,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },

  tabStrip: { flex: 1, justifyContent: 'center' },
  tabScrollContent: { alignItems: 'center', paddingRight: 4 },
  /*
    Every tab — tool or category — is sized to its OWN label with the same tight padding,
    so the gap between any two neighbours is identical and the neighbours of the selected
    tab stay on screen. ⚠️ The earlier equal-width clamp (a 128pt `minWidth` + `flexGrow`)
    padded `Risk` / `Notes` out to `Inspection`'s width, which left one pill hogging a phone's
    whole strip with the next title cut off — do not reintroduce it.
  */
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    height: 34,
    borderRadius: 17,
    marginRight: 2,
  },
  tabActive: { backgroundColor: GREEN },
  tabIcon: { marginRight: 5 },
  tabText: { color: 'rgba(255,255,255,0.78)', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#fff', fontWeight: '700' },

  close: { width: 32, height: 34, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },

  /*
    Solid in the card's own colour so a label passing underneath is hidden rather than
    showing through the chevron — a half-visible word beneath an arrow reads as clutter.
  */
  edgeArrow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#181A1B',
  },
  edgeArrowBack: { left: 0 },
  edgeArrowForward: { right: 0 },

  toolPanel: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(16,18,19,0.98)',
  },
});
