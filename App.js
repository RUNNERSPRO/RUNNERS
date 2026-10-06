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
   RAFTAAR DESIGN SYSTEM
========================================================= */

const COLORS = {
  bg: "#050505",
  surface: "#0A0A0A",
  surface2: "#0E0E0E",
  surface3: "#131313",

  white: "#F5F5F5",
  muted: "#777777",
  muted2: "#4A4A4A",

  border: "#1C1C1C",
  borderLight: "#282828",

  lime: "#A8FF00",
  limeDark: "#7FC700",

  red: "#EF4444",
  orange: "#FF8A00",
  yellow: "#FFD000",
};

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
  { speed: 4, color: "#FF8A00" },
  { speed: 7, color: "#FFD000" },
  { speed: 10, color: "#A8FF00" },
  { speed: 13, color: "#62E000" },
  { speed: 16, color: "#A8FF00" },
  { speed: 20, color: "#A8FF00" },
];

/* =========================================================
   HELPERS
========================================================= */

function getDirection(heading) {
  if (heading === null || heading === undefined || heading < 0) return "--";

  const val = Math.floor(heading / 45 + 0.5);
  const arr = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

  return arr[val % 8];
}

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
      .map((v) =>
        Math.round(v)
          .toString(16)
          .padStart(2, "0")
          .toUpperCase()
      )
      .join("")
  );
}

function getSpectrumColor(speed) {
  const s = Math.max(
    SPEED_STOPS[0].speed,
    Math.min(
      SPEED_STOPS[SPEED_STOPS.length - 1].speed,
      Number(speed) || 0
    )
  );

  for (let i = 0; i < SPEED_STOPS.length - 1; i++) {
    const current = SPEED_STOPS[i];
    const next = SPEED_STOPS[i + 1];

    if (s >= current.speed && s <= next.speed) {
      const ratio =
        (s - current.speed) / (next.speed - current.speed || 1);

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
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return (
    2 *
    R *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  );
}

function isValidCoordinate(point) {
  if (!point) return false;

  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);

  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function mapCoordinate(point) {
  return {
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
    altitude: point.altitude,
    heading: point.heading,
  };
}

function compressSegment(segment, maxPoints) {
  if (!segment.length) return [];

  if (segment.length <= maxPoints) {
    return segment;
  }

  if (maxPoints <= 1) {
    return [segment[segment.length - 1]];
  }

  const result = [];
  const step = (segment.length - 1) / (maxPoints - 1);

  for (let i = 0; i < maxPoints; i++) {
    result.push(segment[Math.round(i * step)]);
  }

  return result;
}

function compactRoute(points, maxPoints = MAX_ROUTE_POINTS) {
  if (!Array.isArray(points)) return [];

  const valid = points.filter(isValidCoordinate);

  if (valid.length <= maxPoints) {
    return valid;
  }

  const segments = [];
  let current = [];

  valid.forEach((point, index) => {
    if (index === 0) {
      current = [point];
      return;
    }

    if (point.breakBefore) {
      if (current.length) {
        segments.push(current);
      }

      current = [point];
    } else {
      current.push(point);
    }
  });

  if (current.length) {
    segments.push(current);
  }

  if (segments.length === 1) {
    return compressSegment(segments[0], maxPoints);
  }

  const minimumPerSegment = 2;
  const allocation = segments.map(() => 0);

  let remaining = maxPoints;

  segments.forEach((segment, index) => {
    if (remaining >= minimumPerSegment) {
      allocation[index] = Math.min(
        minimumPerSegment,
        segment.length
      );

      remaining -= allocation[index];
    }
  });

  while (remaining > 0) {
    let largestIndex = -1;
    let largestAvailable = 0;

    segments.forEach((segment, index) => {
      const available =
        segment.length - allocation[index];

      if (available > largestAvailable) {
        largestAvailable = available;
        largestIndex = index;
      }
    });

    if (
      largestIndex === -1 ||
      largestAvailable <= 0
    ) {
      break;
    }

    allocation[largestIndex]++;
    remaining--;
  }

  const result = [];

  segments.forEach((segment, index) => {
    const compressed = compressSegment(
      segment,
      Math.max(1, allocation[index])
    );

    if (index > 0 && compressed.length) {
      compressed[0] = {
        ...compressed[0],
        breakBefore: true,
      };
    }

    result.push(...compressed);
  });

  return result;
}

function formatTime(seconds) {
  const total = Math.max(
    0,
    Math.floor(Number(seconds) || 0)
  );

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${String(hours).padStart(
      2,
      "0"
    )}:${String(minutes).padStart(
      2,
      "0"
    )}:${String(secs).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(
    2,
    "0"
  )}:${String(secs).padStart(2, "0")}`;
}

function getPace(distanceKm, seconds) {
  if (
    !distanceKm ||
    distanceKm <= 0 ||
    !seconds ||
    seconds <= 0
  ) {
    return "--:--";
  }

  const paceSeconds = seconds / distanceKm;

  return `${Math.floor(
    paceSeconds / 60
  )}:${String(
    Math.floor(paceSeconds % 60)
  ).padStart(2, "0")}`;
}

function estimatedCalories(distanceKm) {
  return Math.round(
    Math.max(0, Number(distanceKm) || 0) * 65
  );
}

function getGpsStatus(accuracy) {
  if (!Number.isFinite(Number(accuracy))) {
    return {
      label: "SEARCHING",
      color: "#F59E0B",
    };
  }

  if (accuracy <= 10) {
    return {
      label: "EXCELLENT",
      color: COLORS.lime,
    };
  }

  if (accuracy <= 20) {
    return {
      label: "GOOD",
      color: COLORS.lime,
    };
  }

  if (accuracy <= 30) {
    return {
      label: "FAIR",
      color: COLORS.yellow,
    };
  }

  return {
    label: "WEAK",
    color: COLORS.red,
  };
}

function smoothSpeed(previous, current) {
  return (
    (Number(previous) || 0) * 0.85 +
    (Number(current) || 0) * 0.15
  );
}

/* =========================================================
   PREMIUM DARK MAP
========================================================= */

const darkMapStyle = [
  {
    elementType: "geometry",
    stylers: [{ color: "#090909" }],
  },
  {
    elementType: "labels.text.fill",
    stylers: [{ color: "#666666" }],
  },
  {
    elementType: "labels.text.stroke",
    stylers: [{ color: "#090909" }],
  },
  {
    featureType: "administrative",
    elementType: "geometry",
    stylers: [{ color: "#191919" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#171717" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#0A0A0A" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#202020" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#0A0A0A" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#070707" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#101010" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#555555" }],
  },
  {
    featureType: "transit",
    stylers: [{ visibility: "off" }],
  },
];

/* =========================================================
   ROUTE
========================================================= */

const MemoizedSpectrumRoute = React.memo(
  ({ points, prefix = "route" }) => {
    if (!Array.isArray(points) || points.length < 2) {
      return null;
    }

    const segments = (function splitRouteSegments(pts) {
      const valid = pts.filter(isValidCoordinate);

      if (valid.length < 2) return [];

      const segs = [];
      let cur = [];

      valid.forEach((p, i) => {
        if (i === 0) {
          cur = [p];
          return;
        }

        if (p.breakBefore) {
          if (cur.length >= 2) {
            segs.push(cur);
          }

          cur = [p];
        } else {
          cur.push(p);
        }
      });

      if (cur.length >= 2) {
        segs.push(cur);
      }

      return segs;
    })(points);

    return (
      <>
        {segments.map((segment, segmentIndex) => {
          if (segment.length < 2) {
            return null;
          }

          const colorChunks = [];

          let currentChunk = [segment[0]];
          let currentColor = null;

          for (
            let i = 0;
            i < segment.length - 1;
            i++
          ) {
            const point = segment[i];
            const next = segment[i + 1];

            const color = getSpectrumColor(
              (Number(point.speedKmh || 0) +
                Number(next.speedKmh || 0)) /
                2
            );

            if (currentColor === null) {
              currentColor = color;
            }

            if (color !== currentColor) {
              colorChunks.push({
                color: currentColor,
                coordinates: [...currentChunk],
              });

              currentChunk = [point, next];
              currentColor = color;
            } else {
              currentChunk.push(next);
            }
          }

          if (currentChunk.length > 1) {
            colorChunks.push({
              color: currentColor,
              coordinates: currentChunk,
            });
          }

          return (
            <React.Fragment
              key={`${prefix}-segment-${segmentIndex}`}
            >
              <Polyline
                coordinates={segment.map(mapCoordinate)}
                strokeColor="rgba(0,0,0,0.80)"
                strokeWidth={10}
                lineCap="round"
                lineJoin="round"
                zIndex={1}
              />

              {colorChunks.map(
                (chunk, chunkIndex) => (
                  <Polyline
                    key={`${prefix}-${segmentIndex}-${chunkIndex}`}
                    coordinates={chunk.coordinates.map(
                      mapCoordinate
                    )}
                    strokeColor={chunk.color}
                    strokeWidth={6}
                    lineCap="round"
                    lineJoin="round"
                    zIndex={2}
                  />
                )
              )}
            </React.Fragment>
          );
        })}
      </>
    );
  },
  (prevProps, nextProps) =>
    prevProps.points?.length ===
    nextProps.points?.length
);

/* =========================================================
   MARKERS
========================================================= */

const StartMarker = React.memo(({ coordinate }) => {
  if (
    !coordinate ||
    !isValidCoordinate(coordinate)
  ) {
    return null;
  }

  return (
    <Marker
      coordinate={mapCoordinate(coordinate)}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={styles.startMarker}>
        <View style={styles.startMarkerDot} />
      </View>
    </Marker>
  );
});

const FinishMarker = React.memo(({ coordinate }) => {
  if (
    !coordinate ||
    !isValidCoordinate(coordinate)
  ) {
    return null;
  }

  return (
    <Marker
      coordinate={mapCoordinate(coordinate)}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={styles.finishMarker}>
        <View style={styles.finishMarkerInner} />
      </View>
    </Marker>
  );
});

const LiveMarker = React.memo(({ coordinate }) => {
  if (
    !coordinate ||
    !isValidCoordinate(coordinate)
  ) {
    return null;
  }

  return (
    <Marker
      coordinate={mapCoordinate(coordinate)}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={999}
    >
      <View style={styles.liveMarker}>
        <View style={styles.liveMarkerInner} />
      </View>
    </Marker>
  );
});

/* =========================================================
   BACKGROUND LOCATION
========================================================= */

TaskManager.defineTask(
  LOCATION_TASK_NAME,
  async ({ data, error }) => {
    if (
      error ||
      !data?.locations?.length
    ) {
      return;
    }

    try {
      const stored =
        await AsyncStorage.getItem(
          SESSION_KEY
        );

      if (!stored) return;

      const session = JSON.parse(stored);

      if (
        !session ||
        !session.running ||
        session.paused
      ) {
        return;
      }

      let updatedSession = {
        ...session,
      };

      for (const locationData of data.locations) {
        const coords =
          locationData?.coords;

        if (!coords) continue;

        const {
          latitude,
          longitude,
          accuracy,
          altitude,
          heading,
        } = coords;

        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          (Number.isFinite(accuracy) &&
            accuracy > MAX_ACCURACY)
        ) {
          continue;
        }

        const timestamp =
          Number(locationData.timestamp) ||
          Date.now();

        const currentPoint = {
          latitude,
          longitude,
          accuracy,
          timestamp,
          altitude: altitude || 0,
          heading:
            heading === null ||
            heading === undefined
              ? -1
              : heading,
        };

        const previous =
          updatedSession.lastPoint ||
          updatedSession.route?.[
            updatedSession.route.length - 1
          ];

        if (!previous) {
          updatedSession.lastPoint =
            currentPoint;

          updatedSession.route = [
            ...(updatedSession.route || []),
            {
              ...currentPoint,
              speedKmh: 0,
            },
          ];

          continue;
        }

        const distance = distanceMeters(
          previous.latitude,
          previous.longitude,
          latitude,
          longitude
        );

        const deltaTime = Math.max(
          0.5,
          (timestamp -
            (Number(previous.timestamp) ||
              timestamp)) /
            1000
        );

        const calculatedSpeed =
          (distance / deltaTime) * 3.6;

        if (
          calculatedSpeed >
            MAX_RUNNING_SPEED_KMH ||
          distance < MIN_MOVEMENT_METERS
        ) {
          continue;
        }

        const smoothedSpeed =
          smoothSpeed(
            updatedSession.speedKmh || 0,
            Math.max(0, calculatedSpeed)
          );

        const newPoint = {
          ...currentPoint,
          speedKmh: Number(
            smoothedSpeed.toFixed(2)
          ),
        };

        if (
          updatedSession.routeBreakPending
        ) {
          newPoint.breakBefore = true;
          updatedSession.routeBreakPending =
            false;
        }

        updatedSession.route =
          compactRoute(
            [
              ...(updatedSession.route || []),
              newPoint,
            ],
            MAX_ROUTE_POINTS
          );

        updatedSession.lastPoint =
          currentPoint;

        updatedSession.speedKmh = Number(
          smoothedSpeed.toFixed(2)
        );

        updatedSession.topSpeedKmh =
          Math.max(
            Number(
              updatedSession.topSpeedKmh || 0
            ),
            Math.max(0, calculatedSpeed)
          );

        updatedSession.distanceMeters =
          Number(
            updatedSession.distanceMeters || 0
          ) + distance;
      }

      await AsyncStorage.setItem(
        SESSION_KEY,
        JSON.stringify(updatedSession)
      );
    } catch (err) {}
  }
);

/* =========================================================
   MAIN APP
========================================================= */

export default function App() {
  const mapRef = useRef(null);
  const completionMapRef = useRef(null);

  const [permissionGranted, setPermissionGranted] =
    useState(false);

  const [location, setLocation] =
    useState(null);

  const [accuracy, setAccuracy] =
    useState(null);

  const [isConnected, setIsConnected] =
    useState(true);

  /* RUN STATE */

  const [running, setRunning] =
    useState(false);

  const [paused, setPaused] =
    useState(false);

  const [timeData, setTimeData] =
    useState({
      accumulatedMs: 0,
      lastResumeTime: 0,
    });

  const [elapsedSeconds, setElapsedSeconds] =
    useState(0);

  const [distance, setDistance] =
    useState(0);

  const [speed, setSpeed] =
    useState(0);

  const [topSpeed, setTopSpeed] =
    useState(0);

  const [route, setRoute] =
    useState([]);

  /* MISSION */

  const [targetDistance, setTargetDistance] =
    useState(null);

  const [challengeCompleted, setChallengeCompleted] =
    useState(false);

  const [missionModalVisible, setMissionModalVisible] =
    useState(false);

  /* UI */

  const [mapType, setMapType] =
    useState("standard");

  const [followUser, setFollowUser] =
    useState(true);

  const [summaryVisible, setSummaryVisible] =
    useState(false);

  const [historyVisible, setHistoryVisible] =
    useState(false);

  const [summary, setSummary] =
    useState(null);

  const [history, setHistory] =
    useState([]);

  const [mapRendered, setMapRendered] =
    useState(false);

  const [mapLayoutSet, setMapLayoutSet] =
    useState(false);

  /* ANIMATION */

  const runAnim =
    useRef(new Animated.Value(0)).current;

  const glowAnim =
    useRef(new Animated.Value(0)).current;

  /* =====================================================
     INIT
  ===================================================== */

  useEffect(() => {
    initializeApp();

    const unsubscribe =
      NetInfo.addEventListener((state) => {
        setIsConnected(
          Boolean(state.isConnected)
        );
      });

    return () => unsubscribe();
  }, []);

  /* =====================================================
     RUNNER ANIMATION
  ===================================================== */

  useEffect(() => {
    if (running && !paused) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(runAnim, {
            toValue: 1,
            duration: 350,
            useNativeDriver: true,
          }),
          Animated.timing(runAnim, {
            toValue: 0,
            duration: 350,
            useNativeDriver: true,
          }),
        ])
      ).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 1,
            duration: 1100,
            useNativeDriver: false,
          }),
          Animated.timing(glowAnim, {
            toValue: 0,
            duration: 1100,
            useNativeDriver: false,
          }),
        ])
      ).start();
    } else {
      runAnim.stopAnimation();
      runAnim.setValue(0);

      glowAnim.stopAnimation();
      glowAnim.setValue(0);
    }
  }, [running, paused]);

  const translateY = runAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -12],
  });

  const glowOpacity =
    glowAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.15, 0.45],
    });

  /* =====================================================
     CHALLENGE
  ===================================================== */

  useEffect(() => {
    if (
      running &&
      targetDistance &&
      !challengeCompleted
    ) {
      if (distance >= targetDistance) {
        setChallengeCompleted(true);

        Speech.speak(
          "Mission completed",
          {
            language: "en-IN",
            rate: 0.95,
          }
        );

        Alert.alert(
          "MISSION COMPLETE",
          `You completed your ${targetDistance} KM mission. Great work!`
        );

        AsyncStorage.getItem(
          SESSION_KEY
        ).then((stored) => {
          if (stored) {
            const s = JSON.parse(stored);

            s.challengeCompleted = true;

            AsyncStorage.setItem(
              SESSION_KEY,
              JSON.stringify(s)
            );
          }
        });
      }
    }
  }, [
    distance,
    running,
    targetDistance,
    challengeCompleted,
  ]);

  /* =====================================================
     INITIALIZE
  ===================================================== */

  async function initializeApp() {
    await loadHistory();
    await setupLocation();
  }

  async function loadHistory() {
    try {
      const saved =
        await AsyncStorage.getItem(
          HISTORY_KEY
        );

      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch (error) {}
  }

  /* =====================================================
     TIMER
  ===================================================== */

  useEffect(() => {
    let interval;

    if (running) {
      interval = setInterval(() => {
        if (
          paused ||
          !timeData.lastResumeTime
        ) {
          setElapsedSeconds(
            Math.floor(
              timeData.accumulatedMs / 1000
            )
          );
        } else {
          setElapsedSeconds(
            Math.floor(
              (
                timeData.accumulatedMs +
                (Date.now() -
                  timeData.lastResumeTime)
              ) / 1000
            )
          );
        }
      }, 1000);
    }

    return () =>
      clearInterval(interval);
  }, [
    running,
    paused,
    timeData,
  ]);

  /* =====================================================
     LOCATION SETUP
  ===================================================== */

  async function setupLocation() {
    try {
      const foreground =
        await Location.requestForegroundPermissionsAsync();

      if (
        foreground.status !==
        "granted"
      ) {
        Alert.alert(
          "Location Required",
          "Location permission is required to track your run."
        );

        return false;
      }

      setPermissionGranted(true);

      const current =
        await Location.getCurrentPositionAsync(
          {
            accuracy:
              Location.Accuracy.High,
          }
        );

      if (current?.coords) {
        setLocation({
          latitude:
            current.coords.latitude,
          longitude:
            current.coords.longitude,
          altitude:
            current.coords.altitude,
          heading:
            current.coords.heading,
        });

        setAccuracy(
          current.coords.accuracy
        );
      }

      const stored =
        await AsyncStorage.getItem(
          SESSION_KEY
        );

      if (stored) {
        const session =
          JSON.parse(stored);

        if (session?.running) {
          setRunning(true);
          setPaused(
            Boolean(session.paused)
          );

          setTimeData(
            session.timeData || {
              accumulatedMs: 0,
              lastResumeTime: 0,
            }
          );

          setDistance(
            Number(
              session.distanceMeters || 0
            ) / 1000
          );

          setSpeed(
            Number(
              session.speedKmh || 0
            )
          );

          setTopSpeed(
            Number(
              session.topSpeedKmh || 0
            )
          );

          setRoute(
            Array.isArray(session.route)
              ? session.route
              : []
          );

          setTargetDistance(
            session.targetDistance ||
              null
          );

          setChallengeCompleted(
            session.challengeCompleted ||
              false
          );
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /* =====================================================
     BACKGROUND LOCATION SERVICE
  ===================================================== */

  async function startLocationService() {
    try {
      const enabled =
        await Location.hasServicesEnabledAsync();

      if (!enabled) {
        Alert.alert(
          "Location Services Off",
          "Please turn on Location Services."
        );

        return false;
      }

      const background =
        await Location.requestBackgroundPermissionsAsync();

      if (
        background.status !==
        "granted"
      ) {
        Alert.alert(
          "Background Location Required",
          "Allow background location permission so Raftaar can continue tracking your run."
        );

        return false;
      }

      const alreadyStarted =
        await Location.hasStartedLocationUpdatesAsync(
          LOCATION_TASK_NAME
        );

      if (!alreadyStarted) {
        await Location.startLocationUpdatesAsync(
          LOCATION_TASK_NAME,
          {
            accuracy:
              Location.Accuracy
                .BestForNavigation,

            timeInterval: 1000,

            distanceInterval: 2,

            showsBackgroundLocationIndicator:
              true,

            foregroundService: {
              notificationTitle:
                "Raftaar",

              notificationBody:
                "Your run is being tracked.",
            },
          }
        );
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /* =====================================================
     SYNC BACKGROUND SESSION
  ===================================================== */

  useEffect(() => {
    if (!running) return;

    const interval =
      setInterval(async () => {
        try {
          const stored =
            await AsyncStorage.getItem(
              SESSION_KEY
            );

          if (!stored) return;

          const session =
            JSON.parse(stored);

          setDistance(
            Number(
              session.distanceMeters || 0
            ) / 1000
          );

          setSpeed(
            Number(
              session.speedKmh || 0
            )
          );

          setTopSpeed(
            Number(
              session.topSpeedKmh || 0
            )
          );

          if (
            Array.isArray(
              session.route
            )
          ) {
            setRoute((prev) =>
              prev.length !==
              session.route.length
                ? session.route
                : prev
            );
          }

          if (
            session.lastPoint &&
            isValidCoordinate(
              session.lastPoint
            )
          ) {
            const point =
              mapCoordinate(
                session.lastPoint
              );

            setLocation(point);

            setAccuracy(
              Number(
                session.lastPoint.accuracy
              )
            );

            if (
              followUser &&
              mapRef.current &&
              isConnected
            ) {
              mapRef.current.animateToRegion(
                {
                  ...point,
                  latitudeDelta:
                    MAP_DELTA,
                  longitudeDelta:
                    MAP_DELTA,
                },
                500
              );
            }
          }
        } catch (error) {}
      }, 1000);

    return () =>
      clearInterval(interval);
  }, [
    running,
    followUser,
    isConnected,
  ]);

  /* =====================================================
     START MISSION
  ===================================================== */

  async function confirmMissionStart(
    targetKm
  ) {
    setMissionModalVisible(false);

    let ready =
      permissionGranted;

    if (!ready) {
      ready =
        await setupLocation();
    }

    if (!ready) return;

    const started =
      await startLocationService();

    if (!started) return;

    try {
      const current =
        await Location.getCurrentPositionAsync(
          {
            accuracy:
              Location.Accuracy
                .BestForNavigation,
          }
        );

      const now = Date.now();

      const firstPoint = {
        latitude:
          current.coords.latitude,

        longitude:
          current.coords.longitude,

        accuracy:
          current.coords.accuracy,

        altitude:
          current.coords.altitude || 0,

        heading:
          current.coords.heading ??
          -1,

        timestamp: now,

        speedKmh: 0,
      };

      const newTimeData = {
        accumulatedMs: 0,
        lastResumeTime: now,
      };

      const newSession = {
        running: true,
        paused: false,

        timeData:
          newTimeData,

        distanceMeters: 0,

        speedKmh: 0,

        topSpeedKmh: 0,

        route: [firstPoint],

        lastPoint: firstPoint,

        routeBreakPending:
          false,

        targetDistance:
          targetKm,

        challengeCompleted:
          false,
      };

      await AsyncStorage.setItem(
        SESSION_KEY,
        JSON.stringify(newSession)
      );

      setTargetDistance(targetKm);

      setChallengeCompleted(false);

      setLocation(
        mapCoordinate(firstPoint)
      );

      setAccuracy(
        firstPoint.accuracy
      );

      setTimeData(
        newTimeData
      );

      setElapsedSeconds(0);

      setRunning(true);

      setPaused(false);

      setDistance(0);

      setSpeed(0);

      setTopSpeed(0);

      setRoute([firstPoint]);

      Speech.speak(
        targetKm
          ? `Mission ${targetKm} kilometers started`
          : "Free Run started",
        {
          language: "en-IN",
          rate: 0.95,
        }
      );

      Vibration.vibrate(100);
    } catch (error) {
      Alert.alert(
        "Error",
        "Could not start tracking."
      );
    }
  }

  /* =====================================================
     PAUSE
  ===================================================== */

  async function pauseRun() {
    const newTimeData = {
      accumulatedMs:
        timeData.accumulatedMs +
        (Date.now() -
          timeData.lastResumeTime),

      lastResumeTime: null,
    };

    setPaused(true);

    setSpeed(0);

    setTimeData(
      newTimeData
    );

    await AsyncStorage.mergeItem(
      SESSION_KEY,
      JSON.stringify({
        paused: true,
        speedKmh: 0,
        routeBreakPending: true,
        timeData: newTimeData,
      })
    );

    Vibration.vibrate(100);

    Speech.speak(
      "Run paused",
      {
        language: "en-IN",
        rate: 0.95,
      }
    );
  }

  /* =====================================================
     RESUME
  ===================================================== */

  async function resumeRun() {
    try {
      const current =
        await Location.getCurrentPositionAsync(
          {
            accuracy:
              Location.Accuracy
                .BestForNavigation,
          }
        );

      const newTimeData = {
        accumulatedMs:
          timeData.accumulatedMs,

        lastResumeTime:
          Date.now(),
      };

      const point = {
        latitude:
          current.coords.latitude,

        longitude:
          current.coords.longitude,

        accuracy:
          current.coords.accuracy,

        altitude:
          current.coords.altitude || 0,

        heading:
          current.coords.heading ??
          -1,

        timestamp: Date.now(),

        speedKmh: 0,

        breakBefore: true,
      };

      setPaused(false);

      setSpeed(0);

      setTimeData(
        newTimeData
      );

      setRoute([
        ...route,
        point,
      ]);

      setLocation(
        mapCoordinate(point)
      );

      setAccuracy(
        point.accuracy
      );

      const stored =
        await AsyncStorage.getItem(
          SESSION_KEY
        );

      if (stored) {
        const session =
          JSON.parse(stored);

        session.paused = false;

        session.speedKmh = 0;

        session.timeData =
          newTimeData;

        session.routeBreakPending =
          false;

        session.route = [
          ...(session.route || []),
          point,
        ];

        session.lastPoint =
          point;

        await AsyncStorage.setItem(
          SESSION_KEY,
          JSON.stringify(session)
        );
      }

      Speech.speak(
        "Run resumed",
        {
          language: "en-IN",
          rate: 0.95,
        }
      );

      Vibration.vibrate(100);
    } catch (error) {}
  }

  /* =====================================================
     FINISH
  ===================================================== */

  function finishRun() {
    Alert.alert(
      "Finish Run?",
      "Are you sure you want to finish this run?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Finish",
          style: "destructive",
          onPress: completeRun,
        },
      ]
    );
  }

  async function completeRun() {
    try {
      const finalRoute =
        compactRoute(
          route,
          MAX_ROUTE_POINTS
        );

      const averageSpeed =
        elapsedSeconds > 0
          ? distance /
            (elapsedSeconds / 3600)
          : 0;

      const workout = {
        id: String(Date.now()),

        date:
          new Date().toISOString(),

        distanceKm:
          Number(
            distance.toFixed(3)
          ),

        durationSeconds:
          elapsedSeconds,

        averageSpeedKmh:
          Number(
            averageSpeed.toFixed(2)
          ),

        topSpeedKmh:
          Number(
            topSpeed.toFixed(2)
          ),

        pace: getPace(
          distance,
          elapsedSeconds
        ),

        calories:
          estimatedCalories(
            distance
          ),

        route: finalRoute,

        targetDistance:
          targetDistance,
      };

      const updatedHistory = [
        workout,
        ...history,
      ].slice(0, 50);

      await AsyncStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(
          updatedHistory
        )
      );

      await AsyncStorage.removeItem(
        SESSION_KEY
      );

      const started =
        await Location.hasStartedLocationUpdatesAsync(
          LOCATION_TASK_NAME
        );

      if (started) {
        await Location.stopLocationUpdatesAsync(
          LOCATION_TASK_NAME
        );
      }

      setHistory(
        updatedHistory
      );

      setSummary(workout);

      setMapRendered(false);

      setMapLayoutSet(false);

      setSummaryVisible(true);

      setRunning(false);

      setPaused(false);

      setSpeed(0);

      setTargetDistance(null);

      setChallengeCompleted(false);

      Speech.speak(
        "Run completed",
        {
          language: "en-IN",
          rate: 0.95,
        }
      );

      Vibration.vibrate([
        0,
        150,
        100,
        150,
      ]);
    } catch (error) {}
  }

  /* =====================================================
     SUMMARY MAP
  ===================================================== */

  useEffect(() => {
    if (
      summaryVisible &&
      mapRendered &&
      mapLayoutSet &&
      summary &&
      completionMapRef.current &&
      isConnected
    ) {
      const coordinates =
        Array.isArray(summary.route)
          ? summary.route
              .filter(
                isValidCoordinate
              )
              .map(mapCoordinate)
          : [];

      if (coordinates.length >= 2) {
        completionMapRef.current.fitToCoordinates(
          coordinates,
          {
            edgePadding: {
              top: 80,
              right: 40,
              bottom: 150,
              left: 40,
            },
            animated: true,
          }
        );
      }
    }
  }, [
    summaryVisible,
    mapRendered,
    mapLayoutSet,
    summary,
    isConnected,
  ]);

  const gpsStatus =
    getGpsStatus(accuracy);

  /* =====================================================
     RENDER
  ===================================================== */

  return (
    <SafeAreaView
      style={styles.safe}
    >
      <StatusBar
        hidden={true}
        barStyle="light-content"
        backgroundColor={COLORS.bg}
      />

      <View
        style={styles.container}
      >

        {/* =================================================
            HEADER
        ================================================= */}

        <View style={styles.header}>

          <View>

            <Text
              style={styles.appTitle}
            >
              Raftaar.
            </Text>

            <View
              style={styles.gpsRow}
            >
              <View
                style={[
                  styles.gpsDot,
                  {
                    backgroundColor:
                      gpsStatus.color,
                  },
                ]}
              />

              <Text
                style={styles.gpsText}
              >
                GPS {gpsStatus.label}
              </Text>

              {Number.isFinite(
                Number(accuracy)
              ) && (
                <Text
                  style={
                    styles.accuracyText
                  }
                >
                  ±
                  {Math.round(
                    accuracy
                  )}
                  m
                </Text>
              )}
            </View>

          </View>

          <TouchableOpacity
            style={
              styles.headerButton
            }
            onPress={() =>
              setHistoryVisible(true)
            }
            activeOpacity={0.8}
          >
            <Ionicons
              name="time-outline"
              size={21}
              color={COLORS.white}
            />
          </TouchableOpacity>

        </View>


        {/* =================================================
            MAP
        ================================================= */}

        <View
          style={styles.mapContainer}
        >

          {isConnected ? (
            <>

              <MapView
                ref={mapRef}
                style={styles.map}
                mapType={mapType}
                customMapStyle={
                  mapType ===
                  "standard"
                    ? darkMapStyle
                    : undefined
                }
                showsCompass={false}
                showsBuildings={false}
                showsTraffic={false}
                showsIndoors={false}
                showsUserLocation={false}
                initialRegion={
                  location
                    ? {
                        ...location,
                        latitudeDelta:
                          MAP_DELTA,
                        longitudeDelta:
                          MAP_DELTA,
                      }
                    : {
                        latitude: 28.6139,
                        longitude: 77.209,
                        latitudeDelta: 0.08,
                        longitudeDelta: 0.08,
                      }
                }
              >

                <MemoizedSpectrumRoute
                  points={route}
                  prefix="live"
                />

                {route.length > 0 && (
                  <StartMarker
                    coordinate={
                      route[0]
                    }
                  />
                )}

                {running &&
                  location && (
                    <LiveMarker
                      coordinate={
                        location
                      }
                    />
                  )}

              </MapView>


              {/* SPEED LEGEND */}

              <View
                style={styles.legend}
              >

                <Text
                  style={
                    styles.legendTitle
                  }
                >
                  SPEED SPECTRUM
                </Text>

                <View
                  style={
                    styles.legendBar
                  }
                >
                  {SPEED_STOPS.map(
                    (stop) => (
                      <View
                        key={
                          stop.speed
                        }
                        style={[
                          styles.legendColor,
                          {
                            backgroundColor:
                              stop.color,
                          },
                        ]}
                      />
                    )
                  )}
                </View>

                <View
                  style={
                    styles.legendLabels
                  }
                >
                  <Text
                    style={
                      styles.legendText
                    }
                  >
                    SLOW
                  </Text>

                  <Text
                    style={
                      styles.legendText
                    }
                  >
                    FAST
                  </Text>
                </View>

              </View>


              {/* MAP CONTROLS */}

              <View
                style={
                  styles.mapControls
                }
              >

                <TouchableOpacity
                  style={
                    styles.mapControl
                  }
                  onPress={() =>
                    setFollowUser(
                      (v) => !v
                    )
                  }
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={
                      followUser
                        ? "locate"
                        : "locate-outline"
                    }
                    size={20}
                    color={
                      followUser
                        ? COLORS.lime
                        : COLORS.white
                    }
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={
                    styles.mapControl
                  }
                  onPress={() =>
                    setMapType(
                      (c) =>
                        c ===
                        "standard"
                          ? "satellite"
                          : "standard"
                    )
                  }
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="layers-outline"
                    size={20}
                    color={
                      COLORS.white
                    }
                  />
                </TouchableOpacity>

              </View>

            </>
          ) : (

            /* =================================================
               OFFLINE MODE
            ================================================= */

            <View
              style={
                styles.offlineFallback
              }
            >

              {running &&
              !paused ? (
                <Animated.View
                  style={{
                    transform: [
                      {
                        translateY,
                      },
                    ],
                    marginBottom: 15,
                  }}
                >
                  <FontAwesome5
                    name="running"
                    size={43}
                    color={
                      COLORS.lime
                    }
                  />
                </Animated.View>
              ) : (
                <Ionicons
                  name="cloud-offline"
                  size={40}
                  color={
                    COLORS.muted2
                  }
                  style={{
                    marginBottom: 15,
                  }}
                />
              )}

              <Text
                style={
                  styles.offlineTitle
                }
              >
                {running &&
                !paused
                  ? "TRACKING OFFLINE"
                  : "OFFLINE MODE"}
              </Text>

              {targetDistance ? (
                <>
                  <Text
                    style={
                      styles.bigMetricLabel
                    }
                  >
                    DISTANCE REMAINING
                  </Text>

                  <Text
                    style={
                      styles.bigMetricValue
                    }
                  >
                    {Math.max(
                      0,
                      targetDistance -
                        distance
                    ).toFixed(2)}
                  </Text>

                  <Text
                    style={
                      styles.bigMetricUnit
                    }
                  >
                    KM /{" "}
                    {targetDistance}{" "}
                    KM TARGET
                  </Text>
                </>
              ) : (
                <>
                  <Text
                    style={
                      styles.bigMetricLabel
                    }
                  >
                    ELAPSED TIME
                  </Text>

                  <Text
                    style={
                      styles.bigMetricValue
                    }
                  >
                    {formatTime(
                      elapsedSeconds
                    )}
                  </Text>

                  <Text
                    style={
                      styles.bigMetricUnit
                    }
                  >
                    HR : MIN : SEC
                  </Text>
                </>
              )}

              <View
                style={
                  styles.offlineExtraStatsRow
                }
              >

                <View
                  style={
                    styles.offlineExtraStat
                  }
                >
                  <Ionicons
                    name="triangle-outline"
                    size={18}
                    color={
                      COLORS.muted
                    }
                  />

                  <Text
                    style={
                      styles.offlineExtraLabel
                    }
                  >
                    ALTITUDE
                  </Text>

                  <Text
                    style={
                      styles.offlineExtraValue
                    }
                  >
                    {location?.altitude
                      ? Math.round(
                          location.altitude
                        )
                      : "--"}

                    <Text
                      style={
                        styles.offlineExtraUnit
                      }
                    >
                      {" "}
                      m
                    </Text>
                  </Text>
                </View>


                <View
                  style={
                    styles.offlineExtraStat
                  }
                >

                  <Ionicons
                    name="compass"
                    size={22}
                    color={
                      COLORS.lime
                    }
                    style={{
                      transform: [
                        {
                          rotate: `${
                            location?.heading >=
                            0
                              ? location.heading
                              : 0
                          }deg`,
                        },
                      ],
                    }}
                  />

                  <Text
                    style={
                      styles.offlineExtraLabel
                    }
                  >
                    DIRECTION
                  </Text>

                  <Text
                    style={
                      styles.offlineExtraValue
                    }
                  >
                    {getDirection(
                      location?.heading
                    )}

                    <Text
                      style={
                        styles.offlineExtraUnit
                      }
                    >
                      {" "}
                      {location?.heading >=
                      0
                        ? Math.round(
                            location.heading
                          ) + "°"
                        : ""}
                    </Text>
                  </Text>

                </View>

              </View>

            </View>
          )}

        </View>


        {/* =================================================
            BOTTOM DASHBOARD
        ================================================= */}

        <View
          style={
            styles.bottomPanel
          }
        >

          <View
            style={
              styles.primaryMetric
            }
          >

            <Text
              style={
                styles.metricLabel
              }
            >
              DISTANCE
            </Text>

            <Text
              style={
                styles.distanceText
              }
            >
              {distance.toFixed(2)}

              <Text
                style={
                  styles.distanceUnit
                }
              >
                {" "}
                KM
              </Text>
            </Text>

            <View
              style={
                styles.timerPill
              }
            >
              <Ionicons
                name="time-outline"
                size={15}
                color={
                  COLORS.muted
                }
              />

              <Text
                style={
                  styles.timerText
                }
              >
                {formatTime(
                  elapsedSeconds
                )}
              </Text>
            </View>

          </View>


          {/* STATS */}

          <View
            style={styles.statsGrid}
          >

            <Stat
              icon="speedometer-outline"
              label="SPEED"
              value={speed.toFixed(1)}
              unit="KM/H"
            />

            <Stat
              icon="trending-up-outline"
              label="TOP SPEED"
              value={topSpeed.toFixed(1)}
              unit="KM/H"
            />

            <Stat
              icon="walk-outline"
              label="PACE"
              value={getPace(
                distance,
                elapsedSeconds
              )}
              unit="/KM"
            />

            <Stat
              icon="flame-outline"
              label="CALORIES"
              value={estimatedCalories(
                distance
              )}
              unit="KCAL"
            />

          </View>


          {/* CTA */}

          {!running ? (
            <TouchableOpacity
              style={[
                styles.startButton,
                {
                  shadowOpacity:
                    0.25,
                },
              ]}
              onPress={() =>
                setMissionModalVisible(
                  true
                )
              }
              activeOpacity={0.85}
            >
              <Ionicons
                name="play"
                size={21}
                color="#050505"
              />

              <Text
                style={
                  styles.startButtonText
                }
              >
                START MISSION
              </Text>
            </TouchableOpacity>
          ) : (

            <View
              style={
                styles.runningButtons
              }
            >

              <TouchableOpacity
                style={
                  styles.pauseButton
                }
                onPress={
                  paused
                    ? resumeRun
                    : pauseRun
                }
                activeOpacity={0.85}
              >
                <Ionicons
                  name={
                    paused
                      ? "play"
                      : "pause"
                  }
                  size={21}
                  color={
                    COLORS.white
                  }
                />

                <Text
                  style={
                    styles.actionButtonText
                  }
                >
                  {paused
                    ? "RESUME"
                    : "PAUSE"}
                </Text>
              </TouchableOpacity>


              <TouchableOpacity
                style={
                  styles.finishButton
                }
                onPress={finishRun}
                activeOpacity={0.85}
              >
                <Ionicons
                  name="stop"
                  size={21}
                  color={
                    COLORS.white
                  }
                />

                <Text
                  style={
                    styles.actionButtonText
                  }
                >
                  FINISH
                </Text>
              </TouchableOpacity>

            </View>
          )}

        </View>

      </View>


      {/* =====================================================
          MISSION MODAL
      ===================================================== */}

      <Modal
        visible={
          missionModalVisible
        }
        animationType="slide"
        transparent={true}
        onRequestClose={() =>
          setMissionModalVisible(
            false
          )
        }
      >

        <View
          style={
            styles.missionModalOverlay
          }
        >

          <View
            style={
              styles.missionModalContent
            }
          >

            <View
              style={
                styles.missionModalHeader
              }
            >

              <View>
                <Text
                  style={
                    styles.missionModalTitle
                  }
                >
                  START A RUN
                </Text>

                <Text
                  style={
                    styles.missionModalSub
                  }
                >
                  Choose how far you want
                  to push yourself.
                </Text>
              </View>

              <TouchableOpacity
                onPress={() =>
                  setMissionModalVisible(
                    false
                  )
                }
              >
                <Ionicons
                  name="close-circle"
                  size={28}
                  color={
                    COLORS.muted2
                  }
                />
              </TouchableOpacity>

            </View>


            <TouchableOpacity
              style={
                styles.missionOption
              }
              onPress={() =>
                confirmMissionStart(
                  null
                )
              }
            >
              <View
                style={
                  styles.missionIcon
                }
              >
                <Ionicons
                  name="infinite-outline"
                  size={22}
                  color={
                    COLORS.lime
                  }
                />
              </View>

              <View
                style={
                  styles.missionOptionContent
                }
              >
                <Text
                  style={
                    styles.missionOptionText
                  }
                >
                  Free Run
                </Text>

                <Text
                  style={
                    styles.missionOptionSub
                  }
                >
                  Run without a target
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={
                  COLORS.muted2
                }
              />
            </TouchableOpacity>


            <TouchableOpacity
              style={
                styles.missionOption
              }
              onPress={() =>
                confirmMissionStart(1)
              }
            >
              <View
                style={
                  styles.missionIcon
                }
              >
                <Text
                  style={
                    styles.missionIconNumber
                  }
                >
                  1
                </Text>
              </View>

              <View
                style={
                  styles.missionOptionContent
                }
              >
                <Text
                  style={
                    styles.missionOptionText
                  }
                >
                  1 KM Sprint
                </Text>

                <Text
                  style={
                    styles.missionOptionSub
                  }
                >
                  Quick speed session
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={
                  COLORS.muted2
                }
              />
            </TouchableOpacity>


            <TouchableOpacity
              style={
                styles.missionOption
              }
              onPress={() =>
                confirmMissionStart(3)
              }
            >
              <View
                style={
                  styles.missionIcon
                }
              >
                <Text
                  style={
                    styles.missionIconNumber
                  }
                >
                  3
                </Text>
              </View>

              <View
                style={
                  styles.missionOptionContent
                }
              >
                <Text
                  style={
                    styles.missionOptionText
                  }
                >
                  3 KM Challenge
                </Text>

                <Text
                  style={
                    styles.missionOptionSub
                  }
                >
                  Build your momentum
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={
                  COLORS.muted2
                }
              />
            </TouchableOpacity>


            <TouchableOpacity
              style={
                styles.missionOption
              }
              onPress={() =>
                confirmMissionStart(5)
              }
            >
              <View
                style={
                  styles.missionIcon
                }
              >
                <Text
                  style={
                    styles.missionIconNumber
                  }
                >
                  5
                </Text>
              </View>

              <View
                style={
                  styles.missionOptionContent
                }
              >
                <Text
                  style={
                    styles.missionOptionText
                  }
                >
                  5 KM Pro Mission
                </Text>

                <Text
                  style={
                    styles.missionOptionSub
                  }
                >
                  Serious distance
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={
                  COLORS.muted2
                }
              />
            </TouchableOpacity>


            <TouchableOpacity
              style={
                styles.missionOption
              }
              onPress={() =>
                confirmMissionStart(10)
              }
            >
              <View
                style={[
                  styles.missionIcon,
                  {
                    backgroundColor:
                      "rgba(168,255,0,0.14)",
                  },
                ]}
              >
                <Text
                  style={
                    styles.missionIconNumber
                  }
                >
                  10
                </Text>
              </View>

              <View
                style={
                  styles.missionOptionContent
                }
              >
                <Text
                  style={
                    styles.missionOptionText
                  }
                >
                  10 KM Endurance
                </Text>

                <Text
                  style={
                    styles.missionOptionSub
                  }
                >
                  Go beyond the usual
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={18}
                color={
                  COLORS.muted2
                }
              />
            </TouchableOpacity>

          </View>
        </View>

      </Modal>


      {/* =====================================================
          COMPLETION MODAL
      ===================================================== */}

      <Modal
        visible={summaryVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() =>
          setSummaryVisible(false)
        }
      >

        <SafeAreaView
          style={
            styles.modalSafe
          }
        >

          <View
            style={
              styles.summaryHeader
            }
          >

            <View>
              <Text
                style={
                  styles.summaryTitle
                }
              >
                RUN COMPLETE
              </Text>

              <Text
                style={
                  styles.summarySubtitle
                }
              >
                Another run in the books.
              </Text>
            </View>

            <TouchableOpacity
              style={
                styles.closeButton
              }
              onPress={() =>
                setSummaryVisible(
                  false
                )
              }
            >
              <Ionicons
                name="close"
                size={23}
                color={
                  COLORS.white
                }
              />
            </TouchableOpacity>

          </View>


          {summary && (
            <ScrollView
              showsVerticalScrollIndicator={
                false
              }
              contentContainerStyle={
                styles.summaryScroll
              }
            >

              {/* ACHIEVEMENT */}

              {summary.targetDistance &&
                summary.distanceKm >=
                  summary.targetDistance && (
                  <View
                    style={
                      styles.achievementBanner
                    }
                  >
                    <Ionicons
                      name="trophy"
                      size={23}
                      color={
                        COLORS.lime
                      }
                    />

                    <Text
                      style={
                        styles.achievementText
                      }
                    >
                      MISSION ACCOMPLISHED
                    </Text>
                  </View>
                )}


              {/* MAP */}

              <View
                style={
                  styles.summaryMapCard
                }
                onLayout={() =>
                  setMapLayoutSet(
                    true
                  )
                }
              >

                {isConnected ? (
                  <>
                    <MapView
                      ref={
                        completionMapRef
                      }
                      style={
                        styles.summaryMap
                      }
                      customMapStyle={
                        darkMapStyle
                      }
                      showsCompass={
                        false
                      }
                      showsBuildings={
                        false
                      }
                      showsTraffic={
                        false
                      }
                      showsUserLocation={
                        false
                      }
                      onMapReady={() =>
                        setMapRendered(
                          true
                        )
                      }
                    >

                      <MemoizedSpectrumRoute
                        points={
                          summary.route
                        }
                        prefix="summary"
                      />

                      {summary.route
                        ?.length >
                        0 && (
                        <>
                          <StartMarker
                            coordinate={
                              summary.route[0]
                            }
                          />

                          <FinishMarker
                            coordinate={
                              summary.route[
                                summary.route
                                  .length -
                                  1
                              ]
                            }
                          />
                        </>
                      )}

                    </MapView>

                    <View
                      style={
                        styles.summaryMapLabel
                      }
                    >
                      <Text
                        style={
                          styles.summaryMapLabelText
                        }
                      >
                        YOUR ROUTE
                      </Text>
                    </View>
                  </>
                ) : (
                  <View
                    style={[
                      styles.offlineFallback,
                      {
                        backgroundColor:
                          COLORS.surface,
                      },
                    ]}
                  >
                    <Ionicons
                      name="map-outline"
                      size={30}
                      color={
                        COLORS.muted2
                      }
                    />

                    <Text
                      style={[
                        styles.offlineTitle,
                        {
                          marginTop: 10,
                          marginBottom: 0,
                        },
                      ]}
                    >
                      MAP UNAVAILABLE
                    </Text>
                  </View>
                )}

              </View>


              {/* BIG DISTANCE */}

              <View
                style={
                  styles.bigSummaryCard
                }
              >

                <Text
                  style={
                    styles.bigSummaryLabel
                  }
                >
                  DISTANCE
                </Text>

                <Text
                  style={
                    styles.bigSummaryValue
                  }
                >
                  {Number(
                    summary.distanceKm ||
                      0
                  ).toFixed(2)}

                  <Text
                    style={
                      styles.bigSummaryUnit
                    }
                  >
                    {" "}
                    KM
                  </Text>
                </Text>

                <Text
                  style={
                    styles.bigSummaryTime
                  }
                >
                  {formatTime(
                    summary.durationSeconds
                  )}
                </Text>

              </View>


              {/* SUMMARY GRID */}

              <View
                style={
                  styles.summaryGrid
                }
              >

                <SummaryBox
                  icon="speedometer-outline"
                  label="AVG SPEED"
                  value={`${Number(
                    summary.averageSpeedKmh ||
                      0
                  ).toFixed(1)} km/h`}
                />

                <SummaryBox
                  icon="trending-up-outline"
                  label="TOP SPEED"
                  value={`${Number(
                    summary.topSpeedKmh ||
                      0
                  ).toFixed(1)} km/h`}
                />

                <SummaryBox
                  icon="walk-outline"
                  label="PACE"
                  value={`${summary.pace} /km`}
                />

                <SummaryBox
                  icon="flame-outline"
                  label="CALORIES"
                  value={`${summary.calories} kcal`}
                />

              </View>


              {/* SPECTRUM */}

              <View
                style={
                  styles.spectrumCard
                }
              >

                <Text
                  style={
                    styles.spectrumTitle
                  }
                >
                  SPEED SPECTRUM
                </Text>

                <View
                  style={
                    styles.spectrumGradient
                  }
                >
                  {SPEED_STOPS.map(
                    (stop, index) => (
                      <View
                        key={index}
                        style={{
                          flex: 1,
                          backgroundColor:
                            stop.color,
                        }}
                      />
                    )
                  )}
                </View>

                <View
                  style={
                    styles.spectrumBottomLabels
                  }
                >
                  <Text
                    style={
                      styles.spectrumBottomText
                    }
                  >
                    SLOW
                  </Text>

                  <Text
                    style={
                      styles.spectrumBottomText
                    }
                  >
                    FAST
                  </Text>
                </View>

              </View>


              <TouchableOpacity
                style={
                  styles.doneButton
                }
                onPress={() =>
                  setSummaryVisible(
                    false
                  )
                }
                activeOpacity={0.85}
              >
                <Text
                  style={
                    styles.doneButtonText
                  }
                >
                  DONE
                </Text>
              </TouchableOpacity>

            </ScrollView>
          )}

        </SafeAreaView>

      </Modal>


      {/* =====================================================
          HISTORY MODAL
      ===================================================== */}

      <Modal
        visible={historyVisible}
        animationType="slide"
        transparent={false}
        onRequestClose={() =>
          setHistoryVisible(false)
        }
      >

        <SafeAreaView
          style={
            styles.modalSafe
          }
        >

          <View
            style={
              styles.historyHeader
            }
          >

            <View>
              <Text
                style={
                  styles.summaryTitle
                }
              >
                RUN HISTORY
              </Text>

              <Text
                style={
                  styles.summarySubtitle
                }
              >
                Your previous runs.
              </Text>
            </View>

            <TouchableOpacity
              style={
                styles.closeButton
              }
              onPress={() =>
                setHistoryVisible(
                  false
                )
              }
            >
              <Ionicons
                name="close"
                size={23}
                color={
                  COLORS.white
                }
              />
            </TouchableOpacity>

          </View>


          <ScrollView
            showsVerticalScrollIndicator={
              false
            }
            contentContainerStyle={
              styles.historyScroll
            }
          >

            {history.length === 0 ? (
              <View
                style={
                  styles.emptyHistory
                }
              >

                <View
                  style={
                    styles.emptyHistoryIcon
                  }
                >
                  <Ionicons
                    name="footsteps-outline"
                    size={35}
                    color={
                      COLORS.lime
                    }
                  />
                </View>

                <Text
                  style={
                    styles.emptyHistoryTitle
                  }
                >
                  No runs yet
                </Text>

                <Text
                  style={
                    styles.emptyHistoryText
                  }
                >
                  Complete your first
                  run and your progress
                  will appear here.
                </Text>

              </View>
            ) : (

              history.map(
                (item, index) => (
                  <View
                    key={
                      item.id ||
                      `history-${index}`
                    }
                    style={
                      styles.historyCard
                    }
                  >

                    <View
                      style={
                        styles.historyCardHeader
                      }
                    >

                      <View>
                        <Text
                          style={
                            styles.historyDate
                          }
                        >
                          {new Date(
                            item.date
                          ).toLocaleDateString(
                            "en-IN",
                            {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            }
                          )}
                        </Text>

                        <Text
                          style={
                            styles.historyDistance
                          }
                        >
                          {Number(
                            item.distanceKm ||
                              0
                          ).toFixed(2)}{" "}
                          KM
                        </Text>
                      </View>

                      {item.targetDistance &&
                        item.distanceKm >=
                          item.targetDistance && (
                          <Ionicons
                            name="trophy"
                            size={20}
                            color={
                              COLORS.lime
                            }
                          />
                        )}

                    </View>


                    <View
                      style={
                        styles.historyStats
                      }
                    >

                      <HistoryStat
                        label="TIME"
                        value={formatTime(
                          item.durationSeconds
                        )}
                      />

                      <HistoryStat
                        label="PACE"
                        value={`${item.pace}/km`}
                      />

                      <HistoryStat
                        label="TOP"
                        value={`${Number(
                          item.topSpeedKmh ||
                            0
                        ).toFixed(
                          1
                        )} km/h`}
                      />

                      <HistoryStat
                        label="CAL"
                        value={`${item.calories}`}
                      />

                    </View>

                  </View>
                )
              )
            )}

          </ScrollView>

        </SafeAreaView>

      </Modal>

    </SafeAreaView>
  );
}

/* =========================================================
   STAT COMPONENT
========================================================= */

function Stat({
  icon,
  label,
  value,
  unit,
}) {
  return (
    <View style={styles.stat}>

      <Ionicons
        name={icon}
        size={17}
        color={COLORS.lime}
      />

      <Text
        style={styles.statLabel}
      >
        {label}
      </Text>

      <View
        style={
          styles.statValueRow
        }
      >

        <Text
          style={styles.statValue}
        >
          {value}
        </Text>

        <Text
          style={styles.statUnit}
        >
          {unit}
        </Text>

      </View>

    </View>
  );
}

/* =========================================================
   SUMMARY BOX
========================================================= */

function SummaryBox({
  icon,
  label,
  value,
}) {
  return (
    <View
      style={styles.summaryBox}
    >

      <Ionicons
        name={icon}
        size={19}
        color={COLORS.lime}
      />

      <Text
        style={
          styles.summaryBoxLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.summaryBoxValue
        }
      >
        {value}
      </Text>

    </View>
  );
}

/* =========================================================
   HISTORY STAT
========================================================= */

function HistoryStat({
  label,
  value,
}) {
  return (
    <View
      style={styles.historyStat}
    >

      <Text
        style={
          styles.historyStatLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.historyStatValue
        }
      >
        {value}
      </Text>

    </View>
  );
}

/* =========================================================
   STYLES
========================================================= */

const styles = StyleSheet.create({

  /* =====================================================
     ROOT
  ===================================================== */

  safe: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },


  /* =====================================================
     HEADER
  ===================================================== */

  header: {
    height: 78,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: COLORS.bg,
  },

  appTitle: {
    color: COLORS.white,
    fontSize: 21,
    fontWeight: "900",
    letterSpacing: -0.5,
  },

  gpsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },

  gpsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 7,
  },

  gpsText: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.2,
  },

  accuracyText: {
    color: COLORS.muted2,
    fontSize: 9,
    marginLeft: 7,
  },

  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: COLORS.surface2,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },


  /* =====================================================
     MAP
  ===================================================== */

  mapContainer: {
    flex: 1,
    marginHorizontal: 14,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  map: {
    flex: 1,
  },

  legend: {
    position: "absolute",
    top: 14,
    left: 14,
    right: 14,
    padding: 13,
    borderRadius: 17,
    backgroundColor:
      "rgba(5,5,5,0.92)",
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  legendTitle: {
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.7,
    marginBottom: 8,
  },

  legendBar: {
    height: 6,
    borderRadius: 4,
    overflow: "hidden",
    flexDirection: "row",
  },

  legendColor: {
    flex: 1,
  },

  legendLabels: {
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  legendText: {
    color: COLORS.muted2,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.8,
  },

  mapControls: {
    position: "absolute",
    right: 14,
    bottom: 14,
    gap: 8,
  },

  mapControl: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor:
      "rgba(5,5,5,0.94)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },


  /* =====================================================
     LIVE MARKERS
  ===================================================== */

  liveMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor:
      "rgba(168,255,0,0.15)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor:
      "rgba(168,255,0,0.35)",
  },

  liveMarkerInner: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor:
      COLORS.lime,
    borderWidth: 2,
    borderColor:
      COLORS.white,
  },

  startMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor:
      COLORS.lime,
    borderWidth: 3,
    borderColor:
      COLORS.bg,
    alignItems: "center",
    justifyContent: "center",
  },

  startMarkerDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor:
      COLORS.bg,
  },

  finishMarker: {
    width: 25,
    height: 25,
    borderRadius: 13,
    backgroundColor:
      COLORS.white,
    borderWidth: 3,
    borderColor:
      COLORS.bg,
    alignItems: "center",
    justifyContent: "center",
  },

  finishMarkerInner: {
    width: 7,
    height: 7,
    backgroundColor:
      COLORS.bg,
    borderRadius: 2,
  },


  /* =====================================================
     OFFLINE
  ===================================================== */

  offlineFallback: {
    flex: 1,
    backgroundColor:
      COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },

  offlineTitle: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 38,
  },

  bigMetricLabel: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.7,
    marginBottom: 5,
  },

  bigMetricValue: {
    color: COLORS.white,
    fontSize: 72,
    fontWeight: "900",
    marginVertical: -10,
    fontVariant: ["tabular-nums"],
    letterSpacing: -3,
  },

  bigMetricUnit: {
    color: COLORS.lime,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 10,
    letterSpacing: 1,
  },

  offlineExtraStatsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 38,
    width: "100%",
  },

  offlineExtraStat: {
    flex: 1,
    backgroundColor:
      COLORS.surface2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor:
      COLORS.border,
    padding: 15,
    alignItems: "center",
  },

  offlineExtraLabel: {
    color: COLORS.muted,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginTop: 5,
    marginBottom: 4,
  },

  offlineExtraValue: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: "900",
  },

  offlineExtraUnit: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: "800",
  },


  /* =====================================================
     BOTTOM DASHBOARD
  ===================================================== */

  bottomPanel: {
    backgroundColor:
      COLORS.bg,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom:
      Platform.OS === "ios"
        ? 20
        : 28,
  },

  primaryMetric: {
    alignItems: "center",
  },

  metricLabel: {
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.8,
  },

  distanceText: {
    color: COLORS.white,
    fontSize: 48,
    fontWeight: "900",
    marginTop: -3,
    letterSpacing: -2,
    fontVariant: [
      "tabular-nums",
    ],
  },

  distanceUnit: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: "800",
  },

  timerPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor:
      COLORS.surface2,
    borderWidth: 1,
    borderColor:
      COLORS.border,
    marginTop: 4,
  },

  timerText: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: "700",
    marginLeft: 5,
    fontVariant: [
      "tabular-nums",
    ],
  },


  /* =====================================================
     STATS
  ===================================================== */

  statsGrid: {
    flexDirection: "row",
    marginTop: 14,
    gap: 7,
  },

  stat: {
    flex: 1,
    minHeight: 72,
    padding: 10,
    borderRadius: 17,
    backgroundColor:
      COLORS.surface2,
    borderWidth: 1,
    borderColor:
      COLORS.border,
  },

  statLabel: {
    color: COLORS.muted,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.9,
    marginTop: 6,
  },

  statValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: 3,
  },

  statValue: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "900",
    fontVariant: [
      "tabular-nums",
    ],
  },

  statUnit: {
    color: COLORS.muted,
    fontSize: 6,
    fontWeight: "800",
    marginLeft: 2,
  },


  /* =====================================================
     MAIN CTA
  ===================================================== */

  startButton: {
    height: 58,
    borderRadius: 18,
    backgroundColor:
      COLORS.lime,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 13,
    gap: 9,
    elevation: 8,
  },

  startButtonText: {
    color: "#050505",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
  },

  runningButtons: {
    flexDirection: "row",
    gap: 9,
    marginTop: 13,
  },

  pauseButton: {
    flex: 1,
    height: 58,
    borderRadius: 18,
    backgroundColor:
      COLORS.surface3,
    borderWidth: 1,
    borderColor:
      COLORS.borderLight,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  finishButton: {
    flex: 1,
    height: 58,
    borderRadius: 18,
    backgroundColor:
      COLORS.surface3,
    borderWidth: 1,
    borderColor:
      "#343434",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  actionButtonText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },


  /* =====================================================
     MISSION MODAL
  ===================================================== */

  missionModalOverlay: {
    flex: 1,
    backgroundColor:
      "rgba(0,0,0,0.80)",
    justifyContent: "flex-end",
  },

  missionModalContent: {
    backgroundColor:
      "#090909",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 24,
    paddingBottom:
      Platform.OS === "ios"
        ? 40
        : 25,
    borderWidth: 1,
    borderColor:
      COLORS.border,
  },

  missionModalHeader: {
    flexDirection: "row",
    justifyContent:
      "space-between",
    alignItems: "flex-start",
    marginBottom: 15,
  },

  missionModalTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 1,
  },

  missionModalSub: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 5,
    maxWidth: 260,
    lineHeight: 17,
  },

  missionOption: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor:
      COLORS.surface2,
    padding: 14,
    borderRadius: 17,
    marginBottom: 9,
    borderWidth: 1,
    borderColor:
      COLORS.border,
  },

  missionIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor:
      "rgba(168,255,0,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },

  missionIconNumber: {
    color: COLORS.lime,
    fontSize: 14,
    fontWeight: "900",
  },

  missionOptionContent: {
    flex: 1,
    marginLeft: 13,
  },

  missionOptionText: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: "800",
  },

  missionOptionSub: {
    color: COLORS.muted,
    fontSize: 10,
    marginTop: 3,
  },


  /* =====================================================
     SUMMARY
  ===================================================== */

  modalSafe: {
    flex: 1,
    backgroundColor:
      COLORS.bg,
  },

  summaryHeader: {
    height: 78,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent:
      "space-between",
  },

  historyHeader: {
    height: 78,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent:
      "space-between",
  },

  summaryTitle: {
    color: COLORS.white,
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: 1.2,
  },

  summarySubtitle: {
    color: COLORS.muted,
    fontSize: 10,
    marginTop: 4,
  },

  closeButton: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor:
      COLORS.surface2,
    borderWidth: 1,
    borderColor:
      COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },

  summaryScroll: {
    paddingHorizontal: 16,
    paddingBottom: 35,
  },

  summaryMapCard: {
    height: height * 0.39,
    borderRadius: 25,
    overflow: "hidden",
    borderWidth: 1,
    borderColor:
      COLORS.border,
    backgroundColor:
      COLORS.surface,
  },

  summaryMap: {
    flex: 1,
  },

  summaryMapLabel: {
    position: "absolute",
    top: 13,
    left: 13,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor:
      "rgba(5,5,5,0.92)",
    borderWidth: 1,
    borderColor:
      COLORS.border,
  },

  summaryMapLabelText: {
    color: COLORS.muted,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 1.3,
  },

  bigSummaryCard: {
    marginTop: 13,
    padding: 20,
    borderRadius: 21,
    backgroundColor:
      COLORS.surface2,
    borderWidth: 1,
    borderColor:
      COLORS.border,
    alignItems: "center",
  },

  bigSummaryLabel: {
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.6,
  },

  bigSummaryValue: {
    color: COLORS.white,
    fontSize: 42,
    fontWeight: "900",
    marginTop: 2,
    letterSpacing: -2,
  },

  bigSummaryUnit: {
    color: COLORS.muted,
    fontSize: 13,
  },

  bigSummaryTime: {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },

  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginTop: 10,
  },

  summaryBox: {
    width:
      (width - 41) / 2,
    minHeight: 100,
    borderRadius: 18,
    backgroundColor:
      COLORS.surface2,
    borderWidth: 1,
    borderColor:
      COLORS.border,
    padding: 13,
  },

  summaryBoxLabel: {
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 8,
  },

  summaryBoxValue: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 4,
  },


  /* =====================================================
     SPECTRUM
  ===================================================== */

  spectrumCard: {
    marginTop: 10,
    padding: 15,
    borderRadius: 18,
    backgroundColor:
      COLORS.surface2,
    borderWidth: 1,
    borderColor:
      COLORS.border,
  },

  spectrumTitle: {
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.4,
    marginBottom: 9,
  },

  spectrumGradient: {
    height: 8,
    borderRadius: 5,
    overflow: "hidden",
    flexDirection: "row",
  },

  spectrumBottomLabels: {
    flexDirection: "row",
    justifyContent:
      "space-between",
    marginTop: 6,
  },

  spectrumBottomText: {
    color: COLORS.muted2,
    fontSize: 8,
    fontWeight: "800",
  },

  doneButton: {
    height: 56,
    borderRadius: 18,
    backgroundColor:
      COLORS.lime,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 13,
  },

  doneButtonText: {
    color: "#050505",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
  },


  /* =====================================================
     ACHIEVEMENT
  ===================================================== */

  achievementBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent:
      "center",
    backgroundColor:
      "rgba(168,255,0,0.08)",
    padding: 12,
    borderRadius: 16,
    marginBottom: 15,
    borderWidth: 1,
    borderColor:
      "rgba(168,255,0,0.22)",
  },

  achievementText: {
    color: COLORS.lime,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    marginLeft: 8,
  },


  /* =====================================================
     HISTORY
  ===================================================== */

  historyScroll: {
    paddingHorizontal: 16,
    paddingBottom: 30,
  },

  historyCard: {
    backgroundColor:
      COLORS.surface2,
    borderRadius: 19,
    borderWidth: 1,
    borderColor:
      COLORS.border,
    padding: 15,
    marginBottom: 10,
  },

  historyCardHeader: {
    flexDirection: "row",
    justifyContent:
      "space-between",
    alignItems: "center",
  },

  historyDate: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: "800",
  },

  historyDistance: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 2,
  },

  historyStats: {
    flexDirection: "row",
    marginTop: 13,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor:
      COLORS.border,
  },

  historyStat: {
    flex: 1,
  },

  historyStatLabel: {
    color: COLORS.muted,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  historyStatValue: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 3,
  },

  emptyHistory: {
    minHeight: height * 0.65,
    alignItems: "center",
    justifyContent:
      "center",
    paddingHorizontal: 40,
  },

  emptyHistoryIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor:
      "rgba(168,255,0,0.07)",
    borderWidth: 1,
    borderColor:
      "rgba(168,255,0,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },

  emptyHistoryTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 14,
  },

  emptyHistoryText: {
    color: COLORS.muted,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
    marginTop: 6,
  },
});
