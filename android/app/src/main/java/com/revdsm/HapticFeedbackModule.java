package com.revdsm;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
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
        Vibrator vibrator = (Vibrator) getReactApplicationContext().getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator == null || !vibrator.hasVibrator()) {
            return;
        }

        // Predefined effects (VibrationEffect.createPredefined) are intentionally NOT used.
        // They silently no-op on some OEM devices (confirmed on Samsung) even though
        // hasVibrator() reports true. Plain duration/waveform vibration is the only
        // path verified to work consistently across OEMs (Samsung + Xiaomi tested).

        if ("success".equals(type)) {
            vibrate(vibrator, 50);
        } else if ("error".equals(type)) {
            long[] pattern = {0, 40, 60, 40};
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
            } else {
                vibrator.vibrate(pattern, -1);
            }
        } else if ("light".equals(type) || "threshold".equals(type)) {
            // 15ms was below the minimum threshold most Android OEMs (Samsung, Xiaomi, etc.)
            // require to produce a perceptible vibration — the OS silently drops it.
            // 35ms is short enough to feel distinctly lighter than success (50ms),
            // but above the hardware minimum to actually fire.
            vibrate(vibrator, 35);
        }
    }

    private void vibrate(Vibrator vibrator, long durationMs) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE));
        } else {
            vibrator.vibrate(durationMs);
        }
    }
}