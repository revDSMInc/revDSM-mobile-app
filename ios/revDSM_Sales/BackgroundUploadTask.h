#import <React/RCTBridgeModule.h>

/// Asks iOS for extra running time when the app leaves the screen, so a queued upload can finish
/// instead of being frozen mid-request. See `src/services/background/nativeBackgroundTask.ts`.
@interface BackgroundUploadTask : NSObject <RCTBridgeModule>
@end
