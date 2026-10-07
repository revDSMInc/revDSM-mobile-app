import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { formatUSPhoneNumber } from '../../../utils/phone-util';
import { FlashMessage } from '../../../config/message';
import { useAuth } from '../../../hooks/useAuth';
import { logEvent } from '../../../services/api/LoggerService';
import { useIsOnline } from '../../../hooks/useIsOnline';
import {
  fetchPlacePredictions,
  geocodePlaceId,
  reverseGeocode,
  PlacePrediction,
} from '../../../utils/places';

export interface CoBuyerPayload {
  _id?: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string;
  address: string;
}

export interface EditCustomerPayload {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  coBuyers: CoBuyerPayload[];
  latitude?: number;
  longitude?: number;
}

interface CoBuyerDraft {
  _id?: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  sameAsPrimary: boolean;
}

const MAX_CO_BUYERS = 3;

const FIELD_CHANGE_DEBOUNCE_MS = 2000;

const CUSTOMER_FIELD_CATEGORY = 'customer';
const CO_BUYER_FIELD_CATEGORY = 'co_buyer';

interface TrackedFieldChange {
  fieldName: string;
  fieldLabel: string;
  fieldValue: string;
  fieldCategory: string;
  oldValue: string;
  newValue: string;
  action: string;
  coBuyerNumber?: number;
}

const CO_BUYER_FIELD_LABELS: Record<string, string> = {
  firstName: 'First Name',
  lastName: 'Last Name',
  phone: 'Phone Number',
  email: 'Email',
  address: 'Address',
};

const coBuyerFieldKey = (position: number, field: string) => `coBuyer_${position}_${field}`;

const coBuyerTrackedValues = (
  index: number,
  coBuyer: CoBuyerDraft,
  primaryAddress: string
): Record<string, string> => ({
  [coBuyerFieldKey(index + 1, 'firstName')]: coBuyer.firstName || '',
  [coBuyerFieldKey(index + 1, 'lastName')]: coBuyer.lastName || '',
  [coBuyerFieldKey(index + 1, 'phone')]: coBuyer.phone || '',
  [coBuyerFieldKey(index + 1, 'email')]: coBuyer.email || '',
  [coBuyerFieldKey(index + 1, 'address')]: coBuyer.sameAsPrimary
    ? primaryAddress
    : coBuyer.address || '',
});

const seedTrackedValues = (lead: any): Record<string, string> => {
  const primaryAddress = lead?.customerDetails?.address || lead?.fullAddress || '';
  const seed: Record<string, string> = {
    firstName: lead?.customerDetails?.firstName || '',
    lastName: lead?.customerDetails?.lastName || '',
    phone: formatUSPhoneNumber(lead?.customerDetails?.phone || ''),
    email: lead?.customerDetails?.email || '',
    address: primaryAddress,
  };
  normalizeCoBuyers(lead?.customerDetails?.coBuyers, primaryAddress).forEach((coBuyer, i) => {
    Object.assign(seed, coBuyerTrackedValues(i, coBuyer, primaryAddress));
  });
  return seed;
};

const emptyCoBuyer = (): CoBuyerDraft => ({
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  address: '',
  sameAsPrimary: false,
});

const formatCoBuyerPhone = (value: string): string => {
  const digits = (value || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const capitalizeFirst = (text: string): string =>
  text.length ? text.charAt(0).toUpperCase() + text.slice(1) : text;

export const normalizeCoBuyers = (coBuyers: any[] = [], primaryAddress = ''): CoBuyerDraft[] => {
  const primary = (primaryAddress || '').trim();
  return (Array.isArray(coBuyers) ? coBuyers : []).map((coBuyer) => {
    const address = coBuyer?.address || '';
    return {
      _id: coBuyer?._id,
      firstName: coBuyer?.firstName || '',
      lastName: coBuyer?.lastName || '',
      phone: formatCoBuyerPhone(coBuyer?.phone || ''),
      email: coBuyer?.email || '',
      address,
      sameAsPrimary: !!primary && address.trim() === primary,
    };
  });
};

interface EditCustomerModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: EditCustomerPayload) => Promise<void>;
  lead: any;
}

export const EditCustomerModal: React.FC<EditCustomerModalProps> = ({
  visible,
  onClose,
  onSubmit,
  lead,
}) => {
  const { colors } = useTheme();
  const { user } = useAuth();

  const pendingChangesRef = useRef<Record<string, TrackedFieldChange>>({});
  const lastValuesRef = useRef<Record<string, string>>({});
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushFieldChangesRef = useRef<() => void>(() => {});

  const logIds = {
    leadId: lead?._id || lead?.id,
    customerId: lead?.customerDetails?._id || lead?.customerDetails?.id || null,
  };

  const flushFieldChanges = () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const pending = pendingChangesRef.current;
    pendingChangesRef.current = {};
    const changes = Object.values(pending);
    if (!changes.length) return;

    changes.forEach((change) => {
      lastValuesRef.current[change.fieldName] = change.newValue;
    });

    const userId = user?._id || user?.id;
    if (!userId) return;

    changes.forEach((change) => {
      if (change.oldValue === change.newValue) return;
      logEvent('change', {
        user_id: userId,
        created_by: userId,
        module_type: 'customer_details',
        meta: { ...logIds, ...change },
      });
    });
  };
  flushFieldChangesRef.current = flushFieldChanges;

  const trackFieldChange = (
    fieldName: string,
    newValue: string,
    fieldLabel: string,
    fieldCategory: string,
    coBuyerNumber?: number
  ) => {
    const sanitized = newValue === undefined || newValue === null ? '' : String(newValue);
    pendingChangesRef.current[fieldName] = {
      fieldName,
      fieldLabel,
      fieldValue: sanitized,
      fieldCategory,
      oldValue: String(lastValuesRef.current[fieldName] ?? ''),
      newValue: sanitized,
      action:
        fieldCategory === CO_BUYER_FIELD_CATEGORY
          ? 'co-buyer field changed'
          : 'customer field changed',
      ...(coBuyerNumber ? { coBuyerNumber } : null),
    };
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(
      () => flushFieldChangesRef.current(),
      FIELD_CHANGE_DEBOUNCE_MS
    );
  };

  useEffect(() => {
    lastValuesRef.current = seedTrackedValues(lead);
    return () => flushFieldChangesRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [firstName, setFirstName] = useState(lead?.customerDetails?.firstName || '');
  const [lastName, setLastName] = useState(lead?.customerDetails?.lastName || '');
  const [phone, setPhone] = useState(formatUSPhoneNumber(lead?.customerDetails?.phone || ''));
  const [email, setEmail] = useState(lead?.customerDetails?.email || '');
  const [submitting, setSubmitting] = useState(false);

  const [coBuyers, setCoBuyers] = useState<CoBuyerDraft[]>(() =>
    normalizeCoBuyers(
      lead?.customerDetails?.coBuyers,
      lead?.customerDetails?.address || lead?.fullAddress || ''
    )
  );

  const atCoBuyerLimit = coBuyers.length >= MAX_CO_BUYERS;
  const addCoBuyerStyle = React.useMemo(
    () => ({ borderColor: colors.primary.main, opacity: atCoBuyerLimit ? 0.5 : 1 }),
    [colors.primary.main, atCoBuyerLimit]
  );

  const handleAddCoBuyer = () => {
    if (coBuyers.length >= MAX_CO_BUYERS) {
      FlashMessage.warning('Limit reached', `A customer can have at most ${MAX_CO_BUYERS} co-buyers`);
      return;
    }
    setCoBuyers((prev) => [...prev, emptyCoBuyer()]);

    const userId = user?._id || user?.id;
    if (userId) {
      logEvent('view', {
        user_id: userId,
        module_type: 'customer_details',
        created_by: userId,
        meta: {
          leadId: lead?._id || lead?.id,
          customerId: lead?.customerDetails?._id || lead?.customerDetails?.id || null,
          action: 'add co-buyer opened',
          is_co_buyer: true,
        },
      });
    }
  };

  const handleRemoveCoBuyer = (index: number) => {
    flushFieldChanges();

    const removed = coBuyers[index];
    const next = coBuyers.filter((_, i) => i !== index);
    setCoBuyers(next);

    closeCoBuyerAddressSearch();

    Object.keys(lastValuesRef.current)
      .filter((key) => key.startsWith('coBuyer_'))
      .forEach((key) => delete lastValuesRef.current[key]);
    next.forEach((coBuyer, i) => {
      Object.assign(lastValuesRef.current, coBuyerTrackedValues(i, coBuyer, address));
    });

    const userId = user?._id || user?.id;
    if (userId) {
      logEvent('change', {
        user_id: userId,
        created_by: userId,
        module_type: 'customer_details',
        meta: {
          ...logIds,
          action: 'co-buyer removed',
          fieldCategory: CO_BUYER_FIELD_CATEGORY,
          coBuyerNumber: index + 1,
          removedCoBuyer:
            `${removed?.firstName || ''} ${removed?.lastName || ''}`.trim(),
        },
      });
    }
  };

  const handleCoBuyerSameAddress = (index: number, checked: boolean) => {
    setCoBuyers((prev) =>
      prev.map((coBuyer, i) => (i === index ? { ...coBuyer, sameAsPrimary: checked } : coBuyer))
    );
    if (checked) closeCoBuyerAddressSearch();
    trackFieldChange(
      coBuyerFieldKey(index + 1, 'address'),
      checked ? address : coBuyers[index]?.address || '',
      `Co-Buyer ${index + 1} Address`,
      CO_BUYER_FIELD_CATEGORY,
      index + 1
    );
  };

  const coBuyerAddressOf = (coBuyer: CoBuyerDraft) =>
    coBuyer.sameAsPrimary ? address : coBuyer.address;

  const handleCoBuyerChange = (index: number, field: 'firstName' | 'lastName' | 'phone' | 'email' | 'address', value: string) => {
    const nextValue =
      field === 'phone'
        ? formatCoBuyerPhone(value)
        : field === 'firstName' || field === 'lastName'
        ? capitalizeFirst(value)
        : value;
    if (field === 'address') setCoBuyerSearchIndex(index);
    setCoBuyers((prev) =>
      prev.map((coBuyer, i) => (i === index ? { ...coBuyer, [field]: nextValue } : coBuyer))
    );
    trackFieldChange(
      coBuyerFieldKey(index + 1, field),
      nextValue,
      `Co-Buyer ${index + 1} ${CO_BUYER_FIELD_LABELS[field]}`,
      CO_BUYER_FIELD_CATEGORY,
      index + 1
    );
  };

  const [address, setAddress] = useState(
    lead?.customerDetails?.address || lead?.fullAddress || ''
  );
  const [addressCoords, setAddressCoords] = useState<
    { latitude: number; longitude: number } | undefined
  >(() => {
    const latitude = lead?.customerDetails?.latitude ?? lead?.latitude;
    const longitude = lead?.customerDetails?.longitude ?? lead?.longitude;
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      return { latitude, longitude };
    }
    const coords = lead?.location?.coordinates;
    if (Array.isArray(coords) && coords.length === 2) {
      return { latitude: Number(coords[1]), longitude: Number(coords[0]) };
    }
    return undefined;
  });
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [locating, setLocating] = useState(false);
  const skipSearchRef = useRef(true);

  const online = useIsOnline();

  useEffect(() => {
    const query = address.trim();
    if (!online || skipSearchRef.current || query.length < 3) {
      setPredictions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearchingAddress(true);
      const results = await fetchPlacePredictions(query);
      setPredictions(results);
      setSearchingAddress(false);
    }, 600);

    return () => clearTimeout(timer);
  }, [address, online]);

  const handlePickPrediction = async (prediction: PlacePrediction) => {
    skipSearchRef.current = true;
    setAddress(prediction.description);
    setPredictions([]);
    trackFieldChange('address', prediction.description, 'Address', CUSTOMER_FIELD_CATEGORY);
    const coords = await geocodePlaceId(prediction.placeId);
    setAddressCoords(coords ?? undefined);
  };

  const [coBuyerSearchIndex, setCoBuyerSearchIndex] = useState<number | null>(null);
  const [coBuyerPredictions, setCoBuyerPredictions] = useState<PlacePrediction[]>([]);
  const [coBuyerSearching, setCoBuyerSearching] = useState(false);
  const coBuyerSkipSearchRef = useRef(true);

  const coBuyerSearchQuery =
    coBuyerSearchIndex == null ? '' : coBuyers[coBuyerSearchIndex]?.address || '';

  useEffect(() => {
    const query = coBuyerSearchQuery.trim();
    if (!online || coBuyerSkipSearchRef.current || query.length < 3) {
      setCoBuyerPredictions([]);
      return;
    }

    const timer = setTimeout(async () => {
      setCoBuyerSearching(true);
      const results = await fetchPlacePredictions(query);
      setCoBuyerPredictions(results);
      setCoBuyerSearching(false);
    }, 600);

    return () => clearTimeout(timer);
  }, [coBuyerSearchQuery, online]);

  const closeCoBuyerAddressSearch = () => {
    coBuyerSkipSearchRef.current = true;
    setCoBuyerPredictions([]);
    setCoBuyerSearchIndex(null);
  };

  const handlePickCoBuyerPrediction = (index: number, prediction: PlacePrediction) => {
    coBuyerSkipSearchRef.current = true;
    setCoBuyerPredictions([]);
    handleCoBuyerChange(index, 'address', prediction.description);
  };

  const applyCurrentLocation = async (prompt: boolean) => {
    try {
      setLocating(true);

      if (Platform.OS === 'android') {
        const granted = prompt
          ? (await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
            )) === PermissionsAndroid.RESULTS.GRANTED
          : await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);

        if (!granted) {
          if (prompt) {
            FlashMessage.error(
              'Permission Denied',
              'Location access is needed to fill the address.'
            );
          }
          return;
        }
      } else if (prompt) {
        await Geolocation.requestAuthorization('whenInUse');
      }

      const position = await new Promise<any>((resolve, reject) => {
        Geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 10000,
        });
      });

      const coords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
      const resolved = await reverseGeocode(coords);

      if (!resolved) {
        if (prompt) {
          FlashMessage.error('Error', 'Could not resolve an address for your current location.');
        }
        return;
      }

      skipSearchRef.current = true;
      setAddress(resolved);
      setAddressCoords(coords);
      setPredictions([]);
      if (prompt) {
        trackFieldChange('address', resolved, 'Address', CUSTOMER_FIELD_CATEGORY);
      }
    } catch (error: any) {
      console.log('[EditCustomer] Current location failed:', error);
      if (prompt) {
        FlashMessage.error('Error', 'Could not get your current location.');
      }
    } finally {
      setLocating(false);
    }
  };

  const didAutoFillRef = useRef(false);
  useEffect(() => {
    if (didAutoFillRef.current) return;
    if (address.trim()) return;
    didAutoFillRef.current = true;
    applyCurrentLocation(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (!firstName.trim()) {
      FlashMessage.error('Validation Error', 'First Name is required.');
      return;
    }
    if (!lastName.trim()) {
      FlashMessage.error('Validation Error', 'Last Name is required.');
      return;
    }
    const phoneDigits = phone.replace(/\D/g, '');
    if (!phone.trim() || phoneDigits.length <= 1) {
      FlashMessage.error('Validation Error', 'Phone Number is required.');
      return;
    }
    if (phoneDigits.length !== 11) {
      FlashMessage.error('Validation Error', 'Please enter a complete 10-digit phone number');
      return;
    }
    if (!address.trim()) {
      FlashMessage.error('Validation Error', 'Address is required.');
      return;
    }

    for (let i = 0; i < coBuyers.length; i += 1) {
      const coBuyer = coBuyers[i];
      const coBuyerPhoneDigits = coBuyer.phone?.replace(/\D/g, '') || '';
      const coBuyerEmail = coBuyer.email?.trim() || '';

      if (!coBuyer.firstName?.trim() || !coBuyer.lastName?.trim()) {
        FlashMessage.error('Validation Error', `Co-buyer ${i + 1}: first and last name are required`);
        return;
      }
      if (coBuyerPhoneDigits && coBuyerPhoneDigits.length !== 10) {
        FlashMessage.error('Validation Error', `Co-buyer ${i + 1}: phone must be exactly 10 digits`);
        return;
      }
      if (coBuyerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(coBuyerEmail)) {
        FlashMessage.error('Validation Error', `Co-buyer ${i + 1}: email must be valid`);
        return;
      }
    }

    const sanitizedCoBuyers: CoBuyerPayload[] = coBuyers.map((coBuyer) => {
      const digits = coBuyer.phone?.replace(/\D/g, '') || '';
      const payload: CoBuyerPayload = {
        firstName: coBuyer.firstName.trim(),
        lastName: coBuyer.lastName.trim(),
        phone: digits || null,
        email: coBuyer.email?.trim() || '',
        address: coBuyerAddressOf(coBuyer).trim(),
      };
      if (coBuyer._id) payload._id = coBuyer._id;
      return payload;
    });

    flushFieldChanges();

    try {
      setSubmitting(true);
      await onSubmit({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        coBuyers: sanitizedCoBuyers,
        latitude: addressCoords?.latitude,
        longitude: addressCoords?.longitude,
      });

      const userId = user?._id || user?.id;
      if (userId) {
        logEvent('change', {
          user_id: userId,
          module_type: 'lead_center',
          created_by: userId,
          meta: {
            leadId: lead?._id || lead?.id,
            action: 'edited_customer_details',
          },
        });
      }

      onClose();
    } catch (error: any) {
      FlashMessage.error('Error', error?.message || 'Failed to update customer info.');
    } finally {
      setSubmitting(false);
    }
  };

  const trackedSetter = (
    setter: (value: string) => void,
    fieldName: string,
    fieldLabel: string
  ) => (value: string) => {
    setter(value);
    trackFieldChange(fieldName, value, fieldLabel, CUSTOMER_FIELD_CATEGORY);
  };

  const renderField = (
    label: string,
    value: string,
    onChange: (t: string) => void,
    required = false,
    keyboardType: any = 'default'
  ) => (
    <View style={styles.fieldWrap}>
      <View style={styles.floatingLabel}>
        <Text style={styles.floatingLabelText}>
          {label}
          {required && <Text style={{ color: '#FF4842' }}>*</Text>}
        </Text>
      </View>
      <View style={styles.fieldBox}>
        <TextInput
          value={value}
          onChangeText={(t) => {
            const lowerLabel = label.toLowerCase();
            const formatted = lowerLabel.includes('phone')
              ? formatUSPhoneNumber(t)
              : lowerLabel.includes('name')
              ? capitalizeFirst(t)
              : t;
            onChange(formatted);
          }}
          placeholder={label}
          placeholderTextColor="#919EAB"
          keyboardType={keyboardType}
          autoCapitalize={label.toLowerCase().includes('name') ? 'words' : 'sentences'}
          style={styles.fieldInput}
          maxLength={label.toLowerCase().includes('phone') ? 17 : undefined}
          editable={!submitting}
        />
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            {/* Header */}
            <View style={[styles.header, { backgroundColor: colors.primary.main }]}>
              <Text style={styles.headerTitle}>Edit Customer Details</Text>
              <TouchableOpacity
                onPress={onClose}
                disabled={submitting}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Icon name="close" size={24} color="white" />
              </TouchableOpacity>
            </View>

            {/* Body */}
            <ScrollView
              style={styles.body}
              contentContainerStyle={{ paddingBottom: 24, paddingTop: 20 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {renderField(
                'First Name',
                firstName,
                trackedSetter(setFirstName, 'firstName', 'First Name'),
                true
              )}
              {renderField(
                'Last Name',
                lastName,
                trackedSetter(setLastName, 'lastName', 'Last Name'),
                true
              )}
              {renderField(
                'Phone Number',
                phone,
                trackedSetter(setPhone, 'phone', 'Phone Number'),
                true,
                'phone-pad'
              )}
              {renderField(
                'Email',
                email,
                trackedSetter(setEmail, 'email', 'Email'),
                false,
                'email-address'
              )}

              {/* Address — type a street, town or landmark to search, or tap the
                  crosshair to drop in the rep's current location. */}
              <View style={styles.fieldWrap}>
                <View style={styles.floatingLabel}>
                  <Text style={styles.floatingLabelText}>
                    Address<Text style={styles.requiredMark}>*</Text>
                  </Text>
                </View>
                <View style={styles.fieldBox}>
                  <TextInput
                    value={address}
                    onChangeText={(text) => {
                      skipSearchRef.current = false;
                      setAddress(text);
                      setAddressCoords(undefined);
                      trackFieldChange('address', text, 'Address', CUSTOMER_FIELD_CATEGORY);
                    }}
                    placeholder="Street, town or city"
                    placeholderTextColor="#919EAB"
                    style={styles.fieldInput}
                    editable={!submitting && !locating}
                    multiline
                  />
                  {searchingAddress && <ActivityIndicator size="small" color={colors.primary.main} />}
                  {address.length > 0 && !searchingAddress && !locating && (
                    <TouchableOpacity
                      onPress={() => {
                        skipSearchRef.current = true;
                        setAddress('');
                        setAddressCoords(undefined);
                        setPredictions([]);
                        trackFieldChange('address', '', 'Address', CUSTOMER_FIELD_CATEGORY);
                      }}
                      disabled={submitting}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={styles.fieldAction}
                    >
                      <Icon name="close-circle" size={16} color="#919EAB" />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => applyCurrentLocation(true)}
                    disabled={submitting || locating}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.fieldAction}
                  >
                    {locating ? (
                      <ActivityIndicator size="small" color={colors.primary.main} />
                    ) : (
                      <Icon name="crosshairs-gps" size={18} color={colors.primary.main} />
                    )}
                  </TouchableOpacity>
                </View>

                {!online && (
                  <Text style={styles.offlineHint}>
                    Address search needs a connection — type the address as it reads on the door.
                  </Text>
                )}

                {predictions.length > 0 && (
                  <View style={styles.predictionList}>
                    {predictions.slice(0, 5).map((prediction) => (
                      <TouchableOpacity
                        key={prediction.placeId}
                        onPress={() => handlePickPrediction(prediction)}
                        style={styles.predictionRow}
                      >
                        <Icon name="map-marker-outline" size={14} color="#919EAB" />
                        <Text style={styles.predictionText} numberOfLines={2}>
                          {prediction.description}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* Co-Buyers — up to three, each a bordered block with a Remove
                  action, matching the web modal. */}
              {coBuyers.map((coBuyer, index) => (
                <View key={coBuyer._id || `co-buyer-${index}`} style={styles.coBuyerCard}>
                  <View style={styles.coBuyerHeader}>
                    <Text style={styles.coBuyerTitle}>Co-Buyer {index + 1}</Text>
                    <TouchableOpacity
                      onPress={() => handleRemoveCoBuyer(index)}
                      disabled={submitting}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.coBuyerRemove}>Remove</Text>
                    </TouchableOpacity>
                  </View>

                  {renderField(
                    'First Name',
                    coBuyer.firstName,
                    (t) => handleCoBuyerChange(index, 'firstName', t),
                    true
                  )}
                  {renderField(
                    'Last Name',
                    coBuyer.lastName,
                    (t) => handleCoBuyerChange(index, 'lastName', t),
                    true
                  )}
                  {/* "+1" sits beside the input, as on web, so the digits the
                      rep types are never mistaken for a country code. */}
                  <View style={styles.fieldWrap}>
                    <View style={styles.floatingLabel}>
                      <Text style={styles.floatingLabelText}>Phone Number</Text>
                    </View>
                    <View style={styles.fieldBox}>
                      <Text style={styles.phonePrefix}>+1</Text>
                      <TextInput
                        value={coBuyer.phone}
                        onChangeText={(t) => handleCoBuyerChange(index, 'phone', t)}
                        placeholder="Enter Phone Number"
                        placeholderTextColor="#919EAB"
                        keyboardType="phone-pad"
                        style={styles.fieldInput}
                        maxLength={14}
                        editable={!submitting}
                      />
                    </View>
                  </View>
                  {renderField(
                    'Email',
                    coBuyer.email,
                    (t) => handleCoBuyerChange(index, 'email', t),
                    false,
                    'email-address'
                  )}

                  {/* Same-address opt-in. Ticking it fills the box below from the
                      primary buyer's Address field ABOVE — which is why the whole
                      co-buyer block now sits under that field rather than over it:
                      a checkbox that mirrors a value the rep has not reached yet
                      reads as broken. */}
                  <TouchableOpacity
                    onPress={() => handleCoBuyerSameAddress(index, !coBuyer.sameAsPrimary)}
                    disabled={submitting}
                    activeOpacity={0.7}
                    style={styles.sameAddressRow}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        coBuyer.sameAsPrimary && {
                          backgroundColor: colors.primary.main,
                          borderColor: colors.primary.main,
                        },
                      ]}
                    >
                      {coBuyer.sameAsPrimary && <Icon name="check" size={13} color="#fff" />}
                    </View>
                    <Text style={styles.sameAddressText}>Same address as primary buyer?</Text>
                  </TouchableOpacity>

                  {/* Read-only while mirrored — the value lives in the primary field,
                      so editing it here would silently diverge from the box's claim. */}
                  <View style={styles.fieldWrap}>
                    <View style={styles.floatingLabel}>
                      <Text style={styles.floatingLabelText}>Address</Text>
                    </View>
                    <View
                      style={[styles.fieldBox, coBuyer.sameAsPrimary && styles.fieldBoxReadOnly]}
                    >
                      <TextInput
                        value={coBuyerAddressOf(coBuyer)}
                        onChangeText={(t) => {
                          coBuyerSkipSearchRef.current = false;
                          handleCoBuyerChange(index, 'address', t);
                        }}
                        placeholder="Street, town or city"
                        placeholderTextColor="#919EAB"
                        style={styles.fieldInput}
                        editable={!submitting && !coBuyer.sameAsPrimary}
                        multiline
                      />
                      {coBuyerSearching && coBuyerSearchIndex === index && (
                        <ActivityIndicator size="small" color={colors.primary.main} />
                      )}
                    </View>

                    {/* Scoped to the co-buyer being searched, so the list can only ever
                        drop its pick into the box it opened under. */}
                    {coBuyerSearchIndex === index && coBuyerPredictions.length > 0 && (
                      <View style={styles.predictionList}>
                        {coBuyerPredictions.slice(0, 5).map((prediction) => (
                          <TouchableOpacity
                            key={prediction.placeId}
                            onPress={() => handlePickCoBuyerPrediction(index, prediction)}
                            style={styles.predictionRow}
                          >
                            <Icon name="map-marker-outline" size={14} color="#919EAB" />
                            <Text style={styles.predictionText} numberOfLines={2}>
                              {prediction.description}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                </View>
              ))}

              <TouchableOpacity
                onPress={handleAddCoBuyer}
                disabled={submitting || atCoBuyerLimit}
                style={[styles.addCoBuyerBtn, addCoBuyerStyle]}
              >
                <Icon name="plus" size={16} color={colors.primary.main} />
                <Text style={[styles.addCoBuyerText, { color: colors.primary.main }]}>
                  Add Co-Buyer
                </Text>
              </TouchableOpacity>
            </ScrollView>

            {/* Footer */}
            <View style={styles.footer}>
              <TouchableOpacity
                onPress={onClose}
                disabled={submitting}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                disabled={submitting}
                style={[
                  styles.submitBtn,
                  { backgroundColor: colors.primary.main, opacity: submitting ? 0.6 : 1 },
                ]}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text style={styles.submitBtnText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    maxHeight: '85%',
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerTitle: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  body: {
    paddingHorizontal: 16,
    backgroundColor: 'white',
  },
  fieldWrap: {
    marginBottom: 20,
    position: 'relative',
  },
  floatingLabel: {
    position: 'absolute',
    top: -8,
    left: 14,
    zIndex: 10,
    paddingHorizontal: 4,
    backgroundColor: 'white',
  },
  floatingLabelText: {
    fontSize: 11,
    color: '#000000',
  },
  offlineHint: {
    marginTop: 6,
    fontSize: 11,
    color: '#919EAB',
  },
  fieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#919EAB33',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  fieldInput: {
    flex: 1,
    fontSize: 12,
    color: '#1C252E',
    padding: 0,
  },
  requiredMark: {
    color: '#FF4842',
  },
  phonePrefix: {
    fontSize: 12,
    color: '#1C252E',
    marginRight: 6,
  },
  coBuyerCard: {
    borderWidth: 1,
    borderColor: '#919EAB33',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingTop: 16,
    marginBottom: 20,
  },
  coBuyerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  coBuyerTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1C252E',
  },
  coBuyerRemove: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FF4842',
  },
  sameAddressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 14,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sameAddressText: {
    marginLeft: 10,
    fontSize: 13,
    fontWeight: '600',
    color: '#454F5B',
  },
  fieldBoxReadOnly: {
    backgroundColor: '#F4F6F8',
  },
  addCoBuyerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginBottom: 20,
  },
  addCoBuyerText: {
    fontSize: 13,
    fontWeight: '600',
  },
  fieldAction: {
    marginLeft: 8,
  },
  predictionList: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#919EAB33',
    borderRadius: 8,
    backgroundColor: 'white',
    overflow: 'hidden',
  },
  predictionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#919EAB1A',
  },
  predictionText: {
    flex: 1,
    fontSize: 12,
    color: '#1C252E',
  },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#919EAB22',
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#919EAB33',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#637381',
  },
  submitBtn: {
    flex: 1.5,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtnText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '700',
  },
});
