import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Dimensions,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Modal,
  Vibration,
  ScrollView,
  Platform,
  Animated,
} from "react-native";

import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Speech from "expo-speech";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MapView, { Marker, Polyline } from "react-native-maps";
import { Ionicons, FontAwesome5 } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";

const { width, height } = Dimensions.get("window");

/* =========================================================
   CONSTANTS 
========================================================= */
const LOCATION_TASK_NAME = "RUNNER_BACKGROUND_LOCATION";
const SESSION_KEY = "@runner_active_session_v6";
const HISTORY_KEY = "@runner_workout_history_v6";

const MAX_ACCURACY = 25; 
const MIN_MOVEMENT_METERS = 2;
const MAX_RUNNING_SPEED_KMH = 22; 
const MAX_ROUTE_POINTS = 6000;
const MAP_DELTA = 0.0045;

const SPEED_STOPS = [
  { speed: 0, color: "#EF4444" },   
  { speed: 4, color: "#FB923C" },   
  { speed: 7, color: "#FACC15" },   
  { speed: 10, color: "#A3E635" },  
  { speed: 13, color: "#22C55E" },  
  { speed: 16, color: "#06B6D4" },  
  { speed: 20, color: "#2563EB" },  
];

/* =========================================================
   COLOR & MATH HELPERS
========================================================= */
function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.round(v).toString(16).padStart(2, "0").toUpperCase())
      .join("")
  );
}

function getSpectrumColor(speed) {
  const s = Math.max(SPEED_STOPS[0].speed, Math.min(SPEED_STOPS[SPEED_STOPS.length - 1].speed, Number(speed) || 0));

  for (let i = 0; i < SPEED_STOPS.length - 1; i++) {
    const current = SPEED_STOPS[i];
    const next = SPEED_STOPS[i + 1];

    if (s >= current.speed && s <= next.speed) {
      const ratio = (s - current.speed) / (next.speed - current.speed || 1);
      const a = hexToRgb(current.color);
      const b = hexToRgb(next.color);

      return rgbToHex(
        a.r + (b.r - a.r) * ratio,
        a.g + (b.g - a.g) * ratio,
        a.b + (b.b - a.b) * ratio
      );
    }
  }
  return SPEED_STOPS[SPEED_STOPS.length - 1].color;
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isValidCoordinate(point) {
  if (!point) return false;
  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 && latitude <= 90 &&
    longitude >= -180 && longitude <= 180
  );
}

function mapCoordinate(point) {
  return { 
    latitude: Number(point.latitude), 
    longitude: Number(point.longitude),
    altitude: point.altitude,
    heading: point.heading
  };
}

/* =========================================================
   ROUTE COMPRESSION
========================================================= */
function compressSegment(segment, maxPoints) {
  if (!segment.length) return [];
  if (segment.length <= maxPoints) return segment;
  if (maxPoints <= 1) return [segment[segment.length - 1]];

  const result = [];
  const step = (segment.length - 1) / (maxPoints - 1);

  for (let i = 0; i < maxPoints; i++) {
    const index = Math.round(i * step);
    result.push(segment[index]);
  }
  return result;
}

function compactRoute(points, maxPoints = MAX_ROUTE_POINTS) {
  if (!Array.isArray(points)) return [];
  const valid = points.filter(isValidCoordinate);
  if (valid.length <= maxPoints) return valid;

  const segments = [];
  let current = [];

  valid.forEach((point, index) => {
    if (index === 0) {
      current = [point];
      return;
    }
    if (point.breakBefore) {
      if (current.length) segments.push(current);
      current = [point];
    } else {
      current.push(point);
    }
  });
  if (current.length) segments.push(current);
  if (segments.length === 1) return compressSegment(segments[0], maxPoints);

  const minimumPerSegment = 2;
  const allocation = segments.map(() => 0);
  let remaining = maxPoints;

  segments.forEach((segment, index) => {
    if (remaining >= minimumPerSegment) {
      allocation[index] = Math.min(minimumPerSegment, segment.length);
      remaining -= allocation[index];
    }
  });

  while (remaining > 0) {
    let largestIndex = -1;
    let largestAvailable = 0;
    segments.forEach((segment, index) => {
      const available = segment.length - allocation[index];
      if (available > largestAvailable) {
        largestAvailable = available;
        largestIndex = index;
      }
    });
    if (largestIndex === -1 || largestAvailable <= 0) break;
    allocation[largestIndex]++;
    remaining--;
  }

  const result = [];
  segments.forEach((segment, index) => {
    const compressed = compressSegment(segment, Math.max(1, allocation[index]));
    if (index > 0 && compressed.length) {
      compressed[0] = { ...compressed[0], breakBefore: true };
    }
    result.push(...compressed);
  });
  return result;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getPace(distanceKm, seconds) {
  if (!distanceKm || distanceKm <= 0 || !seconds || seconds <= 0) return "--:--";
  const paceSeconds = seconds / distanceKm;
  const minutes = Math.floor(paceSeconds / 60);
  const secs = Math.floor(paceSeconds % 60);
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function estimatedCalories(distanceKm) {
  return Math.round(Math.max(0, Number(distanceKm) || 0) * 65);
}

function getGpsStatus(accuracy) {
  if (!Number.isFinite(Number(accuracy))) return { label: "SEARCHING", color: "#F59E0B" };
  if (accuracy <= 10) return { label: "EXCELLENT", color: "#22C55E" };
  if (accuracy <= 20) return { label: "GOOD", color: "#84CC16" };
  if (accuracy <= 30) return { label: "FAIR", color: "#F59E0B" };
  return { label: "WEAK", color: "#EF4444" };
}

function smoothSpeed(previous, current) {
  const p = Number(previous) || 0;
  const c = Number(current) || 0;
  return p * 0.85 + c * 0.15; 
}

const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#111827" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9CA3AF" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#111827" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#374151" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#252B36" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#111827" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#303846" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0B1320" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#18212F" }] },
];

function splitRouteSegments(points) {
  if (!Array.isArray(points)) return [];
  const validPoints = points.filter(isValidCoordinate);
  if (validPoints.length < 2) return [];

  const segments = [];
  let current = [];

  validPoints.forEach((point, index) => {
    if (index === 0) {
      current = [point];
      return;
    }
    if (point.breakBefore) {
      if (current.length >= 2) segments.push(current);
      current = [point];
    } else {
      current.push(point);
    }
  });
  if (current.length >= 2) segments.push(current);
  return segments;
}

/* =========================================================
   MEMOIZED COMPONENTS 
========================================================= */

const MemoizedSpectrumRoute = React.memo(({ points, prefix = "route" }) => {
  if (!Array.isArray(points) || points.length < 2) return null;
  const segments = splitRouteSegments(points);

  return (
    <>
      {segments.map((segment, segmentIndex) => {
        if (segment.length < 2) return null;

        const colorChunks = [];
        let currentChunk = [segment[0]];
        let currentColor = null;

        for (let i = 0; i < segment.length - 1; i++) {
          const point = segment[i];
          const next = segment[i + 1];
          const avgSpeed = (Number(point.speedKmh || 0) + Number(next.speedKmh || 0)) / 2;
          const color = getSpectrumColor(avgSpeed);

          if (currentColor === null) currentColor = color;

          if (color !== currentColor) {
            colorChunks.push({ color: currentColor, coordinates: [...currentChunk] });
            currentChunk = [point, next];
            currentColor = color;
          } else {
            currentChunk.push(next);
          }
        }
        if (currentChunk.length > 1) {
          colorChunks.push({ color: currentColor, coordinates: currentChunk });
        }

        return (
          <React.Fragment key={`${prefix}-segment-${segmentIndex}`}>
            <Polyline
              coordinates={segment.map(mapCoordinate)}
              strokeColor="rgba(0,0,0,0.55)"
              strokeWidth={11}
              lineCap="round"
              lineJoin="round"
              zIndex={1}
            />
            {colorChunks.map((chunk, chunkIndex) => (
              <Polyline
                key={`${prefix}-${segmentIndex}-${chunkIndex}`}
                coordinates={chunk.coordinates.map(mapCoordinate)}
                strokeColor={chunk.color}
                strokeWidth={7}
                lineCap="round"
                lineJoin="round"
                zIndex={2}
              />
            ))}
          </React.Fragment>
        );
      })}
    </>
  );
}, (prevProps, nextProps) => prevProps.points.length === nextProps.points.length);

const StartMarker = React.memo(({ coordinate }) => {
  if (!coordinate || !isValidCoordinate(coordinate)) return null;
  return (
    <Marker coordinate={mapCoordinate(coordinate)} anchor={{ x: 0.5, y: 0.5 }}>
      <View style={styles.startMarker}>
        <View style={styles.startMarkerDot} />
      </View>
    </Marker>
  );
});

const FinishMarker = React.memo(({ coordinate }) => {
  if (!coordinate || !isValidCoordinate(coordinate)) return null;
  return (
    <Marker coordinate={mapCoordinate(coordinate)} anchor={{ x: 0.5, y: 0.5 }}>
      <View style={styles.finishMarker}>
        <View style={styles.finishMarkerInner} />
      </View>
    </Marker>
  );
});

const LiveMarker = React.memo(({ coordinate }) => {
  if (!coordinate || !isValidCoordinate(coordinate)) return null;
  return (
    <Marker coordinate={mapCoordinate(coordinate)} anchor={{ x: 0.5, y: 0.5 }} zIndex={999}>
      <View style={styles.liveMarker}>
        <View style={styles.liveMarkerInner} />
      </View>
    </Marker>
  );
});

/* =========================================================
   BACKGROUND LOCATION TASK
========================================================= */
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  if (!data || !Array.isArray(data.locations) || data.locations.length === 0) return;

  try {
    const stored = await AsyncStorage.getItem(SESSION_KEY);
    if (!stored) return;

    const session = JSON.parse(stored);
    if (!session || session.running !== true || session.paused) return;

    let updatedSession = { ...session };

    for (const locationData of data.locations) {
      const coords = locationData?.coords;
      if (!coords) continue;

      const latitude = Number(coords.latitude);
      const longitude = Number(coords.longitude);
      const accuracy = Number(coords.accuracy);
      const altitude = Number(coords.altitude) || 0;
      const heading = Number(coords.heading) || -1;

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY) continue; 

      const timestamp = Number(locationData.timestamp) || Date.now();
      const currentPoint = { latitude, longitude, accuracy, timestamp, altitude, heading };
      const previous = updatedSession.lastPoint || updatedSession.route?.[updatedSession.route.length - 1];

      if (!previous) {
        updatedSession.lastPoint = currentPoint;
        updatedSession.route = [...(updatedSession.route || []), { ...currentPoint, speedKmh: 0 }];
        continue;
      }

      const distance = distanceMeters(previous.latitude, previous.longitude, latitude, longitude);
      const previousTimestamp = Number(previous.timestamp) || timestamp;
      const deltaTime = Math.max(0.5, (timestamp - previousTimestamp) / 1000);
      const calculatedSpeed = (distance / deltaTime) * 3.6;

      if (calculatedSpeed > MAX_RUNNING_SPEED_KMH) continue; 
      if (distance < MIN_MOVEMENT_METERS) continue;

      const validSpeed = Math.max(0, calculatedSpeed);
      const smoothedSpeed = smoothSpeed(updatedSession.speedKmh || 0, validSpeed);

      const newPoint = {
        ...currentPoint,
        speedKmh: Number(smoothedSpeed.toFixed(2)),
      };

      if (updatedSession.routeBreakPending) {
        newPoint.breakBefore = true;
        updatedSession.routeBreakPending = false;
      }

      const route = [...(updatedSession.route || []), newPoint];

      updatedSession.route = compactRoute(route, MAX_ROUTE_POINTS);
      updatedSession.lastPoint = currentPoint;
      updatedSession.speedKmh = Number(smoothedSpeed.toFixed(2));
      updatedSession.topSpeedKmh = Math.max(Number(updatedSession.topSpeedKmh || 0), validSpeed);
      updatedSession.distanceMeters = Number(updatedSession.distanceMeters || 0) + distance;
    }

    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(updatedSession));
  } catch (taskError) {}
});

/* =========================================================
   MAIN APP
========================================================= */
export default function App() {
  const mapRef = useRef(null);
  const completionMapRef = useRef(null);

  const [permissionGranted, setPermissionGranted] = useState(false);
  const [location, setLocation] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [isConnected, setIsConnected] = useState(true);

  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  
  const [timeData, setTimeData] = useState({ accumulatedMs: 0, lastResumeTime: 0 });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const [distance, setDistance] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [topSpeed, setTopSpeed] = useState(0);
  const [route, setRoute] = useState([]);

  const [mapType, setMapType] = useState("standard");
  const [followUser, setFollowUser] = useState(true);
  
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);

  const [mapRendered, setMapRendered] = useState(false);
  const [mapLayoutSet, setMapLayoutSet] = useState(false);

  // Animation Value for Running Man
  const runAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    initializeApp();
    
    // Check Network Connection
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsConnected(state.isConnected);
    });
    return () => unsubscribe();
  }, []);

  // Trigger Animation when running
  useEffect(() => {
    if (running && !paused) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(runAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(runAnim, { toValue: 0, duration: 350, useNativeDriver: true })
        ])
      ).start();
    } else {
      runAnim.stopAnimation();
      runAnim.setValue(0);
    }
  }, [running, paused]);

  const translateY = runAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -12] // Bounces 12 pixels up
  });

  async function initializeApp() {
    await loadHistory();
    await setupLocation();
  }

  async function loadHistory() {
    try {
      const saved = await AsyncStorage.getItem(HISTORY_KEY);
      if (saved) setHistory(JSON.parse(saved));
    } catch (error) {}
  }

  useEffect(() => {
    let interval;
    if (running) {
      interval = setInterval(() => {
        if (paused || !timeData.lastResumeTime) {
          setElapsedSeconds(Math.floor(timeData.accumulatedMs / 1000));
        } else {
          setElapsedSeconds(Math.floor((timeData.accumulatedMs + (Date.now() - timeData.lastResumeTime)) / 1000));
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [running, paused, timeData]);

  async function setupLocation() {
    try {
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (foreground.status !== "granted") {
        Alert.alert("Location Required", "Location permission is required to track your run.");
        return false;
      }
      setPermissionGranted(true);

      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      if (current?.coords) {
        setLocation({ 
          latitude: current.coords.latitude, 
          longitude: current.coords.longitude,
          altitude: current.coords.altitude,
          heading: current.coords.heading
        });
        setAccuracy(current.coords.accuracy);
      }

      const stored = await AsyncStorage.getItem(SESSION_KEY);
      if (stored) {
        const session = JSON.parse(stored);
        if (session?.running) {
          setRunning(true);
          setPaused(Boolean(session.paused));
          setTimeData(session.timeData || { accumulatedMs: 0, lastResumeTime: 0 });
          setDistance(Number(session.distanceMeters || 0) / 1000);
          setSpeed(Number(session.speedKmh || 0));
          setTopSpeed(Number(session.topSpeedKmh || 0));
          setRoute(Array.isArray(session.route) ? session.route : []);
        }
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  async function startLocationService() {
    try {
      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) {
        Alert.alert("Location Services Off", "Please turn on Location Services.");
        return false;
      }
      
      const background = await Location.requestBackgroundPermissionsAsync();
      if (background.status !== "granted") {
        Alert.alert("Background Location Required", "Allow 'Allow all the time' in App Settings to track when locked.");
        return false;
      }

      const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (!alreadyStarted) {
        await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 2,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: "Run Tracker",
            notificationBody: "Your run is being tracked.",
          },
        });
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(async () => {
      try {
        const stored = await AsyncStorage.getItem(SESSION_KEY);
        if (!stored) return;
        const session = JSON.parse(stored);

        setDistance(Number(session.distanceMeters || 0) / 1000);
        setSpeed(Number(session.speedKmh || 0));
        setTopSpeed(Number(session.topSpeedKmh || 0));

        if (Array.isArray(session.route)) {
          setRoute(prevRoute => prevRoute.length !== session.route.length ? session.route : prevRoute);
        }

        if (session.lastPoint && isValidCoordinate(session.lastPoint)) {
          const point = mapCoordinate(session.lastPoint);
          setLocation(point);
          setAccuracy(Number(session.lastPoint.accuracy));

          if (followUser && mapRef.current && isConnected) {
            mapRef.current.animateToRegion(
              { ...point, latitudeDelta: MAP_DELTA, longitudeDelta: MAP_DELTA },
              500
            );
          }
        }
      } catch (error) {}
    }, 1000);

    return () => clearInterval(interval);
  }, [running, followUser, isConnected]);

  async function startRun() {
    let ready = permissionGranted;
    if (!ready) ready = await setupLocation();
    if (!ready) return;

    const started = await startLocationService();
    if (!started) return;

    try {
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
      const now = Date.now();
      const firstPoint = {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        accuracy: current.coords.accuracy,
        altitude: current.coords.altitude || 0,
        heading: current.coords.heading || -1,
        timestamp: now,
        speedKmh: 0,
      };
      
      const newTimeData = { accumulatedMs: 0, lastResumeTime: now };
      
      const newSession = {
        running: true,
        paused: false,
        timeData: newTimeData,
        distanceMeters: 0,
        speedKmh: 0,
        topSpeedKmh: 0,
        route: [firstPoint],
        lastPoint: firstPoint,
        routeBreakPending: false,
      };

      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(newSession));

      setLocation(mapCoordinate(firstPoint));
      setAccuracy(firstPoint.accuracy);
      setTimeData(newTimeData);
      setElapsedSeconds(0);
      setRunning(true);
      setPaused(false);
      setDistance(0);
      setSpeed(0);
      setTopSpeed(0);
      setRoute([firstPoint]);

      Speech.speak("Run started", { language: "en-IN", rate: 0.95 });
      Vibration.vibrate(100);
    } catch (error) {}
  }

  async function pauseRun() {
    const newAccumulated = timeData.accumulatedMs + (Date.now() - timeData.lastResumeTime);
    const newTimeData = { accumulatedMs: newAccumulated, lastResumeTime: null };
    
    setPaused(true);
    setSpeed(0);
    setTimeData(newTimeData);

    await AsyncStorage.mergeItem(SESSION_KEY, JSON.stringify({
      paused: true,
      speedKmh: 0,
      routeBreakPending: true,
      timeData: newTimeData
    }));

    Vibration.vibrate(100);
    Speech.speak("Run paused", { language: "en-IN", rate: 0.95 });
  }

  async function resumeRun() {
    try {
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
      const newTimeData = { accumulatedMs: timeData.accumulatedMs, lastResumeTime: Date.now() };
      
      const point = {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        accuracy: current.coords.accuracy,
        altitude: current.coords.altitude || 0,
        heading: current.coords.heading || -1,
        timestamp: Date.now(),
        speedKmh: 0,
        breakBefore: true,
      };

      setPaused(false);
      setSpeed(0);
      setTimeData(newTimeData);

      const newRoute = [...route, point];
      setRoute(newRoute);
      setLocation(mapCoordinate(point));
      setAccuracy(point.accuracy);

      const stored = await AsyncStorage.getItem(SESSION_KEY);
      if (stored) {
        const session = JSON.parse(stored);
        session.paused = false;
        session.speedKmh = 0;
        session.timeData = newTimeData;
        session.routeBreakPending = false;
        session.route = [...(session.route || []), point];
        session.lastPoint = point;
        await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
      }

      Speech.speak("Run resumed", { language: "en-IN", rate: 0.95 });
      Vibration.vibrate(100);
    } catch (error) {}
  }

  function finishRun() {
    Alert.alert("Finish Run?", "Are you sure you want to finish this run?", [
      { text: "Cancel", style: "cancel" },
      { text: "Finish", style: "destructive", onPress: completeRun },
    ]);
  }

  async function completeRun() {
    try {
      const finalRoute = compactRoute(route, MAX_ROUTE_POINTS);
      const averageSpeed = elapsedSeconds > 0 ? distance / (elapsedSeconds / 3600) : 0;

      const workout = {
        id: String(Date.now()),
        date: new Date().toISOString(),
        distanceKm: Number(distance.toFixed(3)),
        durationSeconds: elapsedSeconds,
        averageSpeedKmh: Number(averageSpeed.toFixed(2)),
        topSpeedKmh: Number(topSpeed.toFixed(2)),
        pace: getPace(distance, elapsedSeconds),
        calories: estimatedCalories(distance),
        route: finalRoute,
      };

      const updatedHistory = [workout, ...history].slice(0, 50);
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updatedHistory));
      await AsyncStorage.removeItem(SESSION_KEY);

      const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
      if (started) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }

      setHistory(updatedHistory);
      setSummary(workout);
      
      setMapRendered(false);
      setMapLayoutSet(false);
      setSummaryVisible(true);

      setRunning(false);
      setPaused(false);
      setSpeed(0);

      Speech.speak("Run completed", { language: "en-IN", rate: 0.95 });
      Vibration.vibrate([0, 150, 100, 150]);
    } catch (error) {}
  }

  useEffect(() => {
    if (summaryVisible && mapRendered && mapLayoutSet && summary && completionMapRef.current && isConnected) {
      const coordinates = Array.isArray(summary.route)
        ? summary.route.filter(isValidCoordinate).map(mapCoordinate)
        : [];
        
      if (coordinates.length >= 2) {
        completionMapRef.current.fitToCoordinates(coordinates, {
          edgePadding: { top: 80, right: 40, bottom: 150, left: 40 },
          animated: true,
        });
      }
    }
  }, [summaryVisible, mapRendered, mapLayoutSet, summary, isConnected]);

  const gpsStatus = getGpsStatus(accuracy);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar hidden={true} barStyle="light-content" backgroundColor="#080B10" />
      <View style={styles.container}>
        {/* HEADER */}
        <View style={styles.header}>
          <View>
            <Text style={styles.appTitle}>RUNNER</Text>
            <View style={styles.gpsRow}>
              <View style={[styles.gpsDot, { backgroundColor: gpsStatus.color }]} />
              <Text style={styles.gpsText}>GPS {gpsStatus.label}</Text>
              {Number.isFinite(Number(accuracy)) && (
                <Text style={styles.accuracyText}>±{Math.round(accuracy)}m</Text>
              )}
            </View>
          </View>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setHistoryVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="time-outline" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        {/* LIVE MAP OR OFFLINE DASHBOARD */}
        <View style={styles.mapContainer}>
          {isConnected ? (
            <>
              <MapView
                ref={mapRef}
                style={styles.map}
                mapType={mapType}
                customMapStyle={mapType === "standard" ? darkMapStyle : undefined}
                showsCompass={false}
                showsBuildings={false}
                showsTraffic={false}
                showsIndoors={false}
                showsUserLocation={false}
                initialRegion={
                  location
                    ? { ...location, latitudeDelta: MAP_DELTA, longitudeDelta: MAP_DELTA }
                    : { latitude: 28.6139, longitude: 77.209, latitudeDelta: 0.08, longitudeDelta: 0.08 }
                }
              >
                <MemoizedSpectrumRoute points={route} prefix="live" />
                {route.length > 0 && <StartMarker coordinate={route[0]} />}
                {running && location && <LiveMarker coordinate={location} />}
              </MapView>

              <View style={styles.legend}>
                <Text style={styles.legendTitle}>SPEED SPECTRUM</Text>
                <View style={styles.legendBar}>
                  {SPEED_STOPS.map((stop) => (
                    <View key={stop.speed} style={[styles.legendColor, { backgroundColor: stop.color }]} />
                  ))}
                </View>
                <View style={styles.legendLabels}>
                  <Text style={styles.legendText}>SLOW</Text>
                  <Text style={styles.legendText}>FAST</Text>
                </View>
              </View>

              <View style={styles.mapControls}>
                <TouchableOpacity style={styles.mapControl} onPress={() => setFollowUser((v) => !v)} activeOpacity={0.8}>
                  <Ionicons name={followUser ? "locate" : "locate-outline"} size={20} color={followUser ? "#22C55E" : "#FFFFFF"} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.mapControl} onPress={() => setMapType((c) => (c === "standard" ? "satellite" : "standard"))} activeOpacity={0.8}>
                  <Ionicons name="layers-outline" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.offlineFallback}>
              
              {/* ANIMATED RUNNER OR OFFLINE ICON */}
              {running && !paused ? (
                <Animated.View style={{ transform: [{ translateY }], marginBottom: 15 }}>
                  <FontAwesome5 name="running" size={45} color="#22C55E" />
                </Animated.View>
              ) : (
                <Ionicons name="cloud-offline" size={40} color="#4B5563" style={{ marginBottom: 15 }} />
              )}
              
              <Text style={styles.offlineTitle}>{running && !paused ? "TRACKING OFFLINE" : "OFFLINE MODE"}</Text>
              
              <Text style={styles.bigSpeedLabel}>LIVE SPEED</Text>
              <Text style={styles.bigSpeedValue}>{speed.toFixed(1)}</Text>
              <Text style={styles.bigSpeedUnit}>KM/H</Text>

              {/* NEW USEFUL STATS BOX */}
              <View style={styles.offlineExtraStatsRow}>
                <View style={styles.offlineExtraStat}>
                  <Ionicons name="triangle-outline" size={18} color="#6B7280" />
                  <Text style={styles.offlineExtraLabel}>ALTITUDE</Text>
                  <Text style={styles.offlineExtraValue}>
                    {location?.altitude ? Math.round(location.altitude) : "--"}
                    <Text style={styles.offlineExtraUnit}> m</Text>
                  </Text>
                </View>
                <View style={styles.offlineExtraStat}>
                  <Ionicons name="compass-outline" size={18} color="#6B7280" />
                  <Text style={styles.offlineExtraLabel}>HEADING</Text>
                  <Text style={styles.offlineExtraValue}>
                    {location?.heading && location.heading >= 0 ? Math.round(location.heading) : "--"}
                    <Text style={styles.offlineExtraUnit}>°</Text>
                  </Text>
                </View>
              </View>

            </View>
          )}
        </View>

        {/* BOTTOM STATS */}
        <View style={styles.bottomPanel}>
          <View style={styles.primaryMetric}>
            <Text style={styles.metricLabel}>DISTANCE</Text>
            <Text style={styles.distanceText}>
              {distance.toFixed(2)}
              <Text style={styles.distanceUnit}> KM</Text>
            </Text>
            <View style={styles.timerPill}>
              <Ionicons name="time-outline" size={15} color="#9CA3AF" />
              <Text style={styles.timerText}>{formatTime(elapsedSeconds)}</Text>
            </View>
          </View>

          <View style={styles.statsGrid}>
            <Stat icon="speedometer-outline" label="SPEED" value={speed.toFixed(1)} unit="KM/H" />
            <Stat icon="trending-up-outline" label="TOP SPEED" value={topSpeed.toFixed(1)} unit="KM/H" />
            <Stat icon="walk-outline" label="PACE" value={getPace(distance, elapsedSeconds)} unit="/KM" />
            <Stat icon="flame-outline" label="CALORIES" value={estimatedCalories(distance)} unit="KCAL" />
          </View>

          {!running ? (
            <TouchableOpacity style={styles.startButton} onPress={startRun} activeOpacity={0.85}>
              <Ionicons name="play" size={23} color="#FFFFFF" />
              <Text style={styles.startButtonText}>START RUN</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.runningButtons}>
              <TouchableOpacity style={styles.pauseButton} onPress={paused ? resumeRun : pauseRun} activeOpacity={0.85}>
                <Ionicons name={paused ? "play" : "pause"} size={22} color="#FFFFFF" />
                <Text style={styles.actionButtonText}>{paused ? "RESUME" : "PAUSE"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.finishButton} onPress={finishRun} activeOpacity={0.85}>
                <Ionicons name="stop" size={22} color="#FFFFFF" />
                <Text style={styles.actionButtonText}>FINISH</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>

      {/* COMPLETION MODAL */}
      <Modal visible={summaryVisible} animationType="slide" transparent={false} onRequestClose={() => setSummaryVisible(false)}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.summaryHeader}>
            <View>
              <Text style={styles.summaryTitle}>RUN COMPLETE</Text>
              <Text style={styles.summarySubtitle}>Great work. Here's your run.</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={() => setSummaryVisible(false)}>
              <Ionicons name="close" size={23} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {summary && (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.summaryScroll}>
              <View style={styles.summaryMapCard} onLayout={() => setMapLayoutSet(true)}>
                {isConnected ? (
                  <>
                    <MapView
                      ref={completionMapRef}
                      style={styles.summaryMap}
                      customMapStyle={darkMapStyle}
                      showsCompass={false}
                      showsBuildings={false}
                      showsTraffic={false}
                      showsUserLocation={false}
                      onMapReady={() => setMapRendered(true)}
                    >
                      <MemoizedSpectrumRoute points={summary.route} prefix="summary" />
                      {summary.route?.length > 0 && (
                        <>
                          <StartMarker coordinate={summary.route[0]} />
                          <FinishMarker coordinate={summary.route[summary.route.length - 1]} />
                        </>
                      )}
                    </MapView>
                    <View style={styles.summaryMapLabel}>
                      <Text style={styles.summaryMapLabelText}>SPEED SPECTRUM</Text>
                    </View>
                  </>
                ) : (
                  <View style={[styles.offlineFallback, { backgroundColor: '#11161E' }]}>
                     <Ionicons name="map-outline" size={30} color="#4B5563" />
                     <Text style={[styles.offlineTitle, { marginTop: 10 }]}>MAP UNAVAILABLE (OFFLINE)</Text>
                  </View>
                )}
              </View>

              <View style={styles.bigSummaryCard}>
                <Text style={styles.bigSummaryLabel}>DISTANCE</Text>
                <Text style={styles.bigSummaryValue}>
                  {Number(summary.distanceKm || 0).toFixed(2)}
                  <Text style={styles.bigSummaryUnit}> KM</Text>
                </Text>
                <Text style={styles.bigSummaryTime}>{formatTime(summary.durationSeconds)}</Text>
              </View>

              <View style={styles.summaryGrid}>
                <SummaryBox icon="speedometer-outline" label="AVG SPEED" value={`${Number(summary.averageSpeedKmh || 0).toFixed(1)} km/h`} />
                <SummaryBox icon="trending-up-outline" label="TOP SPEED" value={`${Number(summary.topSpeedKmh || 0).toFixed(1)} km/h`} />
                <SummaryBox icon="walk-outline" label="PACE" value={`${summary.pace} /km`} />
                <SummaryBox icon="flame-outline" label="CALORIES" value={`${summary.calories} kcal`} />
              </View>

              <View style={styles.spectrumCard}>
                <Text style={styles.spectrumTitle}>SPEED SPECTRUM</Text>
                <View style={styles.spectrumGradient}>
                  {SPEED_STOPS.map((stop, index) => (
                    <View key={index} style={{ flex: 1, backgroundColor: stop.color }} />
                  ))}
                </View>
                <View style={styles.spectrumBottomLabels}>
                  <Text style={styles.spectrumBottomText}>SLOW</Text>
                  <Text style={styles.spectrumBottomText}>FAST</Text>
                </View>
              </View>

              <TouchableOpacity style={styles.doneButton} onPress={() => setSummaryVisible(false)} activeOpacity={0.85}>
                <Text style={styles.doneButtonText}>DONE</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* HISTORY MODAL */}
      <Modal visible={historyVisible} animationType="slide" transparent={false} onRequestClose={() => setHistoryVisible(false)}>
        <SafeAreaView style={styles.modalSafe}>
          <View style={styles.historyHeader}>
            <View>
              <Text style={styles.summaryTitle}>RUN HISTORY</Text>
              <Text style={styles.summarySubtitle}>Your previous workouts</Text>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={() => setHistoryVisible(false)}>
              <Ionicons name="close" size={23} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.historyScroll}>
            {history.length === 0 ? (
              <View style={styles.emptyHistory}>
                <Ionicons name="footsteps-outline" size={50} color="#4B5563" />
                <Text style={styles.emptyHistoryTitle}>No runs yet</Text>
                <Text style={styles.emptyHistoryText}>Complete your first run and it will appear here.</Text>
              </View>
            ) : (
              history.map((item, index) => (
                <View key={item.id || `history-${index}`} style={styles.historyCard}>
                  <View style={styles.historyCardHeader}>
                    <View>
                      <Text style={styles.historyDate}>
                        {new Date(item.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                      </Text>
                      <Text style={styles.historyDistance}>{Number(item.distanceKm || 0).toFixed(2)} KM</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#4B5563" />
                  </View>
                  <View style={styles.historyStats}>
                    <HistoryStat label="TIME" value={formatTime(item.durationSeconds)} />
                    <HistoryStat label="PACE" value={`${item.pace}/km`} />
                    <HistoryStat label="TOP" value={`${Number(item.topSpeedKmh || 0).toFixed(1)} km/h`} />
                    <HistoryStat label="CAL" value={`${item.calories}`} />
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Stat({ icon, label, value, unit }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={18} color="#6B7280" />
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statValueRow}>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statUnit}>{unit}</Text>
      </View>
    </View>
  );
}

function SummaryBox({ icon, label, value }) {
  return (
    <View style={styles.summaryBox}>
      <Ionicons name={icon} size={19} color="#6B7280" />
      <Text style={styles.summaryBoxLabel}>{label}</Text>
      <Text style={styles.summaryBoxValue}>{value}</Text>
    </View>
  );
}

function HistoryStat({ label, value }) {
  return (
    <View style={styles.historyStat}>
      <Text style={styles.historyStatLabel}>{label}</Text>
      <Text style={styles.historyStatValue}>{value}</Text>
    </View>
  );
}

/* =========================================================
   STYLES
========================================================= */
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#080B10" },
  container: { flex: 1, backgroundColor: "#080B10" },
  header: { height: 76, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#080B10" },
  appTitle: { color: "#FFFFFF", fontSize: 21, fontWeight: "900", letterSpacing: 2.5 },
  gpsRow: { flexDirection: "row", alignItems: "center", marginTop: 5 },
  gpsDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  gpsText: { color: "#9CA3AF", fontSize: 10, fontWeight: "800", letterSpacing: 0.8 },
  accuracyText: { color: "#6B7280", fontSize: 10, marginLeft: 6 },
  headerButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#141922", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#202733" },
  mapContainer: { flex: 1, marginHorizontal: 12, borderRadius: 24, overflow: "hidden", backgroundColor: "#10151E", borderWidth: 1, borderColor: "#202733" },
  map: { flex: 1 },
  legend: { position: "absolute", top: 15, left: 15, right: 15, padding: 11, borderRadius: 15, backgroundColor: "rgba(8,11,16,0.88)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  legendTitle: { color: "#9CA3AF", fontSize: 8, fontWeight: "900", letterSpacing: 1.5, marginBottom: 7 },
  legendBar: { height: 7, borderRadius: 4, overflow: "hidden", flexDirection: "row" },
  legendColor: { flex: 1 },
  legendLabels: { marginTop: 5, flexDirection: "row", justifyContent: "space-between" },
  legendText: { color: "#6B7280", fontSize: 8, fontWeight: "800" },
  mapControls: { position: "absolute", right: 14, bottom: 14, gap: 8 },
  mapControl: { width: 43, height: 43, borderRadius: 14, backgroundColor: "rgba(8,11,16,0.9)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  liveMarker: { width: 27, height: 27, borderRadius: 14, backgroundColor: "rgba(34,197,94,0.25)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(34,197,94,0.5)" },
  liveMarkerInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#22C55E", borderWidth: 2, borderColor: "#FFFFFF" },
  startMarker: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#22C55E", borderWidth: 3, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  startMarkerDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#FFFFFF" },
  finishMarker: { width: 26, height: 26, borderRadius: 13, backgroundColor: "#2563EB", borderWidth: 3, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  finishMarkerInner: { width: 8, height: 8, backgroundColor: "#FFFFFF", borderRadius: 2 },
  
  /* OFFLINE DASHBOARD STYLES */
  offlineFallback: { flex: 1, backgroundColor: "#10151E", alignItems: "center", justifyContent: "center", padding: 20 },
  offlineTitle: { color: "#6B7280", fontSize: 11, fontWeight: "900", letterSpacing: 2, marginBottom: 40 },
  bigSpeedLabel: { color: '#6B7280', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 5 },
  bigSpeedValue: { color: '#FFFFFF', fontSize: 80, fontWeight: '900', marginVertical: -10 },
  bigSpeedUnit: { color: '#22C55E', fontSize: 15, fontWeight: '800', marginTop: 5 },
  
  /* NEW EXTRA STATS ROW STYLES */
  offlineExtraStatsRow: { flexDirection: 'row', gap: 15, marginTop: 40, width: '100%' },
  offlineExtraStat: { flex: 1, backgroundColor: '#141922', borderRadius: 18, borderWidth: 1, borderColor: '#1B222D', padding: 15, alignItems: 'center' },
  offlineExtraLabel: { color: '#6B7280', fontSize: 8, fontWeight: '900', letterSpacing: 1, marginTop: 6, marginBottom: 4 },
  offlineExtraValue: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  offlineExtraUnit: { color: '#6B7280', fontSize: 10, fontWeight: '800' },

  bottomPanel: { backgroundColor: "#080B10", paddingHorizontal: 18, paddingTop: 15, paddingBottom: Platform.OS === "ios" ? 20 : 40 },
  primaryMetric: { alignItems: "center" },
  metricLabel: { color: "#6B7280", fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  distanceText: { color: "#FFFFFF", fontSize: 43, fontWeight: "900", marginTop: -2 },
  distanceUnit: { color: "#6B7280", fontSize: 14, fontWeight: "800" },
  timerPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: "#11161E", marginTop: 3 },
  timerText: { color: "#9CA3AF", fontSize: 12, fontWeight: "700", marginLeft: 5, fontVariant: ["tabular-nums"] },
  statsGrid: { flexDirection: "row", marginTop: 15, gap: 7 },
  stat: { flex: 1, minHeight: 70, padding: 9, borderRadius: 15, backgroundColor: "#11161E", borderWidth: 1, borderColor: "#1B222D" },
  statLabel: { color: "#6B7280", fontSize: 7, fontWeight: "900", letterSpacing: 0.7, marginTop: 5 },
  statValueRow: { flexDirection: "row", alignItems: "baseline", marginTop: 2 },
  statValue: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  statUnit: { color: "#6B7280", fontSize: 7, fontWeight: "800", marginLeft: 2 },
  startButton: { height: 57, borderRadius: 18, backgroundColor: "#22C55E", flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 13, gap: 9 },
  startButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "900", letterSpacing: 1.2 },
  runningButtons: { flexDirection: "row", gap: 9, marginTop: 13 },
  pauseButton: { flex: 1, height: 57, borderRadius: 18, backgroundColor: "#1F2937", borderWidth: 1, borderColor: "#374151", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  finishButton: { flex: 1, height: 57, borderRadius: 18, backgroundColor: "#DC2626", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  actionButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900", letterSpacing: 0.8 },
  modalSafe: { flex: 1, backgroundColor: "#080B10" },
  summaryHeader: { height: 78, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  historyHeader: { height: 78, paddingHorizontal: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  summaryTitle: { color: "#FFFFFF", fontSize: 20, fontWeight: "900", letterSpacing: 1.5 },
  summarySubtitle: { color: "#6B7280", fontSize: 11, marginTop: 3 },
  closeButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#141922", alignItems: "center", justifyContent: "center" },
  summaryScroll: { paddingHorizontal: 16, paddingBottom: 35 },
  summaryMapCard: { height: height * 0.39, borderRadius: 24, overflow: "hidden", borderWidth: 1, borderColor: "#202733", backgroundColor: "#11161E" },
  summaryMap: { flex: 1 },
  summaryMapLabel: { position: "absolute", top: 13, left: 13, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: "rgba(8,11,16,0.88)" },
  summaryMapLabelText: { color: "#9CA3AF", fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  bigSummaryCard: { marginTop: 13, padding: 19, borderRadius: 21, backgroundColor: "#11161E", borderWidth: 1, borderColor: "#1B222D", alignItems: "center" },
  bigSummaryLabel: { color: "#6B7280", fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  bigSummaryValue: { color: "#FFFFFF", fontSize: 39, fontWeight: "900", marginTop: 2 },
  bigSummaryUnit: { color: "#6B7280", fontSize: 14 },
  bigSummaryTime: { color: "#9CA3AF", fontSize: 13, fontWeight: "700", marginTop: 2 },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9, marginTop: 10 },
  summaryBox: { width: (width - 41) / 2, minHeight: 100, borderRadius: 18, backgroundColor: "#11161E", borderWidth: 1, borderColor: "#1B222D", padding: 13 },
  summaryBoxLabel: { color: "#6B7280", fontSize: 8, fontWeight: "900", letterSpacing: 1, marginTop: 8 },
  summaryBoxValue: { color: "#FFFFFF", fontSize: 17, fontWeight: "900", marginTop: 4 },
  spectrumCard: { marginTop: 10, padding: 15, borderRadius: 18, backgroundColor: "#11161E", borderWidth: 1, borderColor: "#1B222D" },
  spectrumTitle: { color: "#9CA3AF", fontSize: 9, fontWeight: "900", letterSpacing: 1.3, marginBottom: 9 },
  spectrumGradient: { height: 10, borderRadius: 5, overflow: "hidden", flexDirection: "row" },
  spectrumBottomLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  spectrumBottomText: { color: "#6B7280", fontSize: 8, fontWeight: "800" },
  doneButton: { height: 56, borderRadius: 18, backgroundColor: "#22C55E", alignItems: "center", justifyContent: "center", marginTop: 13 },
  doneButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900", letterSpacing: 1.2 },
  historyScroll: { paddingHorizontal: 16, paddingBottom: 30 },
  historyCard: { backgroundColor: "#11161E", borderRadius: 19, borderWidth: 1, borderColor: "#1B222D", padding: 15, marginBottom: 10 },
  historyCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  historyDate: { color: "#6B7280", fontSize: 10, fontWeight: "800" },
  historyDistance: { color: "#FFFFFF", fontSize: 22, fontWeight: "900", marginTop: 2 },
  historyStats: { flexDirection: "row", marginTop: 13, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#1B222D" },
  historyStat: { flex: 1 },
  historyStatLabel: { color: "#6B7280", fontSize: 7, fontWeight: "900", letterSpacing: 0.8 },
  historyStatValue: { color: "#FFFFFF", fontSize: 11, fontWeight: "800", marginTop: 3 },
  emptyHistory: { minHeight: height * 0.65, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  emptyHistoryTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "900", marginTop: 14 },
  emptyHistoryText: { color: "#6B7280", fontSize: 12, textAlign: "center", lineHeight: 18, marginTop: 6 },
});
