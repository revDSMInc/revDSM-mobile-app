#import "BackgroundUploadTask.h"
#import <UIKit/UIKit.h>

/// iOS does not allow a persistent background service. What it does allow is a FINITE grace period
/// (about 30 s) after the app is backgrounded, requested with `beginBackgroundTask`. This module
/// exposes exactly that and nothing more: begin, end, and how much of the budget is left.
///
/// WARNING The expiration handler MUST end the task. If it returns without calling
/// `endBackgroundTask:`, iOS terminates the app — so the handler ends it natively and never
/// depends on JavaScript being alive to do so (by the time it fires, JS is usually frozen).
///
/// WARNING Everything runs on the main queue: `UIApplication` is main-thread only, and a single
/// serial queue also makes begin/end race-free without a lock.
@implementation BackgroundUploadTask {
  UIBackgroundTaskIdentifier _taskId;
}

RCT_EXPORT_MODULE(BackgroundUploadTask);

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (dispatch_queue_t)methodQueue {
  return dispatch_get_main_queue();
}

- (instancetype)init {
  if ((self = [super init])) {
    _taskId = UIBackgroundTaskInvalid;
  }
  return self;
}

/// Starts a grace period. Idempotent: a second call while one is open resolves `true` without
/// opening another, so overlapping backgrounding events cannot leak a task id (a leaked task is
/// never ended, and ends in the OS killing the app when it expires).
RCT_EXPORT_METHOD(begin:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (_taskId != UIBackgroundTaskInvalid) {
    resolve(@(YES));
    return;
  }
  __weak BackgroundUploadTask *weakSelf = self;
  _taskId = [[UIApplication sharedApplication]
      beginBackgroundTaskWithName:@"revdsm-queued-upload"
                expirationHandler:^{
                  [weakSelf endNow];
                }];
  // `UIBackgroundTaskInvalid` here means iOS refused (e.g. the app is already being suspended).
  resolve(@(_taskId != UIBackgroundTaskInvalid));
}

RCT_EXPORT_METHOD(end:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [self endNow];
  resolve(nil);
}

/// Seconds of grace left. While the app is in the foreground iOS reports DBL_MAX, which is capped
/// so it crosses the bridge as an ordinary number.
RCT_EXPORT_METHOD(remainingSeconds:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSTimeInterval remaining = [UIApplication sharedApplication].backgroundTimeRemaining;
  resolve(@(MIN(remaining, 1000000.0)));
}

- (void)endNow {
  if (_taskId == UIBackgroundTaskInvalid) {
    return;
  }
  UIBackgroundTaskIdentifier id = _taskId;
  _taskId = UIBackgroundTaskInvalid;
  [[UIApplication sharedApplication] endBackgroundTask:id];
}

@end
