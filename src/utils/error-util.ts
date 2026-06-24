/**
 * Parses API and Network errors into user-friendly localized messages.
 * Specifically checks for HTTP status codes (404, 500, 502) and connection/network disruptions.
 */
export const parseApiError = (error: any): string => {
  if (error?.response) {
    const status = error.response.status;
    const data = error.response.data;

    if (status === 404) {
      return 'The requested resource could not be found on the server (404).';
    }
    if (status === 500) {
      return 'Internal Server Error (500). Please try again later.';
    }
    if (status === 502) {
      return 'Bad Gateway (502). The server is temporarily down.';
    }
    if (status >= 500) {
      return `Server Error (${status}). Please contact support if this persists.`;
    }
    return data?.message || data?.error || `Request failed with status code ${status}`;
  }

  // Handle network disruptions or offline status
  const errorMsg = error?.message || '';
  const errorCode = error?.code || '';
  if (
    errorCode === 'ERR_NETWORK' ||
    errorMsg.toLowerCase().includes('network error') ||
    errorMsg.toLowerCase().includes('connection') ||
    !error?.response
  ) {
    return 'Network Error: A connection disruption occurred. Please check your internet connectivity.';
  }

  return errorMsg || 'An unknown error occurred.';
};
