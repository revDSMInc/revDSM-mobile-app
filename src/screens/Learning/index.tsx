import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { Header } from '../../widgets/components/headers/MainHeader';
import { useNavigation } from '@react-navigation/native';

export default function LearningPage() {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <Header onNavigate={(route) => navigation.navigate(route)} />
      <View className="flex-1 items-center justify-center -mt-20">
        <Text className="text-[60px] opacity-40">📚</Text>
        <Text
          className="text-xl font-black uppercase tracking-widest mt-6"
          style={{ color: colors.text }}
        >
          My Learning
        </Text>
        <Text
          className="mt-2 opacity-50 font-black uppercase text-[10px] tracking-widest"
          style={{ color: colors.textSecondary }}
        >
          Training materials and courses coming soon...
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
