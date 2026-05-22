import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { fetchPropertyDetails } from '../../../services/api/zone-canvasser';
import { OverlayModal } from './OverlayModal';
import { DetailItem } from './DetailItem';

type Props = {
  visible: boolean;
  building: any;
  onContinue: (data: any) => void;
  onCancel: () => void;
};

export function PropertyDetailModal({ visible, building, onContinue, onCancel }: Props) {
  const [propertyData, setPropertyData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && building) loadProperty();
    if (!visible) {
      setPropertyData(null);
      setError(null);
    }
  }, [visible, building?.id]);

  const loadProperty = async () => {
    if (!building?.position) return;
    const [lat, lng] = building.position;
    if (!lat || !lng) {
      setError('Invalid building coordinates');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPropertyDetails(lat, lng);
      setPropertyData(data);
      if (data?.propertyLookupUnavailable) {
        setError(data.error || 'Property data lookup is only available for US addresses');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch property details');
    } finally {
      setLoading(false);
    }
  };

  const ownerName = propertyData?.owner?.names?.[0] || 'Unknown Owner';
  const formattedAddress = propertyData?.formattedAddress || building?.label || 'N/A';

  const homeValue = (() => {
    const assessments = propertyData?.taxAssessments;
    if (assessments) {
      const years = Object.keys(assessments).sort((a, b) => Number(b) - Number(a));
      const value = assessments[years[0]]?.value;
      return value ? `$${value.toLocaleString()}` : 'N/A';
    }
    return propertyData?.lastSalePrice ? `$${propertyData.lastSalePrice.toLocaleString()}` : 'N/A';
  })();

  return (
    <OverlayModal visible={visible} onRequestClose={onCancel}>
      <View className="w-[90%] max-h-[85%] rounded-xl overflow-hidden bg-neutral-100">
        {loading ? (
          <View className="min-h-[400px] justify-center items-center">
            <ActivityIndicator size="large" color="#4CBB17" />
          </View>
        ) : (
          <>
            <View className="bg-white p-5 pt-4 rounded-t-xl relative">
              <TouchableOpacity onPress={onCancel} className="absolute right-4 top-4 z-10">
                <MaterialCommunityIcons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
              <View className="flex-row items-center gap-3">
                <View className="w-14 h-14 rounded-full bg-[#4caf50] items-center justify-center">
                  <MaterialCommunityIcons name="home" size={32} color="#FFFFFF" />
                </View>
                <View className="flex-1 pr-8">
                  <Text className="text-xl font-semibold text-slate-800">{ownerName}</Text>
                  <Text className="text-sm text-slate-400 mt-1">{formattedAddress}</Text>
                </View>
              </View>
            </View>

            <ScrollView className="p-5 max-h-80">
              {error ? (
                <View className="py-4 items-center">
                  <Text className="text-red-500 font-semibold text-center">{error}</Text>
                  <Text className="text-slate-400 text-center mt-2 text-sm">
                    You can still continue to submit a result
                  </Text>
                </View>
              ) : (
                <View className="flex-row flex-wrap gap-3">
                  <DetailItem
                    label="Length Of Residence"
                    value={
                      propertyData?.lastSaleDate
                        ? `${new Date().getFullYear() - new Date(propertyData.lastSaleDate).getFullYear()} years`
                        : 'N/A'
                    }
                  />
                  <DetailItem label="Year Home Built" value={String(propertyData?.yearBuilt || 'N/A')} />
                  <DetailItem
                    label="Square Footage"
                    value={
                      propertyData?.squareFootage
                        ? `${propertyData.squareFootage.toLocaleString()} sq ft`
                        : 'N/A'
                    }
                  />
                  <DetailItem
                    label="Household Income"
                    value={
                      propertyData?.householdIncome
                        ? `$${propertyData.householdIncome.toLocaleString()}`
                        : 'N/A'
                    }
                  />
                  <DetailItem
                    label="Home Owner Renter"
                    value={
                      propertyData?.ownerOccupied !== undefined
                        ? propertyData.ownerOccupied
                          ? 'Owner Occupied'
                          : 'Renter'
                        : 'N/A'
                    }
                  />
                  <DetailItem label="Home Value" value={homeValue} />
                  <DetailItem
                    label="Home Sale Date"
                    fullWidth
                    value={
                      propertyData?.lastSaleDate
                        ? new Date(propertyData.lastSaleDate).toLocaleDateString('en-US', {
                            month: '2-digit',
                            day: '2-digit',
                            year: 'numeric',
                          })
                        : 'N/A'
                    }
                  />
                </View>
              )}
            </ScrollView>

            <View className="flex-row justify-end gap-3 p-5 bg-neutral-100">
              <TouchableOpacity onPress={onCancel} className="px-6 py-3 rounded-lg bg-red-500">
                <Text className="text-white font-bold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onContinue(propertyData || { formattedAddress })}
                className="px-6 py-3 rounded-lg bg-slate-800"
              >
                <Text className="text-white font-bold">Continue</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </OverlayModal>
  );
}
