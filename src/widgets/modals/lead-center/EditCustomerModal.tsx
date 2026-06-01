import React, { useState } from 'react';
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
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { formatUSPhoneNumber } from '../../../utils/phone-util';
import { FlashMessage } from '../../../config/message';

interface EditCustomerModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: { firstName: string; lastName: string; phone: string; email: string }) => Promise<void>;
  lead: any;
}

export const EditCustomerModal: React.FC<EditCustomerModalProps> = ({
  visible,
  onClose,
  onSubmit,
  lead,
}) => {
  const { colors } = useTheme();
  const [firstName, setFirstName] = useState(lead?.customerDetails?.firstName || '');
  const [lastName, setLastName] = useState(lead?.customerDetails?.lastName || '');
  const [phone, setPhone] = useState(lead?.customerDetails?.phone || '');
  const [email, setEmail] = useState(lead?.customerDetails?.email || '');
  const [submitting, setSubmitting] = useState(false);

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

    try {
      setSubmitting(true);
      await onSubmit({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        email: email.trim(),
      });
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
              <Text style={styles.headerTitle}>Edit Customer</Text>
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
