import React, { useRef, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, TextInput, Platform, Pressable, Keyboard } from 'react-native';
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
import { FlashMessage } from '../../../config/message';
import { ContractAmendmentModal, AmendmentChange } from '../lead-center/ContractAmendmentModal';

interface AppointmentSchedulerModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (data: any) => void;
  onGenerate?: (data: any) => void;
  onUpload?: (data: any) => void;
  customerName: string;
  isEdit?: boolean;
  initialDate?: string;
  initialTimeWindow?: string;
  /**
   * When true, rescheduling an EXISTING appointment with real changes requires a
   * customer signature (contract amendment) before the change is committed.
   * Web parity: `appointment-scheduler.js` `requireScheduleAmendment`.
   */
  requireScheduleAmendment?: boolean;
  /** Lead id — needed to create/update the amendment lead-draft. */
  leadId?: string;
  /** Full lead object — provides customer phone/email/name for the amendment modal. */
  lead?: any;
  /** Old schedule values, diffed against the new selection to build the amendment changes list. */
  scheduleTime?: { date?: string; timeWindow?: string; reason?: string };
}

export const AppointmentSchedulerModal = ({
  visible,
  onClose,
  onConfirm,
  onGenerate,
  onUpload,
  customerName,
  isEdit = false,
  initialDate,
  initialTimeWindow,
  requireScheduleAmendment = false,
  leadId,
  lead,
  scheduleTime,
}: AppointmentSchedulerModalProps) => {
  const { colors, isDark } = useTheme();

  const [view, setView] = useState<'date' | 'time' | 'tbd' | 'success'>('date');

  // ── Contract-amendment gating (web parity: appointment-scheduler.js) ────────
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

  // Sync state when props change and modal becomes visible
  React.useEffect(() => {
    if (visible) {
      if (initialDate && initialDate !== 'TBD') {
        const parsed = new Date(initialDate);
        if (!isNaN(parsed.getTime())) {
          setSelectedDate(parsed);
          setCurrentMonth(parsed);
        }
        setIsTBD(false);
      } else if (initialDate === 'TBD') {
        setIsTBD(true);
        setView('tbd');
      }

      if (initialTimeWindow) {
        const idx = windows.findIndex(w => w.value === initialTimeWindow);
        if (idx !== -1) setTimeSlotIdx(idx);
      }
    }
  }, [visible, initialDate, initialTimeWindow]);

  const handleDateSelect = (date: Date) => {
    if (getDay(date) === 0) return; // Disable Sunday
    setSelectedDate(date);
    setTimeSlotIdx(0);
    setIsTBD(false);
    setView('time');
  };

  const handleNoSlot = () => {
    if (timeSlotIdx === windows.length - 1) {
      let nextDay = addDays(selectedDate, 1);
      while (getDay(nextDay) === 0) {
        nextDay = addDays(nextDay, 1);
      }
      setSelectedDate(nextDay);
      setTimeSlotIdx(0);
    } else {
      setTimeSlotIdx((prev) => prev + 1);
    }
  };

  const handleAcceptSlot = () => {
    setIsTBD(false);
    setView('success');
  };

  const handleConfirmTBDStep = () => {
    setIsTBD(true);
    setView('success');
  };

  const handleModalClose = () => {
    onClose();
    // Reset views after modal closes
    setTimeout(() => {
      setView('date');
      setTimeSlotIdx(0);
      setTbdReason('');
      setIsTBD(false);
      setAmendmentOpen(false);
      setAmendmentChanges([]);
      pendingDataRef.current = null;
      pendingPayloadRef.current = null;
    }, 300);
  };

  // ── Amendment gating ────────────────────────────────────────────────────────
  // Diff old (scheduleTime / initial* props) vs new selection — web parity with
  // `appointment-scheduler.js` `buildScheduleChanges`.
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

  // Build the appointmentData object emitted by the edit "Save Changes" button.
  const buildEditAppointmentData = () =>
    isTBD
      ? { date: 'TBD', reason: tbdReason, customerName }
      : { date: format(selectedDate, 'M/d/yyyy'), timeWindow: windows[timeSlotIdx].value, customerName };

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

      // Schedule amendment only — do not send contract fields so a pending contract
      // proposal on the draft is preserved (web parity).
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

  // Edit "Save Changes" handler: gate on amendment when required + changed.
  const handleEditConfirm = async () => {
    const appointmentData = buildEditAppointmentData();
    const changes = buildScheduleChanges(appointmentData);
    const scheduleChanged = changes.length > 0;

    if (leadId && scheduleChanged && requireScheduleAmendment) {
      await openAmendmentFlow(appointmentData, changes);
      return;
    }

    onConfirm(appointmentData);
    handleModalClose();
  };

  // Amendment signed → persist schedule + accept draft, then run onConfirm.
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
          // non-fatal
        }
      }
      FlashMessage.success('Installation time updated successfully');
      setAmendmentOpen(false);
      const data = pendingDataRef.current;
      pendingDataRef.current = null;
      try {
        await onConfirm?.(data ?? {});
      } catch {
        // non-fatal
      }
      handleModalClose();
    } catch (error) {
      console.error(error);
      FlashMessage.error('Error', 'Failed to submit amendment');
    } finally {
      setAmendmentSubmitting(false);
    }
  };

  // Calendar Logic
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
            const isDisabled = isPast || isSunday;

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
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#334155', marginBottom: 40 }}>
                  {windows[timeSlotIdx].label}
                </Text>

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

                  <TouchableOpacity onPress={handleAcceptSlot} style={{ flex: 1 }}>
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
                      <Text style={{ color: 'white', fontWeight: '900', fontSize: 14 }}>Yes</Text>
                    </View>
                  </TouchableOpacity>
                </View>
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
                  />
                </View>

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
                      <Text style={{ color: '#334155', fontWeight: '700', fontSize: 14 }}>{windows[timeSlotIdx].label}</Text>
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
                        onGenerate?.(
                          isTBD
                            ? { date: 'TBD', reason: tbdReason, customerName }
                            : { date: format(selectedDate, 'M/d/yyyy'), timeWindow: windows[timeSlotIdx].value, customerName }
                        );
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
                        onUpload?.(
                          isTBD
                            ? { date: 'TBD', reason: tbdReason, customerName }
                            : { date: format(selectedDate, 'M/d/yyyy'), timeWindow: windows[timeSlotIdx].value, customerName }
                        );
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
