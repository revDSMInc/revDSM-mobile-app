import React, { forwardRef, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Keyboard,
  Alert,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { fetchPlacePredictions, resolvePlace, type PlacePrediction } from '../../../utils/places';
import type { MapCoordinate } from '../../../types/zone-canvasser';

/**
 * The zone map's address search — a port of web
 * src/components/zone-canvasser-search/zone-canvasser-search-{bar,popover}.js.
 *
 * Kept from web:
 *  - suggestions are Places Autocomplete restricted to `types: ['address']`;
 *  - a committed search pans the map (zoom 17) and drops a pin;
 *  - emptying the box, or the ✕, clears the committed search and removes the pin.
 *
 * ⚠️ Deliberate divergences:
 *  - PICKING a suggestion commits it immediately — the map moves the moment the rep taps
 *    the address. Web only fills the box and waits for the Search button; on a phone that
 *    reads as the tap doing nothing ("the map should move to the selected location").
 *    Search (button or keyboard submit) still re-centres on the picked place.
 *  - Editing the text after picking drops the picked place. Web keeps it, so Search would
 *    pan to a place the box no longer names.
 */

type Props = {
  /** Reset on close — the map modal stays mounted while hidden (web `closeZoneMap`). */
  visible: boolean;
  onSearch: (address: string, coords: MapCoordinate) => void;
  onClear: () => void;
};

type Pending = { address: string; latitude: number; longitude: number };

const GREEN = '#4CBB17';
const SEARCH_DEBOUNCE_MS = 400;

export const ZoneSearchBar = forwardRef<TextInput, Props>(function ZoneSearchBarField(
  { visible, onSearch, onClear },
  inputRef
) {
  const { colors, isDark } = useTheme();
  const [inputValue, setInputValue] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  // Set when the text was written by a pick, so it doesn't search itself again.
  const skipSearchRef = useRef(false);
  // Only the newest autocomplete response may land.
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (visible) return;
    setInputValue('');
    setPending(null);
    setPredictions([]);
    skipSearchRef.current = false;
  }, [visible]);

  useEffect(() => {
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }
    const query = inputValue.trim();
    if (query.length < 3) {
      setPredictions([]);
      return;
    }
    const requestId = ++requestIdRef.current;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      const results = await fetchPlacePredictions(query, { types: 'address' });
      if (requestId !== requestIdRef.current) return;
      setPredictions(results);
      setIsSearching(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      setIsSearching(false);
    };
  }, [inputValue]);

  const handleChangeText = (text: string) => {
    setInputValue(text);
    if (pending && text !== pending.address) setPending(null);
    if (!text) {
      setPending(null);
      setPredictions([]);
      onClear();
    }
  };

  const handlePick = async (item: PlacePrediction) => {
    requestIdRef.current += 1; // drop any autocomplete still in flight
    setIsSearching(false);
    setPredictions([]);
    setIsResolving(true);
    const place = await resolvePlace(item.placeId);
    setIsResolving(false);
    // Web's place_changed ignores a place without geometry + a formatted address. Say so
    // rather than leaving a tap that silently did nothing.
    if (!place?.formattedAddress) {
      Alert.alert('Location not found', 'Could not find that address. Try another suggestion.');
      return;
    }
    // Only arm the skip when the text actually changes — if it doesn't, the search effect
    // never runs to consume it, and the rep's next keystroke would be ignored.
    if (place.formattedAddress !== inputValue) skipSearchRef.current = true;
    setInputValue(place.formattedAddress);
    setPending({
      address: place.formattedAddress,
      latitude: place.latitude,
      longitude: place.longitude,
    });
    Keyboard.dismiss();
    onSearch(place.formattedAddress, { latitude: place.latitude, longitude: place.longitude });
  };

  const handleSearch = () => {
    if (!pending) return;
    Keyboard.dismiss();
    setPredictions([]);
    onSearch(pending.address, { latitude: pending.latitude, longitude: pending.longitude });
  };

  const handleClear = () => {
    requestIdRef.current += 1;
    setIsSearching(false);
    setInputValue('');
    setPending(null);
    setPredictions([]);
    onClear();
  };

  const surface = isDark ? colors.surface : '#FFFFFF';
  const border = isDark ? colors.border : '#E2E8F0';

  return (
    <View style={{ flex: 1 }}>
      <View
        className="flex-row items-center overflow-hidden"
        style={{
          height: 44,
          borderRadius: 10,
          backgroundColor: surface,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 6,
          elevation: 4,
        }}
      >
        <View className="h-full items-center justify-center px-2.5" style={{ backgroundColor: GREEN }}>
          <MaterialCommunityIcons name="map-marker-outline" size={18} color="#FFFFFF" />
        </View>

        <TextInput
          ref={inputRef}
          value={inputValue}
          onChangeText={handleChangeText}
          onSubmitEditing={handleSearch}
          placeholder="Enter a location"
          placeholderTextColor={colors.textSecondary}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          className="flex-1 px-2 text-[14px]"
          style={{ color: colors.text, height: '100%' }}
        />

        {isSearching || isResolving ? (
          <ActivityIndicator size="small" color={GREEN} style={{ marginRight: 6 }} />
        ) : inputValue ? (
          <TouchableOpacity onPress={handleClear} className="px-1.5" hitSlop={8}>
            <MaterialCommunityIcons name="close" size={16} color="#9ea392" />
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          onPress={handleSearch}
          disabled={!pending}
          accessibilityLabel="Search"
          className="h-full items-center justify-center px-3"
          style={{ backgroundColor: GREEN, opacity: pending ? 1 : 0.6 }}
        >
          <MaterialCommunityIcons name="magnify" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {predictions.length > 0 && (
        <View
          className="mt-1.5 overflow-hidden"
          style={{
            borderRadius: 10,
            borderWidth: 1,
            borderColor: border,
            backgroundColor: surface,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.12,
            shadowRadius: 8,
            elevation: 6,
          }}
        >
          <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={{ maxHeight: 220 }}>
            {predictions.map((item, index) => (
              <TouchableOpacity
                key={item.placeId}
                onPress={() => handlePick(item)}
                className="flex-row items-center px-3 py-3"
                style={{
                  borderBottomWidth: index === predictions.length - 1 ? 0 : 1,
                  borderBottomColor: border,
                }}
              >
                <MaterialCommunityIcons name="map-marker-outline" size={16} color={colors.textSecondary} />
                <Text className="ml-2 flex-1 text-[13px]" style={{ color: colors.text }} numberOfLines={2}>
                  {item.description}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
});
