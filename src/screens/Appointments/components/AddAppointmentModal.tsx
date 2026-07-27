import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Geolocation from 'react-native-geolocation-service';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../theme/ThemeProvider';
import { ENV } from '../../../config/env';
import { Appointment } from '../../../hooks/useAppointments';

interface PlacePrediction {
  place_id: string;
  description: string;
}

interface AddAppointmentModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: { title: string; address: string; leadId?: string }) => Promise<void> | void;
  isEdit?: boolean;
  appointment?: Appointment | null;
  submitting?: boolean;
}

// Port of web `add-appointment.js`. Address uses Google Places autocomplete + a
// reverse-geocode prefill of the rep's current location for new appointments.
export const AddAppointmentModal: React.FC<AddAppointmentModalProps> = ({
  visible,
  onClose,
  onSubmit,
  isEdit = false,
  appointment,
  submitting = false,
}) => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [leadId, setLeadId] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [formattedAddress, setFormattedAddress] = useState('');
  const [nameError, setNameError] = useState('');

  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [searching, setSearching] = useState(false);
  const skipSearch = useRef(false);

  // ── Reset / hydrate on open ────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    setNameError('');
    setPredictions([]);
    skipSearch.current = true; // do not fire a search for the prefilled text

    if (isEdit && appointment) {
      setName(appointment.title || '');
      setLeadId(appointment.leadId || '');
      setAddressInput(appointment.address || '');
      setFormattedAddress(appointment.address || '');
    } else {
      setName('');
      setLeadId('');
      setAddressInput('Getting your location...');
      setFormattedAddress('');
      prefillCurrentLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, isEdit, appointment]);

  const prefillCurrentLocation = () => {
    Geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          const res = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${ENV.GOOGLE_MAPS_API_KEY}`
          );
          const data = await res.json();
          const address = data?.results?.[0]?.formatted_address;
          if (address) {
            skipSearch.current = true;
            setAddressInput(address);
            setFormattedAddress(address);
          } else {
            setAddressInput('');
          }
        } catch (e) {
          console.warn('[Appointments] reverse geocode failed:', e);
          setAddressInput('');
        }
      },
      (error) => {
        console.warn('[Appointments] location error:', error);
        setAddressInput('');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 300000 }
    );
  };

  // ── Autocomplete search ────────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    if (skipSearch.current) {
      skipSearch.current = false;
      return;
    }
    if (!addressInput || addressInput.trim().length < 3) {
      setPredictions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
          addressInput
        )}&key=${ENV.GOOGLE_MAPS_API_KEY}&components=country:us&types=establishment|geocode`;
        const res = await fetch(url);
        const data = await res.json();
        setPredictions(data?.predictions || []);
      } catch (e) {
        console.warn('[Appointments] Places API error:', e);
        setPredictions([]);
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [addressInput, visible]);

  const handleSelectPrediction = (item: PlacePrediction) => {
    skipSearch.current = true;
    setAddressInput(item.description);
    setFormattedAddress(item.description);
    setPredictions([]);
    Keyboard.dismiss();
  };

  const handleAddressChange = (text: string) => {
    setAddressInput(text);
    // Keep formattedAddress in sync so a typed (not-picked) address is still saved,
    // matching web where the raw input is used as the address on submit.
    setFormattedAddress(text);
  };

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Name is required');
      return;
    }
    await onSubmit({
      title: trimmed,
      address: formattedAddress.trim(),
      leadId: leadId.trim() || undefined,
    });
  };

  const cardBg = isDark ? colors.card : '#FFFFFF';
  const inputBg = isDark ? '#FFFFFF08' : '#F9FAFB';
  const inputBorder = isDark ? '#FFFFFF20' : '#919EAB33';
  const labelColor = isDark ? colors.textSecondary : '#637381';
  const textColor = isDark ? '#FFFFFF' : '#1C252E';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.overlay}>
          <View style={[styles.sheet, { backgroundColor: cardBg }]}>
            {/* Header */}
            <View style={[styles.header, { backgroundColor: colors.primary.main }]}>
              <Text style={styles.headerTitle}>
                {isEdit ? 'Edit Appointment' : 'Add Appointment'}
              </Text>
              <TouchableOpacity onPress={onClose} disabled={submitting}>
                <View style={styles.headerClose}>
                  <Icon name="close" size={20} color="#FFFFFF" />
                </View>
              </TouchableOpacity>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 20, paddingBottom: Math.max(insets.bottom, 20) }}
              showsVerticalScrollIndicator={false}
            >
              {/* Address */}
              <Text style={[styles.label, { color: labelColor }]}>Address</Text>
              <View style={[styles.inputRow, { backgroundColor: inputBg, borderColor: inputBorder }]}>
                <Icon name="map-marker-outline" size={18} color={labelColor} style={{ marginRight: 8 }} />
                <TextInput
                  value={addressInput}
                  onChangeText={handleAddressChange}
                  placeholder="Search address"
                  placeholderTextColor="#919EAB"
                  style={[styles.input, { color: textColor }]}
                  editable={!submitting}
                  autoCapitalize="words"
                />
                {searching && <ActivityIndicator size="small" color={colors.primary.main} />}
              </View>

              {/* Predictions dropdown */}
              {predictions.length > 0 && (
                <View style={[styles.predictions, { backgroundColor: cardBg, borderColor: inputBorder }]}>
                  {predictions.map((p) => (
                    <TouchableOpacity
                      key={p.place_id}
                      onPress={() => handleSelectPrediction(p)}
                      style={[styles.predictionRow, { borderBottomColor: inputBorder }]}
                    >
                      <Icon name="map-marker" size={16} color={colors.primary.main} style={{ marginRight: 8 }} />
                      <Text style={[styles.predictionText, { color: textColor }]} numberOfLines={2}>
                        {p.description}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Name */}
              <Text style={[styles.label, { color: labelColor, marginTop: 16 }]}>Name</Text>
              <View
                style={[
                  styles.inputRow,
                  { backgroundColor: inputBg, borderColor: nameError ? '#FF5630' : inputBorder },
                ]}
              >
                <TextInput
                  value={name}
                  onChangeText={(t) => {
                    setName(t);
                    if (nameError) setNameError('');
                  }}
                  placeholder="Customer name"
                  placeholderTextColor="#919EAB"
                  style={[styles.input, { color: textColor }]}
                  editable={!submitting}
                />
              </View>
              {!!nameError && <Text style={styles.errorText}>{nameError}</Text>}

              {/* Lead ID */}
              <Text style={[styles.label, { color: labelColor, marginTop: 16 }]}>Lead ID</Text>
              <View style={[styles.inputRow, { backgroundColor: inputBg, borderColor: inputBorder }]}>
                <TextInput
                  value={leadId}
                  onChangeText={setLeadId}
                  placeholder="Optional"
                  placeholderTextColor="#919EAB"
                  style={[styles.input, { color: textColor }]}
                  editable={!submitting}
                  autoCapitalize="characters"
                />
              </View>

              {/* Actions */}
              <View style={styles.footer}>
                <TouchableOpacity
                  onPress={onClose}
                  disabled={submitting}
                  style={[styles.cancelBtn, { borderColor: inputBorder }]}
                >
                  <Text style={[styles.cancelText, { color: labelColor }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSubmit}
                  disabled={submitting}
                  style={[styles.submitBtn, { backgroundColor: colors.primary.main, opacity: submitting ? 0.6 : 1 }]}
                >
                  {submitting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.submitText}>{isEdit ? 'Update' : 'Create'}</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  headerClose: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 5,
    borderRadius: 999,
  },
  label: {
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 50,
  },
  input: { flex: 1, fontSize: 14, fontWeight: '600' },
  predictions: {
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 6,
    overflow: 'hidden',
  },
  predictionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  predictionText: { flex: 1, fontSize: 13, fontWeight: '600' },
  errorText: { color: '#FF5630', fontSize: 12, marginTop: 4, fontWeight: '600' },
  footer: { flexDirection: 'row', gap: 12, marginTop: 28 },
  cancelBtn: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontWeight: '700', fontSize: 14 },
  submitBtn: {
    flex: 1.5,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
});
