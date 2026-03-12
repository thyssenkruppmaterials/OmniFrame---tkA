#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// This macro registers the plugin with Capacitor
CAP_PLUGIN(DJIDronePlugin, "DJIDrone",
    CAP_PLUGIN_METHOD(connect, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(disconnect, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getConnectionStatus, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(capturePhoto, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getTelemetry, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getDroneInfo, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(startMission, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stopMission, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getMissionStatus, CAPPluginReturnPromise);
)
