import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Platform,
  StyleSheet,
  ActivityIndicator,
  PermissionsAndroid,
  TextInput,
  Keyboard,
  Alert,
  Linking,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { GlobalKeyboardAvoidingView } from '../../common/keyboard/GlobalKeyboard';
import { CustomInput } from '../../common/CustomInput';
import { CustomButton } from '../../common/CustomButton';
import { FlashMessage } from '../../../config/message';
import { validateName } from '../../../utils/validation';
import { useCreateLeadMutation } from '../../../hooks/useLeadMutation';
import Geolocation from 'react-native-geolocation-service';
import axios from 'axios';
import { ENV } from '../../../config/env';
import { formatUSPhoneNumber } from '../../../utils/phone-util';
import { geocodeAddress } from '../../../utils/places';
import Ionicons from 'react-native-vector-icons/Ionicons';
import RNFlashMessage from 'react-native-flash-message';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { logEvent } from '../../../services/api/LoggerService';
import { NUMERIC_KEYBOARD } from '../../../utils/keyboard-type';
import { isOnline } from '../../../services/connectivity';
import { useIsOnline } from '../../../hooks/useIsOnline';
import { reverseGeocode } from '../../../utils/places';
import {
  formatCoordsPlaceholder,
  geolocationOptions,
  isValidCoords,
  needsAddressResolution,
  parseCoordsPlaceholder,
  resolveSyncAddress,
} from '../../../utils/offline-lead-location';
import { enqueueOfflineLead } from '../../../services/offlineLeadStore';
import {
  classifyCreateOutcome,
  messageOfError,
  resolveRetryDecision,
} from '../../../utils/offline-lead-queue';

/** Capitalize just the first character as the rep types — leaves the rest untouched so a
 *  legitimately mixed-case name (McDonald, O'Brien) isn't forced to lowercase mid-entry. */
const capitalizeFirst = (text: string): string =>
  text.length ? text.charAt(0).toUpperCase() + text.slice(1) : text;

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: (createdLead?: any, leadType?: 'selfGen' | 'lf_lead') => void;
  user: any;
  fromZone?: boolean;
  zoneId?: string;
  buildingId?: string;
  prefilledAddress?: string;
  prefilledCoords?: { latitude: number; longitude: number } | null;
  prefilledOwnerName?: string;
}

export default function LeadCreateModal({
  visible,
  onClose,
  onSuccess,
  user,
  fromZone = false,
  zoneId,
  buildingId,
  prefilledAddress,
  prefilledCoords,
  prefilledOwnerName = '',
}: Props) {
  const { colors, isDark } = useTheme();
  const createLeadMutation = useCreateLeadMutation();
  // For RENDER only. Every imperative read inside an async callback calls `isOnline()` directly,
  // so a connection that drops mid-fix is judged on what is true when the callback runs rather
  // than on what was true when the closure was created.
  const online = useIsOnline();
  const initialFormState: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    address: string;
    leadType: 'selfGen' | 'lf_lead';
    lowesLead: boolean;
    lfLeadTime: string;
    lfLeadId: string;
    leadCode: string;
    lfLeadDate: string;
  } = {
    firstName: '',
    lastName: '',
    phone: '',
    email: '',
    address: '',
    leadType: 'selfGen',
    lowesLead: false,
    lfLeadTime: '9am',
    lfLeadId: '',
    leadCode: '',
    lfLeadDate: (() => {
      const d = new Date();
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(
        2,
        '0'
      )}-${d.getFullYear()}`;
    })(),
  };

  const [form, setForm] = useState(initialFormState);

  const scrollViewRef = useRef<ScrollView>(null);
  const flashRef = useRef<any>(null);
  const [addressFieldY, setAddressFieldY] = useState(0);
  const [lfSyncBoxY, setLfSyncBoxY] = useState(0);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setShowSuggestions(false);
    });
    return () => hideSubscription.remove();
  }, []);

  useEffect(() => {
    if (visible) {
      if (fromZone && prefilledAddress) {
        let firstName = '';
        let lastName = '';
        if (prefilledOwnerName) {
          const parts = prefilledOwnerName.trim().split(/\s+/);
          firstName = parts[0] || '';
          lastName = parts.slice(1).join(' ') || '';
        }
        setForm({
          ...initialFormState,
          address: prefilledAddress,
          firstName,
          lastName,
          leadType: 'selfGen',
        });
        if (prefilledCoords) {
          setLocation(prefilledCoords);
        } else {
          setLocation(null);
        }
      } else {
        // Default to the rep's current location: reverse-geocode the device GPS
        // into Full Address on open. The rep can overtype to search a different
        // address via the Places autocomplete (which also updates the coordinates),
        // or re-fetch their location via the pin icon. The auto-fetch is SILENT —
        // if permission is denied/unavailable it just leaves the field blank for
        // manual entry instead of alerting on every open.
        setForm(initialFormState);
        setLocation(null);
        setSuggestions([]);
        setShowSuggestions(false);
        handleGetCurrentLocation(true);
      }
    }
  }, [visible]);

  // `silent` (used by the auto-fetch on open) suppresses the permission-denied
  // alerts so a rep without location access just gets a blank field to type into,
  // instead of an alert every time the form opens. Manual taps on the pin pass
  // silent=false and keep the full "enable in Settings" prompts.
  const handleGetCurrentLocation = async (silent = false) => {
    if (Platform.OS === 'android') {
      const hasLocation = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      let granted = hasLocation ? PermissionsAndroid.RESULTS.GRANTED : null;
      if (!hasLocation) {
        // Don't trigger the OS permission dialog on the silent auto-fetch — only
        // use already-granted access; the rep can tap the pin to grant it.
        if (silent) return;
        granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
      }
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        if (silent) return;
        Alert.alert(
          'Permission Denied',
          'Location access is required to auto-fill the address. Please enable it in your device settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Settings', onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }
    } else if (Platform.OS === 'ios') {
      const auth = await Geolocation.requestAuthorization('whenInUse');
      if (auth !== 'granted') {
        if (silent) return;
        Alert.alert(
          'Location Access Denied',
          'We need your location to auto-fill the address. Please enable location services in your iPhone settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]
        );
        return;
      }
    }

    setIsLocating(true);
    Geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const coords = { latitude, longitude };
        // Never overwrite an address the rep has already typed — theirs outranks anything we
        // derive from a fix that is only accurate to within several metres.
        const fillAddress = (text: string) =>
          setForm((prev) => (prev.address.trim() ? prev : { ...prev, address: text }));

        try {
          // ⚠️ Store the fix BEFORE anything that can throw. This line used to sit inside the
          // reverse-geocode's success branch, so with no signal the GPS lock succeeded, the axios
          // call threw, and a perfectly good position was discarded — the lead then went up with
          // `location: undefined`. The coordinates are the half that needs no network; nothing
          // network-shaped may gate them.
          if (isValidCoords(coords)) setLocation(coords);

          // Offline there is no reverse-geocoder to reach: iOS CLGeocoder and Android Geocoder
          // both call a web service. Show the coordinates so the rep can see the fix landed, and
          // let them type the address off the door — `resolveSyncAddress` resolves it at submit.
          if (!isOnline()) {
            if (isValidCoords(coords)) fillAddress(formatCoordsPlaceholder(coords));
            return;
          }

          const res = await axios.get(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${ENV.GOOGLE_MAPS_API_KEY}`
          );
          if (res.data.results?.[0]) {
            fillAddress(res.data.results[0].formatted_address);
          } else if (isValidCoords(coords)) {
            fillAddress(formatCoordsPlaceholder(coords));
          }
        } catch (e) {
          // A geocode that fails on a live-looking connection is the same situation as offline:
          // we hold a real fix and no address for it. Show the fix rather than an empty box.
          console.warn('Geocoding failed', e);
          if (isValidCoords(coords)) fillAddress(formatCoordsPlaceholder(coords));
        } finally {
          setIsLocating(false);
        }
      },
      (error) => {
        console.warn('Location error', error);
        setIsLocating(false);
        if (error.code === 1 && !silent) {
          // PERMISSION_DENIED
          Alert.alert(
            'Location Permission Required',
            'Please enable location services in your device settings to use this feature.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Settings', onPress: () => Linking.openSettings() },
            ]
          );
        }
      },
      // Offline the chip has no A-GPS almanac and no Wi-Fi triangulation to lean on, so a cold
      // fix takes 30-60 s. The online 15 s timeout would abort nearly every one of them.
      geolocationOptions(isOnline())
    );
  };

  const handleAddressSearch = async (text: string) => {
    setForm({ ...form, address: text });
    // ⚠️ The stored coordinates belong to the address they were captured for — the GPS
    // fix that filled this box on open, or the suggestion that was picked. Once the rep
    // types over it they describe a DIFFERENT place, and were being saved with the new
    // address (a Davenport lead pinned on the rep's own GPS position, i.e. Lahore).
    // Dropped here; `handleSelectSuggestion` sets the picked place's, and submit looks up
    // the typed address when no suggestion was picked.
    setLocation(null);
    if (text.length > 3) {
      // Places autocomplete is a network call whose failure is swallowed, so offline it leaves the
      // rep typing into a box that never responds. Suppress it outright and let them type the
      // address straight through; the GPS fix is already attached to the lead either way.
      if (!isOnline()) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }
      try {
        const res = await axios.get(
          `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
            text
          )}&key=${ENV.GOOGLE_MAPS_API_KEY}&types=address`
        );
        setSuggestions(res.data.predictions || []);
        if (res.data.predictions?.length > 0) {
          setShowSuggestions(true);
        }
      } catch (e) {
        console.warn('Places search failed', e);
      }
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handleSelectSuggestion = async (suggestion: any) => {
    setForm({ ...form, address: suggestion.description });
    setShowSuggestions(false);
    setSuggestions([]);
    Keyboard.dismiss();

    try {
      const res = await axios.get(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${suggestion.place_id}&fields=geometry&key=${ENV.GOOGLE_MAPS_API_KEY}`
      );
      if (res.data.result?.geometry?.location) {
        const { lat, lng } = res.data.result.geometry.location;
        setLocation({ latitude: lat, longitude: lng });
      }
    } catch (e) {
      console.warn('Place details failed', e);
    }
  };

  const handleSubmit = async () => {
    const isLF = form.leadType === 'lf_lead';

    const showError = (title: string, msg: string) => {
      if (flashRef.current) {
        flashRef.current.showMessage({
          message: title,
          description: msg,
          type: 'danger',
          icon: 'danger',
          duration: 4000,
          style: { zIndex: 9999, elevation: 9999, backgroundColor: '#D32F2F' },
        });
      } else {
        FlashMessage.error(title, msg);
      }
    };

    const showSuccess = (title: string, msg: string) => {
      if (flashRef.current) {
        flashRef.current.showMessage({
          message: title,
          description: msg,
          type: 'success',
          icon: 'success',
          duration: 3000,
        });
      } else {
        FlashMessage.success(title, msg);
      }
    };

    // Base validation for all leads
    if (!form.firstName || !form.lastName || !form.address) {
      showError('Missing Info', 'Please fill all required customer fields marked with *');
      return;
    }

    if (!validateName(form.firstName)) {
      showError('Invalid First Name', 'First Name must contain only letters, hyphens, or apostrophes (no spaces).');
      return;
    }

    if (!validateName(form.lastName)) {
      showError('Invalid Last Name', 'Last Name must contain only letters, hyphens, or apostrophes (no spaces).');
      return;
    }

    const rawPhone = (form.phone || '').replace(/\D/g, '');
    if (!fromZone) {
      if (!form.phone || rawPhone.length !== 11) {
        showError('Invalid Phone', 'Please enter a complete 10-digit phone number');
        return;
      }
    } else {
      // If fromZone is true, phone is optional, but if entered, it must be complete
      if (rawPhone.length > 1 && rawPhone.length !== 11) {
        showError('Invalid Phone', 'Please enter a complete 10-digit phone number');
        return;
      }
    }

    // Email validation (optional but must be valid if provided)
    if (form.email && (!form.email.includes('@') || !form.email.toLowerCase().includes('.com'))) {
      showError('Invalid Email', 'Email must contain "@" and ".com"');
      return;
    }

    // Additional validation for Issued Leads (backend key `lfLead`/`isLF` unchanged)
    if (isLF) {
      if (!form.lfLeadId || !form.leadCode || !form.lfLeadDate || !form.lfLeadTime) {
        showError('Metadata Required', 'Issued Leads require ID, Code, Date, and Time slot.');
        return;
      }
    }

    // Declared out here so the catch below can read it: whether a FAILED create may be safely
    // queued for replay depends on the lead's own shape (see `resolveRetryDecision`).
    let payload: Record<string, any> | null = null;

    try {
      Keyboard.dismiss();

      // The address box may still hold the coordinate placeholder from a fix taken with no signal.
      // Resolving it HERE — at the moment of sending, not at capture — is the whole shape of the
      // offline flow: the coordinates are captured the instant the rep is at the door, and the
      // street address is derived later, whenever a connection exists to derive it with.
      //
      // ⚠️ `resolveSyncAddress` guarantees a rep-typed address is never replaced by the geocode.
      // A fix is accurate to +/-5-20 m and a reverse-geocode snaps it to the nearest address it
      // knows, which on an ordinary street is regularly the NEIGHBOUR. What the rep read off the
      // mailbox is better data than anything we can infer from a scatter of metres.
      let reverseGeocoded: string | null = null;
      if (isOnline() && needsAddressResolution(form.address, location)) {
        const fix = isValidCoords(location) ? location : parseCoordsPlaceholder(form.address);
        if (fix) reverseGeocoded = await reverseGeocode(fix);
      }
      const { address: submitAddress } = resolveSyncAddress({
        address: form.address,
        coords: location,
        reverseGeocoded,
      });

      // The pin is placed from these coordinates, so they must match `submitAddress`. With none
      // (the rep typed the address without picking a suggestion, and no GPS fix was captured)
      // recover a coords placeholder if the text still carries one, else look the typed address
      // up ONLINE ONLY — every other network call in this handler is `isOnline()`-gated, and an
      // offline attempt here would just add latency to the queue-and-park path below for a call
      // `geocodeAddress` will swallow into `null` anyway. If Google can't place it, send none
      // rather than somebody else's location.
      const leadLocation =
        location ||
        parseCoordsPlaceholder(form.address) ||
        (isOnline() ? await geocodeAddress(form.address) : null);

      payload = isLF
        ? {
          leadType: 'lfLead',
          lfLeadId: form.lfLeadId,
          leadCode: form.leadCode,
          lfLeadDate: (() => {
            // Parse MM-DD-YYYY
            const parts = form.lfLeadDate.split('-');
            if (parts.length !== 3) return new Date().toISOString();
            const m = parseInt(parts[0]) - 1;
            const d = parseInt(parts[1]);
            const y = parseInt(parts[2]);
            const date = new Date(y, m, d);
            const now = new Date();
            date.setHours(
              now.getHours(),
              now.getMinutes(),
              now.getSeconds(),
              now.getMilliseconds()
            );
            return date.toISOString();
          })(),
          lfLeadTime: form.lfLeadTime,
          fullAddress: submitAddress,
          location: leadLocation
            ? {
              type: 'Point',
              coordinates: [leadLocation.longitude, leadLocation.latitude],
            }
            : undefined,
          customer: {
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            phone: form.phone,
            email: form.email,
            address: submitAddress,
          },
        }
        : {
          leadType: 'selfGen',
          repId: user?._id || user?.id,
          fullAddress: submitAddress,
          lowesLead: form.lowesLead === true,
          location: leadLocation
            ? {
              type: 'Point',
              coordinates: [leadLocation.longitude, leadLocation.latitude],
            }
            : undefined,
          customer: {
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            ...(form.phone ? { phone: form.phone } : {}),
            email: form.email,
            address: submitAddress,
          },
          ...(fromZone && {
            zoneId,
            buildingId,
            latitude: leadLocation?.latitude,
            longitude: leadLocation?.longitude,
          }),
        };
      // With no signal, park the lead rather than failing. It carries the GPS fix taken at the
      // door and whatever address the rep typed; `resolveSyncAddress` above has already settled
      // which of those gets filed, so the queued body is the exact one that would have been sent.
      if (!isOnline()) {
        enqueueOfflineLead(payload);
        showSuccess(
          'Saved offline',
          "This lead is queued and will be created automatically when you're back online.",
        );
        onSuccess(null, form.leadType);
        handleClose();
        return;
      }

      console.log(payload, 'lf lead creation');
      const response = await createLeadMutation.mutateAsync(payload);
      showSuccess('Success', 'Lead created successfully');

      const uId = user?._id || user?.id;
      if (uId) {
        logEvent('add', {
          user_id: uId,
          created_by: uId,
          module_type: 'self_gen_lead',
          meta: {
            leadData: response?.data?.lead || response?.data || response || payload,
            action: 'self_gen_lead_created',
          },
        });
      }

      const createdLead = fromZone ? {
        ...(response?.data?.lead || response?.data || response),
        ...payload,
        status: 'selfGenerated',
      } : null;

      onSuccess(createdLead, form.leadType);
      handleClose();
    } catch (err: any) {
      // A create can fail on a connection that LOOKED live — one bar at the door, a tunnel. Rather
      // than losing the rep's work, run the failure through the same decision table the replay
      // queue uses and act on its verdict.
      const outcome = classifyCreateOutcome(err);
      const decision = resolveRetryDecision(outcome, payload);

      if (payload && decision === 'retry') {
        // Provably never sent, or an Issued Lead whose `lfLeadId` the server would refuse a second
        // time — either way a replay cannot duplicate it.
        enqueueOfflineLead(payload);
        showSuccess(
          'Saved offline',
          "We couldn't reach the server, so this lead is queued and will be created automatically.",
        );
        onSuccess(null, form.leadType);
        handleClose();
        return;
      }

      if (decision === 'done') {
        // The server refused a duplicate lead id, which means an earlier attempt already landed.
        showSuccess('Already created', 'This lead is already on the server.');
        onSuccess(null, form.leadType);
        handleClose();
        return;
      }

      if (decision === 'needs-review') {
        // ⚠️ The honest answer, and the reason this branch exists at all. The request may have been
        // processed and may not have been, and a self-gen lead has NO unique field the server would
        // refuse — so replaying it could file a second real lead. A human checking the list is
        // slower than a guess and is never wrong.
        showError(
          "Couldn't confirm",
          'The lead may or may not have saved. Check your Leads list before entering it again.',
        );
        return;
      }

      showError('Error', messageOfError(err) || 'Failed to create lead');
    }
  };

  const handleClose = () => {
    Keyboard.dismiss();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
        <GlobalKeyboardAvoidingView
          isModal
          style={[styles.modalContainer, { backgroundColor: isDark ? colors.surface : '#fff' }]}
        >
          {/* Header */}
          <View
            className="p-6 flex-row justify-between items-center border-b"
            style={{ borderBottomColor: isDark ? colors.border : colors.grey[200] }}
          >
            <View>
              <Text className="text-xl font-black" style={{ color: colors.text }}>
                {fromZone ? 'Add Self Gen Lead' : 'Add New Lead'}
              </Text>
              <Text
                className="text-[11px] font-bold mt-1 opacity-60"
                style={{ color: colors.textSecondary }}
              >
                Fill in the customer details below
              </Text>
            </View>
            <TouchableOpacity onPress={handleClose} className="p-2">
              <Text className="text-3xl font-light" style={{ color: colors.textSecondary }}>
                ×
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            ref={scrollViewRef}
            className="px-6 py-6"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 80 }}
            scrollEnabled={!showSuggestions}
            keyboardShouldPersistTaps="handled"
          >
            <View className="gap-5">
              <View className="flex-row gap-4">
                <View className="flex-1">
                  <CustomInput
                    label="First Name*"
                    value={form.firstName}
                    onChangeText={(t) => setForm({ ...form, firstName: capitalizeFirst(t) })}
                    autoCapitalize="words"
                    placeholder="Enter First Name"
                  />
                </View>
                <View className="flex-1">
                  <CustomInput
                    label="Last Name*"
                    value={form.lastName}
                    onChangeText={(t) => setForm({ ...form, lastName: capitalizeFirst(t) })}
                    autoCapitalize="words"
                    placeholder="Enter Last Name"
                  />
                </View>
              </View>

              <CustomInput
                label={fromZone ? 'Phone Number' : 'Phone Number*'}
                value={form.phone}
                onChangeText={(t) => {
                  const formatted = formatUSPhoneNumber(t);
                  setForm({ ...form, phone: formatted });
                }}
                placeholder="+1 (123) 456-7890"
                keyboardType="phone-pad"
                maxLength={17}
              />
              <CustomInput
                label="Email Address"
                value={form.email}
                onChangeText={(t) => setForm({ ...form, email: t })}
                placeholder="example@mail.com"
                keyboardType="email-address"
              />

              <View style={{ marginTop: 4 }}>
                <Text
                  className="text-sm font-semibold mb-2"
                  style={{ color: colors.text }}
                >
                  Lowe&apos;s Lead
                </Text>
                <View
                  className="flex-row gap-3 p-1 rounded-2xl"
                  style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.1)' : colors.grey[200] }}
                >
                  {[
                    { label: 'No', value: false },
                    { label: 'Yes', value: true },
                  ].map((opt) => (
                    <TouchableOpacity
                      key={opt.label}
                      onPress={() => setForm({ ...form, lowesLead: opt.value })}
                      className="flex-1 py-3 items-center rounded-xl"
                      style={{
                        backgroundColor:
                          form.lowesLead === opt.value
                            ? isDark
                              ? colors.surface
                              : '#fff'
                            : 'transparent',
                        borderWidth: 1,
                        borderColor:
                          form.lowesLead === opt.value ? `${colors.primary.main}25` : 'transparent',
                        shadowColor: form.lowesLead === opt.value ? '#000' : 'transparent',
                        shadowOffset: { width: 0, height: 1 },
                        shadowOpacity: form.lowesLead === opt.value ? 0.08 : 0,
                        shadowRadius: 2,
                        elevation: form.lowesLead === opt.value ? 1 : 0,
                      }}
                    >
                      <Text
                        className="text-[11px] font-black"
                        style={{
                          color:
                            form.lowesLead === opt.value ? colors.primary.main : colors.textSecondary,
                          opacity: form.lowesLead === opt.value ? 1 : 0.4,
                        }}
                      >
                        {opt.label.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Address Section */}
              <View onLayout={(e) => setAddressFieldY(e.nativeEvent.layout.y)}>
                <Text className="text-sm font-semibold mb-2"
                  style={{ color: colors.text }}>
                  Full Address*
                </Text>
                <View style={{ position: 'relative', zIndex: 1000 }}>
                  <TextInput
                    value={form.address}
                    onChangeText={handleAddressSearch}
                    editable={!fromZone}
                    onFocus={() => {
                      if (!fromZone && suggestions.length > 0) setShowSuggestions(true);
                      scrollViewRef.current?.scrollTo({ y: addressFieldY, animated: true });
                    }}
                    placeholder={
                      isLocating
                        ? online
                          ? 'Detecting your location...'
                          : 'Locating by GPS — this can take a minute...'
                        : '123 Main St, City, State'
                    }
                    style={{
                      height: 56,
                      backgroundColor: isDark ? colors.surface : (fromZone ? '#E2E8F030' : '#F8FAFC'),
                      borderWidth: 1,
                      borderColor: isDark ? colors.border : '#E2E8F0',
                      borderRadius: 16,
                      paddingHorizontal: 20,
                      paddingRight: 48,
                      fontWeight: '700',
                      color: colors.text,
                      fontSize: 14,
                    }}
                    placeholderTextColor={colors.textSecondary + '60'}
                  />
                  <View
                    style={{
                      position: 'absolute',
                      right: 16,
                      top: 0,
                      bottom: 0,
                      justifyContent: 'center',
                    }}
                  >
                    {isLocating ? (
                      <ActivityIndicator size="small" color={colors.primary.main} />
                    ) : form.address.length > 0 ? (
                      !fromZone ? (
                        <TouchableOpacity
                          onPress={() => {
                            setForm({ ...form, address: '' });
                            setSuggestions([]);
                            setShowSuggestions(false);
                          }}
                        >
                          <Ionicons
                            name="close-circle"
                            size={18}
                            color={colors.textSecondary + '80'}
                          />
                        </TouchableOpacity>
                      ) : null
                    ) : (
                      // Opt-in current-location fill: tapping the pin reverse-
                      // geocodes the device GPS into the address (disabled for
                      // zone leads, whose address is fixed to the picked building).
                      <TouchableOpacity
                        disabled={fromZone}
                        onPress={() => handleGetCurrentLocation(false)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      >
                        <Ionicons
                          name="location-outline"
                          size={18}
                          color={colors.primary.main + '80'}
                        />
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Suggestions Dropdown Inline */}
                  {showSuggestions && suggestions.length > 0 && (
                    <View
                      onStartShouldSetResponder={() => true}
                      style={{
                        position: 'absolute',
                        top: 60,
                        left: 0,
                        right: 0,
                        backgroundColor: isDark ? colors.surface : 'white',
                        borderRadius: 16,
                        maxHeight: 250,
                        borderWidth: 1,
                        borderColor: isDark ? colors.border : '#E2E8F0',
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.1,
                        shadowRadius: 12,
                        elevation: 10,
                        zIndex: 2000,
                        overflow: 'hidden',
                      }}
                    >
                      <ScrollView
                        nestedScrollEnabled={true}
                        keyboardShouldPersistTaps="always"
                        showsVerticalScrollIndicator={true}
                      >
                        {suggestions.map((item, idx) => (
                          <TouchableOpacity
                            key={item.place_id}
                            onPress={() => {
                              handleSelectSuggestion(item);
                              Keyboard.dismiss();
                            }}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              paddingHorizontal: 16,
                              paddingVertical: 14,
                              borderBottomWidth: idx !== suggestions.length - 1 ? 1 : 0,
                              borderBottomColor: isDark ? colors.border : '#F8FAFC',
                            }}
                          >
                            <View
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 8,
                                backgroundColor: colors.primary.main + '15',
                                alignItems: 'center',
                                justifyContent: 'center',
                                marginRight: 12,
                              }}
                            >
                              <Ionicons name="location" size={14} color={colors.primary.main} />
                            </View>
                            <Text
                              style={{
                                flex: 1,
                                fontSize: 13,
                                fontWeight: '600',
                                color: colors.text,
                                lineHeight: 18,
                              }}
                            >
                              {item.description}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </View>

                {/* Offline, the address box behaves differently in two visible ways — no
                    suggestions, and a coordinate placeholder instead of a street address — and
                    neither is self-explanatory. Without this line the rep sees autocomplete
                    silently stop working and has no way to tell whether the lead has a position
                    attached at all. */}
                {!online && !fromZone && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'flex-start',
                      marginTop: 8,
                      gap: 6,
                    }}
                  >
                    <Ionicons
                      name={isValidCoords(location) ? 'navigate-circle-outline' : 'cloud-offline-outline'}
                      size={14}
                      color={colors.textSecondary}
                      style={{ marginTop: 1 }}
                    />
                    <Text
                      style={{
                        flex: 1,
                        fontSize: 11,
                        lineHeight: 15,
                        color: colors.textSecondary,
                      }}
                    >
                      {isValidCoords(location)
                        ? "Offline - GPS position saved. Type the address if you can read it; otherwise we'll fill it in when you're back online."
                        : 'Offline - address suggestions are unavailable. Type the full address, or tap the pin to locate by GPS.'}
                    </Text>
                  </View>
                )}
              </View>

              {/* Lead Type — hidden from zone canvasser (self-gen only, web parity) */}
              {!fromZone && (
                <View className="mt-4 mb-6">
                  <Text
                    className="text-sm font-semibold mb-2"
                    style={{ color: colors.text }}
                  >
                    Lead Classification
                  </Text>
                  <View
                    className="flex-row gap-3 p-1 rounded-2xl"
                    style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.1)' : colors.grey[200] }}
                  >
                    {['selfGen', 'lf_lead'].map((type) => (
                      <TouchableOpacity
                        key={type}
                        onPress={() => setForm({ ...form, leadType: type as 'selfGen' | 'lf_lead' })}
                        className="flex-1 py-3 items-center rounded-xl"
                        style={{
                          backgroundColor:
                            form.leadType === type
                              ? isDark
                                ? colors.surface
                                : '#fff'
                              : 'transparent',
                          borderWidth: 1,
                          borderColor:
                            form.leadType === type ? `${colors.primary.main}25` : 'transparent',
                          shadowColor: form.leadType === type ? '#000' : 'transparent',
                          shadowOffset: { width: 0, height: 1 },
                          shadowOpacity: form.leadType === type ? 0.08 : 0,
                          shadowRadius: 2,
                          elevation: form.leadType === type ? 1 : 0,
                        }}
                      >
                        <Text
                          className="text-[11px] font-black"
                          style={{
                            color:
                              form.leadType === type ? colors.primary.main : colors.textSecondary,
                            opacity: form.leadType === type ? 1 : 0.4,
                          }}
                        >
                          {type === 'selfGen' ? 'SELF GEN' : 'ISSUED LEAD'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {form.leadType === 'lf_lead' && (
                <View
                  onLayout={(e) => setLfSyncBoxY(e.nativeEvent.layout.y)}
                  className="p-5 rounded-[24px] border mb-6"
                  style={{
                    backgroundColor: isDark ? colors.surface : '#fff',
                    borderColor: isDark ? colors.border : colors.grey[200],
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.05,
                    shadowRadius: 2,
                    elevation: 1,
                  }}
                >

                  <CustomInput
                    label="Lead ID*"
                    value={form.lfLeadId}
                    onChangeText={(t) => setForm({ ...form, lfLeadId: t })}
                    placeholder="Enter ID"
                    keyboardType={NUMERIC_KEYBOARD}
                    returnKeyType="done"
                    onFocus={() => {
                      scrollViewRef.current?.scrollTo({ y: lfSyncBoxY, animated: true });
                    }}
                  />
                  <CustomInput
                    label="Lead Code*"
                    value={form.leadCode}
                    onChangeText={(t) => setForm({ ...form, leadCode: t })}
                    placeholder="Enter Code"
                    onFocus={() => {
                      scrollViewRef.current?.scrollTo({ y: lfSyncBoxY + 60, animated: true });
                    }}
                  />

                  <View className="mt-4 mb-2">
                    <Text
                      className="text-[11px] font-bold mb-3"
                      style={{ color: colors.textSecondary }}
                    >
                      Preferred Time Slot*
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ paddingRight: 16 }}
                    >
                      {['9am', '11am', '1pm', '3pm', '5pm', '7pm'].map((time) => (
                        <TouchableOpacity
                          key={time}
                          onPress={() => setForm({ ...form, lfLeadTime: time })}
                          className="px-5 py-2.5 rounded-xl mr-3"
                          style={{
                            backgroundColor:
                              form.lfLeadTime === time
                                ? `${colors.primary.main}15`
                                : isDark
                                  ? 'rgba(255,255,255,0.05)'
                                  : colors.grey[200],
                            borderWidth: 1,
                            borderColor:
                              form.lfLeadTime === time ? colors.primary.main : 'transparent',
                          }}
                        >
                          <Text
                            className="text-[10px] font-black"
                            style={{
                              color:
                                form.lfLeadTime === time
                                  ? colors.primary.main
                                  : colors.textSecondary,
                              opacity: form.lfLeadTime === time ? 1 : 0.4,
                            }}
                          >
                            {(() => {
                              const match = time.match(/^(\d+)(am|pm)$/i);
                              if (match) {
                                return `${match[1]}:00 ${match[2].toUpperCase()}`;
                              }
                              return time.toUpperCase();
                            })()}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                  <CustomInput
                    label="Appointment Date (MM/DD/YYYY)*"
                    value={form.lfLeadDate ? form.lfLeadDate.replace(/-/g, '/') : ''}
                    onChangeText={(t) => setForm({ ...form, lfLeadDate: t })}
                    placeholder="MM/DD/YYYY"
                    rightIcon="calendar-outline"
                    onRightIconPress={() => setShowDatePicker(true)}
                    onFocus={() => {
                      scrollViewRef.current?.scrollTo({ y: lfSyncBoxY + 180, animated: true });
                    }}
                  />

                  {showDatePicker && (
                    <DateTimePicker
                      value={(() => {
                        const parts = form.lfLeadDate.split('-');
                        if (parts.length === 3) {
                          const m = parseInt(parts[0]) - 1;
                          const d = parseInt(parts[1]);
                          const y = parseInt(parts[2]);
                          if (!isNaN(m) && !isNaN(d) && !isNaN(y)) {
                            return new Date(y, m, d);
                          }
                        }
                        return new Date();
                      })()}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={(event, selectedDate) => {
                        setShowDatePicker(false);
                        if (selectedDate) {
                          setForm({ ...form, lfLeadDate: format(selectedDate, 'MM-dd-yyyy') });
                        }
                      }}
                    />
                  )}
                </View>
              )}

              <CustomButton
                title="Save & Submit Lead"
                onPress={handleSubmit}
                loading={createLeadMutation.isPending}
                style={{ marginTop: 12 }}
              />

              {/* Spacer for Address Suggestions when Keyboard is open */}
              {showSuggestions && <View style={{ height: 350 }} />}
            </View>
          </ScrollView>
          <RNFlashMessage ref={flashRef} position="top" canRegisterAsDefault={false} />
        </GlobalKeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContainer: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    maxHeight: '90%',
    overflow: 'hidden',
  },
});
