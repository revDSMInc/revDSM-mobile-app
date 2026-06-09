#import <UIKit/UIKit.h>
#import <objc/runtime.h>

@interface UIView (KeyboardToolbarHelper)
- (UIToolbar *)makeCustomKeyboardToolbar;
@end

@implementation UITextView (DoneButton)

+ (void)load {
  // UITextView always benefits from a Done button
  // (no Return key by default in RN multiline)
  Method orig = class_getInstanceMethod(self, @selector(becomeFirstResponder));
  Method swiz =
      class_getInstanceMethod(self, @selector(tv_becomeFirstResponder));
  method_exchangeImplementations(orig, swiz);
}

- (BOOL)tv_becomeFirstResponder {
  if (!self.inputAccessoryView) {
    self.inputAccessoryView = [self makeCustomKeyboardToolbar];
  }
  return [self tv_becomeFirstResponder];
}

@end
