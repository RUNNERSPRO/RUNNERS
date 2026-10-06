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
  bg: "#050807",
  bg2: "#08110F",
  card: "rgba(14,24,21,0.94)",
  card2: "#0D1714",
  card3: "#12211C",

  white: "#F7FFF4",
  ink: "#F4FAF1",
  muted: "#93A49B",
  muted2: "#64756D",
  line: "rgba(190,255,218,0.11)",

  lime: "#5CFF8A",
  lime2: "#B8FF27",
  limeDark: "rgba(92,255,138,0.10)",
  cyan: "#27E8FF",
  teal: "#00BFAE",
  blue: "#4D7CFF",
  blue2: "#24C6FF",
  purple: "#8B7CFF",
  gradientStart: "#27E8FF",
  gradientEnd: "#5CFF8A",

  red: "#FF5A68",
  orange: "#FF9D4D",
  yellow: "#FFD75A",

  black: "#030504",
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
  { speed: 10, color: "#5CFF8A" },
  { speed: 13, color: "#27E8FF" },
  { speed: 16, color: "#4D7CFF" },
  { speed: 20, color: "#8B7CFF" },
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

  const [onboardingPage, setOnboardingPage] =
    useState(0);

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
      // Keep Android navigation in the normal layout flow so the app
      // bottom bar cannot sit underneath the system navigation controls.
      NavigationBar.setPositionAsync("relative").catch(() => {});
      NavigationBar.setBackgroundColorAsync(C.black).catch(() => {});
      NavigationBar.setButtonStyleAsync("light").catch(() => {});
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
    await AsyncStorage.setItem(ONBOARDING_KEY, "true");
    setOnboarding(false);
    setOnboardingPage(0);
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
     HOME — REFERENCE STYLE
  ========================================================= */

  function renderHome() {
    const goal = 10;
    const progress = Math.min(100, (weeklyDistance / goal) * 100);
    const latest = history[0];

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.refScroll}>
        <View style={styles.refTopBar}>
          <View>
            <Text style={styles.refGreetingSmall}>GOOD MORNING,</Text>
            <View style={styles.refTitleRow}>
              <Text style={styles.refTitle}>Runner</Text>
              <Text style={styles.refLeaf}>✦</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.refBell} onPress={() => Alert.alert("Notifications", "You're all caught up.")} activeOpacity={0.8}>
            <Ionicons name="notifications-outline" size={20} color={C.white} />
            <View style={styles.refBellDot} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.refTodayCard} onPress={() => setMissionVisible(true)} activeOpacity={0.9}>
          <View style={{flex: 1}}>
            <Text style={styles.refCardEyebrow}>TODAY'S RUN</Text>
            <Text style={styles.refCardTitle}>Let's move.</Text>
            <Text style={styles.refCardSub}>Keep the streak alive!</Text>
          </View>
          <View style={styles.refStartPill}><Text style={styles.refStartText}>Start</Text></View>
        </TouchableOpacity>

        <View style={styles.refGoalCard}>
          <View style={styles.refGlow} />
          <View style={styles.refGoalRing}>
            <View style={styles.refGoalRingInner}>
              <Text style={styles.refGoalNumber}>{weeklyDistance.toFixed(1)}</Text>
              <Text style={styles.refGoalUnit}>KM</Text>
              <Text style={styles.refGoalHint}>Goal {goal} km</Text>
            </View>
          </View>
          <Text style={styles.refGoalLabel}>WEEKLY DISTANCE</Text>
          <Text style={styles.refGoalCaption}>{Math.round(progress)}% of your weekly goal</Text>
        </View>

        <View style={styles.refStatsGrid}>
          <View style={styles.refStatCard}><Text style={styles.refStatLabel}>PACE</Text><Text style={styles.refStatValue}>{latest?.pace || personalBests.fastestPace || "--:--"}</Text><Text style={styles.refStatUnit}>/km</Text></View>
          <View style={styles.refStatCard}><Text style={styles.refStatLabel}>TIME</Text><Text style={styles.refStatValue}>{latest ? formatTime(latest.durationSeconds) : "--:--"}</Text><Text style={styles.refStatUnit}>min</Text></View>
          <View style={styles.refStatCard}><Text style={styles.refStatLabel}>CALORIES</Text><Text style={styles.refStatValue}>{latest?.calories || 0}</Text><Text style={styles.refStatUnit}>kcal</Text></View>
          <View style={styles.refStatCard}><Text style={styles.refStatLabel}>RUNS</Text><Text style={styles.refStatValue}>{totalRuns}</Text><Text style={styles.refStatUnit}>total</Text></View>
        </View>

        <View style={styles.refSectionHead}><Text style={styles.refSectionTitle}>Your progress</Text><TouchableOpacity onPress={() => setActiveTab("stats")}><Text style={styles.refSeeAll}>See stats</Text></TouchableOpacity></View>
        <View style={styles.refProgressCard}>
          <View style={styles.refProgressBars}>
            {[0.22,0.44,0.32,0.66,0.52,0.78,Math.max(0.18, Math.min(1, progress/100))].map((v,i)=><View key={i} style={styles.refBarTrack}><View style={[styles.refBarFill,{height:`${Math.max(12,v*100)}%`}]} /></View>)}
          </View>
          <View style={styles.refProgressFooter}><Text style={styles.refMuted}>LAST 7 DAYS</Text><Text style={styles.refProgressValue}>{weeklyDistance.toFixed(1)} km</Text></View>
        </View>

        <View style={styles.refSectionHead}><Text style={styles.refSectionTitle}>Recent run</Text><TouchableOpacity onPress={() => setActiveTab("history")}><Text style={styles.refSeeAll}>View all</Text></TouchableOpacity></View>
        {latest ? (
          <TouchableOpacity style={styles.refRunRow} activeOpacity={0.86} onPress={() => {setSelectedHistoryRun(latest);setHistoryDetailVisible(true);}}>
            <View style={styles.refRunIcon}><Ionicons name="footsteps" size={21} color={C.lime2} /></View>
            <View style={{flex:1}}><Text style={styles.refRunDistance}>{Number(latest.distanceKm || 0).toFixed(2)} km</Text><Text style={styles.refRunMeta}>{new Date(latest.date).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})} · {latest.pace}/km · {formatTime(latest.durationSeconds)}</Text></View>
            <Ionicons name="chevron-forward" size={18} color={C.muted2} />
          </TouchableOpacity>
        ) : (
          <View style={styles.refRunRow}><View style={styles.refRunIcon}><Ionicons name="sparkles-outline" size={21} color={C.lime2}/></View><View style={{flex:1}}><Text style={styles.refRunDistance}>Your first run</Text><Text style={styles.refRunMeta}>Start your journey today.</Text></View></View>
        )}
      </ScrollView>
    );
  }

  /* =========================================================
     RUN TAB — REFERENCE STYLE
  ========================================================= */

  function renderRun() {
    const currentPace = getPace(distance, elapsedSeconds);
    const displayPace = currentPace === "--:--" ? "--:--" : currentPace;
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.refScroll}>
        <View style={styles.refRunHeader}>
          <View><Text style={styles.refGpsPill}>{running ? (paused ? "PAUSED" : "● GPS") : "● GPS READY"}</Text><Text style={styles.refRunTitle}>{running ? "Running" : "Ready to run"}</Text><Text style={styles.refRunSub}>{running ? (paused ? "Take a breath." : "Keep going!") : "Move at your own pace."}</Text></View>
          <Ionicons name="lock-closed-outline" size={18} color={C.muted} />
        </View>

        <View style={styles.refLiveCard}>
          <Text style={styles.refLiveLabel}>TIME</Text>
          <Text style={styles.refLiveTime}>{formatTime(elapsedSeconds)}</Text>
          <View style={styles.refLiveStats}>
            <View><Text style={styles.refLiveValue}>{distance.toFixed(2)}</Text><Text style={styles.refLiveUnit}>DISTANCE · KM</Text></View>
            <View><Text style={styles.refLiveValue}>{displayPace}</Text><Text style={styles.refLiveUnit}>PACE · /KM</Text></View>
          </View>
          <LiveGraph values={paceHistory.map(v => Number(v) || 0)} />
        </View>

        <View style={styles.refMapCard}>
          {route.length > 1 ? (
            <MapView
              ref={mapRef}
              style={styles.refMap}
              mapType="standard"
              showsUserLocation={false}
              showsMyLocationButton={false}
              initialRegion={{latitude: route[0].latitude, longitude: route[0].longitude, latitudeDelta: MAP_DELTA, longitudeDelta: MAP_DELTA}}
            >
              <Polyline coordinates={route.map(mapCoordinate)} strokeColor={C.lime2} strokeWidth={5} />
              <Marker coordinate={mapCoordinate(route[0])}><View style={styles.refMapDotStart} /></Marker>
              <Marker coordinate={mapCoordinate(route[route.length-1])}><View style={styles.refMapDotEnd} /></Marker>
            </MapView>
          ) : (
            <View style={styles.refMapEmpty}><Ionicons name="map-outline" size={38} color={C.lime2}/><Text style={styles.refMapEmptyTitle}>Your route appears here</Text><Text style={styles.refMapEmptySub}>Start running to see live GPS tracking.</Text></View>
          )}
          <View style={styles.refMapBadge}><Ionicons name="navigate" size={13} color={C.lime2}/><Text style={styles.refMapBadgeText}>{accuracy ? `${Math.round(accuracy)}m GPS` : "GPS"}</Text></View>
        </View>

        {!running ? (
          <TouchableOpacity style={styles.refMainButton} onPress={() => setMissionVisible(true)} activeOpacity={0.88}><Ionicons name="play" size={19} color={C.black}/><Text style={styles.refMainButtonText}>START RUN</Text></TouchableOpacity>
        ) : (
          <View style={styles.refRunControls}><TouchableOpacity style={styles.refCircleControl} onPress={paused ? resumeRun : pauseRun}><Ionicons name={paused ? "play" : "pause"} size={25} color={C.black}/></TouchableOpacity><TouchableOpacity style={styles.refStopButton} onPress={finishRun}><Ionicons name="stop" size={19} color={C.white}/><Text style={styles.refStopText}>FINISH</Text></TouchableOpacity></View>
        )}
        <Text style={styles.refSwipeHint}>{running ? "Tap FINISH when you're done" : "Choose a goal or start a free run"}</Text>
      </ScrollView>
    );
  }

  /* =========================================================
     ROUTES / HISTORY
  ========================================================= */

  function renderHistory() {
    const tabs = ["All", "Week", "Month", "Year"];
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.refScroll}>
        <View style={styles.refPageHeader}><View><Text style={styles.refGreetingSmall}>YOUR ACTIVITY</Text><Text style={styles.refPageTitle}>Run History</Text></View><TouchableOpacity style={styles.refIconButton} onPress={() => setMissionVisible(true)}><Ionicons name="add" size={22} color={C.lime2}/></TouchableOpacity></View>
        <View style={styles.refFilterRow}>{tabs.map((t,i)=><TouchableOpacity key={t} style={[styles.refFilter,{backgroundColor:i===0?C.lime2:"transparent",borderColor:i===0?C.lime2:C.line}]}><Text style={[styles.refFilterText,{color:i===0?C.black:C.muted}]}>{t}</Text></TouchableOpacity>)}</View>
        <View style={styles.refHistoryHero}><Text style={styles.refCardEyebrow}>TOTAL DISTANCE</Text><Text style={styles.refHistoryHeroValue}>{totalDistance.toFixed(2)} <Text style={styles.refHistoryHeroUnit}>KM</Text></Text><Text style={styles.refCardSub}>{totalRuns} runs · {streak} day streak</Text></View>
        {history.length === 0 ? (
          <View style={styles.refEmpty}><Ionicons name="footsteps-outline" size={38} color={C.lime2}/><Text style={styles.refEmptyTitle}>No runs yet</Text><Text style={styles.refEmptySub}>Your completed runs will appear here.</Text><TouchableOpacity style={styles.refSmallButton} onPress={() => setMissionVisible(true)}><Text style={styles.refSmallButtonText}>START FIRST RUN</Text></TouchableOpacity></View>
        ) : history.map((item,index) => (
          <TouchableOpacity key={item.id || `run-${index}`} style={styles.refHistoryRow} activeOpacity={0.86} onPress={() => {setSelectedHistoryRun(item);setHistoryDetailVisible(true);}}>
            <View style={styles.refHistoryIcon}><Ionicons name="footsteps" size={20} color={C.lime2}/></View>
            <View style={{flex:1}}><Text style={styles.refHistoryDistance}>{Number(item.distanceKm||0).toFixed(2)} km</Text><Text style={styles.refHistoryMeta}>{item.pace || "--:--"}/km · {formatTime(item.durationSeconds)} · {new Date(item.date).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}</Text></View>
            <Ionicons name="chevron-forward" size={18} color={C.muted2}/>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  }

  /* =========================================================
     PROFILE
  ========================================================= */

  function renderProfile() {
    const setting = (icon,title,subtitle,action) => (
      <TouchableOpacity style={styles.refSettingRow} key={title} activeOpacity={0.8} onPress={action}>
        <View style={styles.refSettingIcon}><Ionicons name={icon} size={19} color={C.muted} /></View><View style={{flex:1}}><Text style={styles.refSettingTitle}>{title}</Text><Text style={styles.refSettingSub}>{subtitle}</Text></View><Ionicons name="chevron-forward" size={17} color={C.muted2}/>
      </TouchableOpacity>
    );
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.refScroll}>
        <View style={styles.refPageHeader}><View><Text style={styles.refGreetingSmall}>RUNNER</Text><Text style={styles.refPageTitle}>Profile</Text></View><TouchableOpacity style={styles.refIconButton} onPress={() => Alert.alert("Profile", "Your RAFTAAR profile is stored locally on this device.")}><Ionicons name="settings-outline" size={20} color={C.white}/></TouchableOpacity></View>
        <View style={styles.refProfileCard}><View style={styles.refProfileAvatar}><Text style={styles.refProfileLetter}>R</Text></View><View style={{flex:1}}><Text style={styles.refProfileName}>Runner</Text><Text style={styles.refProfileLocal}>Your runs are saved on this device</Text><View style={styles.refProPill}><Ionicons name="trophy" size={11} color={C.lime2}/><Text style={styles.refProText}>PRO RUNNER</Text></View></View></View>
        <View style={styles.refProfileStats}><View><Text style={styles.refProfileStatValue}>{totalRuns}</Text><Text style={styles.refProfileStatLabel}>RUNS</Text></View><View><Text style={styles.refProfileStatValue}>{totalDistance.toFixed(1)}</Text><Text style={styles.refProfileStatLabel}>KM</Text></View><View><Text style={styles.refProfileStatValue}>{streak}</Text><Text style={styles.refProfileStatLabel}>STREAK</Text></View></View>
        <View style={styles.refSettingsBox}>
          {setting("flag-outline","My Goals","Distance, time & pace goals",() => setMissionVisible(true))}
          {setting("options-outline","Running Preferences","Voice, GPS & run behavior",() => Alert.alert("Running Preferences","Voice feedback and GPS preferences are available for your runs."))}
          {setting("speedometer-outline","Units","Kilometers · min/km",() => Alert.alert("Units","RAFTAAR is currently set to kilometers and min/km."))}
          {setting("notifications-outline","Notifications","Run reminders & updates",() => Alert.alert("Notifications","Notifications are enabled for this device."))}
          {setting("shield-checkmark-outline","Privacy & Security","Your data stays on this device",() => Alert.alert("Privacy & Security","Your run history is stored locally on this device."))}
          {setting("help-circle-outline","Help & Support","Get help with RAFTAAR",() => Alert.alert("Help & Support","Need help? Check your GPS permissions and make sure location services are enabled."))}
          {setting("information-circle-outline","About RAFTAAR","Track · Improve · Move faster",() => Alert.alert("RAFTAAR","Run with purpose. Move faster. Live better."))}
        </View>
      </ScrollView>
    );
  }

  /* =========================================================
     STATS
  ========================================================= */

  function renderStats() {
    const valid = history.filter(x => Number(x.distanceKm) > 0);
    const avgPaceSeconds = valid.length ? valid.reduce((a,x)=>a + (Number(x.durationSeconds||0)/Number(x.distanceKm||1)),0) / valid.length : 0;
    const avgPace = avgPaceSeconds ? `${Math.floor(avgPaceSeconds/60)}:${String(Math.floor(avgPaceSeconds%60)).padStart(2,"0")}` : "--:--";
    const values = [0.18,0.34,0.27,0.48,0.62,0.54,Math.min(1,Math.max(0.2,weeklyDistance/10))];
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.refScroll}>
        <View style={styles.refPageHeader}><View><Text style={styles.refGreetingSmall}>YOUR PERFORMANCE</Text><Text style={styles.refPageTitle}>Analyze your run</Text></View><Ionicons name="stats-chart" size={24} color={C.lime2}/></View>
        <View style={styles.refStatsHero}><Text style={styles.refCardEyebrow}>ALL-TIME DISTANCE</Text><Text style={styles.refStatsHeroValue}>{totalDistance.toFixed(2)} <Text style={styles.refStatsHeroUnit}>KM</Text></Text><Text style={styles.refCardSub}>Keep building your momentum.</Text></View>
        <View style={styles.refChartCard}><View style={styles.refChartHead}><View><Text style={styles.refCardEyebrow}>LAST 7 DAYS</Text><Text style={styles.refChartTitle}>Distance</Text></View><Text style={styles.refChartTotal}>{weeklyDistance.toFixed(1)} km</Text></View><View style={styles.refBars}>{values.map((v,i)=><View key={i} style={styles.refChartSlot}><View style={styles.refChartTrack}><View style={[styles.refChartBar,{height:`${Math.max(10,v*100)}%`}]} /></View><Text style={styles.refChartDay}>["S","M","T","W","T","F","S"][new Date(Date.now()-(6-i)*86400000).getDay()]}</Text></View>)}</View></View>
        <View style={styles.refStatsGrid}><View style={styles.refStatCard}><Text style={styles.refStatLabel}>AVG PACE</Text><Text style={styles.refStatValue}>{avgPace}</Text><Text style={styles.refStatUnit}>MIN / KM</Text></View><View style={styles.refStatCard}><Text style={styles.refStatLabel}>BEST PACE</Text><Text style={styles.refStatValue}>{personalBests.fastestPace}</Text><Text style={styles.refStatUnit}>MIN / KM</Text></View><View style={styles.refStatCard}><Text style={styles.refStatLabel}>LONGEST</Text><Text style={styles.refStatValue}>{personalBests.longestRun.toFixed(1)}</Text><Text style={styles.refStatUnit}>KM</Text></View><View style={styles.refStatCard}><Text style={styles.refStatLabel}>TOP SPEED</Text><Text style={styles.refStatValue}>{personalBests.topSpeed.toFixed(1)}</Text><Text style={styles.refStatUnit}>KM / H</Text></View></View>
        <View style={styles.refInsight}><View style={styles.refInsightIcon}><Ionicons name="flash" size={17} color={C.black}/></View><View style={{flex:1}}><Text style={styles.refInsightTitle}>PERSONAL BESTS</Text><Text style={styles.refInsightText}>{history.length ? `Longest run ${personalBests.longestRun.toFixed(2)} km · Fastest pace ${personalBests.fastestPace}/km` : "Complete a run to unlock your personal performance data."}</Text></View></View>
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
        hidden={false}
        barStyle="dark-content"
        backgroundColor={C.bg}
        translucent={false}
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

          {activeTab === "stats" &&
            renderStats()}

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

      <Modal visible={onboarding} animationType="fade" transparent={false}>
        <SafeAreaView style={styles.refOnboarding}>
          <View style={styles.refOnboardTop}>
            <Text style={styles.refOnboardLogo}>Raftaar<Text style={{color:C.lime2}}>.</Text></Text>
            {onboardingPage > 0 ? <Text style={styles.refOnboardCount}>{onboardingPage}/3</Text> : null}
          </View>
          <View style={styles.refOnboardCenter}>
            {onboardingPage === 0 && <>
              <View style={styles.refOnboardHero}><FontAwesome5 name="running" size={72} color={C.lime2}/></View>
              <Text style={styles.refOnboardTitle}>Run with purpose.</Text>
              <Text style={styles.refOnboardSub}>Track your run. Improve your pace. Build a better you.</Text>
              <View style={styles.refOnboardTag}><Text style={styles.refOnboardTagText}>FITNESS  +  GPS  +  AI</Text></View>
            </>}
            {onboardingPage === 1 && <>
              <Text style={styles.refOnboardKicker}>Track</Text><Text style={styles.refOnboardTitle}>Your Runs</Text><Text style={styles.refOnboardSub}>Get accurate GPS tracking, distance, pace, time and more.</Text>
              <View style={styles.refOnboardPreview}><Ionicons name="map-outline" size={55} color={C.lime2}/><View style={styles.refFakeRoute}><View style={styles.refFakeLineA}/><View style={styles.refFakeLineB}/><View style={styles.refFakeLineC}/></View><View style={styles.refPreviewStats}><Text>5.42 km</Text><Text>5:28 /km</Text><Text>29:45</Text></View></View>
            </>}
            {onboardingPage === 2 && <>
              <Text style={styles.refOnboardKicker}>Analyze</Text><Text style={styles.refOnboardTitle}>Your Performance</Text><Text style={styles.refOnboardSub}>See detailed stats, trends and improve with insights.</Text>
              <View style={styles.refOnboardPreview}><View style={styles.refFakeBars}>{[32,52,42,68,57,78,66,88].map((h,i)=><View key={i} style={[styles.refFakeBar,{height:h}]} />)}</View><View style={styles.refMiniTrend}><Text style={styles.refMiniTrendLabel}>WEEKLY PROGRESS</Text><Text style={styles.refMiniTrendValue}>+12%</Text></View></View>
            </>}
            {onboardingPage === 3 && <>
              <Text style={styles.refOnboardKicker}>Reach</Text><Text style={styles.refOnboardTitle}>Your Goals</Text><Text style={styles.refOnboardSub}>Set goals, stay consistent and get better every day.</Text>
              <View style={styles.refGoalPreview}><Ionicons name="footsteps" size={58} color={C.lime2}/><Text>Distance Goals</Text><Text>Time Goals</Text><Text>Pace Goals</Text><Text>Personal Bests</Text></View>
            </>}
          </View>
          <View style={styles.refOnboardBottom}>
            {onboardingPage === 0 ? <TouchableOpacity style={styles.refOnboardButton} onPress={() => setOnboardingPage(1)}><Text style={styles.refOnboardButtonText}>GET STARTED</Text><Ionicons name="arrow-forward" size={18} color={C.black}/></TouchableOpacity> : onboardingPage < 3 ? <TouchableOpacity style={styles.refOnboardButton} onPress={() => setOnboardingPage(onboardingPage+1)}><Text style={styles.refOnboardButtonText}>NEXT</Text><Ionicons name="arrow-forward" size={18} color={C.black}/></TouchableOpacity> : <TouchableOpacity style={styles.refOnboardButton} onPress={finishOnboarding}><Text style={styles.refOnboardButtonText}>GET STARTED</Text><Ionicons name="arrow-forward" size={18} color={C.black}/></TouchableOpacity>}
            {onboardingPage > 0 && <TouchableOpacity onPress={finishOnboarding} style={styles.refSkip}><Text style={styles.refSkipText}>Skip</Text></TouchableOpacity>}
            {onboardingPage > 0 && <View style={styles.refDots}>{[1,2,3].map(i=><View key={i} style={[styles.refDot,{width:i===onboardingPage?18:6,opacity:i===onboardingPage?1:.35}]} />)}</View>}
          </View>
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

function BottomNav({ active, onChange, running }) {
  const items = [
    { id: "home", icon: "home-outline", activeIcon: "home", label: "Home" },
    { id: "stats", icon: "stats-chart-outline", activeIcon: "stats-chart", label: "Stats" },
    { id: "run", icon: "play-circle-outline", activeIcon: "play-circle", label: "Run" },
    { id: "history", icon: "footsteps-outline", activeIcon: "footsteps", label: "Routes" },
    { id: "profile", icon: "person-outline", activeIcon: "person", label: "Profile" },
  ];
  return (
    <View style={styles.refBottomNav}>
      {items.map((item) => {
        const selected = active === item.id;
        return (
          <TouchableOpacity key={item.id} style={styles.refNavItem} onPress={() => onChange(item.id)} activeOpacity={0.8}>
            <View style={[styles.refNavIconWrap, selected && styles.refNavIconActive]}>
              <Ionicons name={selected ? item.activeIcon : item.icon} size={selected ? 22 : 20} color={selected ? C.black : C.muted} />
            </View>
            <Text style={[styles.refNavLabel, selected && styles.refNavLabelActive]}>{item.label}</Text>
          </TouchableOpacity>
        );
      })}
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

function HomeHeroVisual() {
  return (
    <View pointerEvents="none" style={styles.heroVisual}>
      <View style={styles.heroGlowA} />
      <View style={styles.heroGlowB} />
      <View style={styles.heroRingOuter} />
      <View style={styles.heroRing}>
        <View style={styles.heroRingInner} />
      </View>
      <View style={[styles.routeSeg, styles.routeSeg1]} />
      <View style={[styles.routeSeg, styles.routeSeg2]} />
      <View style={[styles.routeSeg, styles.routeSeg3]} />
      <View style={styles.routeDotStart} />
      <View style={styles.routeDotEnd} />
      <View style={styles.runnerMark}>
        <View style={styles.runnerHead} />
        <View style={[styles.runnerLimb, styles.runnerArm]} />
        <View style={[styles.runnerLimb, styles.runnerLegA]} />
        <View style={[styles.runnerLimb, styles.runnerLegB]} />
      </View>
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

      <View style={styles.microSparkline}>
        {[0.28, 0.42, 0.34, 0.62, 0.48, 0.76, 0.58, 0.9].map((v, i) => (
          <View
            key={i}
            style={[
              styles.microSparkBar,
              {
                height: 3 + v * 11,
                backgroundColor: accent,
                opacity: 0.25 + i * 0.09,
              },
            ]}
          />
        ))}
      </View>
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
  const data = values.length > 1
    ? values.slice(-18)
    : [0.2, 0.35, 0.28, 0.58, 0.42, 0.72, 0.55, 0.86, 0.68, 0.9];

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  return (
    <View style={styles.liveGraph}>
      <View style={styles.graphGridLine} />
      <View style={[styles.graphGridLine, { top: "50%" }]} />
      <View style={[styles.graphGridLine, { top: "100%" }]} />

      <View style={styles.graphBars}>
        {data.map((value, index) => {
          const normalized = (value - min) / range;
          const y = 30 - normalized * 24;
          const next = data[index + 1] ?? value;
          const nextNormalized = (next - min) / range;
          const nextY = 30 - nextNormalized * 24;
          const dx = 100 / Math.max(1, data.length - 1);
          const dy = nextY - y;
          const length = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * (180 / Math.PI);

          return (
            <View
              key={index}
              style={{
                position: "absolute",
                left: `${(index / Math.max(1, data.length - 1)) * 100}%`,
                top: `${y}%`,
                width: `${Math.max(12, length)}%`,
                height: 2,
                borderRadius: 2,
                backgroundColor: C.lime,
                opacity: 0.45 + (index / data.length) * 0.55,
                transform: [{ rotate: `${angle}deg` }],
                transformOrigin: "left center",
                shadowColor: C.lime,
                shadowOpacity: 0.9,
                shadowRadius: 5,
                shadowOffset: { width: 0, height: 0 },
                elevation: 3,
              }}
            />
          );
        })}
        {data.map((value, index) => {
          const normalized = (value - min) / range;
          return (
            <View
              key={`dot-${index}`}
              style={{
                position: "absolute",
                left: `${(index / Math.max(1, data.length - 1)) * 100}%`,
                top: `${30 - normalized * 24}%`,
                width: 5,
                height: 5,
                borderRadius: 3,
                marginLeft: -2,
                marginTop: -2,
                backgroundColor: C.lime,
                shadowColor: C.lime,
                shadowOpacity: 0.85,
                shadowRadius: 5,
                shadowOffset: { width: 0, height: 0 },
                elevation: 3,
              }}
            />
          );
        })}
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
    paddingTop: 14,
    paddingBottom: 190,
  },

  hero: {
    minHeight: 355,
    borderRadius: 30,
    padding: 22,
    backgroundColor: "#071117",
    borderWidth: 1,
    borderColor: "rgba(39,232,255,0.18)",
    overflow: "hidden",
    position: "relative",
    shadowColor: C.lime,
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },

  heroGlow: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(39,232,255,0.07)",
    opacity: 1,
    right: -90,
    top: -90,
  },

  heroGlowSmall: {
    position: "absolute",
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: "rgba(92,255,138,0.06)",
    right: 15,
    top: 35,
  },

  heroVisual: {
    position: "absolute",
    right: -4,
    top: 72,
    width: 190,
    height: 150,
    opacity: 0.96,
  },

  heroGlowA: {
    position: "absolute", width: 120, height: 120, borderRadius: 60,
    right: 20, top: 10, backgroundColor: "rgba(39,232,255,0.10)",
  },
  heroGlowB: {
    position: "absolute", width: 95, height: 95, borderRadius: 48,
    right: 2, top: 44, backgroundColor: "rgba(92,255,138,0.08)",
  },
  heroRingOuter: {
    position: "absolute", width: 104, height: 104, borderRadius: 52,
    right: 8, top: 18, borderWidth: 14, borderColor: "rgba(39,232,255,0.08)",
  },
  heroRing: {
    position: "absolute", width: 88, height: 88, borderRadius: 44,
    right: 16, top: 26, borderWidth: 3, borderStyle: "dashed",
    borderColor: C.cyan, transform: [{ rotate: "-22deg" }],
    alignItems: "center", justifyContent: "center",
  },
  heroRingInner: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 2,
    borderColor: "rgba(92,255,138,0.55)",
  },
  routeSeg: {
    position: "absolute", height: 3, borderRadius: 2,
    backgroundColor: C.cyan, shadowColor: C.cyan, shadowOpacity: 0.8, shadowRadius: 8,
  },
  routeSeg1: { width: 55, left: 14, top: 105, transform: [{ rotate: "-24deg" }] },
  routeSeg2: { width: 47, left: 61, top: 92, transform: [{ rotate: "24deg" }] },
  routeSeg3: { width: 55, left: 101, top: 68, transform: [{ rotate: "-28deg" }], backgroundColor: C.lime },
  routeDotStart: {
    position: "absolute", width: 9, height: 9, borderRadius: 5, left: 18, top: 108,
    backgroundColor: C.cyan, borderWidth: 2, borderColor: C.white,
  },
  routeDotEnd: {
    position: "absolute", width: 10, height: 10, borderRadius: 5, right: 17, top: 39,
    backgroundColor: C.lime, borderWidth: 2, borderColor: C.white,
  },
  runnerMark: {
    position: "absolute", right: 55, top: 48, width: 42, height: 48,
  },
  runnerHead: {
    position: "absolute", width: 10, height: 10, borderRadius: 5, left: 17, top: 0,
    backgroundColor: C.white, shadowColor: C.cyan, shadowOpacity: 0.8, shadowRadius: 6,
  },
  runnerLimb: {
    position: "absolute", height: 4, borderRadius: 2, backgroundColor: C.gradientEnd,
  },
  runnerArm: { width: 25, left: 11, top: 17, transform: [{ rotate: "-28deg" }] },
  runnerLegA: { width: 28, left: 8, top: 35, transform: [{ rotate: "35deg" }] },
  runnerLegB: { width: 25, left: 17, top: 31, transform: [{ rotate: "-42deg" }], backgroundColor: C.cyan },


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
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.white,
    fontSize: 41,
    lineHeight: 42,
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
    backgroundColor: "rgba(39,232,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(184,255,39,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },

  heroDescription: {
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: "#B8C1BA",
    fontSize: 13,
    lineHeight: 20,
    marginTop: 24,
    maxWidth: 255,
  },

  startGradientBase: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    backgroundColor: C.gradientEnd,
  },
  startGradientGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    width: "58%",
    backgroundColor: C.gradientStart,
    opacity: 0.92,
  },

  heroStart: {
    height: 57,
    borderRadius: 18,
    backgroundColor: "transparent",
    marginTop: 25,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    shadowColor: C.cyan,
    shadowOpacity: 0.34,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
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
    color: "#8F9A91",
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
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.ink,
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
    backgroundColor: "rgba(13,24,20,0.92)",
    borderWidth: 1,
    borderColor: "rgba(190,255,218,0.13)",
    shadowColor: C.lime,
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },

  weekMain: {
    flexDirection: "row",
    alignItems: "baseline",
  },

  weekValue: {
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.ink,
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
    height: 10,
    backgroundColor: "#14201B",
    borderRadius: 8,
    overflow: "hidden",
    marginTop: 20,
    borderWidth: 1,
    borderColor: "rgba(184,255,39,0.08)",
  },

  weekProgressFill: {
    height: "100%",
    borderRadius: 8,
    backgroundColor: C.lime,
    shadowColor: C.lime,
    shadowOpacity: 0.9,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
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
    minHeight: 122,
    borderRadius: 20,
    backgroundColor: "rgba(12,21,18,0.88)",
    borderWidth: 1,
    borderColor: "rgba(190,255,218,0.10)",
    padding: 15,
    shadowColor: C.lime,
    shadowOpacity: 0.045,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },

  miniMetricValue: {
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.ink,
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

  microSparkline: {
    height: 18,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    opacity: 0.95,
  },

  microSparkBar: {
    width: 4,
    minHeight: 3,
    borderRadius: 3,
  },

  featureCard: {
    minHeight: 91,
    borderRadius: 21,
    backgroundColor: "rgba(12,21,18,0.82)",
    borderWidth: 1,
    borderColor: "rgba(190,255,218,0.10)",
    padding: 14,
    marginBottom: 9,
    flexDirection: "row",
    alignItems: "center",
  },

  featureIcon: {
    width: 47,
    height: 47,
    borderRadius: 15,
    backgroundColor: "rgba(184,255,39,0.09)",
    borderWidth: 1,
    borderColor: "rgba(184,255,39,0.22)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: C.lime,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },

  featureContent: {
    flex: 1,
    marginLeft: 13,
  },

  featureTitle: {
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.ink,
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
    backgroundColor: "#0A1411",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(184,255,39,0.15)",
    shadowColor: C.lime,
    shadowOpacity: 0.07,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },

  bottomCTAKicker: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.7,
  },

  bottomCTATitle: {
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.white,
    fontSize: 32,
    fontWeight: "900",
    marginTop: 5,
    letterSpacing: -1,
  },

  ctaButton: {
    height: 52,
    marginTop: 20,
    borderRadius: 16,
    backgroundColor: C.lime,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: C.lime,
    shadowOpacity: 0.38,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },

  ctaButtonText: {
    color: C.black,
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
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.ink,
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
    borderColor: "rgba(39,232,255,0.18)",
    backgroundColor: C.card,
    shadowColor: C.lime,
    shadowOpacity: 0.10,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
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
    borderColor: "rgba(184,255,39,0.18)",
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
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.ink,
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
    minHeight: 64,
    borderRadius: 15,
    backgroundColor: "rgba(12,21,18,0.86)",
    borderWidth: 1,
    borderColor: "rgba(190,255,218,0.10)",
    padding: 9,
  },

  liveStatLabel: {
    color: C.muted2,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.8,
  },

  liveStatValue: {
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.ink,
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
    height: 88,
    marginTop: 8,
    padding: 10,
    borderRadius: 17,
    backgroundColor: "rgba(10,19,16,0.92)",
    borderWidth: 1,
    borderColor: "rgba(184,255,39,0.13)",
  },

  graphHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },

  graphTitle: {
    color: C.ink,
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
    alignItems: "center",
    justifyContent: "space-between",
    gap: 1,
  },

  graphBar: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.lime,
    shadowColor: C.lime,
    shadowOpacity: 0.75,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },

  bigStart: {
    height: 54,
    borderRadius: 17,
    backgroundColor: C.lime,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: C.lime,
    shadowOpacity: 0.48,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 9,
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
    backgroundColor: "rgba(17,30,25,0.95)",
    borderWidth: 1,
    borderColor: "rgba(190,255,218,0.13)",
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
    color: C.ink,
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
    color: C.ink,
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
    paddingTop: 8,
    paddingBottom: Platform.OS === "android" ? 34 : 12,
    backgroundColor: C.bg,
  },

  bottomNav: {
    height: 72,
    borderRadius: 24,
    backgroundColor: "rgba(9,16,14,0.96)",
    borderWidth: 1,
    borderColor: "rgba(190,255,218,0.14)",
    shadowColor: C.lime,
    shadowOpacity: 0.10,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingHorizontal: 4,
  },

  navItem: {
    flex: 1,
    height: 62,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },

  navItemActive: {
    backgroundColor: "rgba(184,255,39,0.10)",
    borderWidth: 1,
    borderColor: "rgba(184,255,39,0.24)",
    shadowColor: C.lime,
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
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
    color: C.muted,
    fontSize: 9,
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
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.ink,
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
    backgroundColor: C.limeDark,
    borderWidth: 1,
    borderColor: "#CDEEBB",
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
    paddingBottom: 170,
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
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.ink,
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
    shadowColor: "#101713",
    shadowOpacity: 0.045,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
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
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.ink,
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
    color: C.ink,
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
      "rgba(184,255,39,0.06)",
    borderWidth: 1,
    borderColor:
      "rgba(183,201,138,0.09)",
    alignItems: "center",
    justifyContent: "center",
  },

  emptyTitle: {
    color: C.ink,
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
    backgroundColor: C.lime,
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
    paddingBottom: 175,
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
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.ink,
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
    shadowColor: "#101713",
    shadowOpacity: 0.045,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },

  profileStatValue: {
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.ink,
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
    shadowColor: "#101713",
    shadowOpacity: 0.045,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
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
      "rgba(184,255,39,0.06)",
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
    color: C.ink,
    fontSize: 12,
    fontWeight: "900",
  },

  valueCard: {
    padding: 8,
    borderRadius: 21,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    shadowColor: "#101713",
    shadowOpacity: 0.045,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
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
      "rgba(184,255,39,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },

  valueContent: {
    flex: 1,
    marginLeft: 11,
  },

  valueTitle: {
    color: C.ink,
    fontSize: 11,
    fontWeight: "900",
  },

  valueText: {
    color: C.muted2,
    fontSize: 9,
    marginTop: 3,
  },

  versionText: {
    color: C.muted2,
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
    backgroundColor: C.card,
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
    backgroundColor: "#31413A",
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
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.ink,
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
    color: C.ink,
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
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.ink,
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
      "rgba(184,255,39,0.06)",
    borderWidth: 1,
    borderColor:
      "rgba(184,255,39,0.18)",
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
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.ink,
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
    color: C.ink,
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
    backgroundColor: C.ink,
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
    color: C.ink,
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
      "rgba(184,255,39,0.06)",
    borderWidth: 1,
    borderColor:
      "rgba(183,201,138,0.10)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 30,
  },

  onboardingTitle: {
    fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
    color: C.ink,
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
      "rgba(184,255,39,0.06)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },

  onboardingFeatureTitle: {
    color: C.ink,
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
    backgroundColor: C.lime,
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

  /* =========================================================
     RAFTAAR 3.0 — NEW PRODUCT UI
  ========================================================= */
  neoScroll:{paddingHorizontal:18,paddingTop:18,paddingBottom:125},
  neoHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:20},
  neoOverline:{fontSize:10,fontWeight:"900",letterSpacing:1.8,color:C.muted2},
  neoGreeting:{fontSize:29,fontWeight:"900",color:C.white,letterSpacing:-1,marginTop:4},
  neoDot:{color:C.lime},
  neoAvatar:{width:46,height:46,borderRadius:23,backgroundColor:C.card3,borderWidth:1,borderColor:C.line,alignItems:"center",justifyContent:"center",position:"relative"},
  neoAvatarText:{fontSize:17,fontWeight:"900",color:C.lime},
  neoOnline:{position:"absolute",right:1,bottom:2,width:10,height:10,borderRadius:5,backgroundColor:C.lime,borderWidth:2,borderColor:C.bg},
  neoHero:{backgroundColor:C.card2,borderRadius:28,borderWidth:1,borderColor:C.line,padding:20,overflow:"hidden",marginBottom:25},
  neoHeroGlow:{position:"absolute",width:190,height:190,borderRadius:95,backgroundColor:"rgba(92,255,138,.07)",right:-90,top:-70},
  neoHeroTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  neoLabel:{fontSize:9,fontWeight:"900",letterSpacing:1.5,color:C.muted2},
  neoHeroNumber:{fontSize:62,fontWeight:"900",color:C.white,letterSpacing:-3,marginTop:2},
  neoHeroUnit:{fontSize:10,fontWeight:"900",letterSpacing:2,color:C.lime,marginTop:-5},
  neoRing:{width:94,height:94,borderRadius:47,borderWidth:7,borderColor:C.lime2,alignItems:"center",justifyContent:"center",backgroundColor:"rgba(184,255,39,.04)"},
  neoRingInner:{alignItems:"center"}, neoRingValue:{fontSize:19,fontWeight:"900",color:C.white},neoRingText:{fontSize:7,fontWeight:"900",letterSpacing:1.2,color:C.muted2,marginTop:2},
  neoProgressTrack:{height:7,backgroundColor:"rgba(255,255,255,.06)",borderRadius:5,overflow:"hidden",marginTop:18},neoProgressFill:{height:"100%",backgroundColor:C.lime,borderRadius:5},
  neoHeroBottom:{flexDirection:"row",justifyContent:"space-between",marginTop:9},neoMuted:{fontSize:10,color:C.muted},
  neoPrimary:{height:56,borderRadius:18,backgroundColor:C.lime,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:10,marginTop:19},neoPlay:{width:27,height:27,borderRadius:14,backgroundColor:"rgba(0,0,0,.08)",alignItems:"center",justifyContent:"center"},neoPrimaryText:{fontSize:12,fontWeight:"900",letterSpacing:1,color:C.black},
  neoSectionHead:{flexDirection:"row",alignItems:"flex-end",justifyContent:"space-between",marginBottom:12},neoSectionTitle:{fontSize:19,fontWeight:"800",color:C.white,marginTop:4},neoLink:{fontSize:11,fontWeight:"800",color:C.lime},
  neoGrid:{flexDirection:"row",flexWrap:"wrap",gap:10,marginBottom:25},neoMetric:{width:"48.2%",backgroundColor:C.card2,borderWidth:1,borderColor:C.line,borderRadius:20,padding:15,minHeight:122},neoMetricIcon:{width:35,height:35,borderRadius:12,alignItems:"center",justifyContent:"center",marginBottom:13},neoMetricValue:{fontSize:25,fontWeight:"900",color:C.white},neoMetricLabel:{fontSize:8,fontWeight:"900",letterSpacing:1.2,color:C.muted2,marginTop:3},
  neoLatest:{backgroundColor:C.card2,borderWidth:1,borderColor:C.line,borderRadius:20,padding:14,flexDirection:"row",alignItems:"center",gap:12,marginBottom:18},neoLatestIcon:{width:45,height:45,borderRadius:15,backgroundColor:C.limeDark,alignItems:"center",justifyContent:"center"},neoLatestTitle:{fontSize:14,fontWeight:"800",color:C.white},neoLatestSub:{fontSize:10,color:C.muted,marginTop:4},neoQuote:{backgroundColor:"rgba(184,255,39,.08)",borderRadius:20,padding:16,flexDirection:"row",alignItems:"center",gap:12},neoQuoteMark:{width:30,height:30,borderRadius:10,backgroundColor:C.lime2,alignItems:"center",justifyContent:"center"},neoQuoteText:{flex:1,fontSize:12,lineHeight:18,color:C.white,fontWeight:"700"},
  runNeoScroll:{paddingHorizontal:14,paddingTop:14,paddingBottom:125},runNeoHeader:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",paddingHorizontal:4,marginBottom:13},runNeoTitle:{fontSize:26,fontWeight:"900",color:C.white,marginTop:4},gpsNeo:{flexDirection:"row",alignItems:"center",gap:7,paddingHorizontal:10,paddingVertical:8,borderRadius:13,backgroundColor:C.card2,borderWidth:1,borderColor:C.line},gpsNeoDot:{width:7,height:7,borderRadius:4},gpsNeoText:{fontSize:8,fontWeight:"900",letterSpacing:1,color:C.muted},
  runMapNeo:{height:300,borderRadius:27,overflow:"hidden",borderWidth:1,borderColor:C.line,backgroundColor:C.card2},mapNeoTop:{position:"absolute",top:12,left:12},mapLiveBadge:{backgroundColor:"rgba(5,8,7,.82)",paddingHorizontal:10,paddingVertical:7,borderRadius:11,flexDirection:"row",alignItems:"center",gap:6},mapLiveDot:{width:6,height:6,borderRadius:3},mapLiveText:{fontSize:8,fontWeight:"900",letterSpacing:1,color:C.white},mapNeoControls:{position:"absolute",right:12,bottom:12,gap:8},mapNeoButton:{width:38,height:38,borderRadius:12,backgroundColor:"rgba(5,8,7,.82)",alignItems:"center",justifyContent:"center",borderWidth:1,borderColor:"rgba(255,255,255,.09)"},
  runNeoPrimaryCard:{backgroundColor:C.card2,borderWidth:1,borderColor:C.line,borderRadius:24,padding:18,marginTop:12},runNeoDistanceRow:{flexDirection:"row",alignItems:"flex-end",marginTop:1},runNeoDistance:{fontSize:60,fontWeight:"900",color:C.white,letterSpacing:-3},runNeoUnit:{fontSize:12,fontWeight:"900",color:C.lime,letterSpacing:1.5,marginBottom:12,marginLeft:7},runNeoTime:{alignSelf:"flex-start",flexDirection:"row",alignItems:"center",gap:6,backgroundColor:"rgba(255,255,255,.04)",borderRadius:10,paddingHorizontal:9,paddingVertical:6},runNeoTimeText:{fontSize:11,fontWeight:"700",color:C.muted},
  runNeoStats:{flexDirection:"row",backgroundColor:C.card2,borderWidth:1,borderColor:C.line,borderRadius:20,marginTop:10,overflow:"hidden"},runNeoStat:{flex:1,paddingVertical:17,alignItems:"center",borderRightWidth:1,borderRightColor:C.line},runNeoStatValue:{fontSize:17,fontWeight:"900",color:C.white},runNeoStatLabel:{fontSize:7,fontWeight:"900",letterSpacing:1,color:C.muted2,marginTop:4},neoChartCard:{backgroundColor:C.card2,borderWidth:1,borderColor:C.line,borderRadius:20,padding:15,marginTop:10},neoChartHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:8},neoChartTitle:{fontSize:15,fontWeight:"800",color:C.white,marginTop:3},neoChartHint:{fontSize:8,fontWeight:"900",color:C.muted2,letterSpacing:1},runNeoStart:{height:58,borderRadius:18,backgroundColor:C.lime,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:10,marginTop:12},runNeoStartText:{fontSize:12,fontWeight:"900",letterSpacing:1,color:C.black},runNeoActions:{flexDirection:"row",gap:10,marginTop:12},runNeoPause:{flex:1,height:57,borderRadius:18,backgroundColor:C.card3,borderWidth:1,borderColor:C.line,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:9},runNeoFinish:{flex:1,height:57,borderRadius:18,backgroundColor:C.red,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:9},runNeoActionText:{fontSize:11,fontWeight:"900",letterSpacing:1,color:C.white},
  neoCount:{minWidth:42,height:42,borderRadius:14,backgroundColor:C.card2,borderWidth:1,borderColor:C.line,alignItems:"center",justifyContent:"center"},neoCountText:{fontSize:13,fontWeight:"900",color:C.lime},activitySummary:{backgroundColor:C.card2,borderRadius:22,borderWidth:1,borderColor:C.line,padding:18,flexDirection:"row",justifyContent:"space-between",marginBottom:15},activityBig:{fontSize:29,fontWeight:"900",color:C.white,marginTop:4},activityUnit:{fontSize:10,color:C.lime,fontWeight:"900"},activityRow:{backgroundColor:C.card2,borderWidth:1,borderColor:C.line,borderRadius:19,padding:13,marginBottom:9,flexDirection:"row",alignItems:"center"},activityDate:{width:48,height:48,borderRadius:14,backgroundColor:"rgba(92,255,138,.08)",alignItems:"center",justifyContent:"center",marginRight:12},activityDay:{fontSize:18,fontWeight:"900",color:C.lime},activityMonth:{fontSize:7,fontWeight:"900",color:C.muted2,letterSpacing:1},activityMain:{flex:1},activityDistance:{fontSize:15,fontWeight:"800",color:C.white},activitySub:{fontSize:10,color:C.muted,marginTop:4},activityArrow:{width:28,height:28,borderRadius:10,backgroundColor:"rgba(255,255,255,.04)",alignItems:"center",justifyContent:"center"},neoEmpty:{alignItems:"center",backgroundColor:C.card2,borderWidth:1,borderColor:C.line,borderRadius:24,padding:30},neoEmptyIcon:{width:60,height:60,borderRadius:20,backgroundColor:C.limeDark,alignItems:"center",justifyContent:"center",marginBottom:15},neoEmptyTitle:{fontSize:19,fontWeight:"900",color:C.white},neoEmptyText:{fontSize:11,lineHeight:18,color:C.muted,textAlign:"center",marginTop:7},neoSmallButton:{marginTop:18,borderRadius:13,backgroundColor:C.lime,paddingHorizontal:17,paddingVertical:12},neoSmallButtonText:{fontSize:9,fontWeight:"900",letterSpacing:1,color:C.black},
  profileNeoAvatar:{width:46,height:46,borderRadius:23,backgroundColor:C.lime,alignItems:"center",justifyContent:"center"},profileNeoAvatarText:{fontSize:17,fontWeight:"900",color:C.black},profileNeoHero:{backgroundColor:C.card2,borderRadius:24,borderWidth:1,borderColor:C.line,padding:18,flexDirection:"row",alignItems:"center",gap:13},profileNeoBadge:{width:46,height:46,borderRadius:15,backgroundColor:C.lime2,alignItems:"center",justifyContent:"center"},profileNeoName:{fontSize:22,fontWeight:"900",color:C.white},profileNeoSub:{fontSize:10,color:C.muted,marginTop:3},profileNeoStats:{flexDirection:"row",marginTop:10,backgroundColor:C.card2,borderRadius:20,borderWidth:1,borderColor:C.line,overflow:"hidden"},profileNeoStatsItem:{flex:1},profileNeoVersion:{textAlign:"center",fontSize:9,color:C.muted2,letterSpacing:1,marginTop:28},
  statsPulse:{width:42,height:42,borderRadius:14,backgroundColor:"rgba(92,255,138,.09)",alignItems:"center",justifyContent:"center"},statsPulseDot:{width:10,height:10,borderRadius:5,backgroundColor:C.lime},statsHero:{backgroundColor:C.card2,borderRadius:24,borderWidth:1,borderColor:C.line,padding:20,marginBottom:10},statsHeroValue:{fontSize:52,fontWeight:"900",color:C.white,letterSpacing:-2,marginTop:3},statsHeroUnit:{fontSize:12,color:C.lime,letterSpacing:1},statsChartCard:{backgroundColor:C.card2,borderRadius:24,borderWidth:1,borderColor:C.line,padding:17,marginBottom:10},statsChartTotal:{fontSize:11,fontWeight:"800",color:C.lime},barChart:{height:145,flexDirection:"row",alignItems:"flex-end",justifyContent:"space-between",paddingTop:12},barSlot:{height:"100%",width:25,alignItems:"center",justifyContent:"flex-end"},barFill:{width:10,borderRadius:5,backgroundColor:C.lime,minHeight:5},barLabel:{fontSize:8,color:C.muted2,fontWeight:"800",marginTop:7},statsGrid:{flexDirection:"row",flexWrap:"wrap",gap:10},statsCard:{width:"48.2%",backgroundColor:C.card2,borderRadius:19,borderWidth:1,borderColor:C.line,padding:15,minHeight:105},statsValue:{fontSize:24,fontWeight:"900",color:C.white,marginTop:7},statsUnit:{fontSize:8,color:C.muted2,fontWeight:"900",letterSpacing:1,marginTop:2},insightCard:{marginTop:10,borderRadius:20,backgroundColor:"rgba(184,255,39,.08)",padding:15,flexDirection:"row",gap:12,borderWidth:1,borderColor:"rgba(184,255,39,.12)"},insightIcon:{width:37,height:37,borderRadius:12,backgroundColor:C.lime2,alignItems:"center",justifyContent:"center"},insightTitle:{fontSize:9,fontWeight:"900",letterSpacing:1,color:C.lime2},insightText:{fontSize:11,lineHeight:17,color:C.white,marginTop:4},
  neoNavWrap:{paddingHorizontal:12,paddingBottom:6,paddingTop:8,backgroundColor:C.bg},neoNav:{height:67,borderRadius:22,backgroundColor:"rgba(13,21,19,.98)",borderWidth:1,borderColor:C.line,flexDirection:"row",alignItems:"center",justifyContent:"space-around",paddingHorizontal:4},neoNavItem:{flex:1,alignItems:"center",justifyContent:"center",height:60,position:"relative"},neoNavIcon:{width:34,height:28,borderRadius:10,alignItems:"center",justifyContent:"center"},neoNavText:{fontSize:7,fontWeight:"900",letterSpacing:.5,marginTop:2},neoNavLive:{position:"absolute",top:6,right:"28%",width:5,height:5,borderRadius:3,backgroundColor:C.red},


  /* =========================================================
     REFERENCE UI — RAFTAAR
  ========================================================= */
  refScroll: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 130 },
  refTopBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  refGreetingSmall: { color: C.muted, fontSize: 9, fontWeight: "800", letterSpacing: 2.2, marginBottom: 4 },
  refTitleRow: { flexDirection: "row", alignItems: "center" },
  refTitle: { color: C.white, fontSize: 28, fontWeight: "900", letterSpacing: -1 },
  refLeaf: { color: C.lime2, fontSize: 18, marginLeft: 6 },
  refBell: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.025)" },
  refBellDot: { position: "absolute", right: 10, top: 9, width: 5, height: 5, borderRadius: 3, backgroundColor: C.lime2 },
  refTodayCard: { minHeight: 86, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.card2, padding: 16, flexDirection: "row", alignItems: "center", marginBottom: 14 },
  refCardEyebrow: { color: C.muted, fontSize: 9, fontWeight: "900", letterSpacing: 1.6, marginBottom: 5 },
  refCardTitle: { color: C.white, fontSize: 18, fontWeight: "800" },
  refCardSub: { color: C.muted2, fontSize: 11, marginTop: 4 },
  refStartPill: { backgroundColor: C.lime2, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 11 },
  refStartText: { color: C.black, fontSize: 12, fontWeight: "900" },
  refGoalCard: { minHeight: 310, borderRadius: 25, borderWidth: 1, borderColor: "rgba(184,255,39,0.13)", backgroundColor: "#07100D", alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 14 },
  refGlow: { position: "absolute", width: 280, height: 280, borderRadius: 140, backgroundColor: "rgba(184,255,39,0.055)", top: 18 },
  refGoalRing: { width: 190, height: 190, borderRadius: 95, borderWidth: 3, borderColor: C.lime2, alignItems: "center", justifyContent: "center", shadowColor: C.lime2, shadowOpacity: 0.25, shadowRadius: 20, shadowOffset: {width:0,height:0}, elevation: 7 },
  refGoalRingInner: { width: 166, height: 166, borderRadius: 83, borderWidth: 1, borderColor: "rgba(184,255,39,0.17)", alignItems: "center", justifyContent: "center" },
  refGoalNumber: { color: C.white, fontSize: 31, fontWeight: "900" },
  refGoalUnit: { color: C.lime2, fontSize: 11, fontWeight: "900", letterSpacing: 1 },
  refGoalHint: { color: C.muted2, fontSize: 9, marginTop: 7 },
  refGoalLabel: { color: C.muted, fontSize: 9, fontWeight: "900", letterSpacing: 2, marginTop: 16 },
  refGoalCaption: { color: C.muted2, fontSize: 10, marginTop: 5 },
  refStatsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 18 },
  refStatCard: { flex: 1, minWidth: "47%", minHeight: 82, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.card2, padding: 13 },
  refStatLabel: { color: C.muted2, fontSize: 8, fontWeight: "900", letterSpacing: 1.3 },
  refStatValue: { color: C.white, fontSize: 21, fontWeight: "900", marginTop: 7 },
  refStatUnit: { color: C.muted2, fontSize: 8, marginTop: 1 },
  refSectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 5, marginBottom: 10 },
  refSectionTitle: { color: C.white, fontSize: 17, fontWeight: "800" },
  refSeeAll: { color: C.lime2, fontSize: 10, fontWeight: "800" },
  refProgressCard: { backgroundColor: C.card2, borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 16, marginBottom: 18 },
  refProgressBars: { height: 90, flexDirection: "row", alignItems: "flex-end", gap: 9 },
  refBarTrack: { flex: 1, height: "100%", justifyContent: "flex-end", backgroundColor: "rgba(255,255,255,0.025)", borderRadius: 5, overflow: "hidden" },
  refBarFill: { width: "100%", backgroundColor: C.lime2, borderRadius: 5 },
  refProgressFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  refMuted: { color: C.muted2, fontSize: 9, fontWeight: "800", letterSpacing: 1.1 },
  refProgressValue: { color: C.white, fontSize: 11, fontWeight: "800" },
  refRunRow: { minHeight: 76, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.card2, padding: 12, flexDirection: "row", alignItems: "center", marginBottom: 10 },
  refRunIcon: { width: 45, height: 45, borderRadius: 14, backgroundColor: "rgba(184,255,39,0.08)", alignItems: "center", justifyContent: "center", marginRight: 12 },
  refRunDistance: { color: C.white, fontSize: 15, fontWeight: "800" },
  refRunMeta: { color: C.muted2, fontSize: 10, marginTop: 5 },
  refRunHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 15 },
  refGpsPill: { color: C.lime2, fontSize: 9, fontWeight: "900", letterSpacing: 1.4, marginBottom: 7 },
  refRunTitle: { color: C.white, fontSize: 25, fontWeight: "900" },
  refRunSub: { color: C.muted2, fontSize: 11, marginTop: 3 },
  refLiveCard: { backgroundColor: C.card2, borderWidth: 1, borderColor: C.line, borderRadius: 22, padding: 18, marginBottom: 13 },
  refLiveLabel: { color: C.muted2, fontSize: 9, fontWeight: "900", letterSpacing: 1.6 },
  refLiveTime: { color: C.white, fontSize: 51, lineHeight: 56, fontWeight: "900", letterSpacing: -2, marginTop: 4 },
  refLiveStats: { flexDirection: "row", gap: 48, marginTop: 14 },
  refLiveValue: { color: C.white, fontSize: 24, fontWeight: "900" },
  refLiveUnit: { color: C.muted2, fontSize: 8, fontWeight: "800", marginTop: 3 },
  refMapCard: { height: 230, borderRadius: 20, overflow: "hidden", borderWidth: 1, borderColor: C.line, backgroundColor: "#0A120F", marginBottom: 14, position: "relative" },
  refMap: { flex: 1 },
  refMapEmpty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  refMapEmptyTitle: { color: C.white, fontSize: 14, fontWeight: "800", marginTop: 10 },
  refMapEmptySub: { color: C.muted2, fontSize: 10, marginTop: 5, textAlign: "center" },
  refMapBadge: { position: "absolute", left: 12, top: 12, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(5,8,7,0.85)", borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6, borderWidth: 1, borderColor: C.line },
  refMapBadgeText: { color: C.white, fontSize: 9, fontWeight: "800" },
  refMapDotStart: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.cyan, borderWidth: 2, borderColor: C.white },
  refMapDotEnd: { width: 14, height: 14, borderRadius: 7, backgroundColor: C.lime2, borderWidth: 2, borderColor: C.black },
  refMainButton: { height: 57, borderRadius: 17, backgroundColor: C.lime2, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 9, shadowColor: C.lime2, shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: {width:0,height:6}, elevation: 6 },
  refMainButtonText: { color: C.black, fontSize: 14, fontWeight: "900", letterSpacing: 1 },
  refRunControls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  refCircleControl: { width: 66, height: 66, borderRadius: 33, backgroundColor: C.lime2, alignItems: "center", justifyContent: "center" },
  refStopButton: { height: 54, paddingHorizontal: 24, borderRadius: 16, backgroundColor: "#171E1B", borderWidth: 1, borderColor: C.line, flexDirection: "row", alignItems: "center", gap: 8 },
  refStopText: { color: C.white, fontWeight: "800", fontSize: 12 },
  refSwipeHint: { color: C.muted2, fontSize: 9, textAlign: "center", marginTop: 10, marginBottom: 5 },
  refPageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  refPageTitle: { color: C.white, fontSize: 27, fontWeight: "900", letterSpacing: -1 },
  refIconButton: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center" },
  refFilterRow: { flexDirection: "row", gap: 7, marginBottom: 13 },
  refFilter: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  refFilterText: { fontSize: 9, fontWeight: "900" },
  refHistoryHero: { backgroundColor: C.card2, borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 18, marginBottom: 13 },
  refHistoryHeroValue: { color: C.white, fontSize: 34, fontWeight: "900", marginTop: 3 },
  refHistoryHeroUnit: { color: C.lime2, fontSize: 13 },
  refHistoryRow: { minHeight: 72, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.card2, padding: 11, flexDirection: "row", alignItems: "center", marginBottom: 8 },
  refHistoryIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: "rgba(184,255,39,0.07)", alignItems: "center", justifyContent: "center", marginRight: 11 },
  refHistoryDistance: { color: C.white, fontSize: 14, fontWeight: "800" },
  refHistoryMeta: { color: C.muted2, fontSize: 9, marginTop: 4 },
  refEmpty: { alignItems: "center", paddingVertical: 55, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.card2 },
  refEmptyTitle: { color: C.white, fontSize: 17, fontWeight: "800", marginTop: 12 },
  refEmptySub: { color: C.muted2, fontSize: 10, marginTop: 5 },
  refSmallButton: { backgroundColor: C.lime2, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 11, marginTop: 16 },
  refSmallButtonText: { color: C.black, fontSize: 9, fontWeight: "900" },
  refProfileCard: { backgroundColor: C.card2, borderRadius: 20, borderWidth: 1, borderColor: C.line, padding: 16, flexDirection: "row", alignItems: "center", marginBottom: 12 },
  refProfileAvatar: { width: 58, height: 58, borderRadius: 29, borderWidth: 2, borderColor: C.lime2, alignItems: "center", justifyContent: "center", marginRight: 13 },
  refProfileLetter: { color: C.white, fontSize: 22, fontWeight: "900" },
  refProfileName: { color: C.white, fontSize: 17, fontWeight: "900" },
  refProfileLocal: { color: C.muted2, fontSize: 10, marginTop: 3 },
  refProPill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(184,255,39,0.08)", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4, marginTop: 7 },
  refProText: { color: C.lime2, fontSize: 7, fontWeight: "900", letterSpacing: .8 },
  refProfileStats: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 15, marginBottom: 12, backgroundColor: C.card2, borderRadius: 17, borderWidth: 1, borderColor: C.line },
  refProfileStatValue: { color: C.white, textAlign: "center", fontSize: 19, fontWeight: "900" },
  refProfileStatLabel: { color: C.muted2, textAlign: "center", fontSize: 8, fontWeight: "900", letterSpacing: 1, marginTop: 3 },
  refSettingsBox: { backgroundColor: C.card2, borderRadius: 18, borderWidth: 1, borderColor: C.line, paddingHorizontal: 13, marginBottom: 12 },
  refSettingRow: { minHeight: 66, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: C.line },
  refSettingIcon: { width: 37, height: 37, borderRadius: 11, backgroundColor: "rgba(255,255,255,0.025)", alignItems: "center", justifyContent: "center", marginRight: 11 },
  refSettingTitle: { color: C.white, fontSize: 12, fontWeight: "800" },
  refSettingSub: { color: C.muted2, fontSize: 9, marginTop: 3 },
  refLogout: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  refLogoutText: { color: C.muted, fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
  refStatsHero: { backgroundColor: C.card2, borderRadius: 20, borderWidth: 1, borderColor: "rgba(184,255,39,0.13)", padding: 20, marginBottom: 13 },
  refStatsHeroValue: { color: C.white, fontSize: 40, fontWeight: "900", letterSpacing: -1.5 },
  refStatsHeroUnit: { color: C.lime2, fontSize: 13 },
  refChartCard: { backgroundColor: C.card2, borderRadius: 20, borderWidth: 1, borderColor: C.line, padding: 17, marginBottom: 13 },
  refChartHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  refChartTitle: { color: C.white, fontSize: 17, fontWeight: "800" },
  refChartTotal: { color: C.lime2, fontSize: 11, fontWeight: "900" },
  refBars: { height: 145, flexDirection: "row", alignItems: "flex-end", gap: 8, marginTop: 17 },
  refChartSlot: { flex: 1, height: "100%", alignItems: "center", justifyContent: "flex-end" },
  refChartTrack: { width: "100%", height: 112, justifyContent: "flex-end", backgroundColor: "rgba(255,255,255,0.02)", borderRadius: 6, overflow: "hidden" },
  refChartBar: { width: "100%", backgroundColor: C.lime2, borderRadius: 6 },
  refChartDay: { color: C.muted2, fontSize: 8, marginTop: 8, fontWeight: "800" },
  refInsight: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "rgba(184,255,39,0.07)", borderWidth: 1, borderColor: "rgba(184,255,39,0.13)", borderRadius: 17, padding: 14 },
  refInsightIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.lime2, alignItems: "center", justifyContent: "center" },
  refInsightTitle: { color: C.lime2, fontSize: 8, fontWeight: "900", letterSpacing: 1.2 },
  refInsightText: { color: C.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  refBottomNav: { position: "absolute", left: 12, right: 12, bottom: Platform.OS === "android" ? 8 : 12, height: 68, borderRadius: 22, borderWidth: 1, borderColor: "rgba(190,255,218,0.13)", backgroundColor: "rgba(8,14,12,0.98)", flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 4, elevation: 12 },
  refNavItem: { flex: 1, alignItems: "center", justifyContent: "center", height: "100%" },
  refNavIconWrap: { width: 34, height: 30, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  refNavIconActive: { backgroundColor: C.lime2 },
  refNavLabel: { color: C.muted2, fontSize: 7, fontWeight: "800", marginTop: 2 },
  refNavLabelActive: { color: C.lime2 },
  refOnboarding: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 25 },
  refOnboardTop: { height: 65, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  refOnboardLogo: { color: C.white, fontSize: 28, fontWeight: "900", letterSpacing: -1 },
  refOnboardCount: { color: C.muted, fontSize: 10, fontWeight: "900" },
  refOnboardCenter: { flex: 1, justifyContent: "center" },
  refOnboardHero: { width: 220, height: 280, alignSelf: "center", borderRadius: 34, borderWidth: 1, borderColor: "rgba(184,255,39,0.16)", backgroundColor: "#07110D", alignItems: "center", justifyContent: "center", shadowColor: C.lime2, shadowOpacity: .12, shadowRadius: 30, shadowOffset: {width:0,height:0}, elevation: 7 },
  refOnboardKicker: { color: C.muted, fontSize: 11, fontWeight: "900", letterSpacing: 2, marginBottom: 4 },
  refOnboardTitle: { color: C.white, fontSize: 33, lineHeight: 37, fontWeight: "900", letterSpacing: -1.3, marginTop: 22 },
  refOnboardSub: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 10, maxWidth: 310 },
  refOnboardTag: { alignSelf: "center", marginTop: 18, borderRadius: 20, borderWidth: 1, borderColor: "rgba(184,255,39,0.4)", paddingHorizontal: 13, paddingVertical: 7 },
  refOnboardTagText: { color: C.lime2, fontSize: 8, fontWeight: "900", letterSpacing: 1.5 },
  refOnboardPreview: { marginTop: 25, height: 230, borderRadius: 25, backgroundColor: C.card2, borderWidth: 1, borderColor: C.line, padding: 18, overflow: "hidden" },
  refFakeRoute: { position: "absolute", left: 30, top: 40, width: 200, height: 120 },
  refFakeLineA: { position: "absolute", left: 15, top: 75, width: 80, height: 4, backgroundColor: C.lime2, transform: [{rotate:"-22deg"}], borderRadius: 3 },
  refFakeLineB: { position: "absolute", left: 80, top: 55, width: 70, height: 4, backgroundColor: C.lime2, transform: [{rotate:"30deg"}], borderRadius: 3 },
  refFakeLineC: { position: "absolute", left: 130, top: 90, width: 58, height: 4, backgroundColor: C.lime2, transform: [{rotate:"-45deg"}], borderRadius: 3 },
  refPreviewStats: { position: "absolute", left: 18, right: 18, bottom: 16, flexDirection: "row", justifyContent: "space-between" },
  refPreviewStatsText: { color: C.white, fontSize: 11 },
  refFakeBars: { height: 130, flexDirection: "row", alignItems: "flex-end", gap: 7, paddingHorizontal: 8 },
  refFakeBar: { flex: 1, backgroundColor: C.lime2, borderRadius: 5, opacity: .8 },
  refMiniTrend: { marginTop: 18, padding: 12, borderRadius: 13, backgroundColor: "rgba(184,255,39,0.06)" },
  refMiniTrendLabel: { color: C.muted2, fontSize: 8, fontWeight: "800" },
  refMiniTrendValue: { color: C.lime2, fontSize: 20, fontWeight: "900", marginTop: 4 },
  refGoalPreview: { marginTop: 25, height: 230, borderRadius: 25, backgroundColor: C.card2, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center", gap: 9 },
  refGoalPreviewText: { color: C.muted, fontSize: 11 },
  refOnboardBottom: { paddingBottom: 14 },
  refOnboardButton: { height: 55, borderRadius: 17, backgroundColor: C.lime2, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  refOnboardButtonText: { color: C.black, fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  refSkip: { alignItems: "center", paddingTop: 11 },
  refSkipText: { color: C.muted2, fontSize: 9, fontWeight: "800" },
  refDots: { position: "absolute", left: 0, right: 0, top: 12, flexDirection: "row", justifyContent: "center", gap: 5 },
  refDot: { height: 6, borderRadius: 3, backgroundColor: C.lime2 },

});
