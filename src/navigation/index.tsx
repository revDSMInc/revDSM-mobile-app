import React, { useState } from 'react';
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
import MapDetailPage from '../screens/MapDetail';
import LeadCenterPage from '../screens/LeadCenter';
import PitchbookScreen from '../screens/Pitchbook';
import RooflineDeckScreen from '../screens/RooflineDeck';
import DealCenter from '../screens/DealCenter/index';
import ForgotPasswordScreen from '../screens/auth/forgot-password';
import EmailOTPScreen from '../screens/auth/email-otp';
import ResetPasswordScreen from '../screens/auth/reset-password';
import AuthenticatorOTPScreen from '../screens/auth/authenticator-otp';
import JobBuilderScreen from '../screens/JobBuilder/index';
import RevRenderScreen from '../screens/RevRender/index';
import ImageAnnotationScreen from '../screens/ImageAnnotation/index';

export type RootStackParamList = {
  Login: undefined;
  Leads: { openChatId?: string; reopenZoneCanvasser?: boolean } | undefined;
  LeadCenter: {
    lead: any;
    initialTool?: string;
    fromZoneCanvasser?: boolean;
    appointmentStarted?: boolean;
    tab?: string;
  };
  Profile: undefined;
  AppointmentDetails: { leadId: string };
  JobTracker: undefined;
  MyLearning: undefined;
  ChatThreads: undefined;
  ChatDetail: {
    leadId?: string;
    chatId: string;
    customerName: string;
    description?: string;
    chatType?: 'lead' | 'channel';
    initialParticipants?: any[];
    // Full lead photo array, handed straight from an already-loaded lead
    // (LeadCenter) so the Appointment Photos picker doesn't have to refetch.
    salesPhotos?: any[];
  };
  MapDetail: { currentLead?: any };
  Pitchbook: { lead: any };
  RooflineDeck: { lead: any };
  DealCenter: { lead: any };
  ForgotPassword: undefined;
  EmailOTP: { 
    email: string; 
    password?: string;
    companyId?: string;
    companyName?: string;
    lat?: number;
    long?: number;
  };
  ResetPassword: {
    email: string;
    companyId: string;
    companyName: string;
  };
  AuthenticatorOTP: { 
    email: string; 
    password?: string; 
    lat?: number; 
    long?: number 
  };

  JobBuilder: {
    initialJobState: any;
    calculatorData: any;
    leadId: string;
    outcomeForm: any;
    onGoBack?: (jobState: any) => void;
  };
  RevRender: {
    lead: any;
    sectionImages: { [key: string]: any[] };
    onNavToDocs: () => void;
    onGenerate: (payload: any) => Promise<string | null>;
    onGenerateAll?: (body: { payloads: any[]; leadId: string; jobId: string }) => void;
  };
  ImageAnnotation: {
    selectedPhotos: any[];
    lead: any;
    onSaveSuccess?: () => void;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

import { Header, HeaderContext } from '../widgets/common/MainHeader';
import { useTheme } from '../theme/ThemeProvider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createNavigationContainerRef } from '@react-navigation/native';
import { useEffect } from 'react';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export default function RootNavigator({ currentRouteName }: { currentRouteName: string | null }) {
  const { isAuthenticated, loading, isInitialized } = useAuth();
  const { colors, isDark } = useTheme();

  const [headerActions, setHeaderActions] = useState<{
    onFilterPress?: (() => void) | null;
    onListPress?: (() => void) | null;
    onNavigate?: ((route: any) => void) | null;
  }>({});

  const contextValue = React.useMemo(() => ({
    ...headerActions,
    setHeaderActions,
  }), [headerActions]);


  const showHeader = isAuthenticated && currentRouteName && [
    'Leads',
    'Profile',
    'JobTracker',
    'MyLearning',
    'LeadCenter',
    'DealCenter',
    'Pitchbook',
    'RooflineDeck',
    'MapDetail',
  ].includes(currentRouteName);

  if (loading || !isInitialized) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <HeaderContext.Provider value={contextValue}>
      <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? colors.background : '#101828' }} edges={showHeader ? ['top'] : []}>
        {showHeader && <Header />}
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <Stack.Navigator screenOptions={{ headerShown: false, screenOrientation: 'portrait' } as any}>
            {!isAuthenticated ? (
              <>
                <Stack.Screen name="Login" component={LoginPage} />
                <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
                <Stack.Screen name="EmailOTP" component={EmailOTPScreen} />
                <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
                <Stack.Screen name="AuthenticatorOTP" component={AuthenticatorOTPScreen} />
              </>
            ) : (
              <>
                <Stack.Screen name="Leads" component={LeadsPage} />
                <Stack.Screen name="Profile" component={ProfilePage} />
                <Stack.Screen name="JobTracker" component={JobTrackerPage} />
                <Stack.Screen name="MyLearning" component={LearningPage} />
                <Stack.Screen name="ChatThreads" component={ChatThreadsScreen} />
                <Stack.Screen name="ChatDetail" component={ChatDetailScreen} />
                <Stack.Screen name="MapDetail" component={MapDetailPage} />
                <Stack.Screen
                  name="LeadCenter"
                  component={LeadCenterPage}
                  options={{ gestureEnabled: true }}
                />
                <Stack.Screen name="Pitchbook" component={PitchbookScreen} />
                <Stack.Screen name="RooflineDeck" component={RooflineDeckScreen} />
                <Stack.Screen name="DealCenter" component={DealCenter} />
                <Stack.Screen name="JobBuilder" component={JobBuilderScreen} />
                <Stack.Screen name="RevRender" component={RevRenderScreen} />
                <Stack.Screen name="ImageAnnotation" component={ImageAnnotationScreen} options={{ gestureEnabled: false }} />
              </>
            )}
          </Stack.Navigator>
        </View>
      </SafeAreaView>
    </HeaderContext.Provider>
  );
}
