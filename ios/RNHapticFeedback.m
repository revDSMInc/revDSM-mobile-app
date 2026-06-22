#import "RNHapticFeedback.h"
#import <UIKit/UIKit.h>

@implementation RNHapticFeedback {
  UINotificationFeedbackGenerator *_notificationGenerator;
  UIImpactFeedbackGenerator *_impactGenerator;
}

RCT_EXPORT_MODULE(HapticFeedback);

- (dispatch_queue_t)methodQueue {
  return dispatch_get_main_queue();
}

RCT_EXPORT_METHOD(prepare:(NSString *)type) {
  if ([type isEqualToString:@"notification"]) {
    if (!_notificationGenerator) {
      _notificationGenerator = [[UINotificationFeedbackGenerator alloc] init];
    }
    [_notificationGenerator prepare];
  } else if ([type isEqualToString:@"impact"]) {
    if (!_impactGenerator) {
      _impactGenerator = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleLight];
    }
    [_impactGenerator prepare];
  }
}

RCT_EXPORT_METHOD(trigger:(NSString *)type) {
  if ([type isEqualToString:@"success"]) {
    if (!_notificationGenerator) {
      _notificationGenerator = [[UINotificationFeedbackGenerator alloc] init];
    }
    [_notificationGenerator notificationOccurred:UINotificationFeedbackTypeSuccess];
  } else if ([type isEqualToString:@"error"]) {
    if (!_notificationGenerator) {
      _notificationGenerator = [[UINotificationFeedbackGenerator alloc] init];
    }
    [_notificationGenerator notificationOccurred:UINotificationFeedbackTypeError];
  } else if ([type isEqualToString:@"light"] || [type isEqualToString:@"threshold"]) {
    if (!_impactGenerator) {
      _impactGenerator = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleLight];
    }
    [_impactGenerator impactOccurred];
  }
}

@end
