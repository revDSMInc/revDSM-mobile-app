import React from 'react';
import { View, Text, Modal, TouchableOpacity, Linking, Platform } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface MapSelectionModalProps {
  visible: boolean;
  address: string;
  onClose: () => void;
}

export const MapSelectionModal = ({ visible, address, onClose }: MapSelectionModalProps) => {
  const { colors, isDark } = useTheme();

  const handleOpenGoogleMaps = () => {
    const encodedAddress = encodeURIComponent(address);
    const webUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;

    if (Platform.OS === 'ios') {
      const appUrl = `comgooglemaps://?q=${encodedAddress}`;
      Linking.canOpenURL(appUrl)
        .then(supported => {
          if (supported) {
            Linking.openURL(appUrl).catch(err => {
              console.error('Failed to open Google Maps app, trying web fallback:', err);
              Linking.openURL(webUrl).catch(webErr => {
                console.error('Failed to open Google Maps web URL:', webErr);
              });
            });
          } else {
            Linking.openURL(webUrl).catch(err => {
              console.error('Failed to open Google Maps web URL:', err);
            });
          }
        })
        .catch(err => {
          console.error('canOpenURL error for Google Maps:', err);
          Linking.openURL(webUrl).catch(webErr => {
            console.error('Failed to open Google Maps web URL:', webErr);
          });
        });
    } else {
      Linking.openURL(webUrl).catch(err => {
        console.error('Failed to open Google Maps:', err);
      });
    }
    onClose();
  };

  const handleOpenAppleMaps = () => {
    const encodedAddress = encodeURIComponent(address);
    const url = `http://maps.apple.com/?q=${encodedAddress}`;
    Linking.openURL(url).catch(err => {
      console.error('Failed to open Apple Maps:', err);
    });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableOpacity 
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }} 
        activeOpacity={1} 
        onPress={onClose}
      >
        <TouchableOpacity 
          activeOpacity={1} 
          style={{
            backgroundColor: isDark ? colors.surface : '#fff',
            borderRadius: 16,
            padding: 24,
            width: '85%',
            maxWidth: 400,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.25,
            shadowRadius: 4,
            elevation: 5,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: colors.text }}>
              Do you want to open this address?
            </Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 4, marginRight: -8 }}>
              <Icon name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', gap: 16 }}>
            <TouchableOpacity 
              onPress={handleOpenGoogleMaps}
              style={{
                borderBottomWidth: 2,
                borderBottomColor: '#72BD00',
                paddingBottom: 4,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
                Via Google Maps
              </Text>
            </TouchableOpacity>

            {Platform.OS === 'ios' && (
              <TouchableOpacity 
                onPress={handleOpenAppleMaps}
                style={{
                  borderBottomWidth: 2,
                  borderBottomColor: '#72BD00',
                  paddingBottom: 4,
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
                  Via Apple Maps
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};
