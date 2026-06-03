import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Keyboard,
  StyleSheet,
  Alert,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import axios from 'axios';
import { ENV } from '../../../config/env';
import { useTheme } from '../../../theme/ThemeProvider';
import type { MapCoordinate } from '../../../types/zone-canvasser';

type PlacePrediction = {
  description: string;
  place_id: string;
};

type Props = {
  visible: boolean;
  searchText: string;
  onChangeText: (text: string) => void;
  onClose: () => void;
  onLocationSelected: (coords: MapCoordinate) => void;
  isProcessing?: boolean;
};

async function geocodeAddress(address: string): Promise<MapCoordinate | null> {
  const res = await axios.get(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address
    )}&key=${ENV.GOOGLE_MAPS_API_KEY}`
  );
  const loc = res.data?.results?.[0]?.geometry?.location;
  if (!loc) return null;
  return { latitude: loc.lat, longitude: loc.lng };
}

async function geocodePlaceId(placeId: string): Promise<MapCoordinate | null> {
  const res = await axios.get(
    `https://maps.googleapis.com/maps/api/geocode/json?place_id=${placeId}&key=${ENV.GOOGLE_MAPS_API_KEY}`
  );
  const loc = res.data?.results?.[0]?.geometry?.location;
  if (!loc) return null;
  return { latitude: loc.lat, longitude: loc.lng };
}

export function SearchLocationModal({
  visible,
  searchText,
  onChangeText,
  onClose,
  onLocationSelected,
  isProcessing = false,
}: Props) {
  const { colors, isDark } = useTheme();
  const [searchResults, setSearchResults] = useState<PlacePrediction[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const skipSearch = useRef(false);

  useEffect(() => {
    if (!visible) {
      setSearchResults([]);
      skipSearch.current = false;
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !searchText || searchText.length < 3 || skipSearch.current) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsSearching(true);
        const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
          searchText
        )}&key=${ENV.GOOGLE_MAPS_API_KEY}&components=country:us`;
        const res = await axios.get(url);
        setSearchResults(res.data?.predictions || []);
      } catch (e) {
        console.warn('[ZoneCanvasser] Places API error:', e);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchText, visible]);

  const resolveAndNavigate = async (resolve: () => Promise<MapCoordinate | null>) => {
    try {
      setIsResolving(true);
      Keyboard.dismiss();
      const coords = await resolve();
      if (coords) {
        setSearchResults([]);
        onLocationSelected(coords);
      } else {
        Alert.alert('Not found', 'Could not find that location. Try a different search.');
      }
    } catch (e) {
      console.warn('[ZoneCanvasser] Location resolve failed:', e);
    } finally {
      setIsResolving(false);
    }
  };

  const handleSearchPress = () => {
    if (!searchText.trim()) return;
    resolveAndNavigate(() => geocodeAddress(searchText.trim()));
  };

  const handleSelectPlace = (item: PlacePrediction) => {
    skipSearch.current = true;
    onChangeText(item.description);
    setSearchResults([]);
    resolveAndNavigate(() => geocodePlaceId(item.place_id));
  };

  if (!visible) return null;

  const busy = isProcessing || isResolving;

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} />

      <View
        style={[
          styles.panel,
          {
            backgroundColor: isDark ? colors.surface : '#FFFFFF',
            borderColor: isDark ? colors.border : '#E2E8F0',
          },
        ]}
      >
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center gap-2">
            <View className="w-9 h-9 rounded-lg bg-[#4CBB17] items-center justify-center">
              <Ionicons name="location" size={18} color="#FFFFFF" />
            </View>
            <Text className="text-base font-bold" style={{ color: colors.text }}>
              Search location
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View
          className="flex-row items-center rounded-xl border overflow-hidden h-[48px]"
          style={{
            borderColor: isDark ? colors.border : '#E2E8F0',
            backgroundColor: isDark ? colors.background : '#F8FAFC',
          }}
        >
          <TextInput
            className="flex-1 px-3 text-[14px]"
            style={{ color: colors.text }}
            placeholder="Enter city, address, or ZIP"
            placeholderTextColor={colors.textSecondary}
            value={searchText}
            onChangeText={(text) => {
              skipSearch.current = false;
              onChangeText(text);
            }}
            onSubmitEditing={handleSearchPress}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchText.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                skipSearch.current = false;
                onChangeText('');
                setSearchResults([]);
              }}
              className="px-2"
            >
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
          {isSearching && <ActivityIndicator size="small" color="#4CBB17" className="mr-2" />}
        </View>

        {searchResults.length > 0 && (
          <View
            style={[
              styles.results,
              {
                backgroundColor: isDark ? colors.background : '#FFFFFF',
                borderColor: isDark ? colors.border : '#E2E8F0',
              },
            ]}
          >
            <ScrollView
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 180 }}
            >
              {searchResults.map((item) => (
                <TouchableOpacity
                  key={item.place_id}
                  className="flex-row items-center px-3 py-3 border-b border-slate-100"
                  onPress={() => handleSelectPlace(item)}
                >
                  <Ionicons name="map-outline" size={16} color={colors.textSecondary} />
                  <Text
                    className="ml-2 flex-1 text-[13px]"
                    style={{ color: colors.text }}
                    numberOfLines={2}
                  >
                    {item.description}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <TouchableOpacity
          onPress={handleSearchPress}
          disabled={busy || !searchText.trim()}
          className="flex-row items-center justify-center gap-2 mt-3 py-3 rounded-lg"
          style={{
            backgroundColor: busy || !searchText.trim() ? '#94A3B8' : '#1E293B',
            opacity: busy || !searchText.trim() ? 0.7 : 1,
          }}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="search" size={18} color="#FFFFFF" />
          )}
          <Text className="text-white font-bold">Go to area</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 40,
    elevation: 40,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  panel: {
    marginHorizontal: 12,
    marginTop: 8,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  results: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
});
