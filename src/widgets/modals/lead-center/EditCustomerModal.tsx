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
import {
  fetchPlacePredictions,
  geocodePlaceId,
  reverseGeocode,
  PlacePrediction,
} from '../../../utils/places';

/** A co-buyer as sent to the API — phone digits only, `null` when blank. */
export interface CoBuyerPayload {
  _id?: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string;
}

export interface EditCustomerPayload {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  coBuyers: CoBuyerPayload[];
  // Set when the address came from a picked suggestion or the device GPS;
  // undefined when it was typed free-hand and never resolved.
  latitude?: number;
  longitude?: number;
}

/** Co-buyer while being edited — phone is display-formatted. */
interface CoBuyerDraft {
  _id?: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

// Web parity: `edit-customer-modal.js` caps a customer at three co-buyers.
const MAX_CO_BUYERS = 3;

const emptyCoBuyer = (): CoBuyerDraft => ({
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
});

/**
 * Exact port of the web modal's `formatPhoneNumber` — the first ten digits as
 * (XXX) XXX-XXXX, with "+1" shown beside the field rather than inside it.
 *
 * Deliberately NOT the app's `formatUSPhoneNumber`, which treats a leading 1 as
 * a country code and strips it: that corrupts a real 10-digit number whose area
 * code starts with 1 (e.g. 1214885239 renders as "+1 (214) 885-239", a digit
 * short) and would then save the mangled value.
 */
const formatCoBuyerPhone = (value: string): string => {
  const digits = (value || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const normalizeCoBuyers = (coBuyers: any[] = []): CoBuyerDraft[] =>
  (Array.isArray(coBuyers) ? coBuyers : []).map((coBuyer) => ({
    _id: coBuyer?._id,
    firstName: coBuyer?.firstName || '',
    lastName: coBuyer?.lastName || '',
    phone: formatCoBuyerPhone(coBuyer?.phone || ''),
    email: coBuyer?.email || '',
  }));

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
  const [firstName, setFirstName] = useState(lead?.customerDetails?.firstName || '');
  const [lastName, setLastName] = useState(lead?.customerDetails?.lastName || '');
  const [phone, setPhone] = useState(lead?.customerDetails?.phone || '');
  const [email, setEmail] = useState(lead?.customerDetails?.email || '');
  const [submitting, setSubmitting] = useState(false);

  // ─── Co-buyers ─────────────────────────────────────────────────────────────
  const [coBuyers, setCoBuyers] = useState<CoBuyerDraft[]>(() =>
    normalizeCoBuyers(lead?.customerDetails?.coBuyers)
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
  };

  const handleRemoveCoBuyer = (index: number) => {
    setCoBuyers((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCoBuyerChange = (index: number, field: keyof CoBuyerDraft, value: string) => {
    setCoBuyers((prev) =>
      prev.map((coBuyer, i) =>
        i === index
          ? { ...coBuyer, [field]: field === 'phone' ? formatCoBuyerPhone(value) : value }
          : coBuyer
      )
    );
  };

  // ─── Address ───────────────────────────────────────────────────────────────
  // Web parity (`edit-customer-modal.js`): prefilled from the customer record,
  // searchable via Places autocomplete, and saved with its coordinates.
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
    // GeoJSON on the lead is [longitude, latitude].
    const coords = lead?.location?.coordinates;
    if (Array.isArray(coords) && coords.length === 2) {
      return { latitude: Number(coords[1]), longitude: Number(coords[0]) };
    }
    return undefined;
  });
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [locating, setLocating] = useState(false);
  // Suppresses the search for values the user did not type: the address the
  // modal opens with, a picked suggestion, a GPS fill. Without this the
  // prefilled address searches itself and the suggestion list opens underneath
  // showing the same address back — reads as a duplicate address field.
  const skipSearchRef = useRef(true);

  useEffect(() => {
    const query = address.trim();
    if (skipSearchRef.current || query.length < 3) {
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
  }, [address]);

  const handlePickPrediction = async (prediction: PlacePrediction) => {
    skipSearchRef.current = true;
    setAddress(prediction.description);
    setPredictions([]);
    const coords = await geocodePlaceId(prediction.placeId);
    setAddressCoords(coords ?? undefined);
  };

  /**
   * Reverse-geocodes the device's position into the address box.
   * `prompt` is false for the automatic fill (an empty address on open), which
   * must stay silent — no permission dialog, no error toast.
   */
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
    } catch (error: any) {
      console.log('[EditCustomer] Current location failed:', error);
      if (prompt) {
        FlashMessage.error('Error', 'Could not get your current location.');
      }
    } finally {
      setLocating(false);
    }
  };

  // Nothing on file for this customer → open with where the rep is standing.
  // Once per mount (the modal is only mounted while open), and never over an
  // address that already exists.
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
    if (!phone.trim()) {
      FlashMessage.error('Validation Error', 'Phone Number is required.');
      return;
    }
    if (!address.trim()) {
      FlashMessage.error('Validation Error', 'Address is required.');
      return;
    }

    // Co-buyer rules, ported from the web modal's `onSubmit`.
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

    // Sent shape mirrors the web payload: digits-only phone (null when blank),
    // empty-string email, and `_id` carried through for existing co-buyers.
    const sanitizedCoBuyers: CoBuyerPayload[] = coBuyers.map((coBuyer) => {
      const digits = coBuyer.phone?.replace(/\D/g, '') || '';
      const payload: CoBuyerPayload = {
        firstName: coBuyer.firstName.trim(),
        lastName: coBuyer.lastName.trim(),
        phone: digits || null,
        email: coBuyer.email?.trim() || '',
      };
      if (coBuyer._id) payload._id = coBuyer._id;
      return payload;
    });

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
            const formatted = label.toLowerCase().includes('phone') ? formatUSPhoneNumber(t) : t;
            onChange(formatted);
          }}
          placeholder={label}
          placeholderTextColor="#919EAB"
          keyboardType={keyboardType}
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
              {renderField('First Name', firstName, setFirstName, true)}
              {renderField('Last Name', lastName, setLastName, true)}
              {renderField('Phone Number', phone, setPhone, true, 'phone-pad')}
              {renderField('Email', email, setEmail, false, 'email-address')}

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
                      // The typed text no longer matches the resolved point.
                      setAddressCoords(undefined);
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
    fontWeight: '600',
    color: '#000000',
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
