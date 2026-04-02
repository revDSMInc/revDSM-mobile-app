import React from 'react';
import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { Header } from '../../widgets/components/header/MainHeader';
import { useNavigation } from '@react-navigation/native';

export default function JobTrackerPage() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: colors.background }}>
      <Header onNavigate={(route) => navigation.navigate(route)} />
      <View className="flex-1 items-center justify-center">
        <Text className="text-4xl">🗂️</Text>
        <Text className="text-xl font-black mt-4" style={{ color: colors.text }}>Job Tracker</Text>
        <Text className="mt-2 opacity-50 font-bold" style={{ color: colors.textSecondary }}>Project management tools coming soon...</Text>
      </View>
    </SafeAreaView>
  );
}
