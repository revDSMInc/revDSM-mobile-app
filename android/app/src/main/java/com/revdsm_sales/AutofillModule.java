package com.revdsm_sales;

import android.os.Build;
import android.view.autofill.AutofillManager;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

public class AutofillModule extends ReactContextBaseJavaModule {
    public AutofillModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return "AutofillHelper";
    }

    @ReactMethod
    public void commit() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                AutofillManager afm = getReactApplicationContext().getSystemService(AutofillManager.class);
                if (afm != null) {
                    afm.commit();
                }
            } catch (Exception e) {
                // Fail-safe to avoid app crashes
                e.printStackTrace();
            }
        }
    }

    @ReactMethod
    public void cancel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                AutofillManager afm = getReactApplicationContext().getSystemService(AutofillManager.class);
                if (afm != null) {
                    afm.cancel();
                }
            } catch (Exception e) {
                // Fail-safe to avoid app crashes
                e.printStackTrace();
            }
        }
    }
}
