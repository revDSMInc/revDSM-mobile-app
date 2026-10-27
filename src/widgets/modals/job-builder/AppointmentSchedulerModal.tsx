import React, { useRef, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, TextInput, Platform, Pressable, Keyboard, InputAccessoryView, ActivityIndicator } from 'react-native';

const TBD_REASON_ACCESSORY_ID = 'tbdReasonDoneBar';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  format,
  addDays,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  subMonths,
  addMonths,
  isSameDay,
  startOfToday,
} from 'date-fns';
import { LeadService } from '../../../services/api/leads';
import { bookInstallSlot } from '../../../services/api/installAvailability';
import {
  useInstallAvailability,
  useInstallCalendarAvailability,
  useOfferedWindows,
  windowInfo,
  windowNotice,
} from '../../../hooks/useInstallAvailability';
import { FlashMessage } from '../../../config/message';
import { ContractAmendmentModal, AmendmentChange } from '../lead-center/ContractAmendmentModal';

interface AppointmentSchedulerModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (data: any) => void;
  onBooked?: (data: any) => void;
  onGenerate?: (data: any) => void;
  onUpload?: (data: any) => void;
  customerName: string;
  isEdit?: boolean;
  initialDate?: string;
  initialTimeWindow?: string;
  initialView?: 'date' | 'time';
  requireScheduleAmendment?: boolean;
  leadId?: string;
  /** The job is being sold, so booking the time also assigns a crew. */
  isSale?: boolean;
  lead?: any;
  scheduleTime?: { date?: string; timeWindow?: string; reason?: string };
}

export const AppointmentSchedulerModal = ({
  visible,
  onClose,
  onConfirm,
  onBooked,
  onGenerate,
  onUpload,
  customerName,
  isEdit = false,
  initialDate,
  initialTimeWindow,
  initialView,
  requireScheduleAmendment = false,
  leadId,
  isSale,
  lead,
  scheduleTime,
}: AppointmentSchedulerModalProps) => {
  const { colors, isDark } = useTheme();

  const [view, setView] = useState<'date' | 'time' | 'tbd' | 'success'>('date');

  const [amendmentOpen, setAmendmentOpen] = useState(false);
  const [amendmentChanges, setAmendmentChanges] = useState<AmendmentChange[]>([]);
  const [amendmentSubmitting, setAmendmentSubmitting] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const pendingDataRef = useRef<any>(null);
  const pendingPayloadRef = useRef<any>(null);

  const windows = [
    { label: '8:00 AM - 12:00 PM', value: '8:00 AM - 12:00 PM' },
    { label: '12:00 PM - 4:00 PM', value: '12:00 PM - 4:00 PM' },
  ];

  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    if (initialDate && initialDate !== 'TBD') {
      const parsed = new Date(initialDate);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    let d = new Date();
    if (getDay(d) === 0) d = addDays(d, 1);
    return d;
  });
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    if (initialDate && initialDate !== 'TBD') {
      const parsed = new Date(initialDate);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
  });
  const [timeSlotIdx, setTimeSlotIdx] = useState(0);
  const [tbdReason, setTbdReason] = useState('');
  const [isTBD, setIsTBD] = useState(false);
  // Booking the time on "Yes" is in flight, and a counter that re-asks the scheduler when a time was taken.
  const [booking, setBooking] = useState(false);
  const [availabilityRefresh, setAvailabilityRefresh] = useState(0);
  // Windows on the picked day that "Yes" found no crew for, so they are not offered again.
  const [failedWindows, setFailedWindows] = useState<string[]>([]);
  /**
   * Any flow with a lead is checked and booked when the rep taps "Yes", not while picking a date.
   *
   * ⚠️ EDITING AN APPOINTMENT TAKES THIS PATH TOO. REVDSM-1300 originally excluded `isEdit`
   * (`!isEdit && !!leadId`), which left an edit with the OLD behaviour and, because the three
   * things below are gated together, made it behave worse than the create flow in every respect:
   * the calendar pre-dimmed days no crew could take, "Yes" never booked, and the "No crew
   * available / Try <other window> / Pick Another Date" panel could never appear - the rep was
   * simply blocked with no way forward. Reported from the field against the edit wizard.
   *
   * `checkOnYes` gates three things as one, so they cannot drift apart:
   *   1. the calendar is NOT pre-dimmed (`useInstallCalendarAvailability` disabled)
   *   2. the per-day window check is NOT run up front (`useInstallAvailability` disabled)
   *   3. "Yes" books the window, and a `taken` answer shows the no-crew panel
   *
   * A caller with no `leadId` keeps the earlier checks - there is nothing to book without one.
   */
  const checkOnYes = !!leadId;

  // What the scheduler says about the chosen day. Until it answers — or if it never
  // does — every window is offered exactly as before.
  const { availability, loading: availabilityLoading } = useInstallAvailability(
    format(selectedDate, 'yyyy-MM-dd'),
    leadId,
    visible && view === 'time' && !isTBD && !checkOnYes,
    availabilityRefresh,
  );
  const offered = useOfferedWindows(windows, availability);
  // Days no crew can take are dulled out on the calendar. Empty until it answers.
  const { blocked: blockedDays } = useInstallCalendarAvailability(
    currentMonth,
    leadId,
    visible && view === 'date' && !checkOnYes,
    availabilityRefresh,
  );
  const currentWindow = offered[timeSlotIdx] ?? offered[0] ?? windows[0];
  const notice = windowNotice(windowInfo(currentWindow, availability));

  React.useEffect(() => {
    if (visible) {
      if (initialDate && initialDate !== 'TBD') {
        const parsed = new Date(initialDate);
        if (!isNaN(parsed.getTime())) {
          setSelectedDate(parsed);
          setCurrentMonth(parsed);
        }
        setIsTBD(false);
        if (initialView === 'time' && !isNaN(parsed.getTime())) {
          setTimeSlotIdx(0);
          setView('time');
        }
      } else if (initialDate === 'TBD') {
        setIsTBD(true);
        setView('tbd');
      }

      if (initialTimeWindow && initialView !== 'time') {
        const idx = windows.findIndex(w => w.value === initialTimeWindow);
        if (idx !== -1) setTimeSlotIdx(idx);
      }
    }
  }, [visible, initialDate, initialTimeWindow, initialView]);

  const handleDateSelect = (date: Date) => {
    if (getDay(date) === 0) return; // Disable Sunday
    setSelectedDate(date);
    setTimeSlotIdx(0);
    setFailedWindows([]);
    setIsTBD(false);
    setView('time');
  };

  const handleNoSlot = () => {
    if (timeSlotIdx >= offered.length - 1) {
      let nextDay = addDays(selectedDate, 1);
      while (getDay(nextDay) === 0) {
        nextDay = addDays(nextDay, 1);
      }
      setSelectedDate(nextDay);
      setTimeSlotIdx(0);
      setFailedWindows([]);
    } else {
      setTimeSlotIdx((prev) => prev + 1);
    }
  };

  const bookedAppointmentData = (tbd: boolean) =>
    tbd
      ? { date: 'TBD', reason: tbdReason, customerName }
      : {
          date: format(selectedDate, 'M/d/yyyy'),
          timeWindow: currentWindow.value,
          customerName,
        };

  /**
   * Book the chosen window, first come first served: the server books the time and assigns the
   * crew at this moment, so a time someone else just took is caught here and not at the end of
   * the job.
   *
   * Returns false when the window is gone, having already put the no-crew panel on screen; the
   * caller must stop. Shared by the create flow's "Yes" and by an appointment EDIT, so the two
   * cannot drift apart - an edit that skipped this could never reach the no-crew panel.
   *
   * ⚠️ OFFLINE IS A PASS, NOT A FAILURE. `bookInstallSlot` answers `offline` (or `error`) when
   * the request cannot be made, and only `taken` stops the rep. The server does not enforce
   * windows today, so a booking made with no signal is accepted whatever the crews' load is and
   * the manager sees it on the dispatch board afterwards - see `offline.md`, "Install availability
   * check is skipped offline". Do NOT make this gate the rep's progress on connectivity.
   */
  const bookChosenWindow = async (): Promise<boolean> => {
    if (!checkOnYes) return true;
    setBooking(true);
    const result = await bookInstallSlot({
      leadId,
      date: format(selectedDate, 'yyyy-MM-dd'),
      timeWindow: currentWindow.value,
      isSale,
    });
    setBooking(false);

    if (result.kind === 'taken') {
      // No crew for this window: say so on this screen and let the rep try the other
      // window or another date. Nothing was booked.
      setFailedWindows((prev) => (prev.includes(currentWindow.value) ? prev : [...prev, currentWindow.value]));
      setAvailabilityRefresh((n) => n + 1);
      return false;
    }
    return true;
  };

  const handleAcceptSlot = async () => {
    if (booking) return;
    if (!(await bookChosenWindow())) return;

    setIsTBD(false);
    setView('success');
    onBooked?.(bookedAppointmentData(false));
  };

  // The window "Yes" just found no crew for, and the other one if it has not failed too.
  const noCrewForCurrent = checkOnYes && failedWindows.includes(currentWindow.value);
  const otherWindowIdx = offered.findIndex((w, i) => i !== timeSlotIdx && !failedWindows.includes(w.value));

  const handleTryOtherWindow = () => {
    if (otherWindowIdx >= 0) setTimeSlotIdx(otherWindowIdx);
  };

  const handlePickAnotherDate = () => {
    setFailedWindows([]);
    setTimeSlotIdx(0);
    setView('date');
  };

  const handleConfirmTBDStep = () => {
    setIsTBD(true);
    setView('success');
    onBooked?.(bookedAppointmentData(true));
  };

  const handleModalClose = () => {
    onClose();
    setTimeout(() => {
      setView('date');
      setTimeSlotIdx(0);
      setFailedWindows([]);
      setTbdReason('');
      setIsTBD(false);
      setAmendmentOpen(false);
      setAmendmentChanges([]);
      pendingDataRef.current = null;
      pendingPayloadRef.current = null;
    }, 300);
  };

  const buildScheduleChanges = (appointmentData: any): AmendmentChange[] => {
    const oldDate = scheduleTime?.date ?? initialDate ?? '';
    const oldWindow = scheduleTime?.timeWindow ?? initialTimeWindow ?? '';
    const oldReason = scheduleTime?.reason ?? '';
    const newDate = appointmentData?.date || '';
    const newWindow = appointmentData?.timeWindow || '';
    const newReason = appointmentData?.reason || '';

    const changes: AmendmentChange[] = [];
    if (String(oldDate) !== String(newDate)) {
      changes.push({ key: 'scheduledDate', label: 'Scheduled Date', oldValue: oldDate, newValue: newDate });
    }
    if (String(oldWindow) !== String(newWindow)) {
      changes.push({ key: 'timeWindow', label: 'Time Window', oldValue: oldWindow, newValue: newWindow });
    }
    if (String(oldReason) !== String(newReason)) {
      changes.push({ key: 'scheduleReason', label: 'Schedule — Reason', oldValue: oldReason, newValue: newReason });
    }
    return changes;
  };

  const buildEditAppointmentData = () =>
    isTBD
      ? { date: 'TBD', reason: tbdReason, customerName }
      : { date: format(selectedDate, 'M/d/yyyy'), timeWindow: currentWindow.value, customerName };

  const openAmendmentFlow = async (appointmentData: any, changes: AmendmentChange[]) => {
    if (!leadId) return;
    try {
      const dateRaw = appointmentData?.date;
      const scheduleTimeDraft = {
        customerName:
          appointmentData?.customerName != null && appointmentData.customerName !== ''
            ? String(appointmentData.customerName)
            : null,
        date: dateRaw === 'TBD' ? 'TBD' : dateRaw != null && dateRaw !== '' ? String(dateRaw) : null,
        timeWindow:
          appointmentData?.timeWindow != null && appointmentData.timeWindow !== ''
            ? String(appointmentData.timeWindow)
            : null,
        reason:
          appointmentData?.reason != null && appointmentData.reason !== ''
            ? String(appointmentData.reason)
            : null,
      };

      const draftRes = await LeadService.upsertLeadDraft(leadId, { scheduleTime: scheduleTimeDraft });
      const newDraftId =
        draftRes?.data?._id ||
        draftRes?.data?.data?._id ||
        draftRes?.data?.id ||
        (draftRes?.data as any)?.data?.id ||
        null;
      setDraftId(newDraftId);

      pendingDataRef.current = appointmentData;
      pendingPayloadRef.current = {
        leadData: {},
        jobState: {
          scheduleTime: {
            customerName: appointmentData.customerName,
            date: appointmentData.date,
            timeWindow: appointmentData.timeWindow,
            reason: appointmentData.reason,
          },
        },
      };
      setAmendmentChanges(changes);
      setAmendmentOpen(true);
      FlashMessage.show('Amendment requires customer signature', '', 'info');
    } catch (error) {
      console.error('Failed to create lead draft:', error);
      FlashMessage.error('Error', 'Failed to start amendment flow');
    }
  };

  const handleEditConfirm = async () => {
    if (booking) return;
    const appointmentData = buildEditAppointmentData();
    const changes = buildScheduleChanges(appointmentData);
    const scheduleChanged = changes.length > 0;

    /**
     * ⚠️ An edit books the window too, and only when the schedule actually CHANGED. Confirming
     * an edit that left the date and window alone must not re-book the slot the lead already
     * holds - the server would be asked to take a window this same lead is sitting on.
     */
    if (scheduleChanged && !(await bookChosenWindow())) return;

    if (leadId && scheduleChanged && requireScheduleAmendment) {
      await openAmendmentFlow(appointmentData, changes);
      return;
    }

    onConfirm(appointmentData);
    handleModalClose();
  };

  const handleAmendmentSubmit = async ({ signature }: { signature: string }) => {
    if (!pendingPayloadRef.current || !leadId) return;
    setAmendmentSubmitting(true);
    try {
      await LeadService.submitJobBuilder(leadId, pendingPayloadRef.current);
      await LeadService.updateJobBuilder(leadId, pendingPayloadRef.current);
      if (draftId) {
        try {
          await LeadService.updateLeadDraft(draftId, {
            status: 'accepted',
            customerSignature: signature || null,
          });
        } catch {
        }
      }
      FlashMessage.success('Installation time updated successfully');
      setAmendmentOpen(false);
      const data = pendingDataRef.current;
      pendingDataRef.current = null;
      try {
        await onConfirm?.(data ?? {});
      } catch {
      }
      handleModalClose();
    } catch (error) {
      console.error(error);
      FlashMessage.error('Error', 'Failed to submit amendment');
    } finally {
      setAmendmentSubmitting(false);
    }
  };

  const startOfCurrentMonth = startOfMonth(currentMonth);
  const endOfCurrentMonth = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: startOfCurrentMonth, end: endOfCurrentMonth });
  const startDay = getDay(startOfCurrentMonth);

  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  const renderCalendar = () => {
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const blanks = Array.from({ length: startDay }).map((_, i) => (
      <View key={`blank-${i}`} style={{ width: '14.28%', height: 48 }} />
    ));

    return (
      <View style={{ paddingHorizontal: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 32, gap: 16 }}>
          <Text style={{ fontSize: 18, fontWeight: '900', color: '#334155' }}>
            {format(currentMonth, 'MMMM yyyy')}
          </Text>
          <TouchableOpacity onPress={prevMonth} style={{ padding: 8 }}>
            <View>
              <Icon name="chevron-left" size={24} color="#94a3b8" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={nextMonth} style={{ padding: 8 }}>
            <View>
              <Icon name="chevron-right" size={24} color="#94a3b8" />
            </View>
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', marginBottom: 16 }}>
          {days.map((d, i) => (
            <Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '900', color: '#94a3b8' }}>
              {d}
            </Text>
          ))}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {blanks}
          {daysInMonth.map((day, i) => {
            const isSelected = isSameDay(day, selectedDate);
            const isToday = isSameDay(day, new Date());
            const isPast = day < startOfToday();
            const isSunday = getDay(day) === 0;
            const isDisabled = isPast || isSunday || blockedDays.has(format(day, 'yyyy-MM-dd'));

            return (
              <TouchableOpacity
                key={i}
                disabled={isDisabled}
                onPress={() => handleDateSelect(day)}
                style={{ width: '14.28%', height: 48, alignItems: 'center', justifyContent: 'center' }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isSelected ? '#22C55E' : 'transparent',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '900',
                      color: isSelected ? 'white' : isDisabled ? '#e2e8f0' : '#475569',
                    }}
                  >
                    {format(day, 'd')}
                  </Text>
                </View>
                {isToday && !isSelected && (
                  <View style={{ position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: '#22C55E' }} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <>
    <Modal visible={visible && !amendmentOpen} transparent animationType="fade">
      <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
        <View style={{ width: '100%', backgroundColor: 'white', borderRadius: 24, overflow: 'hidden', maxWidth: 400 }}>
          {/* Header */}
          <View style={{ backgroundColor: '#22C55E', paddingHorizontal: 24, paddingVertical: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ color: 'white', fontSize: 14, fontWeight: '900', letterSpacing: -0.3 }}>
                First Available Date For Customer
              </Text>
            </View>
            <TouchableOpacity onPress={handleModalClose}>
              <View
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                  padding: 6,
                  borderRadius: 999,
                }}
              >
                <Icon name="close" size={20} color="white" />
              </View>
            </TouchableOpacity>
          </View>

          <View style={{ padding: 32 }}>
            {view === 'date' && (
              <View>
                {/* TBD Switch */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', marginBottom: 48, gap: 16 }}>
                  <TouchableOpacity
                    onPress={() => setView('tbd')}
                  >
                    <View style={{ width: 48, height: 24, borderRadius: 12, backgroundColor: '#e2e8f0', padding: 4 }}>
                      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: 'white' }} />
                    </View>
                  </TouchableOpacity>
                  <Text style={{ color: '#475569', fontWeight: '900', fontSize: 14 }}>TBD Install Date</Text>
                </View>

                {renderCalendar()}
              </View>
            )}

            {view === 'time' && (
              <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: '#ecfdf5', alignItems: 'center', justifyContent: 'center', marginBottom: 32, borderWidth: 4, borderColor: 'white' }}>
                  <Icon name="calendar-clock" size={44} color="#22C55E" />
                </View>

                <Text style={{ fontSize: 24, fontWeight: '900', color: '#1e293b', textAlign: 'center', marginBottom: 8 }}>
                  {format(selectedDate, 'M/d/yyyy')}
                </Text>
                {availabilityLoading ? (
                  <View style={{ alignItems: 'center', marginBottom: 40 }}>
                    <ActivityIndicator color="#22C55E" />
                    <Text style={{ color: '#94a3b8', fontWeight: '700', marginTop: 12 }}>Checking availability…</Text>
                  </View>
                ) : noCrewForCurrent ? (
                  <View style={{ alignItems: 'center', width: '100%' }}>
                    <Text style={{ fontSize: 18, fontWeight: '900', color: '#334155', marginBottom: 8 }}>No crew available</Text>
                    <Text style={{ color: '#94a3b8', fontWeight: '700', textAlign: 'center', marginBottom: 32 }}>
                      {`No crew can take this job on ${format(selectedDate, 'EEEE, MMM d')} from ${currentWindow.label}.`}
                    </Text>
                    {otherWindowIdx >= 0 && (
                      <TouchableOpacity onPress={handleTryOtherWindow} style={{ width: '100%', marginBottom: 12 }}>
                        <View style={{ height: 56, backgroundColor: '#22C55E', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: 'white', fontWeight: '900', fontSize: 14 }}>
                            {`Try ${offered[otherWindowIdx].label}`}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={handlePickAnotherDate} style={{ width: '100%' }}>
                      <View style={{ height: 56, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', backgroundColor: 'white' }}>
                        <Text style={{ color: '#475569', fontWeight: '900', fontSize: 14 }}>Pick Another Date</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                ) : offered.length === 0 ? (
                  <View style={{ alignItems: 'center', width: '100%' }}>
                    <Text style={{ fontSize: 18, fontWeight: '900', color: '#334155', marginBottom: 8 }}>No availability</Text>
                    <Text style={{ color: '#94a3b8', fontWeight: '700', textAlign: 'center', marginBottom: 32 }}>
                      No crew can take this job on that day.
                    </Text>
                    <TouchableOpacity onPress={handleNoSlot} style={{ width: '100%' }}>
                      <View style={{ height: 56, backgroundColor: '#22C55E', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ color: 'white', fontWeight: '900', fontSize: 14 }}>Try Next Day</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                ) : (
                <>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#334155', marginBottom: notice ? 16 : 40 }}>
                  {currentWindow.label}
                </Text>

                {notice && (
                  <Text
                    style={{
                      marginBottom: 24,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      borderRadius: 10,
                      overflow: 'hidden',
                      textAlign: 'center',
                      fontWeight: '700',
                      fontSize: 12.5,
                      color: notice.tone === 'warn' ? '#8A5A00' : '#047857',
                      backgroundColor: notice.tone === 'warn' ? '#FFF7E6' : '#ECFDF5',
                    }}
                  >
                    {notice.text}
                  </Text>
                )}

                <Text style={{ color: '#94a3b8', fontWeight: '700', textAlign: 'center', marginBottom: 40 }}>
                  Does this time work for the customer?
                </Text>

                <View style={{ flexDirection: 'row', gap: 16, width: '100%' }}>
                  <TouchableOpacity onPress={handleNoSlot} style={{ flex: 1 }}>
                    <View
                      style={{
                        height: 56,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: '#e2e8f0',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'white',
                      }}
                    >
                      <Text style={{ color: '#475569', fontWeight: '900', fontSize: 14 }}>No</Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={handleAcceptSlot} disabled={booking} style={{ flex: 1, opacity: booking ? 0.7 : 1 }}>
                    <View
                      style={{
                        height: 56,
                        backgroundColor: '#22C55E',
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        shadowColor: '#10B981',
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.2,
                        shadowRadius: 8,
                        elevation: 4,
                      }}
                    >
                      {booking ? (
                        <ActivityIndicator color="white" />
                      ) : (
                        <Text style={{ color: 'white', fontWeight: '900', fontSize: 14 }}>
                          {notice?.tone === 'warn' ? 'Yes, Book Anyway' : 'Yes'}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                </View>
                </>
                )}
              </View>
            )}

            {view === 'tbd' && (
              <View>
                <Text style={{ fontSize: 18, fontWeight: '900', color: '#1e293b', marginBottom: 24 }}>
                  Why is the install date TBD?
                </Text>

                <View style={{ height: 180, backgroundColor: 'white', borderRadius: 16, borderWidth: 2, borderColor: '#1e293b', padding: 12, marginBottom: 32 }}>
                  <TextInput
                    value={tbdReason}
                    onChangeText={setTbdReason}
                    multiline
                    placeholder={"Please explain why the installation date cannot be determined at this time...\nExamples: \u2022 Waiting for material delivery \u2022 Customer needs to confirm schedule \u2022 Weather-dependent installation \u2022 Pending"}
                    placeholderTextColor="#94a3b8"
                    style={{ flex: 1, textAlignVertical: 'top', fontSize: 14, fontWeight: '700', color: '#0f172a' }}
                    inputAccessoryViewID={Platform.OS === 'ios' ? TBD_REASON_ACCESSORY_ID : undefined}
                  />
                </View>

                {/* iOS-only "Done" bar above the keyboard to dismiss it (the multiline
                    TBD-reason field can't be dismissed with the return key on iOS). */}
                {Platform.OS === 'ios' && (
                  <InputAccessoryView nativeID={TBD_REASON_ACCESSORY_ID}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'flex-end',
                        backgroundColor: '#F1F5F9',
                        borderTopWidth: 1,
                        borderTopColor: '#E2E8F0',
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                      }}
                    >
                      <TouchableOpacity onPress={() => Keyboard.dismiss()} style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
                        <Text style={{ color: '#2563EB', fontWeight: '800', fontSize: 16 }}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  </InputAccessoryView>
                )}

                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <TouchableOpacity
                    onPress={() => setView('date')}
                    style={{ flex: 1 }}
                  >
                    <View style={{ height: 56, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', backgroundColor: 'white' }}>
                      <Text style={{ color: '#1e293b', fontWeight: '900', fontSize: 14 }}>Back to Calendar</Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handleConfirmTBDStep}
                    disabled={!tbdReason.trim()}
                    style={{ flex: 1 }}
                  >
                    <View
                      style={{
                        height: 56,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: !tbdReason.trim() ? '#f1f5f9' : '#22C55E',
                        shadowColor: !tbdReason.trim() ? 'transparent' : '#10B981',
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.2,
                        shadowRadius: 8,
                        elevation: !tbdReason.trim() ? 0 : 4,
                      }}
                    >
                      <Text
                        style={{
                          fontWeight: '900',
                          fontSize: 14,
                          color: !tbdReason.trim() ? '#94a3b8' : 'white',
                        }}
                      >
                        Continue
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {view === 'success' && (
              <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#22C55E', alignItems: 'center', marginBottom: 24, justifyContent: 'center' }}>
                  <Icon name="check" size={48} color="white" />
                </View>

                <Text style={{ fontSize: 24, fontWeight: '900', color: '#1e293b', marginBottom: 32 }}>Job Booked!</Text>

                <View style={{ width: '100%', backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#f1f5f9', borderRadius: 24, padding: 24, marginBottom: 32 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(226, 232, 240, 0.5)' }}>
                    <Text style={{ color: '#94a3b8', fontWeight: '900', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Customer</Text>
                    <Text style={{ color: '#334155', fontWeight: '700', fontSize: 14, flex: 1, textAlign: 'right', marginLeft: 16 }}>{customerName}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(226, 232, 240, 0.5)' }}>
                    <Text style={{ color: '#94a3b8', fontWeight: '900', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Date</Text>
                    <Text style={{ color: '#334155', fontWeight: '700', fontSize: 14 }}>{isTBD ? 'TBD' : format(selectedDate, 'M/d/yyyy')}</Text>
                  </View>
                  {isTBD ? (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: '#94a3b8', fontWeight: '900', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>TBD Reason</Text>
                      <Text style={{ color: '#334155', fontWeight: '700', fontSize: 14, flex: 1, textAlign: 'right', marginLeft: 16 }}>{tbdReason || 'none'}</Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: '#94a3b8', fontWeight: '900', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Time Window</Text>
                      <Text style={{ color: '#334155', fontWeight: '700', fontSize: 14 }}>{currentWindow.label}</Text>
                    </View>
                  )}
                </View>

                {isEdit ? (
                  <TouchableOpacity
                    onPress={handleEditConfirm}
                    style={{ width: '100%' }}
                  >
                    <View
                      style={{
                        height: 64,
                        width: '100%',
                        backgroundColor: '#22C55E',
                        borderRadius: 16,
                        alignItems: 'center',
                        justifyContent: 'center',
                        shadowColor: colors.primary.main,
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.2,
                        shadowRadius: 8,
                        elevation: 4,
                      }}
                    >
                      <Text style={{ color: 'white', fontWeight: '900', fontSize: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Save Changes</Text>
                    </View>
                  </TouchableOpacity>
                ) : (
                  <View style={{ width: '100%', gap: 12 }}>
                    <TouchableOpacity
                      onPress={() => {
                        onGenerate?.(bookedAppointmentData(isTBD));
                        handleModalClose();
                      }}
                      style={{
                        height: 64,
                        backgroundColor: '#22C55E',
                        borderRadius: 16,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        shadowColor: '#10B981',
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.2,
                        shadowRadius: 8,
                        elevation: 4,
                      }}
                    >
                      <Icon name="magic-staff" size={24} color="white" style={{ marginRight: 12 }} />
                      <Text
                        style={{
                          color: 'white',
                          fontWeight: '900',
                          fontSize: 14,
                        }}
                      >
                        Generate Dynamic Agreement
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => {
                        onUpload?.(bookedAppointmentData(isTBD));
                        handleModalClose();
                      }}
                      style={{
                        height: 64,
                        backgroundColor: 'white',
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: '#e2e8f0',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text
                        style={{
                          color: '#1e293b',
                          fontWeight: '900',
                          fontSize: 14,
                        }}
                      >
                        Add Presigned Agreement
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>

    {/* Contract amendment (customer signature) — required schedule changes only */}
    {leadId && (
      <ContractAmendmentModal
        visible={amendmentOpen}
        onClose={() => {
          pendingDataRef.current = null;
          pendingPayloadRef.current = null;
          setAmendmentOpen(false);
        }}
        changes={amendmentChanges}
        submitting={amendmentSubmitting}
        leadId={leadId}
        draftId={draftId}
        defaultPhone={lead?.customerDetails?.phone || ''}
        defaultEmail={lead?.customerDetails?.email || ''}
        customerFirstName={lead?.customerDetails?.firstName || ''}
        customerLastName={lead?.customerDetails?.lastName || ''}
        onSubmitAmendment={handleAmendmentSubmit}
      />
    )}
    </>
  );
};
