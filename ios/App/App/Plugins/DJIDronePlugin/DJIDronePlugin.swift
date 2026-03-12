import Foundation
import Capacitor
import CoreLocation
import DJISDK

/**
 * DJIDronePlugin - Capacitor plugin for DJI drone integration
 * 
 * This plugin provides an interface between the OmniFrame RF app and DJI drones
 * for warehouse scanning operations. It handles:
 * - Drone connection/disconnection
 * - Photo capture with GPS metadata
 * - Waypoint mission control
 * - Telemetry data access
 */
@objc(DJIDronePlugin)
public class DJIDronePlugin: CAPPlugin, CAPBridgedPlugin {
    
    public let identifier = "DJIDronePlugin"
    public let jsName = "DJIDrone"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getConnectionStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capturePhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTelemetry", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startMission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopMission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getMissionStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDroneInfo", returnType: CAPPluginReturnPromise),
    ]
    
    // MARK: - Properties
    
    private var isDJISDKRegistered: Bool = false
    private var isProductConnected: Bool = false
    private var currentMissionId: String?
    private var lastCapturedImagePath: String?
    private var pendingConnectCall: CAPPluginCall?
    
    // Cached telemetry data from delegate
    private var cachedFlightControllerState: DJIFlightControllerState?
    private var cachedBatteryState: DJIBatteryState?
    
    // Location manager for GPS data when drone GPS unavailable
    private var locationManager: CLLocationManager?
    private var currentLocation: CLLocation?
    
    // MARK: - Computed Properties
    
    private var aircraft: DJIAircraft? {
        return DJISDKManager.product() as? DJIAircraft
    }
    
    private var flightController: DJIFlightController? {
        return aircraft?.flightController
    }
    
    private var camera: DJICamera? {
        return aircraft?.camera
    }
    
    // MARK: - Lifecycle
    
    public override func load() {
        super.load()
        setupLocationManager()
        registerDJISDK()
    }
    
    private func setupLocationManager() {
        locationManager = CLLocationManager()
        locationManager?.delegate = self
        locationManager?.desiredAccuracy = kCLLocationAccuracyBest
        locationManager?.requestWhenInUseAuthorization()
        locationManager?.startUpdatingLocation()
    }
    
    private func registerDJISDK() {
        // Register with DJI SDK
        DJISDKManager.registerApp(with: self)
        print("DJIDronePlugin: Registering DJI SDK...")
    }
    
    // MARK: - Connection Methods
    
    @objc func connect(_ call: CAPPluginCall) {
        guard isDJISDKRegistered else {
            call.reject("DJI SDK not registered. Please check your App Key in Info.plist.")
            return
        }
        
        // Check if already connected
        if isProductConnected, let product = DJISDKManager.product() {
            let model = product.model ?? "Unknown DJI Drone"
            call.resolve([
                "connected": true,
                "message": "Already connected to drone",
                "droneModel": model
            ])
            return
        }
        
        // Store the call to resolve when connection completes
        pendingConnectCall = call
        
        // Start connection to product
        DJISDKManager.startConnectionToProduct()
        
        // Set a timeout for connection
        DispatchQueue.main.asyncAfter(deadline: .now() + 10.0) { [weak self] in
            guard let self = self, let pendingCall = self.pendingConnectCall else { return }
            
            if self.isProductConnected, let product = DJISDKManager.product() {
                let model = product.model ?? "Unknown DJI Drone"
                pendingCall.resolve([
                    "connected": true,
                    "message": "Connected to drone",
                    "droneModel": model
                ])
            } else {
                pendingCall.resolve([
                    "connected": false,
                    "message": "Connection timeout. Make sure the drone is powered on and the controller is connected to your device."
                ])
            }
            self.pendingConnectCall = nil
        }
    }
    
    @objc func disconnect(_ call: CAPPluginCall) {
        DJISDKManager.stopConnectionToProduct()
        currentMissionId = nil
        isProductConnected = false
        
        call.resolve([
            "disconnected": true,
            "message": "Disconnected from drone"
        ])
    }
    
    @objc func getConnectionStatus(_ call: CAPPluginCall) {
        call.resolve([
            "connected": isProductConnected,
            "sdkRegistered": isDJISDKRegistered
        ])
    }
    
    // MARK: - Photo Capture
    
    @objc func capturePhoto(_ call: CAPPluginCall) {
        guard isProductConnected else {
            call.reject("Not connected to drone")
            return
        }
        
        guard let camera = camera else {
            call.reject("Camera not available")
            return
        }
        
        // Set camera mode to shoot photo
        camera.setMode(.shootPhoto) { [weak self] error in
            if let error = error {
                call.reject("Failed to set camera mode: \(error.localizedDescription)")
                return
            }
            
            // Capture the photo
            camera.startShootPhoto { [weak self] error in
                if let error = error {
                    call.reject("Failed to capture photo: \(error.localizedDescription)")
                    return
                }
                
                // Get GPS data from flight controller state or device
                var gpsData: [String: Any] = [:]
                
                if let state = self?.cachedFlightControllerState,
                   let location = state.aircraftLocation,
                   CLLocationCoordinate2DIsValid(location.coordinate) {
                    gpsData = [
                        "lat": location.coordinate.latitude,
                        "lng": location.coordinate.longitude,
                        "alt": state.altitude,
                        "accuracy": 1.0,
                        "timestamp": Date().timeIntervalSince1970
                    ]
                } else if let location = self?.currentLocation {
                    gpsData = [
                        "lat": location.coordinate.latitude,
                        "lng": location.coordinate.longitude,
                        "alt": location.altitude,
                        "accuracy": location.horizontalAccuracy,
                        "timestamp": location.timestamp.timeIntervalSince1970
                    ]
                }
                
                let timestamp = Date().timeIntervalSince1970
                let imageName = "drone_capture_\(Int(timestamp)).jpg"
                let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                let imagePath = documentsPath.appendingPathComponent(imageName).path
                
                self?.lastCapturedImagePath = imagePath
                
                call.resolve([
                    "success": true,
                    "imagePath": imagePath,
                    "imageName": imageName,
                    "gps": gpsData,
                    "capturedAt": ISO8601DateFormatter().string(from: Date()),
                    "simulated": false
                ])
            }
        }
    }
    
    // MARK: - Telemetry
    
    @objc func getTelemetry(_ call: CAPPluginCall) {
        guard isProductConnected else {
            call.reject("Not connected to drone")
            return
        }
        
        var telemetry: [String: Any] = [
            "connected": isProductConnected,
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ]
        
        // Get data from cached flight controller state
        if let state = cachedFlightControllerState {
            // GPS data
            if let location = state.aircraftLocation,
               CLLocationCoordinate2DIsValid(location.coordinate) {
                telemetry["gps"] = [
                    "lat": location.coordinate.latitude,
                    "lng": location.coordinate.longitude,
                    "alt": state.altitude
                ]
            }
            
            // Attitude data
            let attitude = state.attitude
            telemetry["attitude"] = [
                "pitch": attitude.pitch,
                "roll": attitude.roll,
                "yaw": attitude.yaw
            ]
            
            // Velocity data
            telemetry["velocity"] = [
                "x": state.velocityX,
                "y": state.velocityY,
                "z": state.velocityZ
            ]
            
            // Other telemetry
            telemetry["altitude"] = state.altitude
            telemetry["heading"] = state.attitude.yaw
            telemetry["isFlying"] = state.isFlying
            telemetry["flightMode"] = getFlightModeString(state.flightMode)
        }
        
        // Get battery data from cached state
        if let batteryState = cachedBatteryState {
            telemetry["battery"] = [
                "percentage": batteryState.chargeRemainingInPercent,
                "voltage": Double(batteryState.voltage) / 1000.0,
                "temperature": batteryState.temperature
            ]
        }
        
        telemetry["simulated"] = false
        call.resolve(telemetry)
    }
    
    @objc func getDroneInfo(_ call: CAPPluginCall) {
        guard isProductConnected else {
            call.reject("Not connected to drone")
            return
        }
        
        guard let product = DJISDKManager.product() else {
            call.reject("Product not available")
            return
        }
        
        var info: [String: Any] = [
            "model": product.model ?? "Unknown",
            "simulated": false
        ]
        
        // Get firmware version
        product.getFirmwarePackageVersion { (version, error) in
            info["firmwareVersion"] = version ?? "Unknown"
            info["serialNumber"] = "See DJI GO App" // Serial number requires additional permissions
            info["sdkVersion"] = DJISDKManager.sdkVersion()
            
            call.resolve(info)
        }
    }
    
    // MARK: - Mission Control
    
    @objc func startMission(_ call: CAPPluginCall) {
        guard isProductConnected else {
            call.reject("Not connected to drone")
            return
        }
        
        guard let waypoints = call.getArray("waypoints") as? [[String: Any]] else {
            call.reject("Missing waypoints array")
            return
        }
        
        guard waypoints.count >= 2 else {
            call.reject("Mission requires at least 2 waypoints")
            return
        }
        
        let missionName = call.getString("name") ?? "Warehouse Scan Mission"
        let missionId = UUID().uuidString
        let speed = call.getFloat("speed") ?? 5.0
        
        // Create waypoint mission
        let mission = DJIMutableWaypointMission()
        mission.maxFlightSpeed = 15.0
        mission.autoFlightSpeed = speed
        mission.headingMode = .auto
        mission.flightPathMode = .normal
        mission.finishedAction = .goHome
        
        for wp in waypoints {
            guard let lat = wp["lat"] as? Double,
                  let lng = wp["lng"] as? Double else {
                continue
            }
            
            let altitude = wp["alt"] as? Float ?? 10.0
            let waypoint = DJIWaypoint(coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng))
            waypoint.altitude = altitude
            
            // Add photo action if specified
            if let action = wp["action"] as? String, action == "takePhoto" {
                let shootPhotoAction = DJIWaypointAction(actionType: .shootPhoto, param: 0)
                waypoint.add(shootPhotoAction)
            }
            
            // Add dwell time if specified
            if let dwellTime = wp["dwellTime"] as? Int, dwellTime > 0 {
                let stayAction = DJIWaypointAction(actionType: .stay, param: Int16(dwellTime * 1000))
                waypoint.add(stayAction)
            }
            
            mission.add(waypoint)
        }
        
        // Get mission operator and upload
        guard let missionOperator = DJISDKManager.missionControl()?.waypointMissionOperator() else {
            call.reject("Mission operator not available")
            return
        }
        
        // Load mission
        if let error = missionOperator.load(mission) {
            call.reject("Failed to load mission: \(error.localizedDescription)")
            return
        }
        
        // Upload mission
        missionOperator.uploadMission { [weak self] error in
            if let error = error {
                call.reject("Failed to upload mission: \(error.localizedDescription)")
                return
            }
            
            // Start mission
            missionOperator.startMission { error in
                if let error = error {
                    call.reject("Failed to start mission: \(error.localizedDescription)")
                    return
                }
                
                self?.currentMissionId = missionId
                
                call.resolve([
                    "success": true,
                    "missionId": missionId,
                    "missionName": missionName,
                    "waypointCount": waypoints.count,
                    "status": "started",
                    "message": "Mission started successfully"
                ])
            }
        }
    }
    
    @objc func stopMission(_ call: CAPPluginCall) {
        guard let missionId = currentMissionId else {
            call.reject("No active mission")
            return
        }
        
        guard let missionOperator = DJISDKManager.missionControl()?.waypointMissionOperator() else {
            call.reject("Mission operator not available")
            return
        }
        
        missionOperator.stopMission { [weak self] error in
            if let error = error {
                call.reject("Failed to stop mission: \(error.localizedDescription)")
                return
            }
            
            let stoppedMissionId = missionId
            self?.currentMissionId = nil
            
            call.resolve([
                "success": true,
                "missionId": stoppedMissionId,
                "status": "stopped",
                "message": "Mission stopped successfully"
            ])
        }
    }
    
    @objc func getMissionStatus(_ call: CAPPluginCall) {
        guard let missionOperator = DJISDKManager.missionControl()?.waypointMissionOperator() else {
            call.resolve([
                "status": "no_mission",
                "isActive": false
            ])
            return
        }
        
        let state = missionOperator.currentState
        let progress = missionOperator.latestExecutionProgress
        
        var status: String
        switch state {
        case .executing:
            status = "in_progress"
        case .executionPaused:
            status = "paused"
        case .readyToExecute:
            status = "ready"
        case .readyToUpload:
            status = "planned"
        default:
            status = "idle"
        }
        
        // Get waypoint count from loaded mission
        let loadedMission = missionOperator.loadedMission
        let waypointCount = loadedMission?.waypointCount ?? 0
        
        call.resolve([
            "missionId": currentMissionId ?? "",
            "status": status,
            "progress": progress != nil ? Float(progress!.targetWaypointIndex) / Float(max(waypointCount, 1)) : 0,
            "currentWaypoint": progress?.targetWaypointIndex ?? 0,
            "totalWaypoints": waypointCount,
            "isActive": state == .executing
        ])
    }
    
    // MARK: - Helper Methods
    
    private func getFlightModeString(_ mode: DJIFlightMode) -> String {
        switch mode {
        case .manual:
            return "Manual"
        case .atti:
            return "ATTI"
        case .attiCourseLock:
            return "ATTI Course Lock"
        case .gpsAtti:
            return "P-GPS"
        case .gpsCourseLock:
            return "GPS Course Lock"
        case .gpsHomeLock:
            return "GPS Home Lock"
        case .gpsHotPoint:
            return "Point of Interest"
        case .assistedTakeoff:
            return "Assisted Takeoff"
        case .autoTakeoff:
            return "Auto Takeoff"
        case .autoLanding:
            return "Auto Landing"
        case .gpsWaypoint:
            return "Waypoint"
        case .goHome:
            return "Go Home"
        case .gpsSport:
            return "Sport"
        case .gpsNovice:
            return "Novice"
        case .confirmLanding:
            return "Confirm Landing"
        case .terrainFollow:
            return "Terrain Follow"
        case .tripod:
            return "Tripod"
        case .activeTrack:
            return "Active Track"
        case .tapFly:
            return "Tap Fly"
        case .motorsJustStarted:
            return "Motors Started"
        case .draw:
            return "Draw"
        case .gpsFollowMe:
            return "Follow Me"
        case .activeTrackSpotlight:
            return "Spotlight"
        case .unknown:
            return "Unknown"
        @unknown default:
            return "Unknown"
        }
    }
}

// MARK: - DJISDKManagerDelegate

extension DJIDronePlugin: DJISDKManagerDelegate {
    
    public func appRegisteredWithError(_ error: Error?) {
        if let error = error {
            print("DJIDronePlugin: SDK Registration failed - \(error.localizedDescription)")
            isDJISDKRegistered = false
        } else {
            print("DJIDronePlugin: SDK Registration successful")
            isDJISDKRegistered = true
        }
    }
    
    public func didUpdateDatabaseDownloadProgress(_ progress: Progress) {
        print("DJIDronePlugin: Database download progress: \(progress.fractionCompleted * 100)%")
    }
    
    public func productConnected(_ product: DJIBaseProduct?) {
        print("DJIDronePlugin: Product connected - \(product?.model ?? "Unknown")")
        isProductConnected = true
        
        // If we have a pending connect call, resolve it
        if let pendingCall = pendingConnectCall {
            pendingCall.resolve([
                "connected": true,
                "message": "Connected to drone",
                "droneModel": product?.model ?? "Unknown DJI Drone"
            ])
            pendingConnectCall = nil
        }
        
        // Setup flight controller delegate for state updates
        if let aircraft = product as? DJIAircraft {
            aircraft.flightController?.delegate = self
            
            // Setup battery delegate
            if let batteries = aircraft.batteries, let battery = batteries.first {
                battery.delegate = self
            }
        }
    }
    
    public func productDisconnected() {
        print("DJIDronePlugin: Product disconnected")
        isProductConnected = false
        currentMissionId = nil
        cachedFlightControllerState = nil
        cachedBatteryState = nil
    }
    
    public func componentConnected(withKey key: String?, andIndex index: Int) {
        print("DJIDronePlugin: Component connected - \(key ?? "Unknown")")
    }
    
    public func componentDisconnected(withKey key: String?, andIndex index: Int) {
        print("DJIDronePlugin: Component disconnected - \(key ?? "Unknown")")
    }
}

// MARK: - DJIFlightControllerDelegate

extension DJIDronePlugin: DJIFlightControllerDelegate {
    
    public func flightController(_ fc: DJIFlightController, didUpdate state: DJIFlightControllerState) {
        // Cache the state for telemetry requests
        cachedFlightControllerState = state
    }
}

// MARK: - DJIBatteryDelegate

extension DJIDronePlugin: DJIBatteryDelegate {
    
    public func battery(_ battery: DJIBattery, didUpdate state: DJIBatteryState) {
        // Cache the battery state for telemetry requests
        cachedBatteryState = state
    }
}

// MARK: - CLLocationManagerDelegate

extension DJIDronePlugin: CLLocationManagerDelegate {
    
    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        currentLocation = locations.last
    }
    
    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("DJIDronePlugin: Location error - \(error.localizedDescription)")
    }
    
    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            manager.startUpdatingLocation()
        default:
            break
        }
    }
}
