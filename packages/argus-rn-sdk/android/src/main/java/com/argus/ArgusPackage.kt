package com.argus

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class ArgusPackage : ReactPackage {

    // kr: createNativeModules는 React Native 앱에 Argus native module을 등록합니다.
    // en: createNativeModules registers the Argus native module with the React Native app.
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(ArgusModule(reactContext))
    }

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> {
        return emptyList()
    }
}
