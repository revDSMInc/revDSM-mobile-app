import React, { useCallback, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, ActivityIndicator } from 'react-native';
import { useAuth } from '../hooks/useAuth';
import LoginPage from '../screens/auth/login';
import LeadsPage from '../screens/Leads/index';
import ProfilePage from '../screens/Profile/index';
import JobTrackerPage from '../screens/JobTracker/index';
import MyDealsPage from '../screens/MyDeals/index';
import DealDetailPage from '../screens/DealDetail/index';
import AppointmentsPage from '../screens/Appointments/index';
import LearningPage from '../screens/Learning/index';
import ChatThreadsScreen from '../screens/ChatThreads/index';
import ChatDetailScreen from '../screens/ChatDetail/index';
import NotificationsScreen from '../screens/Notifications';
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
import DynamicDealCenterScreen from '../screens/DynamicDealCenter/components/DynamicDealCenterScreen';
import InstallerDashboard from '../screens/Installer/index';
import InstallerJobDetail from '../screens/Installer/JobDetail';
import InvestmentCenterScreen from '../screens/InvestmentCenter';

export type RootStackParamList = {
  Login: undefined;
  Leads: { openChatId?: string; reopenZoneCanvasser?: boolean } | undefined;
  LeadCenter: {
    lead: any;
    initialTool?: string;
    fromZoneCanvasser?: boolean;
    appointmentStarted?: boolean;
    tab?: string;
    // Opened from My Deals: the screen is identical to the sold-lead Lead Center,
    // except the header reads "Deal" and the Contract Details pencil keeps the My
    // Deals edit flow (the 4-step dynamic deal-edit wizard) instead of the inline
    // Edit Contract Details modal.
    fromMyDeals?: boolean;
  };
  Profile: undefined;
  AppointmentDetails: { leadId: string };
  Appointments: undefined;
  JobTracker: undefined;
  MyLearning: undefined;
  ChatThreads: undefined;
  Notifications: undefined;
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
    // Lead preview thumbnail source, handed from the already-loaded lead so the
    // chat header shows the same street-view image as the Recent-Leads row (web
    // parity: `quick-chat-dialog.js`).
    previewImage?: any;
    previewImages?: any;
  };
  MapDetail: { currentLead?: any };
  // `bookId` selects a PORTAL-AUTHORED pitch book (Lead Center card → book list);
  // omit it for the bundled deck. `bookName` is only a title placeholder shown
  // while the book is still loading — the fetched name wins once it lands.
  Pitchbook: { lead: any; bookId?: string; bookName?: string };
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
  DynamicDealCenter: {
    lead?: any;
    initialVerticalId?: string;
    // 'edit' opens a saved deal straight in the dynamic job builder (My Deals /
    // LeadCenter Products → Edit). `calculatorResultData` carries the calculatorId.
    mode?: 'new' | 'edit';
    calculatorResultData?: any;
    // Opt-in handoff from the Investment Center → open Result Lead (Sale).
    resultOptIn?: { calculatorId?: string; price?: number; paymentMethod?: string; downPayment?: number };
    /**
     * Open straight on the dynamic Job Builder (its Summary step), skipping the
     * calculator and rollout steps. Set by the `agreement-signed` notification:
     * the customer has signed, so the rep's next action is Complete Job.
     *
     * ⚠️ Honoured only once the calculators and config have loaded — the builder
     * mounted early would render an empty summary. See the effect in
     * `DynamicDealCenterScreen`.
     */
    openJobBuilder?: boolean;
  };
  MyDeals: undefined;
  // Deal Detail — opened from My Deals; hosts the contract summary + the Edit
  // pencil that launches the 4-step dynamic edit wizard (DynamicDealCenter edit).
  DealDetail: { lead?: any; leadId?: string };
  // Installer role — landing screen + per-job install timeline. Gated on the
  // `installer_dashboard` dashboard permission (see useUserRole).
  InstallerDashboard: undefined;
  // `checkedIn` is set only when the dashboard opened a work session for this job —
  // it is what tells the detail screen to check out again on the way back.
  InstallerJobDetail: { job: any; checkedIn?: boolean };
  // Investment Center — the in-home presentation step opened from Lead Center tools.
  // Consent-gated; shows per-calculator renders + dynamic job scope + program cards.
  InvestmentCenter: { lead?: any };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

import { Header, HeaderContext } from '../widgets/common/MainHeader';
import { useUserRole } from '../hooks/useUserRole';
import { useTheme } from '../theme/ThemeProvider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export default function RootNavigator({ currentRouteName }: { currentRouteName: string | null }) {
  const { isAuthenticated, loading, isInitialized } = useAuth();
  const { isInstaller, isSales } = useUserRole();
  const { colors, isDark } = useTheme();

  const [headerActions, setHeaderActionsState] = useState<{
    onFilterPress?: (() => void) | null;
    onListPress?: (() => void) | null;
    onNavigate?: ((route: any) => void) | null;
    filterCount?: number | null;
  }>({});

  /**
   * MERGES, and that is the whole point — it used to hand the raw `useState` setter out,
   * which REPLACED the object.
   *
   * Every screen registers its own keys on focus and nulls them on blur, but the two
   * effects belong to DIFFERENT screens and React Navigation does not promise which runs
   * first. Leaving Lead Center for the map, a whole-object replace meant Lead Center's
   * blur cleanup (`{ onNavigate: null }`) landing after Map Detail's focus setup wiped
   * `onFilterPress` / `onListPress` with it — so the map opened with no filter or list
   * icon in the header, and only got them back once something re-focused the screen
   * (tapping the bell or the chat icon navigates away and back, which is exactly the
   * "click an icon and they appear" in the report). The ordering is not deterministic,
   * which is why it was intermittent.
   *
   * Merging makes each screen's cleanup touch only the keys it owns, so no screen can
   * clear another's. An explicit `null` still clears, so nothing about the blur contract
   * changes.
   *
   * ⚠️ It must stay referentially STABLE (`useCallback` with no deps): both consumers
   * list it in a `useFocusEffect` dependency array, so a new identity per render would
   * re-run those effects on every render of this navigator.
   */
  const setHeaderActions = useCallback(
    (actions: {
      onFilterPress?: (() => void) | null;
      onListPress?: (() => void) | null;
      onNavigate?: ((route: any) => void) | null;
      filterCount?: number | null;
    }) => setHeaderActionsState((prev) => ({ ...prev, ...actions })),
    []
  );

  const contextValue = React.useMemo(() => ({
    ...headerActions,
    setHeaderActions,
  }), [headerActions, setHeaderActions]);


  const showHeader = isAuthenticated && currentRouteName && [
    'Leads',
    'Profile',
    'JobTracker',
    'MyLearning',
    'MyDeals',
    'LeadCenter',
    'DealCenter',
    'DynamicDealCenter',
    'Pitchbook',
    'RooflineDeck',
    'MapDetail',
    'InstallerDashboard',
    'InstallerJobDetail',
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
      <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? colors.background : '#0E2A1C' }} edges={showHeader ? ['top'] : []}>
        {showHeader && <Header />}
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <Stack.Navigator screenOptions={{ headerShown: false, screenOrientation: 'portrait' } as any}>
            {/* Sign-in is gated on `permissions.DASHBOARD` (see
                `utils/auth/dashboard-access.ts`), so an authenticated user is always
                exactly one of installer / sales. The auth set is therefore also the
                fallback for `!isSales`: an account that somehow reaches this point with
                neither permission gets the login screen, never the sales app. */}
            {!isAuthenticated || (!isInstaller && !isSales) ? (
              <>
                <Stack.Screen name="Login" component={LoginPage} />
                <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
                <Stack.Screen name="EmailOTP" component={EmailOTPScreen} />
                <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
                <Stack.Screen name="AuthenticatorOTP" component={AuthenticatorOTPScreen} />
              </>
            ) : isInstaller ? (
              // Installers get a dedicated screen set. Their permissions carry no
              // leads/deal access, so the sales screens are not registered at all
              // rather than merely hidden — and InstallerDashboard being first makes
              // it the landing route without needing an explicit initialRouteName.
              <>
                <Stack.Screen name="InstallerDashboard" component={InstallerDashboard} />
                <Stack.Screen
                  name="InstallerJobDetail"
                  component={InstallerJobDetail}
                  options={{ gestureEnabled: true }}
                />
                <Stack.Screen name="Profile" component={ProfilePage} />
                <Stack.Screen name="MyLearning" component={LearningPage} />
                <Stack.Screen name="ChatThreads" component={ChatThreadsScreen} />
                <Stack.Screen name="ChatDetail" component={ChatDetailScreen} />
                {/* Installers are chat participants, so they receive the four chat
                    push types. Registering the screen here as well is what stops a
                    tapped notification from throwing on an unknown route. */}
                <Stack.Screen name="Notifications" component={NotificationsScreen} />
              </>
            ) : (
              <>
                <Stack.Screen name="Leads" component={LeadsPage} />
                <Stack.Screen name="Profile" component={ProfilePage} />
                <Stack.Screen name="JobTracker" component={JobTrackerPage} />
                <Stack.Screen name="MyDeals" component={MyDealsPage} />
                <Stack.Screen name="DealDetail" component={DealDetailPage} />
                <Stack.Screen name="Appointments" component={AppointmentsPage} />
                <Stack.Screen name="MyLearning" component={LearningPage} />
                <Stack.Screen name="ChatThreads" component={ChatThreadsScreen} />
                <Stack.Screen name="ChatDetail" component={ChatDetailScreen} />
                <Stack.Screen name="Notifications" component={NotificationsScreen} />
                <Stack.Screen name="MapDetail" component={MapDetailPage} />
                <Stack.Screen
                  name="LeadCenter"
                  component={LeadCenterPage}
                  options={{ gestureEnabled: true }}
                />
                <Stack.Screen name="Pitchbook" component={PitchbookScreen} />
                <Stack.Screen name="RooflineDeck" component={RooflineDeckScreen} />
                <Stack.Screen name="DealCenter" component={DealCenter} />
                <Stack.Screen name="DynamicDealCenter" component={DynamicDealCenterScreen} />
                <Stack.Screen name="InvestmentCenter" component={InvestmentCenterScreen} />
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
