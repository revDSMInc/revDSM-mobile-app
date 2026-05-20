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
import { useCreateLeadMutation } from '../../../hooks/useLeadMutation';
import Geolocation from 'react-native-geolocation-service';
import axios from 'axios';
import { ENV } from '../../../config/env';
import { formatUSPhoneNumber } from '../../../utils/phone-util';
import Ionicons from 'react-native-vector-icons/Ionicons';
import RNFlashMessage from 'react-native-flash-message';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: (createdLead?: any) => void;
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
  const initialFormState: {
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    address: string;
    leadType: 'selfGen' | 'lf_lead';
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
        setForm(initialFormState);
        handleGetCurrentLocation();
      }
    }
  }, [visible]);

  const handleGetCurrentLocation = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
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
        try {
          const { latitude, longitude } = position.coords;
          const res = await axios.get(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${ENV.GOOGLE_MAPS_API_KEY}`
          );
          if (res.data.results?.[0]) {
            setForm((prev) => ({ ...prev, address: res.data.results[0].formatted_address }));
            setLocation({ latitude, longitude });
          }
        } catch (e) {
          console.warn('Geocoding failed', e);
        } finally {
          setIsLocating(false);
        }
      },
      (error) => {
        console.warn('Location error', error);
        setIsLocating(false);
        if (error.code === 1) {
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
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  };

  const handleAddressSearch = async (text: string) => {
    setForm({ ...form, address: text });
    if (text.length > 3) {
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
    if (!form.firstName || !form.lastName || !form.phone || !form.address) {
      showError('Missing Info', 'Please fill all required customer fields marked with *');
      return;
    }

    // Email validation (optional but must be valid if provided)
    if (form.email && (!form.email.includes('@') || !form.email.toLowerCase().includes('.com'))) {
      showError('Invalid Email', 'Email must contain "@" and ".com"');
      return;
    }

    // Additional validation for LF Leads
    if (isLF) {
      if (!form.lfLeadId || !form.leadCode || !form.lfLeadDate || !form.lfLeadTime) {
        showError('Metadata Required', 'LF Leads require ID, Code, Date, and Time slot.');
        return;
      }
    }

    try {
      const payload = isLF
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
            fullAddress: form.address,
            location: location
              ? {
                  type: 'Point',
                  coordinates: [location.longitude, location.latitude],
                }
              : undefined,
            customer: {
              firstName: form.firstName,
              lastName: form.lastName,
              phone: form.phone,
              email: form.email,
              address: form.address,
            },
          }
        : {
            leadType: 'selfGen',
            repId: user?._id || user?.id,
            fullAddress: form.address,
            location: location
              ? {
                  type: 'Point',
                  coordinates: [location.longitude, location.latitude],
                }
              : undefined,
            customer: {
              firstName: form.firstName,
              lastName: form.lastName,
              phone: form.phone,
              email: form.email,
              address: form.address,
            },
            ...(fromZone && {
              zoneId,
              buildingId,
              latitude: location?.latitude,
              longitude: location?.longitude,
            }),
          };
      console.log(payload, 'lf lead creation');
      const response = await createLeadMutation.mutateAsync(payload);
      showSuccess('Success', 'Lead created successfully');
      
      const createdLead = fromZone ? {
        ...(response?.data?.lead || response?.data || response),
        ...payload,
        status: 'selfGenerated',
      } : null;

      onSuccess(createdLead);
      onClose();
    } catch (err: any) {
      showError('Error', err?.message || 'Failed to create lead');
    }
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
                Add New Lead
              </Text>
              <Text
                className="text-[11px] font-bold mt-1 opacity-60"
                style={{ color: colors.textSecondary }}
              >
                Fill in the customer details below
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} className="p-2">
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
                    onChangeText={(t) => setForm({ ...form, firstName: t })}
                    placeholder="Enter First Name"
                  />
                </View>
                <View className="flex-1">
                  <CustomInput
                    label="Last Name*"
                    value={form.lastName}
                    onChangeText={(t) => setForm({ ...form, lastName: t })}
                    placeholder="Enter Last Name"
                  />
                </View>
              </View>

              <CustomInput
                label="Phone Number*"
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

              {/* Address Section */}
              <View onLayout={(e) => setAddressFieldY(e.nativeEvent.layout.y)}>
                <Text className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">
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
                      isLocating ? 'Detecting your location...' : '123 Main St, City, State'
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
                      <Ionicons
                        name="location-outline"
                        size={18}
                        color={colors.primary.main + '80'}
                      />
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
              </View>

              {/* Lead Type Toggle */}
              <View className="mt-4 mb-6">
                <Text
                  className="text-[10px] font-black tracking-widest uppercase mb-3"
                  style={{ color: colors.textSecondary, opacity: 0.6 }}
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
                        {type === 'selfGen' ? 'SELF GEN' : 'LF LEAD'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {form.leadType === 'lf_lead' && (
                <View
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
                  <View className="flex-row items-center mb-4">
                    <View
                      className="w-1.5 h-6 rounded-full mr-3"
                      style={{ backgroundColor: colors.primary.main }}
                    />
                    <Text
                      className="text-[10px] font-black tracking-widest uppercase"
                      style={{ color: colors.primary.main }}
                    >
                      Lead Force Synchronization
                    </Text>
                  </View>

                  <CustomInput
                    label="Lead ID*"
                    value={form.lfLeadId}
                    onChangeText={(t) => setForm({ ...form, lfLeadId: t })}
                    placeholder="Enter ID"
                    keyboardType="numeric"
                  />
                  <CustomInput
                    label="Lead Code*"
                    value={form.leadCode}
                    onChangeText={(t) => setForm({ ...form, leadCode: t })}
                    placeholder="Enter Code"
                  />

                  <View className="mt-4">
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
                    label="Appointment Date (MM-DD-YYYY)*"
                    value={form.lfLeadDate}
                    onChangeText={(t) => setForm({ ...form, lfLeadDate: t })}
                    placeholder="MM-DD-YYYY"
                    rightIcon="calendar-outline"
                    onRightIconPress={() => setShowDatePicker(true)}
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
                style={{ marginTop: 12, marginBottom: 40 }}
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
