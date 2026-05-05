import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { ENV } from '../../../config/env';
import { useUploadReportMutation } from '../../../hooks/useLeadMutation';

interface RiskReportModalProps {
  visible: boolean;
  onClose: () => void;
  lead: any;
}

export const RiskReportModal = ({ visible, onClose, lead }: RiskReportModalProps) => {
  const { colors } = useTheme();
  const [loadingStep, setLoadingStep] = useState<number>(0);
  const [logs, setLogs] = useState<string[]>([]);
  const uploadReport = useUploadReportMutation();

  const addLog = (msg: string) => setLogs((prev) => [...prev, msg]);

  const generateReport = async () => {
    setLogs([]);
    try {
      const lat = lead?.customerDetails?.lat || lead?.location?.lat;
      const lng = lead?.customerDetails?.lng || lead?.location?.lng;
      const address = lead?.fullAddress || lead?.address;

      if (!lat || !lng || !address) {
        Alert.alert('Missing Location', 'This lead does not have complete location data.');
        return;
      }

      // Step 1: Elevation
      setLoadingStep(1);
      addLog(`Fetching elevation data for coordinates...`);
      const elevationRes = await fetch(
        `https://maps.googleapis.com/maps/api/elevation/json?locations=${lat},${lng}&key=${ENV.GOOGLE_MAPS_API_KEY}`
      );
      const elevationData = await elevationRes.json();
      const elevationMeters = elevationData?.results?.[0]?.elevation || 0;
      const elevationFeet = (elevationMeters * 3.28084).toFixed(2);
      addLog(`✅ Saved Elevation: ${elevationFeet} ft`);

      // Step 2: Weather
      setLoadingStep(2);
      addLog(`Gathering weather forecast...`);
      const weatherRes = await fetch(
        `https://api.weatherapi.com/v1/forecast.json?key=${ENV.WEATHER_API_KEY}&q=${lat},${lng}&days=2`
      );
      const weatherData = await weatherRes.json();
      addLog(`✅ Saved Weather: ${weatherData?.current?.condition?.text || 'Clear'}`);

      // Step 3: Zillow Property Details
      setLoadingStep(3);
      addLog(`Scraping property details from Zillow via Apify...`);
      const apifyRes = await fetch(
        `https://api.apify.com/v2/acts/sorower~zillow-scrape-address-url-zpid/run-sync-get-dataset-items?token=${ENV.APIFY_API_TOKEN}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ multiple_input_box: address, scrape_type: 'property_addresses' }),
        }
      );
      const zillowData = await apifyRes.json();
      addLog(`✅ Saved Property: ${zillowData?.[0]?.homeStatus || 'Unknown'} status`);

      // Step 4: HTML String generation (Mobile limitation fallback)
      setLoadingStep(4);
      addLog('Compiling report payload...');

      const reportPayload = JSON.stringify({
        elevation: elevationFeet,
        condition: weatherData?.current?.condition?.text,
        property: zillowData?.[0],
      });

      // Submit
      setLoadingStep(5);
      addLog('Submitting report to backend...');

      // Note: Since react-native-html-to-pdf is deliberately excluded for stability,
      // we format the form data as required: 'reportType', 'file' or raw json
      const formData = new FormData();
      formData.append('leadId', lead?._id || lead?.id);
      formData.append('reportType', 'risk_report');
      formData.append('fileName', `Risk-Report-${Date.now()}.pdf`);

      // Sending JSON metadata - the backend will create the physical PDF.
      formData.append('payload', reportPayload);

      await uploadReport.mutateAsync(formData);

      addLog(`🎉 Complete! Your report is now available in Job Docs.`);
      setTimeout(() => {
        setLoadingStep(0);
        onClose();
      }, 3000);
    } catch (e: any) {
      addLog(`❌ Error: ${e.message}`);
      Alert.alert('Generation Failed', e.message);
      setLoadingStep(0);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View className="flex-1 justify-center px-4 bg-black/60">
        <View className="bg-white rounded-2xl overflow-hidden shadow-2xl">
          {/* Header */}
          <View
            className="flex-row items-center justify-between p-4 mb-4"
            style={{ backgroundColor: colors.primary.main }}
          >
            <Text className="text-white text-sm font-semibold">Generate Risk Report</Text>
            {loadingStep === 0 && (
              <TouchableOpacity onPress={onClose}>
                <Icon name="close" size={20} color="#ffffff" />
              </TouchableOpacity>
            )}
          </View>

          <View className="px-6 py-4 pb-8">
            <Text className="text-[#1C252E] font-semibold text-lg text-center mb-2">
              Property Risk Analysis
            </Text>
            <Text className="text-[#637381] text-sm text-center mb-8 px-2">
              This will fetch live elevation, property details, and weather history for{' '}
              {lead?.fullAddress}
            </Text>

            {/* Stepper logs */}
            {loadingStep > 0 && (
              <View className="bg-[#919EAB14] rounded-xl p-4 min-h-[140px] mb-6">
                <ScrollView>
                  {logs.map((log, index) => (
                    <Text key={index} className="text-xs text-[#1C252E] mb-2">
                      {log}
                    </Text>
                  ))}
                  {loadingStep > 0 && loadingStep < 6 && (
                    <ActivityIndicator
                      size="small"
                      color={colors.primary.main}
                      className="mt-2 text-left items-start self-start"
                    />
                  )}
                </ScrollView>
              </View>
            )}

            {loadingStep === 0 && (
              <TouchableOpacity
                onPress={generateReport}
                className="w-full py-4 rounded-xl flex-row items-center justify-center gap-2"
                style={{ backgroundColor: colors.primary.main }}
              >
                <Icon name="file-chart" size={20} color="white" />
                <Text className="text-white font-bold text-[15px]">Run Risk Engine</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
};
