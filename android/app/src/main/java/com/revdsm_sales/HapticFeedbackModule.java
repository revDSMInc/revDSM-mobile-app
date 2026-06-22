package com.revdsm_sales;

import android.app.Activity;
import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.HapticFeedbackConstants;
import android.view.View;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class HapticFeedbackModule extends ReactContextBaseJavaModule {
    public HapticFeedbackModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return "HapticFeedback";
    }

    @ReactMethod
    public void prepare(String type) {
        // No-op for Android, as prepare is primarily used for iOS generators
    }

    @ReactMethod
    public void trigger(String type) {
        Activity activity = getCurrentActivity();
        View view = null;
        if (activity != null && activity.getWindow() != null) {
            view = activity.getWindow().getDecorView();
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && view != null) {
            // Android 11+ (API 30+) using performHapticFeedback semantic constants
            int feedbackConstant = -1;
            if ("success".equals(type)) {
                feedbackConstant = HapticFeedbackConstants.CONFIRM;
            } else if ("error".equals(type)) {
                feedbackConstant = HapticFeedbackConstants.REJECT;
            } else if ("light".equals(type)) {
                feedbackConstant = HapticFeedbackConstants.VIRTUAL_KEY;
            } else if ("threshold".equals(type)) {
                feedbackConstant = HapticFeedbackConstants.GESTURE_START;
            }

            if (feedbackConstant != -1) {
                if (view.performHapticFeedback(feedbackConstant)) {
                    return;
                }
            }
        }

        // Fallback for API < 30 or if view is null, using Vibrator API
        Vibrator vibrator = (Vibrator) getReactApplicationContext().getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator != null && vibrator.hasVibrator()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // API 29+ Predefined Effects
                VibrationEffect effect = null;
                if ("success".equals(type)) {
                    effect = VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK);
                } else if ("error".equals(type)) {
                    effect = VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK);
                } else if ("light".equals(type) || "threshold".equals(type)) {
                    effect = VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK);
                }

                if (effect != null) {
                    vibrator.vibrate(effect);
                    return;
                }
            }

            // Older Fallbacks / Custom Waveforms
            if ("success".equals(type)) {
                vibrator.vibrate(50);
            } else if ("error".equals(type)) {
                // Two-pulse error/failure pattern
                long[] pattern = {0, 40, 60, 40};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
                } else {
                    vibrator.vibrate(pattern, -1);
                }
            } else if ("light".equals(type) || "threshold".equals(type)) {
                vibrator.vibrate(15);
            }
        }
    }
}
