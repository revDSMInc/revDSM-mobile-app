import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

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

const GREEN = '#72BD00';

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
  /** How tall the tool panel may grow. The dock never takes the whole slide. */
  maxToolHeight: number;
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
  maxToolHeight,
  left,
  right,
  bottom,
}: Props) {
  const toolsMode = showTools && mode === 'tools';

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
            ⚠️ `flex: 1` on the scroller and NOT on its content, so a deck with few
            categories still left-aligns against the divider instead of the tabs
            stretching. Horizontal because the deck's category count is authored in the
            portal and six of them already fill a phone in landscape.
          */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabScroll}
            contentContainerStyle={styles.tabScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {toolsMode
              ? DOCK_TOOLS.map((tool) => {
                  const active = activeTool === tool.id;
                  return (
                    <TouchableOpacity
                      key={tool.id}
                      onPress={() => onSelectTool(tool.id)}
                      activeOpacity={0.85}
                      style={[styles.tab, active && styles.tabActive]}
                    >
                      <Icon
                        name={tool.icon}
                        size={15}
                        color={active ? '#fff' : 'rgba(255,255,255,0.72)'}
                        style={styles.tabIcon}
                      />
                      <Text style={[styles.tabText, active && styles.tabTextActive]}>
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
          <View style={[styles.toolPanel, { maxHeight: maxToolHeight }]}>{toolContent}</View>
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
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 10 },

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
    marginHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },

  tabScroll: { flex: 1 },
  tabScrollContent: { alignItems: 'center', paddingRight: 4 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 19,
    marginRight: 4,
  },
  tabActive: { backgroundColor: GREEN },
  tabIcon: { marginRight: 6 },
  tabText: { color: 'rgba(255,255,255,0.78)', fontSize: 13.5, fontWeight: '600' },
  tabTextActive: { color: '#fff', fontWeight: '700' },

  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  toolPanel: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(16,18,19,0.98)',
  },
});
