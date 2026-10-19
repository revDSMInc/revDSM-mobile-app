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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { CustomInput } from '../../common/CustomInput';
import { NumPadProvider } from '../../common/keyboard/NumPad';
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
import { NUMBER_PAD_KEYBOARD } from '../../../utils/keyboard-type';
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
  // Inside a Modal the insets read 0 / stale, so floor them (Android 3-button nav bar is ~48dp).
  const insets = useSafeAreaInsets();
  const createLeadMutation = useCreateLeadMutation();
  const online = useIsOnline();
  /**
   * Offline the address box is READ-ONLY and shows the GPS fix.
   *
   * Google Places cannot run without a connection, so anything typed offline is an unvalidated
   * free-text string that nothing can check — and `handleAddressSearch` clears `location` on
   * every keystroke, so typing also threw away the one thing the device did know for certain.
   * The coordinates are resolved to a real address on reconnect.
   */
  const addressLockedOffline = !online;
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

  const scrollViewRef = useRef<any>(null);
  const [numPadActive, setNumPadActive] = useState(false);
  const flashRef = useRef<any>(null);
  const [addressFieldY, setAddressFieldY] = useState(0);
  const [lfSyncBoxY, setLfSyncBoxY] = useState(0);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  // The keyboard (or the in-app pad) covers the nav bar, so the footer's nav-bar floor would only be dead space above it.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const footerBottom = keyboardOpen || numPadActive ? 12 : Math.max(insets.bottom, Platform.OS === 'android' ? 48 : 20);

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const showSubscription = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardOpen(true));
    const hideSubscription = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setShowSuggestions(false);
      setKeyboardOpen(false);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
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
        setForm(initialFormState);
        setLocation(null);
        setSuggestions([]);
        setShowSuggestions(false);
        handleGetCurrentLocation(true);
      }
    }
  }, [visible]);

  const handleGetCurrentLocation = async (silent = false) => {
    if (Platform.OS === 'android') {
      const hasLocation = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      let granted = hasLocation ? PermissionsAndroid.RESULTS.GRANTED : null;
      if (!hasLocation) {
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
        const fillAddress = (text: string) =>
          setForm((prev) => (prev.address.trim() ? prev : { ...prev, address: text }));

        try {
          if (isValidCoords(coords)) setLocation(coords);

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
      geolocationOptions(isOnline())
    );
  };

  const handleAddressSearch = async (text: string) => {
    setForm({ ...form, address: text });
    setLocation(null);
    if (text.length > 3) {
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
      if (rawPhone.length > 1 && rawPhone.length !== 11) {
        showError('Invalid Phone', 'Please enter a complete 10-digit phone number');
        return;
      }
    }

    if (form.email && (!form.email.includes('@') || !form.email.toLowerCase().includes('.com'))) {
      showError('Invalid Email', 'Email must contain "@" and ".com"');
      return;
    }

    if (isLF) {
      if (!form.lfLeadId || !form.leadCode || !form.lfLeadDate || !form.lfLeadTime) {
        showError('Metadata Required', 'Issued Leads require ID, Code, Date, and Time slot.');
        return;
      }
    }

    let payload: Record<string, any> | null = null;

    try {
      Keyboard.dismiss();

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

      const leadLocation =
        (isValidCoords(location) ? location : null) ||
        parseCoordsPlaceholder(form.address) ||
        (isOnline() ? await geocodeAddress(submitAddress) : null);

      payload = isLF
        ? {
          leadType: 'lfLead',
          lfLeadId: form.lfLeadId,
          leadCode: form.leadCode,
          lfLeadDate: (() => {
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
      const outcome = classifyCreateOutcome(err);
      const decision = resolveRetryDecision(outcome, payload);

      if (payload && decision === 'retry') {
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
        showSuccess('Already created', 'This lead is already on the server.');
        onSuccess(null, form.leadType);
        handleClose();
        return;
      }

      if (decision === 'needs-review') {
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
      {/* keyboard-controller's KeyboardAvoidingView (not RN's): KeyboardProvider makes the app edge-to-edge, so Android no longer
          resizes the window and RN's one (and a hand-measured lift) left the pinned button under the system keyboard. It shrinks the
          sheet to the space above the keyboard; off while the in-app pad is up (the pad sizes the form itself). */}
      <KeyboardAvoidingView
        behavior="padding"
        enabled={!numPadActive}
        style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.4)' }]}
      >
        <View style={[styles.modalContainer, { backgroundColor: isDark ? colors.surface : '#fff' }]}>
          {/* Custom number pad: Lead ID + Phone use it; Email/Name/Code/Address keep the system keyboard. */}
          <NumPadProvider layoutAnimated onActiveChange={setNumPadActive}>
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
            <TouchableOpacity onPress={handleClose} className="p-2" style={{ marginRight: -8 }}>
              <Text className="text-3xl font-light" style={{ color: colors.textSecondary }}>
                ×
              </Text>
            </TouchableOpacity>
          </View>

          <KeyboardAwareScrollView
            ref={scrollViewRef}
            bottomOffset={24}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 }}
            scrollEnabled={!showSuggestions}
            keyboardShouldPersistTaps="handled"
          >
            <View>
              <View className="flex-row gap-4">
                <View className="flex-1">
                  <CustomInput
                    fontSize={INPUT_FONT_SIZE}
                    flushLabel
                    label="First Name*"
                    value={form.firstName}
                    onChangeText={(t) => setForm({ ...form, firstName: capitalizeFirst(t) })}
                    autoCapitalize="words"
                    placeholder="Enter First Name"
                  />
                </View>
                <View className="flex-1">
                  <CustomInput
                    fontSize={INPUT_FONT_SIZE}
                    flushLabel
                    label="Last Name*"
                    value={form.lastName}
                    onChangeText={(t) => setForm({ ...form, lastName: capitalizeFirst(t) })}
                    autoCapitalize="words"
                    placeholder="Enter Last Name"
                  />
                </View>
              </View>

              <CustomInput
                    fontSize={INPUT_FONT_SIZE}
                    flushLabel
                label={fromZone ? 'Phone Number' : 'Phone Number*'}
                value={form.phone}
                onChangeText={(t) => {
                  const formatted = formatUSPhoneNumber(t);
                  setForm({ ...form, phone: formatted });
                }}
                placeholder="+1 (123) 456-7890"
                keyboardType={NUMBER_PAD_KEYBOARD}
                maxLength={17}
              />
              <CustomInput
                    fontSize={INPUT_FONT_SIZE}
                    flushLabel
                label="Email Address"
                value={form.email}
                onChangeText={(t) => setForm({ ...form, email: t })}
                placeholder="example@mail.com"
                keyboardType="email-address"
              />

              <View style={{ marginBottom: 16 }}>
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
              <View style={{ marginBottom: 16 }} onLayout={(e) => setAddressFieldY(e.nativeEvent.layout.y)}>
                <Text className="text-sm font-semibold mb-2"
                  style={{ color: colors.text }}>
                  Full Address*
                </Text>
                <View style={{ position: 'relative', zIndex: 1000 }}>
                  <TextInput
                    value={form.address}
                    onChangeText={handleAddressSearch}
                    editable={!fromZone && !addressLockedOffline}
                    onFocus={() => {
                      if (!fromZone && suggestions.length > 0) setShowSuggestions(true);
                      scrollViewRef.current?.scrollTo({ y: addressFieldY, animated: true });
                    }}
                    placeholder={
                      isLocating
                        ? online
                          ? 'Detecting your location...'
                          : 'Locating by GPS — this can take a minute...'
                        : addressLockedOffline
                          ? 'Tap the pin to capture your GPS position'
                          : '123 Main St, City, State'
                    }
                    multiline
                    scrollEnabled={false}
                    submitBehavior="blurAndSubmit"
                    style={{
                      minHeight: 50,
                      backgroundColor: isDark
                        ? 'rgba(255,255,255,0.05)'
                        : fromZone || addressLockedOffline
                          ? '#EDEDED'
                          : '#F5F5F5',
                      borderWidth: 1,
                      borderColor: isDark ? colors.border : '#919EAB33',
                      borderRadius: 12,
                      paddingLeft: 12,
                      paddingRight: 44,
                      paddingTop: 14,
                      paddingBottom: 14,
                      textAlignVertical: 'center',
                      color: colors.text,
                      fontSize: INPUT_FONT_SIZE,
                    }}
                    placeholderTextColor={isDark ? 'rgba(255,255,255,0.35)' : '#919EAB'}
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
                        ? "Offline - GPS position saved. We'll fill in the street address when you're back online."
                        : 'Offline - tap the pin to capture this position by GPS. The address is filled in when you reconnect.'}
                    </Text>
                  </View>
                )}
              </View>

              {/* Lead Type — hidden from zone canvasser (self-gen only, web parity) */}
              {!fromZone && (
                <View className="mb-4">
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
                  className="p-5 rounded-[24px] border mb-4"
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
                    fontSize={INPUT_FONT_SIZE}
                    flushLabel
                    label="Lead ID*"
                    value={form.lfLeadId}
                    onChangeText={(t) => setForm({ ...form, lfLeadId: t.replace(/\D/g, '') })}
                    placeholder="Enter ID"
                    keyboardType={NUMBER_PAD_KEYBOARD}
                    returnKeyType="done"
                    onFocus={() => {
                      scrollViewRef.current?.scrollTo({ y: lfSyncBoxY, animated: true });
                    }}
                  />
                  <CustomInput
                    fontSize={INPUT_FONT_SIZE}
                    flushLabel
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
                    fontSize={INPUT_FONT_SIZE}
                    flushLabel
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

              {/* Spacer for Address Suggestions when Keyboard is open */}
              {showSuggestions && <View style={{ height: 350 }} />}
            </View>
          </KeyboardAwareScrollView>
          {/* Pinned footer: the submit button used to be the last item of the scroll and was clipped / pushed off. */}
          <View
            style={{
              paddingHorizontal: 24,
              paddingTop: 12,
              paddingBottom: footerBottom,
              borderTopWidth: 1,
              borderTopColor: isDark ? colors.border : colors.grey[200],
              backgroundColor: isDark ? colors.surface : '#fff',
            }}
          >
            <CustomButton
              title="Save & Submit Lead"
              onPress={handleSubmit}
              loading={createLeadMutation.isPending}
            />
          </View>
          <RNFlashMessage ref={flashRef} position="top" canRegisterAsDefault={false} />
          </NumPadProvider>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const INPUT_FONT_SIZE = 14;

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContainer: {
    flex: 1,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    maxHeight: '90%',
    overflow: 'hidden',
  },
});
