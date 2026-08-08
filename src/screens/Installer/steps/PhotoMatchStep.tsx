import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  footerBottomPadding,
  headerTopPadding,
} from '../../../utils/installer-insets';
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
  /**
   * The job shipped no rep photos, so `sections` is the static stand-in and none of its
   * tags has a reference image.
   *
   * With nothing to match against, the tag list stops being a checklist and becomes a
   * way to LABEL shots: the installer takes as many or as few as the job warrants, and
   * one is enough to finish the step. Demanding all 16 placeholder tags was demanding
   * ghost-matches against references that do not exist.
   */
  freeform?: boolean;
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
  freeform = false,
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

  /**
   * Does this tag OWE a shot in this phase — the set the counter and the Done button
   * are measured against?
   *
   * **Pre** — the rep photographed it (`hasRep`), so there is a reference to ghost against.
   *
   * **Post** — the installer photographed it in the PRE pass. Post-install exists to be
   * compared against pre-install, so a post shot with no pre counterpart has nothing to
   * compare to. Note what decides this: what the installer actually shot, not what the
   * rep supplied. Match only Back-Left in pre and Back-Left is the only tag post owes.
   */
  const isTagRequired = useCallback(
    (tag: PhotoTag): boolean => (phase === 'post' ? !!preMatched?.[tag.id] : tag.hasRep),
    [phase, preMatched]
  );

  /**
   * Is this tag SHOOTABLE — a superset of what it owes.
   *
   * **Pre — every tag, whether the rep supplied a reference or not.** What the sale side
   * sent is a FLOOR, not a quota: a rep who shot one elevation has documented one
   * elevation, and the crew standing at the house routinely needs the other sides on
   * record (damage, access, an obstruction the sale visit never saw). Those tags used to
   * render dimmed as `N/A` and refuse the tap, so the only way to file the shot was as an
   * untagged "Extra" — evidence with no side attached to it. Now the tag takes it and the
   * shot is labelled Back-Left in the portal like any other.
   *
   * A tag with no rep photo simply has no ghost: the camera falls back to the line-art
   * house, exactly as it does for a job that shipped no rep set at all.
   *
   * **Post — unchanged, still only what the pre pass shot.** Post is a comparison, and a
   * post shot with no before is not one. This needs no special case for the extra tags
   * above: shoot Back-Left in pre and post opens it too, because `preMatched` is what
   * decides. `useInstallProgress` reads the same set, so every pre shot — required or
   * added — is owed its after.
   */
  const isTagOpen = useCallback(
    (tag: PhotoTag): boolean => (phase === 'post' ? !!preMatched?.[tag.id] : true),
    [phase, preMatched]
  );

  const requiredTags = useMemo(
    () => sections.flatMap((s) => s.tags.filter(isTagRequired)),
    [sections, isTagRequired]
  );

  /**
   * Shots taken on tags nothing was owed on. Reported beside the fraction as `+N` rather
   * than folded into it — they are not progress toward the rep's set, and inflating
   * `done` past `total` would read as a bug.
   */
  const optionalMatchedTotal = useMemo(
    () =>
      sections
        .flatMap((s) => s.tags)
        .filter((tag) => !isTagRequired(tag) && !!matched[tag.id]).length,
    [sections, isTagRequired, matched]
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

  const extrasTotal = useMemo(
    () => Object.values(extras).reduce((n, list) => n + (list?.length ?? 0), 0),
    [extras]
  );

  /**
   * Everything shot in this phase, tagged or not.
   *
   * Free-form mode counts extras alongside matches: with no rep tag to attach to, an
   * "extra" is the same evidence as a match — only the label differs.
   */
  const takenTotal = Object.keys(matched).length + extrasTotal;

  /**
   * Free-form applies to the PRE pass only — and only while there is genuinely nothing
   * to work from.
   *
   * Post is never the installer's choice of shots: it is the pre pass replayed, so the
   * open tags below already say exactly what it owes. The one exception is a pre pass
   * that produced no tagged shots at all (free-form, everything filed as an extra) —
   * then post has no open tag either, and without this it could never be finished. Post
   * gates CoC, Return and job completion, so that would be a hard lockout.
   */
  const isFreeform = requiredTags.length === 0 || (freeform && phase === 'pre');

  // Free-form: ONE shot finishes the step, however it was filed. Otherwise every open
  // tag has to be answered.
  const allDone = isFreeform
    ? takenTotal > 0
    : requiredTags.length > 0 && matchedTotal === requiredTags.length;

  const sectionCount = (sid: string) => {
    const tags = sections.find((s) => s.id === sid)?.tags ?? [];
    // No denominator in free-form mode — there is no quota for this section, so a
    // "1/7" would be reporting a requirement that isn't being made.
    if (isFreeform) return String(tags.filter((t) => matched[t.id]).length);
    const req = tags.filter(isTagRequired);
    // Added shots are reported outside the fraction, for the reason in
    // `optionalMatchedTotal` — the tab reads "1/1 +3".
    const added = tags.filter((t) => !isTagRequired(t) && matched[t.id]).length;
    const done = req.filter((t) => matched[t.id]).length;
    return `${done}/${req.length}${added ? ` +${added}` : ''}`;
  };

  /** Reference shot for a tag: rep photo on the pre pass, own pre shot on the post pass. */
  const referenceUri = (tag: PhotoTag): string | undefined =>
    phase === 'pre' ? tag.repPhotoUrl : preMatched?.[tag.id]?.uri ?? tag.repPhotoUrl;

  /**
   * Next tag that still OWES a shot — prefers the current section, then falls through
   * globally.
   *
   * Deliberately blind to the added-shot tags: jumping the installer onto a tag nothing
   * was asked of would present optional work as the next thing due. When nothing is
   * outstanding the selection stays where it is, on the shot just taken, which is also
   * what puts it into its "tap to review" state.
   */
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

  /**
   * Owed-and-pending first, then the tags that can be added to, then anything already
   * shot, then what this phase can't shoot at all. The order is the priority: what the
   * job demands stays at the top of the picker, and the optional tags sit under it as an
   * offer rather than a checklist.
   */
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

  /** Shootable in this phase — see `isTagOpen`. */
  const selectedOpen = !!selected && isTagOpen(selected);

  /**
   * Shootable, but with nothing to ghost against — the rep never covered this tag.
   *
   * Two ways in: a tag the rep skipped (now shootable, see `isTagOpen`), and the static
   * fallback sections, whose tags claim `hasRep` but carry no key. Both mean the same
   * thing to the installer, so both get the same pane: the line-art house and an invite
   * to shoot rather than a "match" prompt.
   */
  const referenceUnavailable = selectedOpen && !selected?.repPhotoS3Url && !selectedRef;

  /**
   * Keep the selection on a tag that can actually be shot in this phase.
   *
   * Both passes stay mounted with `visible` toggling, so the initial selection is picked
   * long before the post pass is opened — at which point `preMatched` was still empty and
   * the chosen tag is very likely one post has since closed. Landing on a dead tag would
   * show a disabled reference pane and look broken.
   *
   * Guarded on the selection being INVALID, so it can never override a manual pick.
   */
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
      // 0 in free-form mode — and that is the useful record: it says the job had no rep
      // capture set, so the shot count was the installer's call.
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
            // Floored — see `headerTopPadding`. Inside a Modal `insets.top` can come
            // back 0, which put the back arrow on the status bar.
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
                {/* "REP PHOTO" over a blank frame reads as a photo that failed to load.
                    A tag with no reference is an addition, so it says so. */}
                {referenceUnavailable
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
                  // dead N/A rows give an installer no reason to try tapping one.
                  t('installer.selectTagRepPlus')
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
                {/* "All Shots Matched" would be a lie in free-form mode — nothing was
                    matched and nothing more is owed. It names the count instead. */}
                {isFreeform
                  ? t('installer.donePhotosTaken', { count: takenTotal })
                  : t('installer.allShotsMatched')}
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
                // Closed in this phase: no pre shot to compare against (post only).
                // Untappable, dimmed, and marked N/A below.
                const open = isTagOpen(t);
                // Owed. Everything else that is open can still be shot — it just isn't
                // asked for, so it carries no amber edge and no N/A.
                const required = isTagRequired(t);
                const pending = required && !m;
                // Shootable, nothing recorded, nothing owed — the "you may add this"
                // state. The plus is what says the row is live; without it a tag with no
                // rep photo looks exactly like the disabled N/A rows it replaced.
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
                      // Amber edge = still needs a shot (same semantic as the timeline).
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
                        // Optional tags read one step back from the owed ones, but stay
                        // legible — they are tappable, so the near-invisible closed grey
                        // would be a lie about what the row does.
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
        // Same footer as `InstallerCamera`'s review, so it clears the nav bar by the
        // same amount — see `footerBottomPadding` there for why the inset alone isn't it.
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
});
