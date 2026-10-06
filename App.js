import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Alert,
  Animated,
  Dimensions,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";

import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import * as Speech from "expo-speech";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MapView, { Marker, Polyline } from "react-native-maps";
import {
  Ionicons,
  FontAwesome5,
  MaterialCommunityIcons,
} from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import * as NavigationBar from "expo-navigation-bar";

const { width, height } = Dimensions.get("window");

/* =========================================================
   RAFTAAR 2.0 — DESIGN SYSTEM
========================================================= */

const C = {
  bg: "#050606",
  bg2: "#090A09",
  card: "#0D0F0E",
  card2: "#111311",
  card3: "#151815",

  white: "#F7F8F5",
  muted: "#858982",
  muted2: "#5C625B",
  line: "#20231F",

  lime: "#B7C98A",
  lime2: "#AFC48A",
  limeDark: "#1B2117",

  red: "#FF4D4D",
  orange: "#FF9F43",
  yellow: "#F8D94E",
  blue: "#5BA7FF",
  purple: "#A88BFF",

  black: "#000000",
};

const RADIUS = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 30,
};

const LOCATION_TASK_NAME = "RUNNER_BACKGROUND_LOCATION";
const SESSION_KEY = "@raftaar_active_session_v7";
const HISTORY_KEY = "@raftaar_workout_history_v7";
const ONBOARDING_KEY = "@raftaar_onboarding_v2";

const MAX_ACCURACY = 25;
const MIN_MOVEMENT_METERS = 2;
const MAX_RUNNING_SPEED_KMH = 22;
const MAX_ROUTE_POINTS = 6000;
const MAP_DELTA = 0.0045;

const SPEED_STOPS = [
  { speed: 0, color: "#FF4D4D" },
  { speed: 4, color: "#FF9F43" },
  { speed: 7, color: "#F8D94E" },
  { speed: 10, color: "#B8FF27" },
  { speed: 13, color: "#55E86B" },
  { speed: 16, color: "#35C8D8" },
  { speed: 20, color: "#5B8CFF" },
];

/* =========================================================
   HELPERS
========================================================= */

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

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
  };
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(
      minutes
    ).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(
    2,
    "0"
  )}`;
}

function getPace(distanceKm, seconds) {
  if (!distanceKm || distanceKm <= 0 || !seconds || seconds <= 0) {
    return "--:--";
  }

  const paceSeconds = seconds / distanceKm;

  return `${Math.floor(paceSeconds / 60)}:${String(
    Math.floor(paceSeconds % 60)
  ).padStart(2, "0")}`;
}

function estimatedCalories(distanceKm) {
  return Math.round(Math.max(0, Number(distanceKm) || 0) * 65);
}

function smoothSpeed(previous, current) {
  return (
    (Number(previous) || 0) * 0.85 +
    (Number(current) || 0) * 0.15
  );
}

function getGpsStatus(accuracy) {
  if (!Number.isFinite(Number(accuracy))) {
    return {
      label: "SEARCHING",
      color: C.orange,
    };
  }

  if (accuracy <= 10) {
    return {
      label: "EXCELLENT",
      color: C.lime,
    };
  }

  if (accuracy <= 20) {
    return {
      label: "GOOD",
      color: "#7DEB38",
    };
  }

  if (accuracy <= 30) {
    return {
      label: "FAIR",
      color: C.orange,
    };
  }

  return {
    label: "WEAK",
    color: C.red,
  };
}

function getDirection(heading) {
  if (heading === null || heading === undefined || heading < 0) {
    return "--";
  }

  const value = Math.floor(heading / 45 + 0.5);

  const directions = [
    "N",
    "NE",
    "E",
    "SE",
    "S",
    "SW",
    "W",
    "NW",
  ];

  return directions[value % 8];
}

function compactRoute(points, maxPoints = MAX_ROUTE_POINTS) {
  if (!Array.isArray(points)) return [];

  const valid = points.filter(isValidCoordinate);

  if (valid.length <= maxPoints) {
    return valid;
  }

  const result = [];

  const step = (valid.length - 1) / (maxPoints - 1);

  for (let i = 0; i < maxPoints; i++) {
    result.push(valid[Math.round(i * step)]);
  }

  return result;
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
    0,
    Math.min(20, Number(speed) || 0)
  );

  for (let i = 0; i < SPEED_STOPS.length - 1; i++) {
    const a = SPEED_STOPS[i];
    const b = SPEED_STOPS[i + 1];

    if (s >= a.speed && s <= b.speed) {
      const ratio =
        (s - a.speed) / (b.speed - a.speed || 1);

      const ca = hexToRgb(a.color);
      const cb = hexToRgb(b.color);

      return rgbToHex(
        ca.r + (cb.r - ca.r) * ratio,
        ca.g + (cb.g - ca.g) * ratio,
        ca.b + (cb.b - ca.b) * ratio
      );
    }
  }

  return C.lime;
}

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();

  const diff = day === 0 ? -6 : 1 - day;

  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);

  return d;
}

function getWeeklyDistance(history) {
  const start = getWeekStart();

  return history.reduce((total, run) => {
    const date = new Date(run.date);

    if (date >= start) {
      return total + Number(run.distanceKm || 0);
    }

    return total;
  }, 0);
}

function getStreak(history) {
  if (!history.length) return 0;

  const days = [
    ...new Set(
      history.map((run) => {
        const d = new Date(run.date);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      })
    ),
  ];

  let streak = 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 365; i++) {
    const check = new Date(today);
    check.setDate(today.getDate() - i);

    const key = `${check.getFullYear()}-${check.getMonth()}-${check.getDate()}`;

    if (days.includes(key)) {
      streak++;
    } else if (i === 0) {
      continue;
    } else {
      break;
    }
  }

  return streak;
}

function getPersonalBests(history) {
  if (!history.length) {
    return {
      fastestPace: "--:--",
      longestRun: 0,
      topSpeed: 0,
      bestDistance: 0,
    };
  }

  const longestRun = Math.max(
    ...history.map((x) => Number(x.distanceKm || 0))
  );

  const topSpeed = Math.max(
    ...history.map((x) => Number(x.topSpeedKmh || 0))
  );

  const fastestPaceRun = history
    .filter(
      (x) =>
        x.distanceKm >= 1 &&
        x.durationSeconds > 0
    )
    .sort(
      (a, b) =>
        a.durationSeconds / a.distanceKm -
        b.durationSeconds / b.distanceKm
    )[0];

  return {
    fastestPace: fastestPaceRun
      ? getPace(
          fastestPaceRun.distanceKm,
          fastestPaceRun.durationSeconds
        )
      : "--:--",
    longestRun: longestRun,
    topSpeed: topSpeed,
    bestDistance: longestRun,
  };
}

/* =========================================================
   DARK MAP
========================================================= */

const darkMapStyle = [
  {
    elementType: "geometry",
    stylers: [{ color: "#111511" }],
  },
  {
    elementType: "labels.text.fill",
    stylers: [{ color: "#747A71" }],
  },
  {
    elementType: "labels.text.stroke",
    stylers: [{ color: "#080A08" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#20251F" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#2B322A" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#111511" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#09110D" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#171C17" }],
  },
];

/* =========================================================
   ROUTE
========================================================= */

const SpectrumRoute = React.memo(
  ({ points, prefix = "route" }) => {
    if (!Array.isArray(points) || points.length < 2) {
      return null;
    }

    const valid = points.filter(isValidCoordinate);

    if (valid.length < 2) return null;

    return (
      <>
        <Polyline
          coordinates={valid.map(mapCoordinate)}
          strokeColor="rgba(0,0,0,0.65)"
          strokeWidth={10}
          lineCap="round"
          lineJoin="round"
        />

        {valid.slice(0, -1).map((point, index) => {
          const next = valid[index + 1];

          const speed =
            (Number(point.speedKmh || 0) +
              Number(next.speedKmh || 0)) /
            2;

          return (
            <Polyline
              key={`${prefix}-${index}`}
              coordinates={[
                mapCoordinate(point),
                mapCoordinate(next),
              ]}
              strokeColor={getSpectrumColor(speed)}
              strokeWidth={6}
              lineCap="round"
              lineJoin="round"
            />
          );
        })}
      </>
    );
  }
);

/* =========================================================
   MARKERS
========================================================= */

const StartMarker = ({ coordinate }) => {
  if (!isValidCoordinate(coordinate)) return null;

  return (
    <Marker
      coordinate={mapCoordinate(coordinate)}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={styles.startMarker}>
        <View style={styles.startMarkerInner} />
      </View>
    </Marker>
  );
};

const FinishMarker = ({ coordinate }) => {
  if (!isValidCoordinate(coordinate)) return null;

  return (
    <Marker
      coordinate={mapCoordinate(coordinate)}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={styles.finishMarker}>
        <Ionicons
          name="flag"
          size={12}
          color="#FFFFFF"
        />
      </View>
    </Marker>
  );
};

const LiveMarker = ({ coordinate }) => {
  if (!isValidCoordinate(coordinate)) return null;

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
};

/* =========================================================
   BACKGROUND GPS TASK
========================================================= */

TaskManager.defineTask(
  LOCATION_TASK_NAME,
  async ({ data, error }) => {
    if (error || !data?.locations?.length) return;

    try {
      const stored =
        await AsyncStorage.getItem(SESSION_KEY);

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
        const coords = locationData?.coords;

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
          !Number.isFinite(longitude)
        ) {
          continue;
        }

        if (
          Number.isFinite(accuracy) &&
          accuracy > MAX_ACCURACY
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
          altitude: altitude || 0,
          heading:
            Number.isFinite(heading) ? heading : -1,
          timestamp,
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

        const smoothedSpeed = smoothSpeed(
          updatedSession.speedKmh || 0,
          Math.max(0, calculatedSpeed)
        );

        const newPoint = {
          ...currentPoint,
          speedKmh: Number(
            smoothedSpeed.toFixed(2)
          ),
        };

        if (updatedSession.routeBreakPending) {
          newPoint.breakBefore = true;
          updatedSession.routeBreakPending = false;
        }

        updatedSession.route = compactRoute(
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
    } catch (e) {}
  }
);

/* =========================================================
   MAIN APP
========================================================= */

export default function App() {
  const mapRef = useRef(null);
  const completionMapRef = useRef(null);

  const runAnim = useRef(
    new Animated.Value(0)
  ).current;

  const pulseAnim = useRef(
    new Animated.Value(0)
  ).current;

  /* ---------------------------------------------
     APP
  --------------------------------------------- */

  const [onboarding, setOnboarding] =
    useState(false);

  const [activeTab, setActiveTab] =
    useState("home");

  const [permissionGranted, setPermissionGranted] =
    useState(false);

  const [location, setLocation] =
    useState(null);

  const [accuracy, setAccuracy] =
    useState(null);

  const [isConnected, setIsConnected] =
    useState(true);

  /* ---------------------------------------------
     RUN
  --------------------------------------------- */

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

  const [paceHistory, setPaceHistory] =
    useState([]);

  /* ---------------------------------------------
     HISTORY
  --------------------------------------------- */

  const [history, setHistory] =
    useState([]);

  /* ---------------------------------------------
     MODALS
  --------------------------------------------- */

  const [missionVisible, setMissionVisible] =
    useState(false);

  const [summaryVisible, setSummaryVisible] =
    useState(false);

  const [historyDetailVisible, setHistoryDetailVisible] =
    useState(false);

  const [selectedHistoryRun, setSelectedHistoryRun] =
    useState(null);

  const [summary, setSummary] =
    useState(null);

  /* ---------------------------------------------
     CHALLENGE
  --------------------------------------------- */

  const [targetDistance, setTargetDistance] =
    useState(null);

  const [challengeCompleted, setChallengeCompleted] =
    useState(false);

  /* ---------------------------------------------
     MAP
  --------------------------------------------- */

  const [mapType, setMapType] =
    useState("standard");

  const [followUser, setFollowUser] =
    useState(true);

  /* =========================================================
     INITIALIZE
  ========================================================= */

  useEffect(() => {
    initializeApp();

    // Keep the Android system navigation bar visible and inset the app
    // so the bottom app navigation never overlaps the system buttons.
    if (Platform.OS === "android") {
      NavigationBar.setVisibilityAsync("visible").catch(() => {});
      NavigationBar.setBehaviorAsync("inset-swipe").catch(() => {});
      NavigationBar.setBackgroundColorAsync(C.bg).catch(() => {});
    }

    const unsubscribe =
      NetInfo.addEventListener((state) => {
        setIsConnected(
          Boolean(state.isConnected)
        );
      });

    return unsubscribe;
  }, []);

  async function initializeApp() {
    await loadHistory();
    await checkOnboarding();
    await setupLocation();
  }

  async function checkOnboarding() {
    try {
      const value =
        await AsyncStorage.getItem(
          ONBOARDING_KEY
        );

      if (!value) {
        setOnboarding(true);
      }
    } catch (e) {}
  }

  async function finishOnboarding() {
    await AsyncStorage.setItem(
      ONBOARDING_KEY,
      "true"
    );

    setOnboarding(false);
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
    } catch (e) {}
  }

  /* =========================================================
     DERIVED DATA
  ========================================================= */

  const weeklyDistance = useMemo(
    () => getWeeklyDistance(history),
    [history]
  );

  const streak = useMemo(
    () => getStreak(history),
    [history]
  );

  const personalBests = useMemo(
    () => getPersonalBests(history),
    [history]
  );

  const totalDistance = useMemo(
    () =>
      history.reduce(
        (sum, item) =>
          sum +
          Number(item.distanceKm || 0),
        0
      ),
    [history]
  );

  const totalRuns = history.length;

  const gpsStatus = getGpsStatus(accuracy);

  /* =========================================================
     ANIMATIONS
  ========================================================= */

  useEffect(() => {
    if (running && !paused) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(runAnim, {
            toValue: 1,
            duration: 380,
            useNativeDriver: true,
          }),
          Animated.timing(runAnim, {
            toValue: 0,
            duration: 380,
            useNativeDriver: true,
          }),
        ])
      );

      loop.start();

      return () => loop.stop();
    }

    runAnim.stopAnimation();
    runAnim.setValue(0);
  }, [running, paused]);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1300,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1300,
          useNativeDriver: true,
        }),
      ])
    );

    pulse.start();

    return () => pulse.stop();
  }, []);

  const runnerTranslateY =
    runAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, -10],
    });

  /* =========================================================
     TIMER
  ========================================================= */

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

    return () => clearInterval(interval);
  }, [
    running,
    paused,
    timeData,
  ]);

  /* =========================================================
     LIVE SESSION SYNC
  ========================================================= */

  useEffect(() => {
    if (!running) return;

    const interval = setInterval(
      async () => {
        try {
          const stored =
            await AsyncStorage.getItem(
              SESSION_KEY
            );

          if (!stored) return;

          const session =
            JSON.parse(stored);

          const nextDistance =
            Number(
              session.distanceMeters || 0
            ) / 1000;

          const nextSpeed =
            Number(
              session.speedKmh || 0
            );

          setDistance(nextDistance);
          setSpeed(nextSpeed);
          setTopSpeed(
            Number(
              session.topSpeedKmh || 0
            )
          );

          if (
            Array.isArray(session.route)
          ) {
            setRoute((prev) => {
              if (
                prev.length !==
                session.route.length
              ) {
                return session.route;
              }

              return prev;
            });
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

            setPaceHistory((prev) => {
              const next = [
                ...prev,
                {
                  speed:
                    Number(
                      session.speedKmh ||
                        0
                    ),
                  time: Date.now(),
                },
              ];

              return next.slice(-30);
            });

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
        } catch (e) {}
      },
      1000
    );

    return () =>
      clearInterval(interval);
  }, [
    running,
    followUser,
    isConnected,
  ]);

  /* =========================================================
     CHALLENGE
  ========================================================= */

  useEffect(() => {
    if (
      running &&
      targetDistance &&
      !challengeCompleted &&
      distance >= targetDistance
    ) {
      setChallengeCompleted(true);

      Speech.speak(
        "Mission completed",
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

      Alert.alert(
        "MISSION COMPLETE",
        `You completed ${targetDistance} KM. Excellent work.`
      );

      AsyncStorage.getItem(
        SESSION_KEY
      ).then((stored) => {
        if (!stored) return;

        try {
          const session =
            JSON.parse(stored);

          session.challengeCompleted =
            true;

          AsyncStorage.setItem(
            SESSION_KEY,
            JSON.stringify(session)
          );
        } catch (e) {}
      });
    }
  }, [
    distance,
    running,
    targetDistance,
    challengeCompleted,
  ]);

  /* =========================================================
     LOCATION
  ========================================================= */

  async function setupLocation() {
    try {
      const foreground =
        await Location.requestForegroundPermissionsAsync();

      if (
        foreground.status !==
        "granted"
      ) {
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

      await restoreSession();

      return true;
    } catch (e) {
      return false;
    }
  }

  async function restoreSession() {
    try {
      const stored =
        await AsyncStorage.getItem(
          SESSION_KEY
        );

      if (!stored) return;

      const session =
        JSON.parse(stored);

      if (!session?.running) {
        return;
      }

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
        Boolean(
          session.challengeCompleted
        )
      );

      setActiveTab("run");
    } catch (e) {}
  }

  async function startLocationService() {
    try {
      const enabled =
        await Location.hasServicesEnabledAsync();

      if (!enabled) {
        Alert.alert(
          "Location is off",
          "Turn on Location Services to track your run."
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
          "Background location needed",
          "Allow background location so Raftaar can continue tracking when the screen is locked."
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
                "Raftaar is tracking",
              notificationBody:
                "Your run is being tracked in the background.",
            },
          }
        );
      }

      return true;
    } catch (e) {
      Alert.alert(
        "GPS error",
        "Unable to start location tracking."
      );

      return false;
    }
  }

  /* =========================================================
     START RUN
  ========================================================= */

  async function confirmMissionStart(
    targetKm
  ) {
    setMissionVisible(false);

    let ready =
      permissionGranted;

    if (!ready) {
      ready = await setupLocation();
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
          current.coords.heading || -1,
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

        timeData: newTimeData,

        distanceMeters: 0,
        speedKmh: 0,
        topSpeedKmh: 0,

        route: [firstPoint],
        lastPoint: firstPoint,

        routeBreakPending: false,

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

      setTimeData(newTimeData);
      setElapsedSeconds(0);

      setRunning(true);
      setPaused(false);

      setDistance(0);
      setSpeed(0);
      setTopSpeed(0);

      setRoute([firstPoint]);
      setPaceHistory([]);

      setActiveTab("run");

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
    } catch (e) {
      Alert.alert(
        "Couldn't start",
        "Raftaar could not start this run."
      );
    }
  }

  /* =========================================================
     PAUSE
  ========================================================= */

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
    setTimeData(newTimeData);

    await AsyncStorage.mergeItem(
      SESSION_KEY,
      JSON.stringify({
        paused: true,
        speedKmh: 0,
        routeBreakPending: true,
        timeData: newTimeData,
      })
    );

    Vibration.vibrate(80);

    Speech.speak("Run paused", {
      language: "en-IN",
      rate: 0.95,
    });
  }

  /* =========================================================
     RESUME
  ========================================================= */

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

      const now = Date.now();

      const newTimeData = {
        accumulatedMs:
          timeData.accumulatedMs,
        lastResumeTime: now,
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
          current.coords.heading || -1,
        timestamp: now,
        speedKmh: 0,
        breakBefore: true,
      };

      setPaused(false);
      setSpeed(0);
      setTimeData(newTimeData);

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

      Vibration.vibrate(80);
    } catch (e) {}
  }

  /* =========================================================
     FINISH
  ========================================================= */

  function finishRun() {
    Alert.alert(
      "Finish your run?",
      "Your workout will be saved to history.",
      [
        {
          text: "Keep running",
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
      let finalDistance =
        distance;

      let finalDuration =
        elapsedSeconds;

      const finalRoute =
        compactRoute(
          route,
          MAX_ROUTE_POINTS
        );

      const averageSpeed =
        finalDuration > 0
          ? finalDistance /
            (finalDuration / 3600)
          : 0;

      const workout = {
        id: String(Date.now()),

        date:
          new Date().toISOString(),

        distanceKm:
          Number(
            finalDistance.toFixed(3)
          ),

        durationSeconds:
          finalDuration,

        averageSpeedKmh:
          Number(
            averageSpeed.toFixed(2)
          ),

        topSpeedKmh:
          Number(
            topSpeed.toFixed(2)
          ),

        pace:
          getPace(
            finalDistance,
            finalDuration
          ),

        calories:
          estimatedCalories(
            finalDistance
          ),

        route:
          finalRoute,

        targetDistance:
          targetDistance,
      };

      const updatedHistory = [
        workout,
        ...history,
      ].slice(0, 100);

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

      setRunning(false);
      setPaused(false);

      setSpeed(0);

      setTargetDistance(null);
      setChallengeCompleted(false);

      setSummaryVisible(true);

      Speech.speak(
        "Run completed",
        {
          language: "en-IN",
          rate: 0.95,
        }
      );

      Vibration.vibrate([
        0,
        120,
        80,
        120,
      ]);
    } catch (e) {
      Alert.alert(
        "Save error",
        "The run could not be saved."
      );
    }
  }

  /* =========================================================
     HOME
  ========================================================= */

  function renderHome() {
    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={
          styles.homeScroll
        }
      >
        {/* HERO */}

        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.eyebrow}>
                RAFTAAR
              </Text>

              <Text style={styles.heroTitle}>
                Run with{"\n"}
                <Text
                  style={
                    styles.heroAccent
                  }
                >
                  purpose.
                </Text>
              </Text>
            </View>

            <View style={styles.heroIcon}>
              <Ionicons
                name="flash"
                size={21}
                color={C.lime}
              />
            </View>
          </View>

          <Text style={styles.heroDescription}>
            Track every run with precision.
            Distance, pace and progress —
            without the clutter.
          </Text>

          <TouchableOpacity
            style={styles.heroStart}
            activeOpacity={0.85}
            onPress={() =>
              setMissionVisible(true)
            }
          >
            <Ionicons
              name="play"
              size={18}
              color={C.black}
            />

            <Text
              style={
                styles.heroStartText
              }
            >
              START RUN
            </Text>
          </TouchableOpacity>

          <View style={styles.heroMeta}>
            <HeroMeta
              icon="navigate"
              text="GPS POWERED"
            />

            <HeroMeta
              icon="shield-checkmark"
              text="PRIVATE"
            />

            <HeroMeta
              icon="sparkles"
              text="NO CLUTTER"
            />
          </View>
        </View>

        {/* WEEKLY CARD */}

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionKicker}>
              THIS WEEK
            </Text>

            <Text
              style={styles.sectionTitle}
            >
              Your movement.
            </Text>
          </View>

          <TouchableOpacity
            onPress={() =>
              setActiveTab("history")
            }
          >
            <Text style={styles.linkText}>
              View all
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.weekCard}>
          <View style={styles.weekMain}>
            <Text style={styles.weekValue}>
              {weeklyDistance.toFixed(1)}
            </Text>

            <Text style={styles.weekUnit}>
              KM
            </Text>
          </View>

          <Text style={styles.weekCaption}>
            distance this week
          </Text>

          <View style={styles.weekProgress}>
            <View
              style={[
                styles.weekProgressFill,
                {
                  width: `${Math.min(
                    100,
                    (weeklyDistance / 20) *
                      100
                  )}%`,
                },
              ]}
            />
          </View>

          <View
            style={styles.weekBottom}
          >
            <Text style={styles.weekHint}>
              {weeklyDistance >= 20
                ? "Weekly goal complete"
                : `${(
                    20 - weeklyDistance
                  ).toFixed(
                    1
                  )} KM to 20 KM`}
            </Text>

            <Text style={styles.weekHint}>
              20 KM goal
            </Text>
          </View>
        </View>

        {/* QUICK STATS */}

        <View style={styles.quickGrid}>
          <MiniMetric
            icon="flame-outline"
            value={`${streak}`}
            label="DAY STREAK"
            accent={C.orange}
          />

          <MiniMetric
            icon="footsteps-outline"
            value={`${totalRuns}`}
            label="TOTAL RUNS"
            accent={C.lime}
          />

          <MiniMetric
            icon="navigate-outline"
            value={`${totalDistance.toFixed(
              0
            )}`}
            label="TOTAL KM"
            accent={C.blue}
          />

          <MiniMetric
            icon="trophy-outline"
            value={
              personalBests.longestRun
                ? personalBests.longestRun.toFixed(
                    1
                  )
                : "0"
            }
            label="BEST KM"
            accent={C.yellow}
          />
        </View>

        {/* FEATURE STRIP */}

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionKicker}>
              BUILT FOR MOVEMENT
            </Text>

            <Text
              style={styles.sectionTitle}
            >
              Everything you need.
            </Text>
          </View>
        </View>

        <FeatureCard
          icon="navigate-outline"
          title="Accurate tracking"
          text="GPS-powered distance and route tracking."
        />

        <FeatureCard
          icon="speedometer-outline"
          title="Live performance"
          text="See speed, pace and time while you move."
        />

        <FeatureCard
          icon="stats-chart-outline"
          title="Progress that matters"
          text="Weekly distance, streaks and personal bests."
        />

        {/* CTA */}

        <View style={styles.bottomCTA}>
          <Text style={styles.bottomCTAKicker}>
            READY?
          </Text>

          <Text style={styles.bottomCTATitle}>
            Move faster.
          </Text>

          <TouchableOpacity
            style={styles.ctaButton}
            onPress={() =>
              setMissionVisible(true)
            }
          >
            <Text
              style={styles.ctaButtonText}
            >
              START A RUN
            </Text>

            <Ionicons
              name="arrow-forward"
              size={18}
              color={C.black}
            />
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  /* =========================================================
     RUN TAB
  ========================================================= */

  function renderRun() {
    return (
      <View style={styles.runScreen}>
        <View style={styles.runHeader}>
          <View>
            <Text style={styles.runKicker}>
              {running
                ? paused
                  ? "RUN PAUSED"
                  : "LIVE RUN"
                : "READY TO RUN"}
            </Text>

            <Text style={styles.runTitle}>
              {targetDistance
                ? `${targetDistance} KM`
                : "Free Run"}
            </Text>
          </View>

          <View
            style={styles.gpsBadge}
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
              style={styles.gpsBadgeText}
            >
              {gpsStatus.label}
            </Text>
          </View>
        </View>

        <View style={styles.mapShell}>
          {isConnected ? (
            <>
              <MapView
                ref={mapRef}
                style={styles.map}
                mapType={mapType}
                customMapStyle={
                  mapType === "standard"
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
                <SpectrumRoute
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

              <View
                style={
                  styles.mapOverlayTop
                }
              >
                <View
                  style={
                    styles.livePill
                  }
                >
                  <Animated.View
                    style={[
                      styles.livePulse,
                      {
                        opacity:
                          pulseAnim.interpolate(
                            {
                              inputRange: [
                                0,
                                1,
                              ],
                              outputRange: [
                                0.5,
                                1,
                              ],
                            }
                          ),
                      },
                    ]}
                  />

                  <Text
                    style={
                      styles.livePillText
                    }
                  >
                    {running
                      ? "GPS LIVE"
                      : "MAP READY"}
                  </Text>
                </View>
              </View>

              <View
                style={styles.mapControls}
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
                >
                  <Ionicons
                    name={
                      followUser
                        ? "locate"
                        : "locate-outline"
                    }
                    size={19}
                    color={
                      followUser
                        ? C.lime
                        : C.white
                    }
                  />
                </TouchableOpacity>

                <TouchableOpacity
                  style={
                    styles.mapControl
                  }
                  onPress={() =>
                    setMapType(
                      (value) =>
                        value ===
                        "standard"
                          ? "satellite"
                          : "standard"
                    )
                  }
                >
                  <Ionicons
                    name="layers-outline"
                    size={19}
                    color={C.white}
                  />
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <OfflineRunView
              running={running}
              paused={paused}
              distance={distance}
              elapsedSeconds={
                elapsedSeconds
              }
              targetDistance={
                targetDistance
              }
              location={location}
              translateY={
                runnerTranslateY
              }
            />
          )}
        </View>

        {/* MAIN RUN METRIC */}

        <View style={styles.runMetric}>
          <Text
            style={styles.runMetricLabel}
          >
            DISTANCE
          </Text>

          <View
            style={
              styles.runDistanceRow
            }
          >
            <Text
              style={
                styles.runDistance
              }
            >
              {distance.toFixed(2)}
            </Text>

            <Text
              style={
                styles.runDistanceUnit
              }
            >
              KM
            </Text>
          </View>

          <View
            style={styles.timePill}
          >
            <Ionicons
              name="time-outline"
              size={14}
              color={C.muted}
            />

            <Text
              style={styles.timePillText}
            >
              {formatTime(
                elapsedSeconds
              )}
            </Text>
          </View>
        </View>

        {/* LIVE STATS */}

        <View style={styles.liveStats}>
          <LiveStat
            label="PACE"
            value={getPace(
              distance,
              elapsedSeconds
            )}
            unit="/KM"
          />

          <LiveStat
            label="SPEED"
            value={speed.toFixed(1)}
            unit="KM/H"
          />

          <LiveStat
            label="CALORIES"
            value={estimatedCalories(
              distance
            )}
            unit="KCAL"
          />
        </View>

        {/* PACE GRAPH */}

        {running && (
          <View
            style={styles.graphCard}
          >
            <View
              style={
                styles.graphHeader
              }
            >
              <Text
                style={
                  styles.graphTitle
                }
              >
                LIVE PACE
              </Text>

              <Text
                style={
                  styles.graphSub
                }
              >
                LAST 30 SEC
              </Text>
            </View>

            <LiveGraph
              values={paceHistory.map(
                (item) =>
                  item.speed
              )}
            />
          </View>
        )}

        {/* ACTIONS */}

        {!running ? (
          <TouchableOpacity
            style={styles.bigStart}
            activeOpacity={0.86}
            onPress={() =>
              setMissionVisible(true)
            }
          >
            <Ionicons
              name="play"
              size={19}
              color={C.black}
            />

            <Text
              style={
                styles.bigStartText
              }
            >
              START RUN
            </Text>

            <Ionicons
              name="arrow-forward"
              size={19}
              color={C.black}
            />
          </TouchableOpacity>
        ) : (
          <View
            style={styles.runActions}
          >
            <TouchableOpacity
              style={
                styles.pauseAction
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
                size={19}
                color={C.white}
              />

              <Text
                style={
                  styles.actionText
                }
              >
                {paused
                  ? "RESUME"
                  : "PAUSE"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={
                styles.finishAction
              }
              onPress={finishRun}
              activeOpacity={0.85}
            >
              <Ionicons
                name="stop"
                size={19}
                color={C.white}
              />

              <Text
                style={
                  styles.actionText
                }
              >
                FINISH
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  /* =========================================================
     HISTORY TAB
  ========================================================= */

  function renderHistory() {
    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={
          styles.historyScreen
        }
      >
        <ScreenHeader
          kicker="YOUR JOURNEY"
          title="Run history."
          right={
            <View
              style={styles.countBadge}
            >
              <Text
                style={
                  styles.countBadgeText
                }
              >
                {history.length}
              </Text>
            </View>
          }
        />

        {history.length === 0 ? (
          <View
            style={styles.emptyState}
          >
            <View
              style={styles.emptyIcon}
            >
              <Ionicons
                name="footsteps-outline"
                size={30}
                color={C.lime}
              />
            </View>

            <Text
              style={
                styles.emptyTitle
              }
            >
              Your journey starts here.
            </Text>

            <Text
              style={
                styles.emptyText
              }
            >
              Complete your first run and
              your progress will appear here.
            </Text>

            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() =>
                setMissionVisible(true)
              }
            >
              <Text
                style={
                  styles.emptyButtonText
                }
              >
                START FIRST RUN
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View
              style={
                styles.historyOverview
              }
            >
              <View>
                <Text
                  style={
                    styles.overviewLabel
                  }
                >
                  TOTAL DISTANCE
                </Text>

                <Text
                  style={
                    styles.overviewValue
                  }
                >
                  {totalDistance.toFixed(
                    1
                  )}
                  <Text
                    style={
                      styles.overviewUnit
                    }
                  >
                    {" "}
                    KM
                  </Text>
                </Text>
              </View>

              <View>
                <Text
                  style={
                    styles.overviewLabel
                  }
                >
                  STREAK
                </Text>

                <Text
                  style={
                    styles.overviewValue
                  }
                >
                  {streak}
                  <Text
                    style={
                      styles.overviewUnit
                    }
                  >
                    {" "}
                    DAYS
                  </Text>
                </Text>
              </View>
            </View>

            {history.map(
              (item, index) => (
                <TouchableOpacity
                  key={
                    item.id ||
                    `run-${index}`
                  }
                  activeOpacity={0.86}
                  style={
                    styles.historyItem
                  }
                  onPress={() => {
                    setSelectedHistoryRun(
                      item
                    );
                    setHistoryDetailVisible(
                      true
                    );
                  }}
                >
                  <View
                    style={
                      styles.historyItemTop
                    }
                  >
                    <View>
                      <Text
                        style={
                          styles.historyItemDate
                        }
                      >
                        {new Date(
                          item.date
                        ).toLocaleDateString(
                          "en-IN",
                          {
                            day: "2-digit",
                            month: "short",
                          }
                        )}
                      </Text>

                      <Text
                        style={
                          styles.historyItemDistance
                        }
                      >
                        {Number(
                          item.distanceKm ||
                            0
                        ).toFixed(
                          2
                        )}{" "}
                        <Text
                          style={
                            styles.historyKm
                          }
                        >
                          KM
                        </Text>
                      </Text>
                    </View>

                    <View
                      style={
                        styles.historyArrow
                      }
                    >
                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={C.muted}
                      />
                    </View>
                  </View>

                  <View
                    style={
                      styles.historyItemStats
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
                      label="AVG"
                      value={`${Number(
                        item.averageSpeedKmh ||
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
                </TouchableOpacity>
              )
            )}
          </>
        )}
      </ScrollView>
    );
  }

  /* =========================================================
     PROFILE
  ========================================================= */

  function renderProfile() {
    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={
          styles.profileScreen
        }
      >
        <ScreenHeader
          kicker="RAFTAAR PROFILE"
          title="Your progress."
        />

        <View
          style={styles.profileHero}
        >
          <View
            style={
              styles.profileAvatar
            }
          >
            <FontAwesome5
              name="running"
              size={25}
              color={C.black}
            />
          </View>

          <View
            style={
              styles.profileHeroText
            }
          >
            <Text
              style={
                styles.profileName
              }
            >
              Runner
            </Text>

            <Text
              style={
                styles.profileSubtitle
              }
            >
              Keep moving. Keep building.
            </Text>
          </View>

          <Ionicons
            name="sparkles"
            size={21}
            color={C.lime}
          />
        </View>

        {/* STATS */}

        <Text
          style={styles.profileSectionTitle}
        >
          OVERVIEW
        </Text>

        <View
          style={styles.profileGrid}
        >
          <ProfileStat
            value={totalRuns}
            label="RUNS"
            icon="footsteps-outline"
          />

          <ProfileStat
            value={`${totalDistance.toFixed(
              0
            )}`}
            label="KM"
            icon="navigate-outline"
          />

          <ProfileStat
            value={streak}
            label="STREAK"
            icon="flame-outline"
          />

          <ProfileStat
            value={
              personalBests.topSpeed
                ? personalBests.topSpeed.toFixed(
                    1
                  )
                : "0"
            }
            label="TOP KM/H"
            icon="speedometer-outline"
          />
        </View>

        {/* PERSONAL BEST */}

        <Text
          style={styles.profileSectionTitle}
        >
          PERSONAL BESTS
        </Text>

        <View
          style={styles.pbCard}
        >
          <PBRow
            icon="trophy-outline"
            label="Longest run"
            value={
              personalBests.longestRun
                ? `${personalBests.longestRun.toFixed(
                    2
                  )} KM`
                : "--"
            }
          />

          <PBRow
            icon="timer-outline"
            label="Fastest pace"
            value={
              personalBests.fastestPace !==
              "--:--"
                ? `${personalBests.fastestPace}/KM`
                : "--"
            }
          />

          <PBRow
            icon="speedometer-outline"
            label="Top speed"
            value={
              personalBests.topSpeed
                ? `${personalBests.topSpeed.toFixed(
                    1
                  )} KM/H`
                : "--"
            }
          />
        </View>

        {/* APP VALUES */}

        <Text
          style={styles.profileSectionTitle}
        >
          RAFTAAR
        </Text>

        <View
          style={styles.valueCard}
        >
          <ValueRow
            icon="shield-checkmark-outline"
            title="Private by design"
            text="Your workout data stays on your device."
          />

          <ValueRow
            icon="flash-outline"
            title="Built for movement"
            text="Fast, focused and distraction free."
          />

          <ValueRow
            icon="map-outline"
            title="GPS powered"
            text="Track routes, distance and speed."
          />
        </View>

        <Text
          style={styles.versionText}
        >
          RAFTAAR • 2.0
        </Text>
      </ScrollView>
    );
  }

  /* =========================================================
     ROOT
  ========================================================= */

  return (
    <SafeAreaView
      style={styles.safe}
    >
      <StatusBar
        hidden={true}
        barStyle="light-content"
        backgroundColor={C.bg}
        translucent={true}
      />

      <View
        style={styles.app}
      >
        <View
          style={styles.content}
        >
          {activeTab === "home" &&
            renderHome()}

          {activeTab === "run" &&
            renderRun()}

          {activeTab === "history" &&
            renderHistory()}

          {activeTab === "profile" &&
            renderProfile()}
        </View>

        {/* BOTTOM NAV */}

        <BottomNav
          active={activeTab}
          onChange={setActiveTab}
          running={running}
        />
      </View>

      {/* =====================================================
          ONBOARDING
      ===================================================== */}

      <Modal
        visible={onboarding}
        animationType="fade"
        transparent={false}
      >
        <SafeAreaView
          style={
            styles.onboarding
          }
        >
          <View
            style={
              styles.onboardingTop
            }
          >
            <Text
              style={
                styles.onboardingLogo
              }
            >
              Raftaar.
            </Text>

            <View
              style={
                styles.onboardingPill
              }
            >
              <View
                style={
                  styles.onboardingDot
                }
              />

              <Text
                style={
                  styles.onboardingPillText
                }
              >
                GPS RUN & DISTANCE TRACKER
              </Text>
            </View>
          </View>

          <View
            style={
              styles.onboardingCenter
            }
          >
            <View
              style={
                styles.onboardingIcon
              }
            >
              <FontAwesome5
                name="running"
                size={50}
                color={C.lime}
              />
            </View>

            <Text
              style={
                styles.onboardingTitle
              }
            >
              Run with{"\n"}
              <Text
                style={
                  styles.onboardingAccent
                }
              >
                purpose.
              </Text>
            </Text>

            <Text
              style={
                styles.onboardingText
              }
            >
              Raftaar turns every run into a
              focused experience. Track your
              route, distance, pace and
              progress beautifully.
            </Text>
          </View>

          <View
            style={
              styles.onboardingFeatures
            }
          >
            <OnboardingFeature
              icon="navigate-outline"
              title="GPS tracking"
              text="Precise route & distance"
            />

            <OnboardingFeature
              icon="stats-chart-outline"
              title="Smart progress"
              text="Streaks & personal bests"
            />

            <OnboardingFeature
              icon="lock-closed-outline"
              title="Private"
              text="Your data stays yours"
            />
          </View>

          <TouchableOpacity
            style={
              styles.onboardingButton
            }
            activeOpacity={0.86}
            onPress={
              finishOnboarding
            }
          >
            <Text
              style={
                styles.onboardingButtonText
              }
            >
              LET'S RUN
            </Text>

            <Ionicons
              name="arrow-forward"
              size={19}
              color={C.black}
            />
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>

      {/* =====================================================
          MISSION MODAL
      ===================================================== */}

      <Modal
        visible={missionVisible}
        transparent
        animationType="slide"
        onRequestClose={() =>
          setMissionVisible(false)
        }
      >
        <View
          style={
            styles.modalOverlay
          }
        >
          <View
            style={
              styles.missionSheet
            }
          >
            <View
              style={
                styles.sheetHandle
              }
            />

            <View
              style={
                styles.sheetHeader
              }
            >
              <View>
                <Text
                  style={
                    styles.sheetKicker
                  }
                >
                  CHOOSE YOUR RUN
                </Text>

                <Text
                  style={
                    styles.sheetTitle
                  }
                >
                  What's the goal?
                </Text>
              </View>

              <TouchableOpacity
                onPress={() =>
                  setMissionVisible(
                    false
                  )
                }
                style={
                  styles.sheetClose
                }
              >
                <Ionicons
                  name="close"
                  size={20}
                  color={C.white}
                />
              </TouchableOpacity>
            </View>

            <MissionOption
              icon="infinite-outline"
              title="Free Run"
              subtitle="Run without a target"
              accent={C.lime}
              onPress={() =>
                confirmMissionStart(
                  null
                )
              }
            />

            <MissionOption
              icon="flash-outline"
              title="1 KM Sprint"
              subtitle="Quick and focused"
              accent={C.orange}
              onPress={() =>
                confirmMissionStart(
                  1
                )
              }
            />

            <MissionOption
              icon="flame-outline"
              title="3 KM Challenge"
              subtitle="Build your momentum"
              accent={C.red}
              onPress={() =>
                confirmMissionStart(
                  3
                )
              }
            />

            <MissionOption
              icon="trophy-outline"
              title="5 KM Mission"
              subtitle="The classic runner goal"
              accent={C.purple}
              onPress={() =>
                confirmMissionStart(
                  5
                )
              }
            />

            <MissionOption
              icon="star-outline"
              title="10 KM Endurance"
              subtitle="Go beyond your limits"
              accent={C.lime}
              onPress={() =>
                confirmMissionStart(
                  10
                )
              }
            />
          </View>
        </View>
      </Modal>

      {/* =====================================================
          SUMMARY
      ===================================================== */}

      <Modal
        visible={summaryVisible}
        animationType="slide"
        onRequestClose={() =>
          setSummaryVisible(false)
        }
      >
        <SafeAreaView
          style={styles.modalSafe}
        >
          <View
            style={
              styles.modalHeader
            }
          >
            <View>
              <Text
                style={
                  styles.modalKicker
                }
              >
                WORKOUT COMPLETE
              </Text>

              <Text
                style={
                  styles.modalTitle
                }
              >
                Great run.
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
                size={20}
                color={C.white}
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
              {summary.targetDistance &&
                summary.distanceKm >=
                  summary.targetDistance && (
                  <View
                    style={
                      styles.missionComplete
                    }
                  >
                    <Ionicons
                      name="trophy"
                      size={22}
                      color={C.lime}
                    />

                    <View
                      style={
                        styles.missionCompleteText
                      }
                    >
                      <Text
                        style={
                          styles.missionCompleteTitle
                        }
                      >
                        MISSION ACCOMPLISHED
                      </Text>

                      <Text
                        style={
                          styles.missionCompleteSub
                        }
                      >
                        You hit your target.
                      </Text>
                    </View>
                  </View>
                )}

              <View
                style={
                  styles.summaryHero
                }
              >
                <Text
                  style={
                    styles.summaryHeroLabel
                  }
                >
                  DISTANCE
                </Text>

                <Text
                  style={
                    styles.summaryHeroValue
                  }
                >
                  {Number(
                    summary.distanceKm ||
                      0
                  ).toFixed(2)}

                  <Text
                    style={
                      styles.summaryHeroUnit
                    }
                  >
                    {" "}
                    KM
                  </Text>
                </Text>

                <Text
                  style={
                    styles.summaryHeroTime
                  }
                >
                  {formatTime(
                    summary.durationSeconds
                  )}
                </Text>
              </View>

              {isConnected &&
                summary.route?.length >=
                  2 && (
                  <View
                    style={
                      styles.summaryMap
                    }
                  >
                    <MapView
                      ref={
                        completionMapRef
                      }
                      style={
                        StyleSheet.absoluteFill
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
                      onMapReady={() => {
                        const coords =
                          summary.route
                            .filter(
                              isValidCoordinate
                            )
                            .map(
                              mapCoordinate
                            );

                        if (
                          coords.length >=
                          2
                        ) {
                          setTimeout(
                            () => {
                              completionMapRef.current?.fitToCoordinates(
                                coords,
                                {
                                  edgePadding:
                                    {
                                      top: 50,
                                      right: 30,
                                      bottom: 50,
                                      left: 30,
                                    },
                                  animated:
                                    true,
                                }
                              );
                            },
                            250
                          );
                        }
                      }}
                    >
                      <SpectrumRoute
                        points={
                          summary.route
                        }
                        prefix="summary"
                      />

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
                    </MapView>
                  </View>
                )}

              <View
                style={
                  styles.summaryStats
                }
              >
                <SummaryMetric
                  icon="walk-outline"
                  label="PACE"
                  value={`${summary.pace}/km`}
                />

                <SummaryMetric
                  icon="speedometer-outline"
                  label="AVG SPEED"
                  value={`${Number(
                    summary.averageSpeedKmh ||
                      0
                  ).toFixed(
                    1
                  )} km/h`}
                />

                <SummaryMetric
                  icon="trending-up-outline"
                  label="TOP SPEED"
                  value={`${Number(
                    summary.topSpeedKmh ||
                      0
                  ).toFixed(
                    1
                  )} km/h`}
                />

                <SummaryMetric
                  icon="flame-outline"
                  label="CALORIES"
                  value={`${summary.calories} kcal`}
                />
              </View>

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
                    styles.spectrumBar
                  }
                >
                  {SPEED_STOPS.map(
                    (stop) => (
                      <View
                        key={
                          stop.speed
                        }
                        style={[
                          styles.spectrumSegment,
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
                    styles.spectrumLabels
                  }
                >
                  <Text
                    style={
                      styles.spectrumLabel
                    }
                  >
                    SLOW
                  </Text>

                  <Text
                    style={
                      styles.spectrumLabel
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
              >
                <Text
                  style={
                    styles.doneButtonText
                  }
                >
                  DONE
                </Text>

                <Ionicons
                  name="checkmark"
                  size={19}
                  color={C.black}
                />
              </TouchableOpacity>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      {/* =====================================================
          HISTORY DETAIL
      ===================================================== */}

      <Modal
        visible={historyDetailVisible}
        animationType="slide"
        onRequestClose={() =>
          setHistoryDetailVisible(
            false
          )
        }
      >
        <SafeAreaView
          style={styles.modalSafe}
        >
          {selectedHistoryRun && (
            <>
              <View
                style={
                  styles.modalHeader
                }
              >
                <View>
                  <Text
                    style={
                      styles.modalKicker
                    }
                  >
                    RUN DETAILS
                  </Text>

                  <Text
                    style={
                      styles.modalTitle
                    }
                  >
                    {Number(
                      selectedHistoryRun.distanceKm ||
                        0
                    ).toFixed(
                      2
                    )}{" "}
                    KM
                  </Text>
                </View>

                <TouchableOpacity
                  style={
                    styles.closeButton
                  }
                  onPress={() =>
                    setHistoryDetailVisible(
                      false
                    )
                  }
                >
                  <Ionicons
                    name="close"
                    size={20}
                    color={C.white}
                  />
                </TouchableOpacity>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={
                  false
                }
                contentContainerStyle={
                  styles.summaryScroll
                }
              >
                <View
                  style={
                    styles.detailDate
                  }
                >
                  {new Date(
                    selectedHistoryRun.date
                  ).toLocaleString(
                    "en-IN",
                    {
                      dateStyle:
                        "long",
                      timeStyle:
                        "short",
                    }
                  )}
                </View>

                {selectedHistoryRun
                  .route?.length >=
                  2 && (
                  <View
                    style={
                      styles.summaryMap
                    }
                  >
                    <MapView
                      style={
                        StyleSheet.absoluteFill
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
                    >
                      <SpectrumRoute
                        points={
                          selectedHistoryRun.route
                        }
                        prefix="detail"
                      />

                      <StartMarker
                        coordinate={
                          selectedHistoryRun
                            .route[0]
                        }
                      />

                      <FinishMarker
                        coordinate={
                          selectedHistoryRun
                            .route[
                              selectedHistoryRun
                                .route
                                .length -
                                1
                            ]
                        }
                      />
                    </MapView>
                  </View>
                )}

                <View
                  style={
                    styles.summaryStats
                  }
                >
                  <SummaryMetric
                    icon="time-outline"
                    label="TIME"
                    value={formatTime(
                      selectedHistoryRun.durationSeconds
                    )}
                  />

                  <SummaryMetric
                    icon="walk-outline"
                    label="PACE"
                    value={`${selectedHistoryRun.pace}/km`}
                  />

                  <SummaryMetric
                    icon="speedometer-outline"
                    label="AVG"
                    value={`${Number(
                      selectedHistoryRun.averageSpeedKmh ||
                        0
                    ).toFixed(
                      1
                    )} km/h`}
                  />

                  <SummaryMetric
                    icon="flame-outline"
                    label="CALORIES"
                    value={`${selectedHistoryRun.calories}`}
                  />
                </View>
              </ScrollView>
            </>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

/* =========================================================
   COMPONENTS
========================================================= */

function BottomNav({
  active,
  onChange,
  running,
}) {
  const items = [
    {
      id: "home",
      icon: "home-outline",
      activeIcon: "home",
      label: "Home",
    },
    {
      id: "run",
      icon: "navigate-outline",
      activeIcon: "navigate",
      label: "Run",
    },
    {
      id: "history",
      icon: "stats-chart-outline",
      activeIcon: "stats-chart",
      label: "History",
    },
    {
      id: "profile",
      icon: "person-outline",
      activeIcon: "person",
      label: "Profile",
    },
  ];

  return (
    <View
      style={styles.navWrap}
    >
      <View
        style={styles.bottomNav}
      >
        {items.map((item) => {
          const selected =
            active === item.id;

          return (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.navItem,
                selected &&
                  styles.navItemActive,
              ]}
              activeOpacity={0.8}
              onPress={() =>
                onChange(item.id)
              }
            >
              <View
                style={
                  styles.navIconWrap
                }
              >
                <Ionicons
                  name={
                    selected
                      ? item.activeIcon
                      : item.icon
                  }
                  size={21}
                  color={
                    selected
                      ? C.lime
                      : C.muted2
                  }
                />

                {item.id ===
                  "run" &&
                  running && (
                    <View
                      style={
                        styles.navLiveDot
                      }
                    />
                  )}
              </View>

              <Text
                style={[
                  styles.navLabel,
                  selected &&
                    styles.navLabelActive,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function ScreenHeader({
  kicker,
  title,
  right,
}) {
  return (
    <View
      style={styles.screenHeader}
    >
      <View>
        <Text
          style={styles.screenKicker}
        >
          {kicker}
        </Text>

        <Text
          style={styles.screenTitle}
        >
          {title}
        </Text>
      </View>

      {right}
    </View>
  );
}

function HeroMeta({
  icon,
  text,
}) {
  return (
    <View
      style={styles.heroMetaItem}
    >
      <Ionicons
        name={icon}
        size={12}
        color={C.lime}
      />

      <Text
        style={styles.heroMetaText}
      >
        {text}
      </Text>
    </View>
  );
}

function MiniMetric({
  icon,
  value,
  label,
  accent,
}) {
  return (
    <View
      style={styles.miniMetric}
    >
      <Ionicons
        name={icon}
        size={18}
        color={accent}
      />

      <Text
        style={styles.miniMetricValue}
      >
        {value}
      </Text>

      <Text
        style={styles.miniMetricLabel}
      >
        {label}
      </Text>
    </View>
  );
}

function FeatureCard({
  icon,
  title,
  text,
}) {
  return (
    <View
      style={styles.featureCard}
    >
      <View
        style={styles.featureIcon}
      >
        <Ionicons
          name={icon}
          size={20}
          color={C.lime}
        />
      </View>

      <View
        style={styles.featureContent}
      >
        <Text
          style={styles.featureTitle}
        >
          {title}
        </Text>

        <Text
          style={styles.featureText}
        >
          {text}
        </Text>
      </View>

      <Ionicons
        name="arrow-up-outline"
        size={18}
        color={C.muted2}
        style={{
          transform: [
            {
              rotate: "45deg",
            },
          ],
        }}
      />
    </View>
  );
}

function LiveStat({
  label,
  value,
  unit,
}) {
  return (
    <View
      style={styles.liveStat}
    >
      <Text
        style={styles.liveStatLabel}
      >
        {label}
      </Text>

      <Text
        style={styles.liveStatValue}
      >
        {value}
      </Text>

      <Text
        style={styles.liveStatUnit}
      >
        {unit}
      </Text>
    </View>
  );
}

function HistoryStat({
  label,
  value,
}) {
  return (
    <View
      style={styles.historyStat}
    >
      <Text
        style={styles.historyStatLabel}
      >
        {label}
      </Text>

      <Text
        style={styles.historyStatValue}
      >
        {value}
      </Text>
    </View>
  );
}

function ProfileStat({
  value,
  label,
  icon,
}) {
  return (
    <View
      style={styles.profileStat}
    >
      <Ionicons
        name={icon}
        size={18}
        color={C.lime}
      />

      <Text
        style={styles.profileStatValue}
      >
        {value}
      </Text>

      <Text
        style={styles.profileStatLabel}
      >
        {label}
      </Text>
    </View>
  );
}

function PBRow({
  icon,
  label,
  value,
}) {
  return (
    <View
      style={styles.pbRow}
    >
      <View
        style={styles.pbIcon}
      >
        <Ionicons
          name={icon}
          size={18}
          color={C.lime}
        />
      </View>

      <Text
        style={styles.pbLabel}
      >
        {label}
      </Text>

      <Text
        style={styles.pbValue}
      >
        {value}
      </Text>
    </View>
  );
}

function ValueRow({
  icon,
  title,
  text,
}) {
  return (
    <View
      style={styles.valueRow}
    >
      <View
        style={styles.valueIcon}
      >
        <Ionicons
          name={icon}
          size={18}
          color={C.lime}
        />
      </View>

      <View
        style={styles.valueContent}
      >
        <Text
          style={styles.valueTitle}
        >
          {title}
        </Text>

        <Text
          style={styles.valueText}
        >
          {text}
        </Text>
      </View>
    </View>
  );
}

function SummaryMetric({
  icon,
  label,
  value,
}) {
  return (
    <View
      style={styles.summaryMetric}
    >
      <Ionicons
        name={icon}
        size={18}
        color={C.lime}
      />

      <Text
        style={
          styles.summaryMetricLabel
        }
      >
        {label}
      </Text>

      <Text
        style={
          styles.summaryMetricValue
        }
      >
        {value}
      </Text>
    </View>
  );
}

function MissionOption({
  icon,
  title,
  subtitle,
  accent,
  onPress,
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      style={
        styles.missionOption
      }
      onPress={onPress}
    >
      <View
        style={[
          styles.missionOptionIcon,
          {
            backgroundColor:
              `${accent}15`,
            borderColor:
              `${accent}35`,
          },
        ]}
      >
        <Ionicons
          name={icon}
          size={21}
          color={accent}
        />
      </View>

      <View
        style={
          styles.missionOptionContent
        }
      >
        <Text
          style={
            styles.missionOptionTitle
          }
        >
          {title}
        </Text>

        <Text
          style={
            styles.missionOptionSubtitle
          }
        >
          {subtitle}
        </Text>
      </View>

      <Ionicons
        name="chevron-forward"
        size={18}
        color={C.muted2}
      />
    </TouchableOpacity>
  );
}

function OfflineRunView({
  running,
  paused,
  distance,
  elapsedSeconds,
  targetDistance,
  location,
  translateY,
}) {
  return (
    <View
      style={
        styles.offlineRun
      }
    >
      {running && !paused ? (
        <Animated.View
          style={{
            transform: [
              {
                translateY,
              },
            ],
          }}
        >
          <FontAwesome5
            name="running"
            size={42}
            color={C.lime}
          />
        </Animated.View>
      ) : (
        <Ionicons
          name="cloud-offline-outline"
          size={42}
          color={C.muted2}
        />
      )}

      <Text
        style={styles.offlineRunTitle}
      >
        {running
          ? paused
            ? "RUN PAUSED"
            : "TRACKING OFFLINE"
          : "READY TO RUN"}
      </Text>

      <Text
        style={
          styles.offlineRunMetricLabel
        }
      >
        {targetDistance
          ? "DISTANCE REMAINING"
          : "ELAPSED TIME"}
      </Text>

      <Text
        style={
          styles.offlineRunMetric
        }
      >
        {targetDistance
          ? Math.max(
              0,
              targetDistance -
                distance
            ).toFixed(2)
          : formatTime(
              elapsedSeconds
            )}
      </Text>

      <Text
        style={
          styles.offlineRunUnit
        }
      >
        {targetDistance
          ? `KM / ${targetDistance} KM`
          : "HR : MIN : SEC"}
      </Text>

      <View
        style={
          styles.offlineExtra
        }
      >
        <View
          style={
            styles.offlineExtraItem
          }
        >
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
              M
            </Text>
          </Text>
        </View>

        <View
          style={
            styles.offlineExtraItem
          }
        >
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
          </Text>
        </View>
      </View>
    </View>
  );
}

function LiveGraph({ values }) {
  const data =
    values.length > 1
      ? values
      : [0, 1, 0, 1, 0, 1, 0];

  const max =
    Math.max(...data, 1);

  const min =
    Math.min(...data, 0);

  const range =
    max - min || 1;

  return (
    <View
      style={styles.liveGraph}
    >
      <View
        style={
          styles.graphGridLine
        }
      />

      <View
        style={[
          styles.graphGridLine,
          {
            top: "50%",
          },
        ]}
      />

      <View
        style={[
          styles.graphGridLine,
          {
            top: "100%",
          },
        ]}
      />

      <View
        style={
          styles.graphBars
        }
      >
        {data.map(
          (value, index) => {
            const normalized =
              (value - min) /
              range;

            const barHeight =
              12 +
              normalized * 55;

            return (
              <View
                key={index}
                style={[
                  styles.graphBar,
                  {
                    height:
                      barHeight,
                    opacity:
                      0.35 +
                      (index /
                        data.length) *
                        0.65,
                  },
                ]}
              />
            );
          }
        )}
      </View>
    </View>
  );
}

function OnboardingFeature({
  icon,
  title,
  text,
}) {
  return (
    <View
      style={
        styles.onboardingFeature
      }
    >
      <View
        style={
          styles.onboardingFeatureIcon
        }
      >
        <Ionicons
          name={icon}
          size={17}
          color={C.lime}
        />
      </View>

      <View>
        <Text
          style={
            styles.onboardingFeatureTitle
          }
        >
          {title}
        </Text>

        <Text
          style={
            styles.onboardingFeatureText
          }
        >
          {text}
        </Text>
      </View>
    </View>
  );
}

/* =========================================================
   STYLES
========================================================= */

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.bg,
  },

  app: {
    flex: 1,
    backgroundColor: C.bg,
  },

  content: {
    flex: 1,
  },

  /* =========================================
     HOME
  ========================================= */

  homeScroll: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 108,
  },

  hero: {
    minHeight: 365,
    borderRadius: 30,
    padding: 24,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    overflow: "hidden",
    position: "relative",
  },

  heroGlow: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "transparent",
    opacity: 0,
    right: -80,
    top: -80,
  },

  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
  },

  eyebrow: {
    color: C.lime,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2.2,
    marginBottom: 17,
  },

  heroTitle: {
    color: C.white,
    fontSize: 45,
    lineHeight: 45,
    fontWeight: "900",
    letterSpacing: -2.5,
  },

  heroAccent: {
    color: C.lime,
  },

  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: "rgba(183,201,138,0.06)",
    borderWidth: 1,
    borderColor: "rgba(183,201,138,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },

  heroDescription: {
    color: C.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 24,
    maxWidth: 320,
  },

  heroStart: {
    height: 55,
    borderRadius: 17,
    backgroundColor: C.white,
    marginTop: 25,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },

  heroStartText: {
    color: C.black,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1,
  },

  heroMeta: {
    flexDirection: "row",
    gap: 13,
    marginTop: 21,
    flexWrap: "wrap",
  },

  heroMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },

  heroMetaText: {
    color: C.muted2,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: 31,
    marginBottom: 13,
  },

  sectionKicker: {
    color: C.lime,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.6,
    marginBottom: 5,
  },

  sectionTitle: {
    color: C.white,
    fontSize: 25,
    fontWeight: "900",
    letterSpacing: -0.8,
  },

  linkText: {
    color: C.lime,
    fontSize: 11,
    fontWeight: "800",
  },

  weekCard: {
    padding: 20,
    borderRadius: 24,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
  },

  weekMain: {
    flexDirection: "row",
    alignItems: "baseline",
  },

  weekValue: {
    color: C.white,
    fontSize: 43,
    fontWeight: "900",
    letterSpacing: -1.5,
  },

  weekUnit: {
    color: C.lime,
    fontSize: 13,
    fontWeight: "900",
    marginLeft: 5,
  },

  weekCaption: {
    color: C.muted,
    fontSize: 11,
    marginTop: -3,
  },

  weekProgress: {
    height: 8,
    backgroundColor: "#1B201A",
    borderRadius: 8,
    overflow: "hidden",
    marginTop: 20,
  },

  weekProgressFill: {
    height: "100%",
    borderRadius: 8,
    backgroundColor: C.lime,
  },

  weekBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 9,
  },

  weekHint: {
    color: C.muted2,
    fontSize: 9,
    fontWeight: "700",
  },

  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginTop: 10,
  },

  miniMetric: {
    width: (width - 45) / 2,
    minHeight: 115,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    padding: 15,
  },

  miniMetricValue: {
    color: C.white,
    fontSize: 27,
    fontWeight: "900",
    marginTop: 13,
  },

  miniMetricLabel: {
    color: C.muted2,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 2,
  },

  featureCard: {
    minHeight: 91,
    borderRadius: 21,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    padding: 14,
    marginBottom: 9,
    flexDirection: "row",
    alignItems: "center",
  },

  featureIcon: {
    width: 47,
    height: 47,
    borderRadius: 15,
    backgroundColor: "rgba(183,201,138,0.05)",
    borderWidth: 1,
    borderColor: "rgba(184,255,39,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },

  featureContent: {
    flex: 1,
    marginLeft: 13,
  },

  featureTitle: {
    color: C.white,
    fontSize: 14,
    fontWeight: "900",
  },

  featureText: {
    color: C.muted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 4,
  },

  bottomCTA: {
    marginTop: 20,
    padding: 24,
    borderRadius: 27,
    backgroundColor: C.card2,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.line,
  },

  bottomCTAKicker: {
    color: "rgba(0,0,0,0.55)",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.7,
  },

  bottomCTATitle: {
    color: C.black,
    fontSize: 32,
    fontWeight: "900",
    marginTop: 5,
    letterSpacing: -1,
  },

  ctaButton: {
    height: 50,
    marginTop: 20,
    borderRadius: 15,
    backgroundColor: C.black,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },

  ctaButtonText: {
    color: C.white,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },

  /* =========================================
     RUN
  ========================================= */

  runScreen: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 9,
  },

  runHeader: {
    height: 57,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  runKicker: {
    color: C.lime,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.6,
  },

  runTitle: {
    color: C.white,
    fontSize: 21,
    fontWeight: "900",
    marginTop: 3,
  },

  gpsBadge: {
    height: 31,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  gpsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  gpsBadgeText: {
    color: C.muted,
    fontSize: 8,
    fontWeight: "900",
  },

  mapShell: {
    flex: 1,
    minHeight: 245,
    borderRadius: 25,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
  },

  map: {
    flex: 1,
  },

  mapOverlayTop: {
    position: "absolute",
    left: 13,
    top: 13,
  },

  livePill: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: "rgba(5,6,5,0.88)",
    borderWidth: 1,
    borderColor: "rgba(183,201,138,0.12)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  livePulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.lime,
  },

  livePillText: {
    color: C.white,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.7,
  },

  mapControls: {
    position: "absolute",
    right: 12,
    bottom: 12,
    gap: 7,
  },

  mapControl: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: "rgba(5,6,5,0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },

  runMetric: {
    alignItems: "center",
    paddingTop: 11,
  },

  runMetricLabel: {
    color: C.muted2,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.5,
  },

  runDistanceRow: {
    flexDirection: "row",
    alignItems: "baseline",
  },

  runDistance: {
    color: C.white,
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: -1.8,
  },

  runDistanceUnit: {
    color: C.lime,
    fontSize: 12,
    fontWeight: "900",
    marginLeft: 5,
  },

  timePill: {
    height: 26,
    paddingHorizontal: 9,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: -3,
  },

  timePillText: {
    color: C.muted,
    fontSize: 10,
    fontWeight: "800",
  },

  liveStats: {
    flexDirection: "row",
    marginTop: 9,
    gap: 7,
  },

  liveStat: {
    flex: 1,
    minHeight: 58,
    borderRadius: 15,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    padding: 8,
  },

  liveStatLabel: {
    color: C.muted2,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  liveStatValue: {
    color: C.white,
    fontSize: 16,
    fontWeight: "900",
    marginTop: 4,
  },

  liveStatUnit: {
    color: C.muted2,
    fontSize: 7,
    fontWeight: "800",
  },

  graphCard: {
    height: 82,
    marginTop: 8,
    padding: 10,
    borderRadius: 17,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
  },

  graphHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },

  graphTitle: {
    color: C.white,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.2,
  },

  graphSub: {
    color: C.muted2,
    fontSize: 7,
    fontWeight: "800",
  },

  liveGraph: {
    flex: 1,
    overflow: "hidden",
    justifyContent: "flex-end",
  },

  graphGridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 1,
    backgroundColor: "#1B201B",
  },

  graphBars: {
    height: "100%",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
  },

  graphBar: {
    flex: 1,
    minWidth: 2,
    borderRadius: 5,
    backgroundColor: C.lime,
  },

  bigStart: {
    height: 52,
    borderRadius: 16,
    backgroundColor: C.white,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },

  bigStartText: {
    color: C.black,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },

  runActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },

  pauseAction: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    backgroundColor: C.card2,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  finishAction: {
    flex: 1,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#351515",
    borderWidth: 1,
    borderColor: "#5A2424",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  actionText: {
    color: C.white,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.7,
  },

  /* =========================================
     OFFLINE
  ========================================= */

  offlineRun: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.card,
    padding: 20,
  },

  offlineRunTitle: {
    color: C.muted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.7,
    marginTop: 13,
    marginBottom: 30,
  },

  offlineRunMetricLabel: {
    color: C.muted2,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.4,
  },

  offlineRunMetric: {
    color: C.white,
    fontSize: 55,
    fontWeight: "900",
    letterSpacing: -2,
    marginTop: 2,
  },

  offlineRunUnit: {
    color: C.lime,
    fontSize: 10,
    fontWeight: "900",
    marginTop: 2,
  },

  offlineExtra: {
    flexDirection: "row",
    width: "100%",
    gap: 8,
    marginTop: 28,
  },

  offlineExtraItem: {
    flex: 1,
    padding: 12,
    borderRadius: 15,
    backgroundColor: C.card2,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
  },

  offlineExtraLabel: {
    color: C.muted2,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 1,
  },

  offlineExtraValue: {
    color: C.white,
    fontSize: 16,
    fontWeight: "900",
    marginTop: 4,
  },

  offlineExtraUnit: {
    color: C.muted2,
    fontSize: 8,
  },

  /* =========================================
     NAV
  ========================================= */

  navWrap: {
    paddingHorizontal: 12,
    paddingTop: 7,
    // Extra bottom breathing room keeps the app navigation clear of
    // Android's system navigation buttons / gesture area.
    paddingBottom:
      Platform.OS === "android"
        ? 16
        : 6,
    backgroundColor: C.bg,
  },

  bottomNav: {
    height: 66,
    borderRadius: 22,
    backgroundColor: "#0C0E0C",
    borderWidth: 1,
    borderColor: C.line,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 4,
  },

  navItem: {
    flex: 1,
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },

  navItemActive: {
    backgroundColor:
      "rgba(255,255,255,0.055)",
  },

  navIconWrap: {
    position: "relative",
  },

  navLiveDot: {
    position: "absolute",
    right: -4,
    top: -3,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.lime,
    borderWidth: 1,
    borderColor: C.bg,
  },

  navLabel: {
    color: C.muted2,
    fontSize: 8,
    fontWeight: "800",
    marginTop: 4,
  },

  navLabelActive: {
    color: C.lime,
  },

  /* =========================================
     SCREEN HEADERS
  ========================================= */

  screenHeader: {
    minHeight: 75,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  screenKicker: {
    color: C.lime,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.7,
  },

  screenTitle: {
    color: C.white,
    fontSize: 29,
    fontWeight: "900",
    letterSpacing: -1,
    marginTop: 4,
  },

  countBadge: {
    minWidth: 34,
    height: 34,
    paddingHorizontal: 9,
    borderRadius: 17,
    backgroundColor:
      "rgba(183,201,138,0.06)",
    borderWidth: 1,
    borderColor:
      "rgba(183,201,138,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },

  countBadgeText: {
    color: C.lime,
    fontSize: 11,
    fontWeight: "900",
  },

  /* =========================================
     HISTORY
  ========================================= */

  historyScreen: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 104,
  },

  historyOverview: {
    padding: 19,
    borderRadius: 23,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
  },

  overviewLabel: {
    color: C.muted2,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 1.1,
  },

  overviewValue: {
    color: C.white,
    fontSize: 24,
    fontWeight: "900",
    marginTop: 4,
  },

  overviewUnit: {
    color: C.lime,
    fontSize: 9,
  },

  historyItem: {
    backgroundColor: C.card,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: C.line,
    padding: 16,
    marginBottom: 9,
  },

  historyItemTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  historyItemDate: {
    color: C.muted,
    fontSize: 9,
    fontWeight: "800",
  },

  historyItemDistance: {
    color: C.white,
    fontSize: 24,
    fontWeight: "900",
    marginTop: 2,
  },

  historyKm: {
    color: C.lime,
    fontSize: 9,
  },

  historyArrow: {
    width: 35,
    height: 35,
    borderRadius: 12,
    backgroundColor: C.card2,
    alignItems: "center",
    justifyContent: "center",
  },

  historyItemStats: {
    flexDirection: "row",
    marginTop: 13,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: C.line,
  },

  historyStat: {
    flex: 1,
  },

  historyStatLabel: {
    color: C.muted2,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  historyStatValue: {
    color: C.white,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 4,
  },

  emptyState: {
    minHeight: height * 0.65,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
  },

  emptyIcon: {
    width: 70,
    height: 70,
    borderRadius: 24,
    backgroundColor:
      "rgba(183,201,138,0.05)",
    borderWidth: 1,
    borderColor:
      "rgba(183,201,138,0.09)",
    alignItems: "center",
    justifyContent: "center",
  },

  emptyTitle: {
    color: C.white,
    fontSize: 20,
    fontWeight: "900",
    marginTop: 17,
    textAlign: "center",
  },

  emptyText: {
    color: C.muted,
    fontSize: 11,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 7,
  },

  emptyButton: {
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 15,
    backgroundColor: C.white,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },

  emptyButtonText: {
    color: C.black,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  /* =========================================
     PROFILE
  ========================================= */

  profileScreen: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 120,
  },

  profileHero: {
    minHeight: 105,
    padding: 17,
    borderRadius: 23,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    flexDirection: "row",
    alignItems: "center",
  },

  profileAvatar: {
    width: 61,
    height: 61,
    borderRadius: 21,
    backgroundColor: C.lime,
    alignItems: "center",
    justifyContent: "center",
  },

  profileHeroText: {
    flex: 1,
    marginLeft: 14,
  },

  profileName: {
    color: C.white,
    fontSize: 18,
    fontWeight: "900",
  },

  profileSubtitle: {
    color: C.muted,
    fontSize: 10,
    marginTop: 3,
  },

  profileSectionTitle: {
    color: C.muted2,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.5,
    marginTop: 25,
    marginBottom: 10,
  },

  profileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },

  profileStat: {
    width: (width - 45) / 2,
    minHeight: 112,
    padding: 14,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
  },

  profileStatValue: {
    color: C.white,
    fontSize: 27,
    fontWeight: "900",
    marginTop: 13,
  },

  profileStatLabel: {
    color: C.muted2,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 2,
  },

  pbCard: {
    padding: 6,
    borderRadius: 21,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
  },

  pbRow: {
    minHeight: 61,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },

  pbIcon: {
    width: 39,
    height: 39,
    borderRadius: 13,
    backgroundColor:
      "rgba(183,201,138,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },

  pbLabel: {
    flex: 1,
    color: C.muted,
    fontSize: 11,
    fontWeight: "700",
    marginLeft: 11,
  },

  pbValue: {
    color: C.white,
    fontSize: 12,
    fontWeight: "900",
  },

  valueCard: {
    padding: 8,
    borderRadius: 21,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
  },

  valueRow: {
    minHeight: 69,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 7,
  },

  valueIcon: {
    width: 39,
    height: 39,
    borderRadius: 13,
    backgroundColor:
      "rgba(183,201,138,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },

  valueContent: {
    flex: 1,
    marginLeft: 11,
  },

  valueTitle: {
    color: C.white,
    fontSize: 11,
    fontWeight: "900",
  },

  valueText: {
    color: C.muted2,
    fontSize: 9,
    marginTop: 3,
  },

  versionText: {
    color: "#343934",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.5,
    textAlign: "center",
    marginTop: 25,
  },

  /* =========================================
     MODALS
  ========================================= */

  modalOverlay: {
    flex: 1,
    backgroundColor:
      "rgba(0,0,0,0.72)",
    justifyContent: "flex-end",
  },

  missionSheet: {
    backgroundColor: "#0A0C0A",
    borderTopLeftRadius: 31,
    borderTopRightRadius: 31,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom:
      Platform.OS === "ios"
        ? 30
        : 18,
    borderTopWidth: 1,
    borderColor: C.line,
  },

  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 4,
    backgroundColor: "#303530",
    alignSelf: "center",
    marginBottom: 19,
  },

  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },

  sheetKicker: {
    color: C.lime,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.5,
  },

  sheetTitle: {
    color: C.white,
    fontSize: 25,
    fontWeight: "900",
    marginTop: 4,
  },

  sheetClose: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: C.card2,
    alignItems: "center",
    justifyContent: "center",
  },

  missionOption: {
    minHeight: 68,
    borderRadius: 18,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 7,
  },

  missionOptionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  missionOptionContent: {
    flex: 1,
    marginLeft: 11,
  },

  missionOptionTitle: {
    color: C.white,
    fontSize: 12,
    fontWeight: "900",
  },

  missionOptionSubtitle: {
    color: C.muted2,
    fontSize: 9,
    marginTop: 3,
  },

  modalSafe: {
    flex: 1,
    backgroundColor: C.bg,
  },

  modalHeader: {
    minHeight: 78,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  modalKicker: {
    color: C.lime,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.5,
  },

  modalTitle: {
    color: C.white,
    fontSize: 28,
    fontWeight: "900",
    marginTop: 3,
  },

  closeButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
  },

  summaryScroll: {
    paddingHorizontal: 16,
    paddingBottom: 35,
  },

  missionComplete: {
    minHeight: 68,
    borderRadius: 19,
    backgroundColor:
      "rgba(183,201,138,0.05)",
    borderWidth: 1,
    borderColor:
      "rgba(183,201,138,0.12)",
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },

  missionCompleteText: {
    marginLeft: 11,
  },

  missionCompleteTitle: {
    color: C.lime,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },

  missionCompleteSub: {
    color: C.muted,
    fontSize: 9,
    marginTop: 3,
  },

  summaryHero: {
    padding: 24,
    borderRadius: 25,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    marginBottom: 10,
  },

  summaryHeroLabel: {
    color: C.muted2,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.5,
  },

  summaryHeroValue: {
    color: C.white,
    fontSize: 43,
    fontWeight: "900",
    letterSpacing: -1.5,
    marginTop: 2,
  },

  summaryHeroUnit: {
    color: C.lime,
    fontSize: 12,
  },

  summaryHeroTime: {
    color: C.muted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 3,
  },

  summaryMap: {
    height: 275,
    borderRadius: 23,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
    marginBottom: 10,
  },

  summaryStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  summaryMetric: {
    width: (width - 41) / 2,
    minHeight: 96,
    padding: 13,
    borderRadius: 18,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
  },

  summaryMetricLabel: {
    color: C.muted2,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 9,
  },

  summaryMetricValue: {
    color: C.white,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 4,
  },

  spectrumCard: {
    marginTop: 10,
    padding: 15,
    borderRadius: 19,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
  },

  spectrumTitle: {
    color: C.muted,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginBottom: 9,
  },

  spectrumBar: {
    height: 9,
    borderRadius: 9,
    overflow: "hidden",
    flexDirection: "row",
  },

  spectrumSegment: {
    flex: 1,
  },

  spectrumLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },

  spectrumLabel: {
    color: C.muted2,
    fontSize: 7,
    fontWeight: "900",
  },

  doneButton: {
    height: 54,
    borderRadius: 17,
    backgroundColor: C.white,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 11,
  },

  doneButtonText: {
    color: C.black,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },

  detailDate: {
    color: C.muted,
    fontSize: 10,
    marginBottom: 10,
  },

  /* =========================================
     ONBOARDING
  ========================================= */

  onboarding: {
    flex: 1,
    backgroundColor: C.bg,
    paddingHorizontal: 23,
    paddingTop: 20,
    paddingBottom:
      Platform.OS === "ios"
        ? 20
        : 15,
    overflow: "hidden",
  },

  onboardingGlow: {
    position: "absolute",
    width: 330,
    height: 330,
    borderRadius: 165,
    backgroundColor: "transparent",
    opacity: 0.2,
    top: height * 0.18,
    left: width * 0.1,
  },

  onboardingTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  onboardingLogo: {
    color: C.white,
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: -0.5,
  },

  onboardingPill: {
    height: 27,
    paddingHorizontal: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor:
      "rgba(183,201,138,0.10)",
    backgroundColor:
      "rgba(184,255,39,0.05)",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },

  onboardingDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.lime,
  },

  onboardingPillText: {
    color: C.lime,
    fontSize: 6,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  onboardingCenter: {
    flex: 1,
    justifyContent: "center",
  },

  onboardingIcon: {
    width: 95,
    height: 95,
    borderRadius: 34,
    backgroundColor:
      "rgba(183,201,138,0.05)",
    borderWidth: 1,
    borderColor:
      "rgba(183,201,138,0.10)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 30,
  },

  onboardingTitle: {
    color: C.white,
    fontSize: 48,
    lineHeight: 47,
    fontWeight: "900",
    letterSpacing: -2.8,
  },

  onboardingAccent: {
    color: C.lime,
  },

  onboardingText: {
    color: C.muted,
    fontSize: 13,
    lineHeight: 21,
    maxWidth: 330,
    marginTop: 20,
  },

  onboardingFeatures: {
    gap: 9,
    marginBottom: 14,
  },

  onboardingFeature: {
    minHeight: 51,
    flexDirection: "row",
    alignItems: "center",
  },

  onboardingFeatureIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor:
      "rgba(183,201,138,0.05)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },

  onboardingFeatureTitle: {
    color: C.white,
    fontSize: 10,
    fontWeight: "900",
  },

  onboardingFeatureText: {
    color: C.muted2,
    fontSize: 8,
    marginTop: 2,
  },

  onboardingButton: {
    height: 55,
    borderRadius: 17,
    backgroundColor: C.white,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },

  onboardingButtonText: {
    color: C.black,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },

  /* =========================================
     MARKERS
  ========================================= */

  startMarker: {
    width: 23,
    height: 23,
    borderRadius: 12,
    backgroundColor: C.lime,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },

  startMarkerInner: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.black,
  },

  finishMarker: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.blue,
    borderWidth: 3,
    borderColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },

  liveMarker: {
    width: 29,
    height: 29,
    borderRadius: 15,
    backgroundColor:
      "rgba(183,201,138,0.13)",
    borderWidth: 1,
    borderColor:
      "rgba(183,201,138,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },

  liveMarkerInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: C.lime,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
});
