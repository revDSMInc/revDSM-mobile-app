import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  StatusBar,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from '../../../i18n/LanguageProvider';
import { InstallerCamera } from '../../../widgets/components/installer/InstallerCamera';
import {
  footerBottomPadding,
  headerTopPadding,
} from '../../../utils/installer-insets';
import { tagTint } from '../../../widgets/components/installer/HouseGhost';
import {
  TaggerImage,
  TaggerImageSpinner,
} from '../../../widgets/components/installer/TaggerImage';
import { PHOTO_SECTIONS } from '../../../constants/installer';
import { useInstallerActivityLog } from '../../../hooks/useInstallerActivityLog';
import type {
  CapturedPhoto,
  PhotoPhase,
  PhotoSection,
  PhotoTag,
} from '../../../config/types/installer';

const T_BG = '#0e1c16';
const T_BAR = '#122019';
const T_CARD = '#1a2b22';
const T_BORDER = '#2c4034';
const T_TEXT = '#e8f0ea';
const T_DIM = '#6c7f74';
const T_GREEN = '#7ddb46';
const AMBER = '#FFAB00';

interface Props {
  visible: boolean;
  phase: PhotoPhase;
  matched: Record<string, CapturedPhoto>;
  extras: Record<string, CapturedPhoto[]>;
  preMatched?: Record<string, CapturedPhoto>;
  sections?: PhotoSection[];
  freeform?: boolean;
  onMatch: (tagId: string, photo: CapturedPhoto) => void;
  onAddExtra: (sectionId: string, photo: CapturedPhoto) => void;
  onComplete: () => void;
  onBack: () => void;
}

export function PhotoMatchStep({
  visible,
  phase,
  matched,
  extras,
  preMatched,
  sections: sectionsProp,
  freeform = false,
  onMatch,
  onAddExtra,
  onComplete,
  onBack,
}: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const log = useInstallerActivityLog();

  const sections = sectionsProp?.length ? sectionsProp : PHOTO_SECTIONS;

  const isTagRequired = useCallback(
    (tag: PhotoTag): boolean => (phase === 'post' ? !!preMatched?.[tag.id] : tag.hasRep),
    [phase, preMatched]
  );

  const isTagOpen = useCallback(
    (tag: PhotoTag): boolean => (phase === 'post' ? !!preMatched?.[tag.id] : true),
    [phase, preMatched]
  );

  const requiredTags = useMemo(
    () => sections.flatMap((s) => s.tags.filter(isTagRequired)),
    [sections, isTagRequired]
  );

  const optionalMatchedTotal = useMemo(
    () =>
      sections
        .flatMap((s) => s.tags)
        .filter((tag) => !isTagRequired(tag) && !!matched[tag.id]).length,
    [sections, isTagRequired, matched]
  );

  const [sectionId, setSectionId] = useState(() => sections[0]?.id ?? '');
  const [selectedId, setSelectedId] = useState<string>(
    () =>
      (requiredTags.find((t) => !matched[t.id]) ?? requiredTags[0] ?? sections[0]?.tags[0])
        ?.id ?? ''
  );
  const [cameraTagId, setCameraTagId] = useState<string | null>(null);
  const [extraCamera, setExtraCamera] = useState(false);
  const [reviewTagId, setReviewTagId] = useState<string | null>(null);

  const section = sections.find((s) => s.id === sectionId) ?? sections[0];

  const tagById = useCallback(
    (id?: string | null): PhotoTag | undefined =>
      id ? sections.flatMap((s) => s.tags).find((t) => t.id === id) : undefined,
    [sections]
  );

  const selected = tagById(selectedId);
  const cameraTag = tagById(cameraTagId);
  const reviewTag = tagById(reviewTagId);

  const setSelected = (tag: PhotoTag) => setSelectedId(tag.id);
  const matchedTotal = requiredTags.filter((t) => matched[t.id]).length;

  const extrasTotal = useMemo(
    () => Object.values(extras).reduce((n, list) => n + (list?.length ?? 0), 0),
    [extras]
  );

  const takenTotal = Object.keys(matched).length + extrasTotal;

  const isFreeform = requiredTags.length === 0 || (freeform && phase === 'pre');

  const allDone = isFreeform
    ? takenTotal > 0
    : requiredTags.length > 0 && matchedTotal === requiredTags.length;

  const tagScrollRef = useRef<ScrollView>(null);
  const viewportH = useRef(0);
  const contentH = useRef(0);
  const scrollY = useRef(0);
  const [moreBelow, setMoreBelow] = useState(false);

  const syncMoreBelow = useCallback(() => {
    const overflow = contentH.current - viewportH.current;
    setMoreBelow(overflow > 8 && scrollY.current < overflow - 8);
  }, []);

  const handleTagScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = e.nativeEvent.contentOffset.y;
      syncMoreBelow();
    },
    [syncMoreBelow]
  );

  const sectionCount = (sid: string) => {
    const tags = sections.find((s) => s.id === sid)?.tags ?? [];
    if (isFreeform) return String(tags.filter((t) => matched[t.id]).length);
    const req = tags.filter(isTagRequired);
    const added = tags.filter((t) => !isTagRequired(t) && matched[t.id]).length;
    const done = req.filter((t) => matched[t.id]).length;
    return `${done}/${req.length}${added ? ` +${added}` : ''}`;
  };

  const referenceUri = (tag: PhotoTag): string | undefined =>
    phase === 'pre' ? tag.repPhotoUrl : preMatched?.[tag.id]?.uri ?? tag.repPhotoUrl;

  const advance = (fromId: string) => {
    const inSection = (section?.tags ?? []).filter(
      (t) => isTagRequired(t) && !matched[t.id] && t.id !== fromId
    );
    if (inSection.length) return setSelected(inSection[0]);

    const next = requiredTags.find((t) => !matched[t.id] && t.id !== fromId);
    if (next) {
      setSelected(next);
      const ns = sections.find((s) => s.tags.some((x) => x.id === next.id));
      if (ns) setSectionId(ns.id);
    }
  };

  const orderedTags = useMemo(() => {
    const rank = (t: PhotoTag) => {
      if (!isTagOpen(t)) return 3;
      if (matched[t.id]) return 2;
      return isTagRequired(t) ? 0 : 1;
    };
    return [...(section?.tags ?? [])].sort((a, b) => rank(a) - rank(b));
  }, [section, matched, isTagOpen, isTagRequired]);

  const isSelectedMatched = !!(selected && matched[selected.id]);
  const selectedRef = selected ? referenceUri(selected) : undefined;

  const capturedUri = selected ? matched[selected.id]?.uri : undefined;
  const heroUri = capturedUri ?? selectedRef;

  const awaitingReference = !!selected?.repPhotoS3Url && !selectedRef;

  const selectedOpen = !!selected && isTagOpen(selected);

  const referenceUnavailable = selectedOpen && !selected?.repPhotoS3Url && !selectedRef;

  useEffect(() => {
    if (!visible || (selected && isTagOpen(selected))) return;
    const next = requiredTags.find((tag) => !matched[tag.id]) ?? requiredTags[0];
    if (!next) return;
    setSelectedId(next.id);
    const owner = sections.find((s) => s.tags.some((tag) => tag.id === next.id));
    if (owner) setSectionId(owner.id);
  }, [visible, selected, isTagOpen, requiredTags, matched, sections]);

  const handleSelectSection = (s: PhotoSection) => {
    if (s.id === sectionId) return;
    log.photoSectionChanged(phase, { id: s.id, name: s.name });
    setSectionId(s.id);
    tagScrollRef.current?.scrollTo({ y: 0, animated: false });
    scrollY.current = 0;
  };

  const handleGhostCapture = (tag: PhotoTag, photo: CapturedPhoto) => {
    onMatch(tag.id, photo);
    setCameraTagId(null);
    advance(tag.id);
  };

  const handleExtraCapture = (photo: CapturedPhoto) => {
    onAddExtra(sectionId, photo);
  };

  const handleComplete = () => {
    log.photoPhaseCompleted(phase, {
      matched: matchedTotal,
      total: isFreeform ? 0 : requiredTags.length,
      extras: extrasTotal,
    });
    onComplete();
    onBack();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      statusBarTranslucent
      onRequestClose={onBack}
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      {/*
        The BOTTOM inset belongs here, on the root — not only on the scroll content
        inside. The tag picker is sized as a percentage of its parent, so a root that
        runs under the navigation bar hands it a share of that hidden strip too: the
        last row of tags and the "Tag as Extra" button render into space the system bar
        covers. Ending the layout above the bar means every child is measured inside the
        usable screen. Left/right are applied for cutouts and landscape.
      */}
      <View
        style={[
          styles.root,
          {
            paddingTop: headerTopPadding(insets.top),
            paddingBottom: insets.bottom,
            paddingLeft: insets.left,
            paddingRight: insets.right,
          },
        ]}
      >
        {/* Top bar */}
        <View className="flex-row items-center justify-between px-3.5 pt-2 pb-2">
          <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="arrow-left" size={22} color={T_TEXT} />
          </TouchableOpacity>
          <Text className="text-xs font-black tracking-widest" style={{ color: T_DIM }}>
            {phase === 'pre' ? t('installer.phasePre') : t('installer.phasePost')} •{' '}
            {isFreeform
              ? t('installer.shotsTakenCount', { done: takenTotal })
              : t('installer.matchedCount', {
                  done: matchedTotal,
                  total: requiredTags.length,
                }) + (optionalMatchedTotal ? ` +${optionalMatchedTotal}` : '')}
          </Text>
        </View>

        {/* Section tabs — horizontally scrollable so any number of rep categories fits */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ backgroundColor: T_BAR, borderBottomWidth: 1, borderBottomColor: T_BORDER, flexGrow: 0 }}
          contentContainerStyle={{ paddingHorizontal: 4 }}
        >
          {sections.map((s) => {
            const active = s.id === sectionId;
            return (
              <TouchableOpacity
                key={s.id}
                onPress={() => handleSelectSection(s)}
                className="items-center pt-2 pb-1.5 px-3"
                style={{
                  minWidth: 76,
                  borderBottomWidth: 2,
                  borderBottomColor: active ? T_GREEN : 'transparent',
                }}
              >
                <Icon name={s.icon} size={17} color={active ? T_GREEN : T_DIM} />
                <Text
                  numberOfLines={1}
                  className="text-[9px] font-black tracking-wide mt-0.5"
                  style={{ color: active ? T_GREEN : T_DIM }}
                >
                  {s.name}
                </Text>
                <Text className="text-[9px] font-bold" style={{ color: active ? T_GREEN : T_DIM }}>
                  {sectionCount(s.id)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Reference photo — tap to shoot or review */}
        <TouchableOpacity
          activeOpacity={0.9}
          disabled={!selectedOpen}
          onPress={() => {
            if (!selectedOpen || !selected) return;
            if (matched[selected.id]) setReviewTagId(selected.id);
            else setCameraTagId(selected.id);
          }}
          className="flex-1 overflow-hidden"
          style={{ backgroundColor: selected ? tagTint(selected.id) : T_CARD }}
        >
          {heroUri ? (
            <TaggerImage uri={heroUri} tint={selected ? tagTint(selected.id) : undefined} />
          ) : (
            <View className="flex-1 items-center justify-center px-6">
              <Text className="text-sm font-semibold text-center" style={{ color: T_DIM }}>
                No Pre-Install Photo From Sale Side
              </Text>
              {awaitingReference && <TaggerImageSpinner />}
            </View>
          )}

          <View className="absolute top-2.5 left-0 right-0 items-center">
            <View className="rounded-2xl px-3 py-1.5" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
              <Text className="text-white text-xs font-bold">
                {/* "REP PHOTO" over a blank frame reads as a photo that failed to load.
                    A tag with no reference is an addition, so it says so — and once a
                    shot exists the pane is showing THAT, so the chip has to say whose
                    photo is on screen or the installer reads their own work as the
                    reference they are supposed to be matching. */}
                {capturedUri
                  ? t('installer.yourPhoto')
                  : referenceUnavailable
                  ? t('installer.addPhoto')
                  : phase === 'pre'
                  ? t('installer.repPhoto')
                  : t('installer.preInstallPhoto')}{' '}
                • {selected ? selected.label : '—'}
              </Text>
            </View>
          </View>

          <View className="absolute bottom-3 left-0 right-0 items-center">
            {isSelectedMatched ? (
              <View
                className="rounded-2xl px-3.5 py-1.5 border"
                style={{ backgroundColor: 'rgba(125,219,70,0.15)', borderColor: T_GREEN }}
              >
                <Text className="text-xs font-bold" style={{ color: T_GREEN }}>
                  {t('installer.matchedTapReview')}
                </Text>
              </View>
            ) : (
              <View className="rounded-2xl px-3.5 py-1.5" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
                <Text className="text-xs font-bold text-white/85">
                  {referenceUnavailable
                    ? t('installer.noRepPhoto')
                    : awaitingReference
                    ? t('installer.loadingRepPhoto')
                    : t('installer.tapToMatch')}
                </Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        {/* Tag picker */}
        <View
          style={{
            backgroundColor: T_BAR,
            borderTopWidth: 1,
            borderTopColor: T_BORDER,
            height: '32%',
          }}
        >
          <View className="px-3 pt-2.5 pb-1.5">
            <Text className="text-[10px] font-black tracking-widest" style={{ color: T_DIM }}>
              {isFreeform
                ? t('installer.selectTagFree')
                : phase === 'pre'
                ? // Says outright that the rep's tags aren't the limit — the previously
                  t('installer.selectTagRepPlus')
                : t('installer.selectTagPre')}
            </Text>
          </View>

          <ScrollView
            ref={tagScrollRef}
            className="flex-1"
            scrollEventThrottle={16}
            onScroll={handleTagScroll}
            onLayout={(e) => {
              viewportH.current = e.nativeEvent.layout.height;
              syncMoreBelow();
            }}
            onContentSizeChange={(_w, h) => {
              contentH.current = h;
              syncMoreBelow();
            }}
            contentContainerStyle={{
              paddingHorizontal: 12,
              paddingBottom: 16,
            }}
          >
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {orderedTags.map((t) => {
                const m = !!matched[t.id];
                const sel = selected?.id === t.id;
                const open = isTagOpen(t);
                const required = isTagRequired(t);
                const pending = required && !m;
                const addable = open && !required && !m;

                return (
                  <TouchableOpacity
                    key={t.id}
                    disabled={!open}
                    onPress={() => setSelected(t)}
                    className="rounded-xl items-center justify-center flex-row px-2 py-2.5"
                    style={{
                      width: '48%',
                      minHeight: 42,
                      backgroundColor: sel ? '#24382d' : m ? 'rgba(125,219,70,0.07)' : T_CARD,
                      borderWidth: 1.5,
                      borderColor: sel ? '#ffffff' : T_BORDER,
                      borderLeftWidth: sel ? 2 : 4,
                      borderLeftColor: sel ? '#ffffff' : pending ? AMBER : 'transparent',
                    }}
                  >
                    {m && <Icon name="check" size={12} color={T_GREEN} style={{ marginRight: 4 }} />}
                    {addable && (
                      <Icon name="plus" size={12} color={T_DIM} style={{ marginRight: 4 }} />
                    )}
                    <Text
                      className="text-xs font-bold text-center"
                      style={{
                        color: !open ? '#44554b' : m ? '#8fae87' : required ? T_TEXT : '#9db3a6',
                        textDecorationLine: m ? 'line-through' : 'none',
                      }}
                      numberOfLines={2}
                    >
                      {t.label}
                      {!open ? ' · N/A' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Free-shoot lane — no ghost, documents anything the rep missed */}
            <TouchableOpacity
              onPress={() => setExtraCamera(true)}
              className="rounded-xl items-center justify-center py-2.5 mt-2.5"
              style={{ borderWidth: 1.5, borderColor: T_GREEN, borderStyle: 'dashed' }}
            >
              <Text className="text-xs font-black" style={{ color: T_GREEN }}>
                + Tag as Extra
              </Text>
            </TouchableOpacity>

            {(extras[sectionId]?.length ?? 0) > 0 && (
              <View className="items-center mt-2">
                <View
                  className="flex-row items-center rounded-2xl px-3 py-1.5 border"
                  style={{ backgroundColor: 'rgba(125,219,70,0.1)', borderColor: T_GREEN }}
                >
                  <Icon name="check" size={11} color={T_GREEN} />
                  <Text className="text-[11px] font-black ml-1.5" style={{ color: T_GREEN }}>
                    {extras[sectionId].length} extra
                    {extras[sectionId].length > 1 ? 's' : ''} logged
                  </Text>
                </View>
              </View>
            )}

            {/*
              Done sits at the very END of the picker, under "Tag as Extra" — it is the
              last thing an installer does, and above the tag grid it hid the first row
              of tags and invited a tap before the optional extras were even seen.
            */}
            {allDone && (
              <TouchableOpacity
                onPress={handleComplete}
                className="rounded-xl items-center justify-center py-2.5 mt-2.5"
                style={{ backgroundColor: T_GREEN }}
              >
                <Text className="text-[#0e1c16] text-sm font-black">
                  {/* "All Shots Matched" would be a lie in free-form mode — nothing was
                      matched and nothing more is owed. It names the count instead. */}
                  {isFreeform
                    ? t('installer.donePhotosTaken', { count: takenTotal })
                    : t('installer.allShotsMatched')}
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {/*
            Floating "there is more below" affordance, pinned to the bottom of the
            picker. `pointerEvents="box-none"` on the wrapper so the tag rows it floats
            over stay tappable — only the pill itself takes touches.
          */}
          {moreBelow && (
            <View style={styles.scrollHintWrap} pointerEvents="box-none">
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => tagScrollRef.current?.scrollToEnd({ animated: true })}
                style={[
                  styles.scrollHintPill,
                  allDone
                    ? { backgroundColor: T_GREEN, borderColor: T_GREEN }
                    : { backgroundColor: T_CARD, borderColor: T_BORDER },
                ]}
              >
                <Text
                  className="text-[11px] font-black mr-1"
                  style={{ color: allDone ? '#0e1c16' : T_DIM }}
                >
                  {allDone ? t('installer.scrollForDone') : t('installer.scrollForMore')}
                </Text>
                <Icon name="chevron-down" size={15} color={allDone ? '#0e1c16' : T_DIM} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* Review a matched pair */}
      {reviewTag && (
        <ReviewPair
          tag={reviewTag}
          phase={phase}
          referenceUri={referenceUri(reviewTag)}
          shot={matched[reviewTag.id]}
          onClose={() => setReviewTagId(null)}
          onRetake={() => {
            setCameraTagId(reviewTag.id);
            setReviewTagId(null);
          }}
        />
      )}

      {/* Ghost capture */}
      {cameraTag && (
        <InstallerCamera
          label={`${phase === 'pre' ? 'PRE' : 'POST'} • ${cameraTag.label}`}
          withGhost
          ghostUri={referenceUri(cameraTag)}
          compareLabels={{
            left: phase === 'pre' ? t('installer.repSale') : t('installer.phasePre'),
            right: phase === 'pre' ? t('installer.phasePre') : t('installer.phasePost'),
          }}
          onCancel={() => setCameraTagId(null)}
          onCapture={(photo) => handleGhostCapture(cameraTag, photo)}
        />
      )}

      {/* Free shot */}
      {extraCamera && (
        <InstallerCamera
          label={`EXTRA • ${section.name}`}
          hint={t('installer.extraShotHint')}
          count={extras[sectionId]?.length ?? 0}
          onCancel={() => setExtraCamera(false)}
          onCapture={handleExtraCapture}
        />
      )}
    </Modal>
  );
}

function ReviewPair({
  tag,
  phase,
  referenceUri,
  shot,
  onClose,
  onRetake,
}: {
  tag: PhotoTag;
  phase: PhotoPhase;
  referenceUri?: string;
  shot?: CapturedPhoto;
  onClose: () => void;
  onRetake: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: '#0c1118', paddingTop: insets.top + 12, zIndex: 20 },
      ]}
    >
      <View className="flex-row items-center justify-between px-3.5 mb-2">
        <Text className="text-white text-base font-bold">
          {t('installer.tagMatched', { tag: tag.label })}
        </Text>
        <TouchableOpacity onPress={onClose} className="p-1">
          <Icon name="close" size={22} color="#8b93a0" />
        </TouchableOpacity>
      </View>

      {/* Stacked, not side by side.
          Two half-width columns gave each photo a sliver barely wider than a thumb, and
          `cover` then cropped most of the frame away — which defeats the point of a
          comparison. Stacking gives each the full screen width; the pair scrolls, so a
          short screen shortens the scroll rather than squeezing both photos into it. */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 4, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text className="text-[11px] font-black tracking-widest mb-1.5" style={{ color: T_GREEN }}>
            {phase === 'pre' ? t('installer.repSale') : t('installer.phasePre')}
          </Text>
          {/* A fixed 4:3 frame rather than `flex-1`: inside a ScrollView a flex child has
              no height to fill, so both photos would collapse to nothing. */}
          {/* ⚠️ An empty reference frame goes BLACK with a plain statement, not the house
              ghost. The ghost is a shooting aid - it belongs over a live camera, where it
              shows where to stand. Here there is nothing to line up against, so drawing a
              house reads as a photo that failed to load rather than one that was never
              taken, and the tinted frame made it look like content. */}
          <View
            className="rounded-xl overflow-hidden"
            style={{
              aspectRatio: 4 / 3,
              backgroundColor: referenceUri ? tagTint(tag.id) : '#000000',
            }}
          >
            {referenceUri ? (
              <TaggerImage uri={referenceUri} tint={tagTint(tag.id)} />
            ) : tag.repPhotoS3Url ? (
              <TaggerImageSpinner />
            ) : (
              <View className="flex-1 items-center justify-center px-6">
                <Text
                  className="text-center text-sm font-bold text-white/70"
                >
                  {phase === 'pre'
                    ? t('installer.noRepSalePhoto')
                    : t('installer.noPreInstallPhoto')}
                </Text>
              </View>
            )}
          </View>
        </View>
        <View>
          <Text className="text-[11px] font-black tracking-widest mb-1.5 text-white">
            {phase === 'pre' ? t('installer.phasePre') : t('installer.phasePost')}
          </Text>
          <View
            className="rounded-xl overflow-hidden"
            style={{ aspectRatio: 4 / 3, backgroundColor: '#26364a' }}
          >
            {shot && <TaggerImage uri={shot.uri} tint="#26364a" />}
          </View>
        </View>
      </ScrollView>

      <View
        className="flex-row px-3.5 pt-3"
        style={{ gap: 10, paddingBottom: footerBottomPadding(insets.bottom) }}
      >
        <TouchableOpacity
          onPress={onRetake}
          className="flex-1 h-12 rounded-xl items-center justify-center bg-white/10"
        >
          <Text className="text-white text-base font-bold">{t('installer.retake')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onClose}
          className="flex-1 h-12 rounded-xl items-center justify-center"
          style={{ backgroundColor: T_GREEN }}
        >
          <Text className="text-[#0e1c16] text-base font-bold">
            {t('installer.looksGood')}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: T_BG },
  scrollHintWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 8,
    alignItems: 'center',
  },
  scrollHintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
});
