import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from './useAuth';

/**
 * Higher Order Component to protect screens with Auth
 */
export function withAuth<P extends object>(Component: React.ComponentType<P>) {
  return function AuthenticatedComponent(props: P) {
    const { isAuthenticated, loading, isInitialized } = useAuth();

    if (loading || !isInitialized) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" />
        </View>
      );
    }

    if (!isAuthenticated) {
      // Typically handled by RootNavigator, but HOC provides another layer
      return null;
    }

    return <Component {...props} />;
  };
}
