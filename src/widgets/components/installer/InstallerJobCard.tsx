import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Ionicon from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import { format } from 'date-fns';
import { useTheme } from '../../../theme/ThemeProvider';
import { useTranslation } from '../../../i18n/LanguageProvider';
import {
  installStatusPhrase,
  JOB_CARD_COLORS,
  resolveJobCardState,
} from '../../../utils/installer-card-state';
import { MapSelectionModal } from '../../common/modal/MapSelectionModal';
import type { InstallerJob } from '../../../config/types/installer';

interface Props {
  job: InstallerJob;
  /** The Upcoming tab — those jobs are preview-only. */
  isUpcoming?: boolean;
  /** Starting the job — the card waits on the API before the detail screen opens. */
  loading?: boolean;
  /** Another card is starting; this one stays tappable-looking but inert. */
  disabled?: boolean;
  /**
   * The device fix matches neither this job's coordinates nor a company office, so the
   * action reads "Preview Appointment" instead of offering a check-in that would be
   * refused. False while the position is still unknown.
   */
  offSite?: boolean;
  /**
   * Clock the arrival window is judged against. Supplied by the dashboard's ticker rather
   * than read here, so a card sitting on screen as noon passes actually re-renders —
   * `new Date()` inside the component would be re-read only when something else already
   * caused a render, which is exactly when it isn't needed.
   */
  now?: Date;
  onPress: () => void;
}

/**
 * Job card for the installer schedule.
 *
 * Follows LeadCard's visual contract — `rounded-2xl border-2` with a `color + '10'`
 * tinted wash and a full-width `h-12 rounded-xl` action button. The accent colour and
 * the action label come from `resolveJobCardState`: the job's `workflowState`, downgraded
 * to a preview when the arrival window hasn't opened or the crew isn't on site.
 */
export function InstallerJobCard({
  job,
  isUpcoming = false,
  loading = false,
  disabled = false,
  offSite = false,
  now,
  onPress,
}: Props) {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();

  const resulted = !!job.resulted;
  const inert = loading || disabled;
  const state = resolveJobCardState(job, { isUpcoming, loading, offSite, now });

  /**
   * Where a Can't Do Work / Not Hit / Reset request on this job has got to, in
   * the API's own words — "Pending Install Not Hit", "Rescheduled Reset".
   *
   * Read off `workflowState`, which carries the phrase in place of its base
   * state on a job that has one. Composed server-side rather than here: a job
   * whose request is still in flight stays `inProgress`, so half of these
   * phrases cannot be derived from anything the card holds.
   */
  const workflowPhrase = installStatusPhrase(job);

  /**
   * The request phrase rides on the ACTION BUTTON, not in a chip above the lead id.
   *
   * Ticket: *"these status are shown on top on the installer side but we need to show
   * these status on the button instead"*. The button is where the crew's eye lands, and
   * it gives the phrase a full row to itself — "Pending Install Can't Do Work" is nearly
   * thirty characters, which is why the chip needed a row of its own in the first place.
   * That row is now pure vertical cost on a card that already carries five.
   *
   * ⚠️ **There is no chip at all any more, on any card.** It first survived for RESULTED
   * jobs, whose button was spoken for by the outcome — and that is exactly the card the
   * reporter came back on: an `INSTALL CAN'T DO WORK` chip sitting above a
   * `Resulted - Cant Do Work!` button, the same sentence twice.
   *
   * ⚠️ **A RESULTED job is no exception, and `workflowState` OUTRANKS the outcome label
   * on it.** Requested directly: *"get the button status from this object —
   * `workflowState: "Install Can't Do Work"`"*. So that card reads `Install Can't Do
   * Work`, not `resultedActionLabel`'s `Resulted - Cant Do Work!`, and the two are not
   * interchangeable: the phrase is composed server-side from where the REQUEST has got
   * to, while the outcome is derived here from `job.status`. Dropping the `Resulted -`
   * prefix loses nothing — the card already carries the RESULTED badge top-right.
   *
   * `resultedActionLabel` still answers every resulted job that carries no phrase, which
   * is most of them (`installStatusPhrase` returns null for a `resulted` workflowState).
   *
   * The one state that keeps the phrase book is **loading** — the button is a spinner +
   * "Starting Job…" for that instant.
   *
   * The card goes GREY while it carries a phrase — see `accent` below.
   */
  const showPhraseOnAction = !!workflowPhrase && !loading;

  /**
   * ⚠️ A status phrase REPLACES the workflow accent for the WHOLE card — border, wash,
   * arrival time, address pin, button and its label all move together, to the RESULTED
   * grey. Requested directly: *"use the same colour for the card that is used for the
   * resulted lead — no need to use the yellow, blue and other colour"*.
   *
   * ⚠️ A per-status TONE was tried twice — on the button, then on the whole card (amber
   * pending / red can't-do-work / blue rescheduled) — and sent back both times: a list
   * where every card is a different hue is a list with no signal in it. These jobs share
   * the one fact that matters — the office is holding them, so they are not the crew's
   * ordinary work — and `JOB_CARD_COLORS` already has the word for that: the grey a
   * resulted job wears. The old `workflowPhraseColor` helper went with the chip.
   *
   * ⚠️ Grey the COLOUR, not the resulted TREATMENT. The card keeps its ordinary `+ '1A'`
   * wash and full opacity — the resulted card's `#F4F6F8` ground and 0.85 dim say "this
   * visit is over", which a pending-reset job flatly is not: its button still starts or
   * resumes the job.
   *
   * ⚠️ The start/resume distinction is NOT lost with the colour: only `state.color` is
   * overridden. `state` still decides what the tap does, the accent bar still draws for
   * the two live states, and a phrase card that is not yet startable still resolves to
   * PREVIEW — it just previews in grey.
   */
  const accent = showPhraseOnAction ? JOB_CARD_COLORS.RESULTED : state.color;

  // A literal label wins over the phrase book — a resulted job reports the API's own
  // outcome string (`Resulted - Cant Do Work`), which has no translation key.
  const actionLabel = state.actionLabel ?? t(state.actionLabelKey);

  const buttonLabel = showPhraseOnAction ? (workflowPhrase as string) : actionLabel;

  /**
   * Preview is styled DOWN, deliberately — it sits in the card's OWN colour rather than
   * shouting in it.
   *
   * A saturated blue button reads as the thing to press, and preview is the one state
   * where pressing does nothing useful: the job is not due yet, or the crew is not at
   * the address. It has to look secondary to the Start / Resume cards beside it, so a
   * rep scanning the list is drawn to the job they can actually work.
   *
   * The tint is the SAME hue as the card, one step deeper — the wash is `accent + '1A'`
   * (10 %) and the button `+ '33'` (20 %), so it reads as a slightly raised area of the
   * card instead of a separate control laid on top of it. A neutral grey was tried first
   * and looked like a foreign element dropped onto a blue card.
   *
   * The label takes the accent itself, which is already how this card tints its arrival
   * time over the same wash — so the two agree instead of introducing a third colour.
   *
   * It stays TAPPABLE — `disabled` is not set. The tap is what explains WHY it isn't
   * open ("This opens on 08/12/2026", "You're 1.4 km away"), and a truly dead button
   * would leave the rep with a card that answers nothing.
   */
  const isPreview = state.key === 'UPCOMING';

  /**
   * ⚠️ A phrase button is always SOLID, even on a preview card: *"the button should not
   * be transparent type, the button's look should be same as the previous"*. The washed
   * form reads as a disabled or secondary control, and a status report is neither
   * optional nor secondary — it is the thing the card exists to say.
   *
   * The preview signal survives on the card itself: such a card still resolves to
   * UPCOMING, so it loses the accent bar exactly as before, and its tap still explains
   * why it will not open.
   */
  const solidAction = !isPreview || showPhraseOnAction;
  const actionBg = solidAction ? accent : accent + '33';
  const actionFg = solidAction ? '#fff' : accent;

  // The pin belongs to an action that takes the installer somewhere. A status report
  // doesn't go anywhere — the same reasoning that dropped it from the resulted bar.
  const showActionIcon = !loading && !resulted && !showPhraseOnAction;

  const name =
    job.customerName ||
    [job.customerDetails?.firstName, job.customerDetails?.lastName].filter(Boolean).join(' ');

  // The API sends "N/A" for leads without a human-facing number; fall back to the job number.
  const displayId = job.leadDisplayId || job.jobNumber || job.leadId;

  const date = job.leadDate ? new Date(job.leadDate) : null;
  const dateLabel = date && !isNaN(date.getTime()) ? format(date, 'MM/dd/yyyy') : 'N/A';

  const [showMapModal, setShowMapModal] = useState(false);

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onPress}
        disabled={inert}
        className="mb-4 rounded-2xl overflow-hidden border-2"
        style={{
          // `+ '1A'` is web's `alpha(color, 0.1)`; resulted falls back to web's `grey.100`
          // (the app's own surface in dark mode, which `grey.100` would blind).
          backgroundColor: resulted ? (isDark ? colors.surface : '#F4F6F8') : accent + '1A',
          borderColor: accent,
          opacity: disabled && !loading ? 0.6 : resulted ? 0.85 : 1,
        }}
      >
        {/*
          Web draws this as `boxShadow: '-6px 0 0 0 color'` on the two live states.
          RN has no offset-only shadow, so it's a real 6 px edge — same result.
        */}
        {state.accentBar && (
          <View
            className="absolute left-0 top-0 bottom-0"
            style={{ width: 6, backgroundColor: accent }}
          />
        )}

        <View className="p-4">
          {/* Arrival window + resulted chip */}
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-row items-center flex-1">
              <Ionicon name="time-outline" size={16} color={accent} />
              <Text className="ml-1.5 text-base font-bold" style={{ color: accent }} numberOfLines={1}>
                {job.leadTime || 'N/A'}
              </Text>
            </View>
            {resulted && (
              // Web's self-gen resulted chip — `#9ca3af`, white, bold.
              <View className="px-3 py-1.5 rounded-lg" style={{ backgroundColor: '#9ca3af' }}>
                <Text className="text-[11px] font-black text-white tracking-widest">
                  {t('installer.resulted')}
                </Text>
              </View>
            )}
          </View>

          {/* Customer + date */}
          <View className="mb-4">
            <Text className="text-base mb-1" style={{ color: colors.textSecondary }}>
              {t('installer.leadId')}: {displayId || 'N/A'}
            </Text>
            <View className="flex-row justify-between items-center">
              <View className="flex-row items-center flex-1">
                <FontAwesome name="user" size={14} color="#637381" />
                <Text className="ml-2 text-base font-bold" style={{ color: colors.text }}>
                  {name || t('installer.customer')}
                </Text>
              </View>
              <View className="flex-row items-center">
                <Ionicon name="calendar-clear" size={14} color="#637381" />
                <Text className="ml-1.5 text-base font-semibold" style={{ color: colors.textSecondary }}>
                  {dateLabel}
                </Text>
              </View>
            </View>
          </View>

          {/* Address — opens the same Apple/Google Maps chooser the sales LeadCard does.

              ⚠️ Nested inside the card's own TouchableOpacity ON PURPOSE. The inner
              view claims the touch, so tapping the address opens directions while
              tapping anywhere else still opens the job — the same arrangement
              `LeadCard` uses, where the card navigates and the address does not.

              ⚠️ NOT gated on `inert`. A preview-only or already-started card still has
              to get the crew to the door; only the ACTION is unavailable, not the
              address. */}
          <TouchableOpacity
            onPress={() => setShowMapModal(true)}
            className="flex-row items-start mb-5"
          >
            <Ionicon name="location-sharp" size={18} color={accent} style={{ marginTop: 2 }} />
            <Text
              className="flex-1 ml-1.5 text-base font-bold leading-5"
              style={{ color: colors.text }}
              numberOfLines={2}
            >
              {job.fullAddress || t('installer.addressPending')}
            </Text>
          </TouchableOpacity>

          {/* Action.

              A resulted card drops the location pin and matches the sales LeadCard's
              resulted bar — centred bold text on its own. The pin belongs to an action
              that takes the installer somewhere; an outcome report doesn't go anywhere,
              and the icon only crowded a label that is already as long as the API's two
              status fields make it. */}
          <TouchableOpacity
            onPress={onPress}
            disabled={inert}
            className="h-12 rounded-xl items-center justify-center flex-row"
            style={{ backgroundColor: actionBg }}
          >
            {loading ? (
              <ActivityIndicator size="small" color={actionFg} />
            ) : (
              showActionIcon && <Ionicon name="location-sharp" size={20} color={actionFg} />
            )}
            {/* `font-medium`, not bold: at 16 px on a filled button, a bold weight reads
                as a heavy slab rather than a label. One line — an outcome label is as
                long as the API's status makes it.

                The margin belongs to whatever precedes the text, so it is keyed on the
                spinner/pin actually being there rather than on `resulted`: a status
                phrase drops the pin too, and an inherited `ml-2` would push it off
                centre. */}
            <Text
              className={`text-base font-medium ${
                loading || showActionIcon ? 'ml-2' : 'tracking-tight'
              }`}
              style={{ color: actionFg }}
              numberOfLines={1}
            >
              {buttonLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      {/* Outside the card, so the chooser is not a child of a pressable. */}
      <MapSelectionModal
        visible={showMapModal}
        address={job.fullAddress || ''}
        onClose={() => setShowMapModal(false)}
      />
    </>
  );
}
