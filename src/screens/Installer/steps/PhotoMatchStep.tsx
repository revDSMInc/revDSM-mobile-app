import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  StatusBar,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from '../../../i18n/LanguageProvider';
import { InstallerCamera } from '../../../widgets/components/installer/InstallerCamera';
import { HouseGhost, tagTint } from '../../../widgets/components/installer/HouseGhost';
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

// Dark "tagger" theme — deliberately distinct from the light app chrome. Shooting
// happens outdoors against bright surfaces, so the capture surface stays dark to
// keep the reference photo the brightest thing on screen.
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
  /** Pre-install shots, shown as the reference during the post pass. */
  preMatched?: Record<string, CapturedPhoto>;
  /**
   * Tagger layout + rep reference photos. Built from the job's real
   * `preInstallPhotos` (`buildRepPhotoSections`); falls back to the static mock.
   */
  sections?: PhotoSection[];
  onMatch: (tagId: string, photo: CapturedPhoto) => void;
  onAddExtra: (sectionId: string, photo: CapturedPhoto) => void;
  onComplete: () => void;
  onBack: () => void;
}

/**
 * Ghost-overlay photo matching.
 *
 * Tag-first: pick a tag, view the reference shot, tap to open the ghost camera,
 * confirm. Pre-install ghosts against the rep's sale photos; post-install ghosts
 * against the installer's own pre-install shots, so the pair is directly comparable.
 */
export function PhotoMatchStep({
  visible,
  phase,
  matched,
  extras,
  preMatched,
  sections: sectionsProp,
  onMatch,
  onAddExtra,
  onComplete,
  onBack,
}: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const log = useInstallerActivityLog();

  // Data-driven from the rep's real capture set when provided; static mock otherwise.
  const sections = sectionsProp?.length ? sectionsProp : PHOTO_SECTIONS;
  const requiredTags = useMemo(
    () => sections.flatMap((s) => s.tags.filter((t) => t.hasRep)),
    [sections]
  );

  /**
   * Tags are tracked by ID, never by holding the object.
   *
   * `useRepPhotoSections` resolves the rep photos' signed URLs asynchronously and rebuilds
   * every tag when they land, so a `PhotoTag` captured in state is a SNAPSHOT — it keeps
   * whatever `repPhotoUrl` it had at the moment it was stored (often none), and a later
   * re-sign never reaches it. That is what left the review pane's reference frame blank
   * while the same photo showed in the viewfinder: two copies of one tag, resolved at
   * different times. Looking each one up on every render means there is only ever the
   * current tag.
   */
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

  /** Current object for a tracked id — always the freshest copy `sections` holds. */
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
  const allDone = requiredTags.length > 0 && matchedTotal === requiredTags.length;

  const sectionCount = (sid: string) => {
    const req = (sections.find((s) => s.id === sid)?.tags ?? []).filter((t) => t.hasRep);
    return `${req.filter((t) => matched[t.id]).length}/${req.length}`;
  };

  /** Reference shot for a tag: rep photo on the pre pass, own pre shot on the post pass. */
  const referenceUri = (tag: PhotoTag): string | undefined =>
    phase === 'pre' ? tag.repPhotoUrl : preMatched?.[tag.id]?.uri ?? tag.repPhotoUrl;

  /** Next unmatched tag — prefers the current section, then falls through globally. */
  const advance = (fromId: string) => {
    const inSection = (section?.tags ?? []).filter(
      (t) => t.hasRep && !matched[t.id] && t.id !== fromId
    );
    if (inSection.length) return setSelected(inSection[0]);

    const next = requiredTags.find((t) => !matched[t.id] && t.id !== fromId);
    if (next) {
      setSelected(next);
      const ns = sections.find((s) => s.tags.some((x) => x.id === next.id));
      if (ns) setSectionId(ns.id);
    }
  };

  // Matched tags sink below pending ones; unavailable tags sink to the bottom.
  const orderedTags = useMemo(() => {
    const rank = (t: PhotoTag) => (!t.hasRep ? 2 : matched[t.id] ? 1 : 0);
    return [...(section?.tags ?? [])].sort((a, b) => rank(a) - rank(b));
  }, [section, matched]);

  const isSelectedMatched = !!(selected && matched[selected.id]);
  const selectedRef = selected ? referenceUri(selected) : undefined;

  /**
   * A signed URL is genuinely on its way: the tag carries an S3 key that
   * `useRepPhotoSections` hasn't exchanged yet.
   *
   * Gated on the KEY, not on `hasRep`. The static fallback sections (used when a job
   * arrives with `preInstallPhotos.products: []`) claim `hasRep: true` but carry no
   * key, so keying off `hasRep` left a spinner up forever on a photo that was never
   * coming.
   */
  const awaitingReference = !!selected?.repPhotoS3Url && !selectedRef;

  /** The tag expects a rep shot but this job shipped none — nothing to ghost against. */
  const referenceUnavailable = !!selected?.hasRep && !selected?.repPhotoS3Url && !selectedRef;

  const handleSelectSection = (s: PhotoSection) => {
    if (s.id === sectionId) return;
    log.photoSectionChanged(phase, { id: s.id, name: s.name });
    setSectionId(s.id);
  };

  // Captures are logged by the upload hook once S3 answers — it is the only place
  // that knows the s3url, bucket and byte size the portal's payload carries.
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
      total: requiredTags.length,
      extras: Object.values(extras).reduce((n, list) => n + (list?.length ?? 0), 0),
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
            paddingTop: insets.top,
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
            {t('installer.matchedCount', {
              done: matchedTotal,
              total: requiredTags.length,
            })}
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
          disabled={!selected?.hasRep}
          onPress={() => {
            if (!selected?.hasRep) return;
            if (matched[selected.id]) setReviewTagId(selected.id);
            else setCameraTagId(selected.id);
          }}
          className="flex-1 overflow-hidden"
          style={{ backgroundColor: selected ? tagTint(selected.id) : T_CARD }}
        >
          {selectedRef ? (
            <TaggerImage uri={selectedRef} tint={selected ? tagTint(selected.id) : undefined} />
          ) : (
            <>
              <HouseGhost opacity={0.8} />
              {awaitingReference && <TaggerImageSpinner />}
            </>
          )}

          <View className="absolute top-2.5 left-0 right-0 items-center">
            <View className="rounded-2xl px-3 py-1.5" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
              <Text className="text-white text-xs font-bold">
                {phase === 'pre' ? t('installer.repPhoto') : t('installer.preInstallPhoto')} •{' '}
                {selected ? selected.label : '—'}
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
              {phase === 'pre'
                ? t('installer.selectTagRep')
                : t('installer.selectTagPre')}
            </Text>
          </View>

          {allDone && (
            <TouchableOpacity
              onPress={handleComplete}
              className="mx-3 mb-2 rounded-xl items-center justify-center py-2.5"
              style={{ backgroundColor: T_GREEN }}
            >
              <Text className="text-[#0e1c16] text-sm font-black">
                {t('installer.allShotsMatched')}
              </Text>
            </TouchableOpacity>
          )}

          <ScrollView
            className="flex-1"
            contentContainerStyle={{
              paddingHorizontal: 12,
              // The root already clears the system bar, so this is only breathing room
              // under the last row.
              paddingBottom: 16,
            }}
          >
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {orderedTags.map((t) => {
                const m = !!matched[t.id];
                const sel = selected?.id === t.id;
                const pending = t.hasRep && !m;

                return (
                  <TouchableOpacity
                    key={t.id}
                    disabled={!t.hasRep}
                    onPress={() => setSelected(t)}
                    className="rounded-xl items-center justify-center flex-row px-2 py-2.5"
                    style={{
                      width: '48%',
                      minHeight: 42,
                      backgroundColor: sel ? '#24382d' : m ? 'rgba(125,219,70,0.07)' : T_CARD,
                      borderWidth: 1.5,
                      borderColor: sel ? '#ffffff' : T_BORDER,
                      // Amber edge = still needs a shot (same semantic as the timeline).
                      borderLeftWidth: sel ? 2 : 4,
                      borderLeftColor: sel ? '#ffffff' : pending ? AMBER : 'transparent',
                    }}
                  >
                    {m && <Icon name="check" size={12} color={T_GREEN} style={{ marginRight: 4 }} />}
                    <Text
                      className="text-xs font-bold text-center"
                      style={{
                        color: !t.hasRep ? '#44554b' : m ? '#8fae87' : T_TEXT,
                        textDecorationLine: m ? 'line-through' : 'none',
                      }}
                      numberOfLines={2}
                    >
                      {t.label}
                      {!t.hasRep ? ' · N/A' : ''}
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
          </ScrollView>
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

/** Two-up review of a matched tag: reference beside the shot just taken. */
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
          <View
            className="rounded-xl overflow-hidden"
            style={{ aspectRatio: 4 / 3, backgroundColor: tagTint(tag.id) }}
          >
            {referenceUri ? (
              <TaggerImage uri={referenceUri} tint={tagTint(tag.id)} />
            ) : (
              <>
                <HouseGhost opacity={0.9} />
                {/* Only when a key is still being signed — see `awaitingReference`. */}
                {!!tag.repPhotoS3Url && <TaggerImageSpinner />}
              </>
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
        style={{ gap: 10, paddingBottom: Math.max(insets.bottom, 16) }}
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
});
