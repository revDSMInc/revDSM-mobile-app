import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, ActivityIndicator } from 'react-native';
import { useAuth } from '../hooks/useAuth';
import LoginPage from '../screens/auth/login';
import LeadsPage from '../screens/Leads/index';
import ProfilePage from '../screens/Profile/index';
import JobTrackerPage from '../screens/JobTracker/index';
import LearningPage from '../screens/Learning/index';
import ChatThreadsScreen from '../screens/ChatThreads/index';
import ChatDetailScreen from '../screens/ChatDetail/index';

export type RootStackParamList = {
  Login: undefined;
  Leads: { openChatId?: string } | undefined;
  Profile: undefined;
  AppointmentDetails: { leadId: string };
  JobTracker: undefined;
  MyLearning: undefined;
  ChatThreads: undefined;
  ChatDetail: {
    leadId?: string;
    chatId: string;
    customerName: string;
    chatType?: 'lead' | 'channel';
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { isAuthenticated, loading, isInitialized } = useAuth();

  if (loading || !isInitialized) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!isAuthenticated ? (
        <Stack.Screen name="Login" component={LoginPage} />
      ) : (
        <>
          <Stack.Screen name="Leads" component={LeadsPage} />
          <Stack.Screen name="Profile" component={ProfilePage} />
          <Stack.Screen name="JobTracker" component={JobTrackerPage} />
          <Stack.Screen name="MyLearning" component={LearningPage} />
          <Stack.Screen name="ChatThreads" component={ChatThreadsScreen} />
          <Stack.Screen name="ChatDetail" component={ChatDetailScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}
