#import <UIKit/UIKit.h>
#import <objc/runtime.h>

@interface UIView (KeyboardToolbarHelper)
- (UIToolbar *)makeCustomKeyboardToolbar;
@end

@implementation UIView (KeyboardToolbarHelper)

- (void)keyboardToolbarDoneTapped {
  [self resignFirstResponder];
}

- (void)keyboardToolbarUpTapped {
  NSArray *inputFields = [self sortedInputFields];
  NSInteger index = [inputFields indexOfObject:self];
  if (index > 0 && index != NSNotFound) {
    [[inputFields objectAtIndex:index - 1] becomeFirstResponder];
  }
}

- (void)keyboardToolbarDownTapped {
  NSArray *inputFields = [self sortedInputFields];
  NSInteger index = [inputFields indexOfObject:self];
  if (index != NSNotFound && index < (NSInteger)inputFields.count - 1) {
    [[inputFields objectAtIndex:index + 1] becomeFirstResponder];
  }
}

- (NSArray<UIView *> *)sortedInputFields {
  UIWindow *window = self.window;
  if (!window) {
    UIView *temp = self;
    while (temp.superview) {
      temp = temp.superview;
    }
    window = (UIWindow *)temp;
  }
  
  NSMutableArray *fields = [NSMutableArray array];
  [self findInputFieldsInView:window results:fields];
  
  [fields sortUsingComparator:^NSComparisonResult(UIView *view1, UIView *view2) {
    CGRect frame1 = [view1 convertRect:view1.bounds toView:nil];
    CGRect frame2 = [view2 convertRect:view2.bounds toView:nil];
    if (frame1.origin.y < frame2.origin.y) return NSOrderedAscending;
    if (frame1.origin.y > frame2.origin.y) return NSOrderedDescending;
    if (frame1.origin.x < frame2.origin.x) return NSOrderedAscending;
    if (frame1.origin.x > frame2.origin.x) return NSOrderedDescending;
    return NSOrderedSame;
  }];
  
  return fields;
}

- (void)findInputFieldsInView:(UIView *)view results:(NSMutableArray *)results {
  if (view.isHidden || view.alpha < 0.01) return;
  
  if ([view isKindOfClass:[UITextField class]]) {
    UITextField *textField = (UITextField *)view;
    if (textField.isUserInteractionEnabled && textField.isEnabled) {
      [results addObject:view];
    }
  } else if ([view isKindOfClass:[UITextView class]]) {
    UITextView *textView = (UITextView *)view;
    if (textView.isUserInteractionEnabled && textView.isEditable) {
      [results addObject:view];
    }
  }
  
  for (UIView *subview in view.subviews) {
    [self findInputFieldsInView:subview results:results];
  }
}

- (UIToolbar *)makeCustomKeyboardToolbar {
  CGFloat screenWidth = [UIScreen mainScreen].bounds.size.width;
  UIToolbar *toolbar = [[UIToolbar alloc] initWithFrame:CGRectMake(0, 0, screenWidth, 44)];
  toolbar.translucent = YES;
  
  // Clean transparent background for actual toolbar to let UIVisualEffectView render nicely
  [toolbar setBackgroundImage:[[UIImage alloc] init] forToolbarPosition:UIBarPositionAny barMetrics:UIBarMetricsDefault];
  [toolbar setShadowImage:[[UIImage alloc] init] forToolbarPosition:UIBarPositionAny];
  
  // Proper blur (glass effect)
  UIBlurEffect *blurEffect = [UIBlurEffect effectWithStyle:UIBlurEffectStyleSystemThinMaterial];
  UIVisualEffectView *blurView = [[UIVisualEffectView alloc] initWithEffect:blurEffect];
  blurView.frame = toolbar.bounds;
  blurView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  [toolbar insertSubview:blurView atIndex:0];
  
  // Top border line
  UIView *topLine = [[UIView alloc] initWithFrame:CGRectMake(0, 0, screenWidth, 0.5)];
  if (@available(iOS 13.0, *)) {
    topLine.backgroundColor = [UIColor separatorColor];
  } else {
    topLine.backgroundColor = [UIColor colorWithWhite:0.0 alpha:0.15];
  }
  topLine.autoresizingMask = UIViewAutoresizingFlexibleWidth;
  [toolbar addSubview:topLine];
  
  UIBarButtonItem *flexSpacer = [[UIBarButtonItem alloc] initWithBarButtonSystemItem:UIBarButtonSystemItemFlexibleSpace target:nil action:nil];
  
  // Container view to provide explicit height and top/bottom padding
  UIView *containerView = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 44, 44)];
  containerView.clipsToBounds = YES;
  [containerView.widthAnchor constraintEqualToConstant:44].active = YES;
  [containerView.heightAnchor constraintEqualToConstant:44].active = YES;
  
  UIButton *tickButton = [UIButton buttonWithType:UIButtonTypeCustom];
  [containerView addSubview:tickButton];
  
  tickButton.translatesAutoresizingMaskIntoConstraints = NO;
  [NSLayoutConstraint activateConstraints:@[
    [tickButton.centerXAnchor constraintEqualToAnchor:containerView.centerXAnchor],
    [tickButton.centerYAnchor constraintEqualToAnchor:containerView.centerYAnchor],
    [tickButton.widthAnchor constraintEqualToConstant:28],
    [tickButton.heightAnchor constraintEqualToConstant:28]
  ]];
  
  UIImage *checkImage = [UIImage systemImageNamed:@"checkmark"];
  if (@available(iOS 13.0, *)) {
    UIImageSymbolConfiguration *config = [UIImageSymbolConfiguration configurationWithPointSize:11 weight:UIImageSymbolWeightBold];
    checkImage = [UIImage systemImageNamed:@"checkmark" withConfiguration:config];
  }
  [tickButton setImage:checkImage forState:UIControlStateNormal];
  tickButton.tintColor = [UIColor whiteColor];
  tickButton.backgroundColor = [UIColor colorWithRed:0.0 green:0.48 blue:1.0 alpha:1.0];
  tickButton.layer.cornerRadius = 14;
  tickButton.layer.masksToBounds = YES;
  tickButton.clipsToBounds = YES;
  [tickButton addTarget:self action:@selector(keyboardToolbarDoneTapped) forControlEvents:UIControlEventTouchUpInside];
  
  UIBarButtonItem *doneButton = [[UIBarButtonItem alloc] initWithCustomView:containerView];
  
  toolbar.items = @[flexSpacer, doneButton];
  
  return toolbar;
}

@end

@implementation UITextField (DoneButton)

+ (void)load {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    Method orig =
        class_getInstanceMethod(self, @selector(becomeFirstResponder));
    Method swiz =
        class_getInstanceMethod(self, @selector(db_becomeFirstResponder));
    method_exchangeImplementations(orig, swiz);
  });
}

- (BOOL)db_becomeFirstResponder {
  if (!self.inputAccessoryView) {
    // Only attach the tick toolbar for numeric keyboard types.
    // Default, email, URL, search, and Twitter keyboards already have
    // a Return/Go key so they do not need the custom done button.
    UIKeyboardType kbType = self.keyboardType;
    BOOL isNumeric = (kbType == UIKeyboardTypeNumberPad ||
                      kbType == UIKeyboardTypeDecimalPad ||
                      kbType == UIKeyboardTypePhonePad ||
                      kbType == UIKeyboardTypeNumbersAndPunctuation);
    if (isNumeric) {
      self.inputAccessoryView = [self makeCustomKeyboardToolbar];
    }
  }
  return [self db_becomeFirstResponder]; // calls original
}

@end
