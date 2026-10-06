'use strict';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

let Haptics = null;

try {
  // Optional: the app still works if expo-haptics is unavailable.
  Haptics = require('expo-haptics');
} catch (e) {
  Haptics = null;
}

/* -------------------------------------------------------------------------- */
/*                                    DATA                                    */
/* -------------------------------------------------------------------------- */

const COLORS = {
  bg: '#050807',
  bg2: '#08110F',
  surface: '#0D1513',
  elevated: '#121C19',
  elevated2: '#17221F',
  green: '#5CFF8A',
  lime: '#B8FF27',
  blue: '#4D7CFF',
  cyan: '#27E8FF',
  white: '#F7FFF9',
  secondary: '#9AA8A2',
  muted: '#65736D',
  border: 'rgba(255,255,255,0.07)',
  borderStrong: 'rgba(255,255,255,0.12)',
  danger: '#FF667A',
  orange: '#FFB55C',
  purple: '#A67CFF',
};

const INITIAL_ACTIVITIES = [
  {
    id: '1',
    title: 'Morning Run',
    type: 'Runs',
    date: 'Today',
    dayIndex: 1,
    distance: 5.42,
    duration: 1938,
    pace: 5.96,
    calories: 412,
    heartRate: 148,
  },
  {
    id: '2',
    title: 'Evening Run',
    type: 'Runs',
    date: 'Yesterday',
    dayIndex: 0,
    distance: 3.21,
    duration: 1182,
    pace: 6.08,
    calories: 246,
    heartRate: 142,
  },
  {
    id: '3',
    title: 'Tempo Session',
    type: 'Runs',
    date: 'Sat, Oct 3',
    dayIndex: 6,
    distance: 4.1,
    duration: 1400,
    pace: 5.69,
    calories: 321,
    heartRate: 154,
  },
  {
    id: '4',
    title: 'Recovery Run',
    type: 'Runs',
    date: 'Thu, Oct 1',
    dayIndex: 4,
    distance: 2.7,
    duration: 1014,
    pace: 6.25,
    calories: 203,
    heartRate: 136,
  },
  {
    id: '5',
    title: 'Sunrise Run',
    type: 'Runs',
    date: 'Tue, Sep 29',
    dayIndex: 2,
    distance: 2.97,
    duration: 1105,
    pace: 6.18,
    calories: 228,
    heartRate: 139,
  },
];

const INITIAL_NOTIFICATIONS = [
  {
    id: '1',
    title: 'Weekly goal',
    message: 'Your weekly goal is 74% complete.',
    time: 'Now',
    unread: true,
  },
  {
    id: '2',
    title: 'Great job!',
    message: 'You ran 5.4 km today.',
    time: '1h ago',
    unread: true,
  },
  {
    id: '3',
    title: 'Streak alert',
    message: "You're on a 4-day streak.",
    time: '3h ago',
    unread: false,
  },
];

const INITIAL_SETTINGS = {
  notifications: true,
  sound: true,
  haptics: true,
  darkMode: true,
  distanceUnit: 'km',
  paceUnit: '/km',
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* -------------------------------------------------------------------------- */
/*                                  HELPERS                                   */
/* -------------------------------------------------------------------------- */

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const formatDuration = (seconds = 0) => {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(
      secs
    ).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const formatPace = (pace = 0) => {
  const value = Number(pace) || 0;

  if (value <= 0) return '0:00';

  const minutes = Math.floor(value);
  const seconds = Math.round((value - minutes) * 60);

  if (seconds >= 60) {
    return `${minutes + 1}:00`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatDistance = (distance = 0) =>
  `${(Number(distance) || 0).toFixed(2)}`;

const getPace = (distance, seconds) => {
  if (!distance || !seconds) return 0;
  return seconds / 60 / distance;
};

const getActivityTotal = (activities, key) =>
  activities.reduce((sum, item) => sum + (Number(item[key]) || 0), 0);

const triggerHaptic = (settings, type = 'selection') => {
  if (!settings?.haptics || !Haptics) return;

  try {
    if (type === 'success' && Haptics.notificationAsync) {
      Haptics.notificationAsync(
        Haptics.NotificationFeedbackType?.Success ||
          Haptics.NotificationFeedbackType.Success
      );
    } else if (type === 'impact' && Haptics.impactAsync) {
      Haptics.impactAsync(
        Haptics.ImpactFeedbackStyle?.Medium ||
          Haptics.ImpactFeedbackStyle.Medium
      );
    } else if (Haptics.selectionAsync) {
      Haptics.selectionAsync();
    }
  } catch (e) {
    // Haptics are intentionally non-critical.
  }
};

/* -------------------------------------------------------------------------- */
/*                               ICON PRIMITIVES                              */
/* -------------------------------------------------------------------------- */

function Icon({ name, size = 20, color = COLORS.white, stroke = 2 }) {
  const common = {
    width: size,
    height: size,
    borderColor: color,
  };

  if (name === 'home') {
    return (
      <View style={[styles.iconBox, common]}>
        <View
          style={[
            styles.homeRoof,
            {
              borderColor: color,
              borderBottomWidth: stroke,
              borderLeftWidth: stroke,
            },
          ]}
        />
        <View
          style={[
            styles.homeBody,
            {
              borderColor: color,
              borderWidth: stroke,
              borderTopWidth: 0,
            },
          ]}
        />
      </View>
    );
  }

  if (name === 'run') {
    return (
      <View style={[styles.iconBox, common]}>
        <View
          style={[
            styles.runnerHead,
            { backgroundColor: color, width: size * 0.2, height: size * 0.2 },
          ]}
        />
        <View
          style={[
            styles.runnerBody,
            {
              backgroundColor: color,
              width: stroke,
              height: size * 0.38,
              left: size * 0.47,
              top: size * 0.28,
            },
          ]}
        />
        <View
          style={[
            styles.runnerArm,
            {
              backgroundColor: color,
              width: size * 0.32,
              height: stroke,
              left: size * 0.33,
              top: size * 0.37,
              transform: [{ rotate: '-25deg' }],
            },
          ]}
        />
        <View
          style={[
            styles.runnerLeg,
            {
              backgroundColor: color,
              width: size * 0.38,
              height: stroke,
              left: size * 0.45,
              top: size * 0.64,
              transform: [{ rotate: '42deg' }],
            },
          ]}
        />
        <View
          style={[
            styles.runnerLeg,
            {
              backgroundColor: color,
              width: size * 0.35,
              height: stroke,
              left: size * 0.23,
              top: size * 0.68,
              transform: [{ rotate: '-48deg' }],
            },
          ]}
        />
      </View>
    );
  }

  if (name === 'activity') {
    return (
      <View style={[styles.iconBox, common, styles.rowIcon]}>
        {[0.35, 0.6, 0.85, 0.5].map((h, i) => (
          <View
            key={i}
            style={{
              width: Math.max(2, size * 0.1),
              height: size * h,
              borderRadius: 5,
              backgroundColor: color,
              marginHorizontal: size * 0.045,
            }}
          />
        ))}
      </View>
    );
  }

  if (name === 'stats') {
    return (
      <View style={[styles.iconBox, common]}>
        <View
          style={{
            position: 'absolute',
            bottom: size * 0.15,
            left: size * 0.12,
            right: size * 0.12,
            height: stroke,
            backgroundColor: color,
            borderRadius: 4,
          }}
        />
        {[0.35, 0.58, 0.82].map((h, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              bottom: size * 0.15,
              left: size * (0.2 + i * 0.22),
              width: size * 0.11,
              height: size * h,
              borderRadius: 4,
              backgroundColor: color,
            }}
          />
        ))}
      </View>
    );
  }

  if (name === 'profile') {
    return (
      <View
        style={[
          styles.iconBox,
          common,
          {
            borderWidth: stroke,
            borderRadius: size,
            justifyContent: 'center',
            alignItems: 'center',
          },
        ]}
      >
        <View
          style={{
            width: size * 0.22,
            height: size * 0.22,
            borderRadius: size,
            backgroundColor: color,
            marginBottom: size * 0.08,
          }}
        />
        <View
          style={{
            width: size * 0.48,
            height: size * 0.24,
            borderRadius: size,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }

  if (name === 'bell') {
    return (
      <View style={[styles.iconBox, common]}>
        <View
          style={{
            position: 'absolute',
            width: size * 0.55,
            height: size * 0.6,
            borderWidth: stroke,
            borderColor: color,
            borderRadius: size * 0.3,
            top: size * 0.14,
            left: size * 0.22,
          }}
        />
        <View
          style={{
            position: 'absolute',
            width: size * 0.18,
            height: stroke,
            backgroundColor: color,
            bottom: size * 0.1,
            left: size * 0.41,
            borderRadius: 4,
          }}
        />
      </View>
    );
  }

  if (name === 'search') {
    return (
      <View style={[styles.iconBox, common]}>
        <View
          style={{
            position: 'absolute',
            width: size * 0.52,
            height: size * 0.52,
            borderWidth: stroke,
            borderColor: color,
            borderRadius: size,
            top: size * 0.1,
            left: size * 0.08,
          }}
        />
        <View
          style={{
            position: 'absolute',
            width: size * 0.35,
            height: stroke,
            backgroundColor: color,
            borderRadius: 4,
            transform: [{ rotate: '45deg' }],
            right: size * 0.02,
            bottom: size * 0.18,
          }}
        />
      </View>
    );
  }

  if (name === 'chevron') {
    return (
      <View
        style={[
          styles.iconBox,
          common,
          {
            justifyContent: 'center',
            alignItems: 'center',
          },
        ]}
      >
        <View
          style={{
            width: size * 0.3,
            height: size * 0.3,
            borderRightWidth: stroke,
            borderTopWidth: stroke,
            borderColor: color,
            transform: [{ rotate: '45deg' }],
            marginLeft: -size * 0.1,
          }}
        />
      </View>
    );
  }

  if (name === 'back') {
    return (
      <View
        style={[
          styles.iconBox,
          common,
          {
            justifyContent: 'center',
            alignItems: 'center',
          },
        ]}
      >
        <View
          style={{
            width: size * 0.45,
            height: size * 0.45,
            borderLeftWidth: stroke,
            borderBottomWidth: stroke,
            borderColor: color,
            transform: [{ rotate: '45deg' }],
            marginLeft: size * 0.08,
          }}
        />
      </View>
    );
  }

  if (name === 'close') {
    return (
      <View style={[styles.iconBox, common]}>
        <View
          style={{
            position: 'absolute',
            width: size * 0.65,
            height: stroke,
            backgroundColor: color,
            top: size * 0.47,
            left: size * 0.18,
            transform: [{ rotate: '45deg' }],
            borderRadius: 4,
          }}
        />
        <View
          style={{
            position: 'absolute',
            width: size * 0.65,
            height: stroke,
            backgroundColor: color,
            top: size * 0.47,
            left: size * 0.18,
            transform: [{ rotate: '-45deg' }],
            borderRadius: 4,
          }}
        />
      </View>
    );
  }

  if (name === 'play') {
    return (
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: size * 0.3,
          borderBottomWidth: size * 0.3,
          borderLeftWidth: size * 0.46,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: color,
          marginLeft: size * 0.08,
        }}
      />
    );
  }

  if (name === 'pause') {
    return (
      <View style={{ flexDirection: 'row', gap: size * 0.17 }}>
        <View
          style={{
            width: size * 0.2,
            height: size * 0.6,
            borderRadius: 4,
            backgroundColor: color,
          }}
        />
        <View
          style={{
            width: size * 0.2,
            height: size * 0.6,
            borderRadius: 4,
            backgroundColor: color,
          }}
        />
      </View>
    );
  }

  if (name === 'check') {
    return (
      <View style={[styles.iconBox, common]}>
        <View
          style={{
            width: size * 0.58,
            height: size * 0.3,
            borderLeftWidth: stroke,
            borderBottomWidth: stroke,
            borderColor: color,
            transform: [{ rotate: '-45deg' }],
            marginTop: -size * 0.08,
          }}
        />
      </View>
    );
  }

  if (name === 'target') {
    return (
      <View
        style={[
          styles.iconBox,
          common,
          {
            borderWidth: stroke,
            borderColor: color,
            borderRadius: size,
            justifyContent: 'center',
            alignItems: 'center',
          },
        ]}
      >
        <View
          style={{
            width: size * 0.45,
            height: size * 0.45,
            borderWidth: stroke,
            borderColor: color,
            borderRadius: size,
          }}
        />
        <View
          style={{
            width: size * 0.16,
            height: size * 0.16,
            borderRadius: size,
            backgroundColor: color,
            position: 'absolute',
          }}
        />
      </View>
    );
  }

  if (name === 'clock') {
    return (
      <View
        style={[
          styles.iconBox,
          common,
          {
            borderWidth: stroke,
            borderColor: color,
            borderRadius: size,
          },
        ]}
      >
        <View
          style={{
            position: 'absolute',
            width: stroke,
            height: size * 0.28,
            backgroundColor: color,
            top: size * 0.2,
            left: size * 0.48,
            borderRadius: 4,
          }}
        />
        <View
          style={{
            position: 'absolute',
            width: size * 0.24,
            height: stroke,
            backgroundColor: color,
            top: size * 0.47,
            left: size * 0.48,
            transform: [{ rotate: '25deg' }],
            borderRadius: 4,
          }}
        />
      </View>
    );
  }

  if (name === 'flame') {
    return (
      <View style={[styles.iconBox, common, { alignItems: 'center' }]}>
        <View
          style={{
            width: size * 0.5,
            height: size * 0.68,
            borderRadius: size * 0.3,
            backgroundColor: color,
            transform: [{ rotate: '12deg' }],
            marginTop: size * 0.12,
          }}
        />
        <View
          style={{
            position: 'absolute',
            width: size * 0.18,
            height: size * 0.3,
            borderRadius: size,
            backgroundColor: COLORS.surface,
            bottom: size * 0.09,
          }}
        />
      </View>
    );
  }

  if (name === 'heart') {
    return (
      <View style={[styles.iconBox, common]}>
        <Text
          style={{
            color,
            fontSize: size * 0.9,
            lineHeight: size,
            fontWeight: '800',
          }}
        >
          ♥
        </Text>
      </View>
    );
  }

  return <View style={[styles.iconBox, common]} />;
}

/* -------------------------------------------------------------------------- */
/*                                ANIMATIONS                                  */
/* -------------------------------------------------------------------------- */

function AnimatedPressable({
  children,
  onPress,
  style,
  disabled = false,
  accessibilityLabel,
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    Animated.spring(scale, {
      toValue: 0.965,
      friction: 7,
      tension: 180,
      useNativeDriver: true,
    }).start();
  };

  const pressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      tension: 180,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

function FadeSlideIn({ children, delay = 0, style }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 480,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(translate, {
        toValue: 0,
        delay,
        friction: 9,
        tension: 70,
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, opacity, translate]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity,
          transform: [{ translateY: translate }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  COMMON UI                                 */
/* -------------------------------------------------------------------------- */

function SectionHeader({ title, action, onAction }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>

      {action ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={action}
          hitSlop={10}
        >
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function MetricCard({ label, value, suffix, icon, accent = COLORS.green }) {
  return (
    <AnimatedPressable style={styles.metricCard}>
      <View
        style={[
          styles.metricIcon,
          {
            backgroundColor: `${accent}12`,
            borderColor: `${accent}24`,
          },
        ]}
      >
        <Icon name={icon} size={16} color={accent} stroke={1.8} />
      </View>

      <Text style={styles.metricValue}>
        {value}
        {suffix ? <Text style={styles.metricSuffix}> {suffix}</Text> : null}
      </Text>

      <Text style={styles.metricLabel}>{label}</Text>
    </AnimatedPressable>
  );
}

function ProgressBar({ progress, height = 8 }) {
  const width = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(width, {
      toValue: clamp(progress, 0, 1),
      duration: 850,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, width]);

  return (
    <View style={[styles.progressTrack, { height }]}>
      <Animated.View
        style={[
          styles.progressFill,
          {
            height,
            width: width.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
          },
        ]}
      />
    </View>
  );
}

function Avatar({ size = 42 }) {
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      <View
        style={[
          styles.avatarGlow,
          {
            width: size * 0.7,
            height: size * 0.7,
            borderRadius: size,
          },
        ]}
      />
      <Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>S</Text>
    </View>
  );
}

function ModalSheet({
  visible,
  onClose,
  title,
  children,
  height = 'auto',
}) {
  const slide = useRef(new Animated.Value(500)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slide, {
          toValue: 0,
          friction: 10,
          tension: 70,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slide, {
          toValue: 500,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, slide, opacity]);

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.modalRoot}>
        <AnimatedPressable
          onPress={onClose}
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Close modal"
        >
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              styles.modalBackdrop,
              { opacity },
            ]}
          />
        </AnimatedPressable>

        <Animated.View
          style={[
            styles.sheet,
            height !== 'auto' ? { height } : null,
            {
              transform: [{ translateY: slide }],
            },
          ]}
        >
          <View style={styles.sheetHandle} />

          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>

            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Icon name="close" size={17} color={COLORS.secondary} />
            </Pressable>
          </View>

          <View style={styles.sheetContent}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function TopHeader({
  title,
  subtitle,
  onNotification,
  onProfile,
  unread = false,
  showBack = false,
  onBack,
}) {
  return (
    <View style={styles.topHeader}>
      <View style={styles.headerLeft}>
        {showBack ? (
          <Pressable
            onPress={onBack}
            style={styles.headerBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Icon name="back" size={22} color={COLORS.white} />
          </Pressable>
        ) : null}

        <View>
          {subtitle ? <Text style={styles.eyebrow}>{subtitle}</Text> : null}
          <Text style={styles.pageTitle}>{title}</Text>
        </View>
      </View>

      <View style={styles.headerActions}>
        {onNotification ? (
          <Pressable
            onPress={onNotification}
            style={styles.headerIconButton}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <Icon name="bell" size={20} color={COLORS.white} />
            {unread ? <View style={styles.unreadDot} /> : null}
          </Pressable>
        ) : null}

        {onProfile ? (
          <Pressable
            onPress={onProfile}
            accessibilityRole="button"
            accessibilityLabel="Profile"
          >
            <Avatar size={40} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*                               HOME HERO                                    */
/* -------------------------------------------------------------------------- */

function HeroVisualization({ progress }) {
  const pulse = useRef(new Animated.Value(0.8)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.8,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    const rotateLoop = Animated.loop(
      Animated.timing(rotate, {
        toValue: 1,
        duration: 16000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    pulseLoop.start();
    rotateLoop.start();

    return () => {
      pulseLoop.stop();
      rotateLoop.stop();
    };
  }, [pulse, rotate]);

  const rotation = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.heroVisual}>
      <View style={styles.heroGlowOne} />
      <View style={styles.heroGlowTwo} />

      <Animated.View
        style={[
          styles.routeOrbit,
          {
            transform: [{ rotate: rotation }],
          },
        ]}
      >
        <View style={[styles.routeNode, styles.routeNodeOne]} />
        <View style={[styles.routeNode, styles.routeNodeTwo]} />
        <View style={[styles.routeNode, styles.routeNodeThree]} />
      </Animated.View>

      <View style={styles.heroCircleOuter}>
        <View
          style={[
            styles.heroCircleProgress,
            {
              transform: [
                {
                  rotate: `${Math.max(15, progress * 360 - 90)}deg`,
                },
              ],
            },
          ]}
        />
        <View style={styles.heroCircleInner}>
          <Animated.View
            style={[
              styles.heroPulse,
              {
                transform: [{ scale: pulse }],
              },
            ]}
          />

          <View style={styles.heroRunIcon}>
            <Icon name="run" size={25} color={COLORS.green} stroke={2} />
          </View>
        </View>
      </View>

      <View style={styles.routeLine routeLineA} />
      <View style={styles.routeLine routeLineB} />
    </View>
  );
}

function HomeScreen({
  user,
  activities,
  weeklyGoal,
  onStartRun,
  onActivityDetails,
  onNotifications,
  onProfile,
  onGoalEdit,
  onSeeAllActivity,
  unread,
}) {
  const weeklyDistance = useMemo(
    () => getActivityTotal(activities, 'distance'),
    [activities]
  );

  const goalProgress = clamp(weeklyDistance / weeklyGoal.target, 0, 1);

  const dayActivity = useMemo(() => {
    const result = DAYS.map(() => false);

    activities.forEach((activity) => {
      if (
        typeof activity.dayIndex === 'number' &&
        activity.dayIndex >= 0 &&
        activity.dayIndex < 7
      ) {
        result[activity.dayIndex] = true;
      }
    });

    return result;
  }, [activities]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={COLORS.bg}
        translucent={false}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <TopHeader
          title="Good morning"
          subtitle={`${user.name} • Ready to move?`}
          onNotification={onNotifications}
          onProfile={onProfile}
          unread={unread}
        />

        <FadeSlideIn delay={60}>
          <View style={styles.homeHeroCard}>
            <View style={styles.heroTopRow}>
              <View>
                <Text style={styles.heroEyebrow}>TODAY'S RUN</Text>
                <Text style={styles.heroTitle}>Keep the pace.</Text>
              </View>

              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>READY</Text>
              </View>
            </View>

            <View style={styles.heroDataRow}>
              <View style={styles.heroMainMetric}>
                <Text style={styles.heroDistance}>5.42</Text>
                <Text style={styles.heroUnit}>KM</Text>

                <View style={styles.heroSecondaryMetrics}>
                  <View>
                    <Text style={styles.heroSmallValue}>32:18</Text>
                    <Text style={styles.heroSmallLabel}>TIME</Text>
                  </View>

                  <View style={styles.heroMetricDivider} />

                  <View>
                    <Text style={styles.heroSmallValue}>5:57</Text>
                    <Text style={styles.heroSmallLabel}>/KM</Text>
                  </View>
                </View>
              </View>

              <HeroVisualization progress={goalProgress} />
            </View>

            <View style={styles.heroBottomRow}>
              <View>
                <Text style={styles.heroBottomLabel}>WEEKLY TARGET</Text>
                <Text style={styles.heroBottomValue}>
                  {weeklyDistance.toFixed(1)} / {weeklyGoal.target} KM
                </Text>
              </View>

              <Text style={styles.heroPercentage}>
                {Math.round(goalProgress * 100)}%
              </Text>
            </View>

            <ProgressBar progress={goalProgress} height={6} />
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={130}>
          <View style={styles.metricGrid}>
            <MetricCard
              label="Distance"
              value="5.42"
              suffix="km"
              icon="run"
              accent={COLORS.green}
            />
            <MetricCard
              label="Calories"
              value="412"
              suffix="kcal"
              icon="flame"
              accent={COLORS.orange}
            />
            <MetricCard
              label="Duration"
              value="32:18"
              icon="clock"
              accent={COLORS.cyan}
            />
            <MetricCard
              label="Pace"
              value="5:57"
              suffix="/km"
              icon="stats"
              accent={COLORS.blue}
            />
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={190}>
          <SectionHeader title="Weekly goal" action="Edit" onAction={onGoalEdit} />

          <View style={styles.goalCard}>
            <View style={styles.goalHeader}>
              <View>
                <Text style={styles.goalTitle}>MOVE WITH PURPOSE</Text>
                <Text style={styles.goalDistance}>
                  {weeklyDistance.toFixed(1)}
                  <Text style={styles.goalTarget}> / {weeklyGoal.target} KM</Text>
                </Text>
              </View>

              <View style={styles.goalBadge}>
                <Text style={styles.goalBadgeText}>
                  {Math.round(goalProgress * 100)}%
                </Text>
              </View>
            </View>

            <ProgressBar progress={goalProgress} height={9} />

            <View style={styles.daysRow}>
              {DAYS.map((day, index) => (
                <View key={day} style={styles.dayItem}>
                  <Text
                    style={[
                      styles.dayText,
                      dayActivity[index] && styles.dayTextActive,
                    ]}
                  >
                    {day}
                  </Text>

                  <View
                    style={[
                      styles.dayDot,
                      dayActivity[index] && styles.dayDotActive,
                    ]}
                  >
                    {dayActivity[index] ? (
                      <Icon name="check" size={12} color={COLORS.bg} stroke={2} />
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={250}>
          <SectionHeader title="Today's plan" />

          <View style={styles.planCard}>
            <View style={styles.planIcon}>
              <Icon name="run" size={23} color={COLORS.green} />
            </View>

            <View style={styles.planInfo}>
              <Text style={styles.planEyebrow}>TODAY'S RUN</Text>
              <Text style={styles.planTitle}>Easy Run</Text>

              <View style={styles.planMeta}>
                <Text style={styles.planMetaText}>5.0 km</Text>
                <View style={styles.metaDot} />
                <Text style={styles.planMetaText}>~30 min</Text>
              </View>
            </View>

            <AnimatedPressable
              onPress={onStartRun}
              style={styles.primaryCircleButton}
              accessibilityLabel="Start running"
            >
              <Icon name="play" size={16} color={COLORS.bg} />
            </AnimatedPressable>
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={310}>
          <SectionHeader
            title="Recent activity"
            action="See all"
            onAction={onSeeAllActivity}
          />

          <View style={styles.activityCard}>
            {activities.slice(0, 3).map((activity, index) => (
              <React.Fragment key={activity.id}>
                <ActivityRow
                  activity={activity}
                  onPress={() => onActivityDetails(activity)}
                />
                {index < Math.min(activities.length, 3) - 1 ? (
                  <View style={styles.rowDivider} />
                ) : null}
              </React.Fragment>
            ))}

            {activities.length === 0 ? (
              <EmptyActivity onStart={onStartRun} compact />
            ) : null}
          </View>
        </FadeSlideIn>

        <View style={{ height: 130 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------------- */
/*                              ACTIVITY COMPONENTS                            */
/* -------------------------------------------------------------------------- */

function ActivityRow({ activity, onPress }) {
  return (
    <AnimatedPressable
      onPress={onPress}
      style={styles.activityRow}
      accessibilityLabel={`Open ${activity.title}`}
    >
      <View style={styles.activityIcon}>
        <Icon name="run" size={18} color={COLORS.green} />
      </View>

      <View style={styles.activityMain}>
        <Text style={styles.activityTitle}>{activity.title}</Text>

        <Text style={styles.activityDate}>{activity.date}</Text>
      </View>

      <View style={styles.activityNumbers}>
        <Text style={styles.activityDistance}>
          {formatDistance(activity.distance)} km
        </Text>
        <Text style={styles.activityPace}>
          {formatPace(activity.pace)}/km
        </Text>
      </View>

      <Icon name="chevron" size={15} color={COLORS.muted} />
    </AnimatedPressable>
  );
}

function EmptyActivity({ onStart, compact = false }) {
  return (
    <View style={[styles.emptyState, compact && styles.emptyStateCompact]}>
      <View style={styles.emptyIcon}>
        <Icon name="run" size={26} color={COLORS.green} />
      </View>

      <Text style={styles.emptyTitle}>No runs yet</Text>
      <Text style={styles.emptyText}>Your next run starts here.</Text>

      <AnimatedPressable
        onPress={onStart}
        style={styles.emptyButton}
        accessibilityLabel="Start your first run"
      >
        <Text style={styles.emptyButtonText}>START YOUR FIRST RUN</Text>
      </AnimatedPressable>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*                              RUN TRACKING                                   */
/* -------------------------------------------------------------------------- */

function RunTrackingScreen({
  settings,
  onBack,
  onFinished,
  onNotify,
}) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [distance, setDistance] = useState(0);
  const [heartRate, setHeartRate] = useState(0);
  const [pace, setPace] = useState(0);

  const startTimeRef = useRef(null);
  const baseElapsedRef = useRef(0);
  const distanceRef = useRef(0);
  const runningRef = useRef(false);

  const pulse = useRef(new Animated.Value(1)).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    runningRef.current = running;
  }, [running]);

  useEffect(() => {
    let timer = null;

    if (running) {
      startTimeRef.current = Date.now();

      timer = setInterval(() => {
        const currentElapsed =
          baseElapsedRef.current +
          Math.floor((Date.now() - startTimeRef.current) / 1000);

        setElapsed(currentElapsed);

        const secondsSinceLast = currentElapsed % 2;

        if (secondsSinceLast === 0) {
          const increment = 0.008 + Math.random() * 0.005;
          distanceRef.current += increment;

          const nextDistance = distanceRef.current;
          const nextPace = getPace(nextDistance, currentElapsed);

          setDistance(nextDistance);
          setPace(clamp(nextPace + (Math.random() - 0.5) * 0.22, 4.7, 7.8));

          const nextHeartRate = Math.round(
            146 + Math.sin(currentElapsed / 11) * 8 + (Math.random() - 0.5) * 5
          );

          setHeartRate(clamp(nextHeartRate, 132, 166));
        }
      }, 1000);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [running]);

  useEffect(() => {
    if (!running) return undefined;

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.08,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    pulseLoop.start();

    return () => pulseLoop.stop();
  }, [running, pulse]);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: Math.min(distance / 5, 1),
      duration: 700,
      useNativeDriver: false,
    }).start();
  }, [distance, progress]);

  const start = () => {
    triggerHaptic(settings, 'impact');

    baseElapsedRef.current = elapsed;
    startTimeRef.current = Date.now();

    setRunning(true);
  };

  const pause = () => {
    triggerHaptic(settings, 'selection');

    if (startTimeRef.current) {
      const currentElapsed =
        baseElapsedRef.current +
        Math.floor((Date.now() - startTimeRef.current) / 1000);

      baseElapsedRef.current = currentElapsed;
      setElapsed(currentElapsed);
    }

    setRunning(false);
  };

  const resume = () => {
    triggerHaptic(settings, 'impact');
    startTimeRef.current = Date.now();
    setRunning(true);
  };

  const finish = () => {
    const finalDistance = Math.max(distanceRef.current, distance);
    const finalTime = elapsed;
    const finalPace = getPace(finalDistance, finalTime);

    triggerHaptic(settings, 'success');

    onFinished({
      distance: finalDistance,
      duration: finalTime,
      pace: finalPace,
      calories: Math.round(finalDistance * 76),
      heartRate: heartRate || 145,
    });
  };

  const calories = Math.round(distance * 76);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={COLORS.bg}
        translucent={false}
      />

      <View style={styles.runScreen}>
        <View style={styles.runHeader}>
          <Pressable
            onPress={onBack}
            style={styles.runBack}
            accessibilityRole="button"
            accessibilityLabel="Exit run"
          >
            <Icon name="back" size={22} color={COLORS.white} />
          </Pressable>

          <View style={styles.liveRunHeader}>
            <View style={[styles.liveDot, running && styles.liveDotRunning]} />
            <Text style={styles.liveRunText}>
              {running ? 'LIVE RUN' : elapsed > 0 ? 'PAUSED' : 'READY'}
            </Text>
          </View>

          <View style={styles.runHeaderPlaceholder} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.runScrollContent}
        >
          <View style={styles.runHero}>
            <Animated.View
              style={[
                styles.runPulseRing,
                {
                  transform: [{ scale: pulse }],
                  opacity: running ? 0.7 : 0.35,
                },
              ]}
            />

            <View style={styles.runCircle}>
              <View style={styles.runCircleInner}>
                <Text style={styles.runDistance}>{distance.toFixed(2)}</Text>
                <Text style={styles.runDistanceUnit}>KM</Text>
                <View style={styles.runMiniLine} />
                <Text style={styles.runTime}>{formatDuration(elapsed)}</Text>
              </View>
            </View>
          </View>

          <View style={styles.runStatsGrid}>
            <RunStat label="PACE" value={pace ? formatPace(pace) : '0:00'} suffix="/KM" />
            <RunStat label="CALORIES" value={calories} suffix="KCAL" />
            <RunStat
              label="HEART RATE"
              value={heartRate || '--'}
              suffix="BPM"
              heart
            />
          </View>

          <View style={styles.runRouteCard}>
            <View style={styles.routeCardHeader}>
              <View>
                <Text style={styles.routeCardEyebrow}>LIVE ROUTE</Text>
                <Text style={styles.routeCardTitle}>
                  {running ? 'Finding your rhythm' : 'Your run is ready'}
                </Text>
              </View>

              <View style={styles.gpsPill}>
                <View style={styles.gpsDot} />
                <Text style={styles.gpsText}>GPS</Text>
              </View>
            </View>

            <View style={styles.fakeMap}>
              <View style={styles.mapGridLineOne} />
              <View style={styles.mapGridLineTwo} />
              <View style={styles.mapRoadOne} />
              <View style={styles.mapRoadTwo} />
              <View style={styles.mapRoadThree} />

              <View style={styles.mapRoute}>
                <View style={styles.mapSegment s1} />
                <View style={styles.mapSegment s2} />
                <View style={styles.mapSegment s3} />
                <View style={styles.mapSegment s4} />
                <View style={styles.mapStartDot} />
                <View style={styles.mapCurrentDot} />
              </View>
            </View>
          </View>

          <View style={styles.runGoalMini}>
            <View>
              <Text style={styles.runGoalLabel}>TARGET</Text>
              <Text style={styles.runGoalValue}>5.00 KM</Text>
            </View>

            <View style={styles.runGoalProgressWrap}>
              <View style={styles.runGoalTrack}>
                <Animated.View
                  style={[
                    styles.runGoalFill,
                    {
                      width: progress.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
              </View>
            </View>
          </View>

          <View style={{ height: 190 }} />
        </ScrollView>

        <View style={styles.runControls}>
          {!running && elapsed === 0 ? (
            <AnimatedPressable
              onPress={start}
              style={styles.startRunLarge}
              accessibilityLabel="Start running"
            >
              <Icon name="play" size={22} color={COLORS.bg} />
              <Text style={styles.startRunLargeText}>START RUN</Text>
            </AnimatedPressable>
          ) : (
            <View style={styles.activeControls}>
              <AnimatedPressable
                onPress={running ? pause : resume}
                style={styles.pauseButton}
                accessibilityLabel={running ? 'Pause running' : 'Resume running'}
              >
                <Icon
                  name={running ? 'pause' : 'play'}
                  size={24}
                  color={COLORS.bg}
                />
              </AnimatedPressable>

              <AnimatedPressable
                onPress={finish}
                style={styles.endRunButton}
                accessibilityLabel="End run"
              >
                <View style={styles.endRunDot} />
                <Text style={styles.endRunText}>END RUN</Text>
              </AnimatedPressable>
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

function RunStat({ label, value, suffix, heart }) {
  return (
    <View style={styles.runStat}>
      <View style={styles.runStatIcon}>
        <Icon
          name={heart ? 'heart' : label === 'PACE' ? 'stats' : 'flame'}
          size={16}
          color={heart ? COLORS.danger : COLORS.green}
        />
      </View>

      <Text style={styles.runStatValue}>
        {value}
        <Text style={styles.runStatSuffix}> {suffix}</Text>
      </Text>
      <Text style={styles.runStatLabel}>{label}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*                              RUN SUMMARY                                    */
/* -------------------------------------------------------------------------- */

function RunSummaryScreen({
  summary,
  settings,
  onSave,
  onShare,
  onDone,
}) {
  const entrance = useRef(new Animated.Value(0)).current;
  const graph = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(entrance, {
        toValue: 1,
        friction: 8,
        tension: 55,
        useNativeDriver: true,
      }),
      Animated.timing(graph, {
        toValue: 1,
        duration: 1000,
        delay: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]).start();

    triggerHaptic(settings, 'success');
  }, [entrance, graph, settings]);

  const translateY = entrance.interpolate({
    inputRange: [0, 1],
    outputRange: [40, 0],
  });

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={COLORS.bg}
        translucent={false}
      />

      <Animated.View
        style={[
          styles.summaryScreen,
          {
            opacity: entrance,
            transform: [{ translateY }],
          },
        ]}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.summaryContent}
        >
          <View style={styles.summaryTop}>
            <View style={styles.completeIcon}>
              <Icon name="check" size={32} color={COLORS.bg} stroke={2.3} />
            </View>

            <Text style={styles.summaryEyebrow}>RUN COMPLETE</Text>
            <Text style={styles.summaryTitle}>Great work!</Text>
            <Text style={styles.summarySubtitle}>
              You showed up. That's what counts.
            </Text>
          </View>

          <View style={styles.summaryMainCard}>
            <Text style={styles.summaryDistance}>
              {summary.distance.toFixed(2)}
              <Text style={styles.summaryDistanceUnit}> KM</Text>
            </Text>

            <Text style={styles.summaryTime}>
              {formatDuration(summary.duration)}
            </Text>

            <View style={styles.summaryDivider} />

            <View style={styles.summaryMetrics}>
              <SummaryMetric
                label="AVG PACE"
                value={`${formatPace(summary.pace)}/km`}
              />
              <SummaryMetric
                label="CALORIES"
                value={`${summary.calories} kcal`}
              />
              <SummaryMetric
                label="AVG HR"
                value={`${summary.heartRate} bpm`}
              />
            </View>
          </View>

          <View style={styles.performanceCard}>
            <View style={styles.performanceHeader}>
              <View>
                <Text style={styles.performanceEyebrow}>PERFORMANCE</Text>
                <Text style={styles.performanceTitle}>Your rhythm</Text>
              </View>

              <Text style={styles.performanceScore}>GOOD</Text>
            </View>

            <View style={styles.performanceGraph}>
              <View style={styles.graphHorizontal h1} />
              <View style={styles.graphHorizontal h2} />
              <View style={styles.graphHorizontal h3} />

              <Animated.View
                style={[
                  styles.graphBar,
                  styles.graphB1,
                  { transform: [{ scaleY: graph }] },
                ]}
              />
              <Animated.View
                style={[
                  styles.graphBar,
                  styles.graphB2,
                  { transform: [{ scaleY: graph }] },
                ]}
              />
              <Animated.View
                style={[
                  styles.graphBar,
                  styles.graphB3,
                  { transform: [{ scaleY: graph }] },
                ]}
              />
              <Animated.View
                style={[
                  styles.graphBar,
                  styles.graphB4,
                  { transform: [{ scaleY: graph }] },
                ]}
              />
              <Animated.View
                style={[
                  styles.graphBar,
                  styles.graphB5,
                  { transform: [{ scaleY: graph }] },
                ]}
              />
              <Animated.View
                style={[
                  styles.graphBar,
                  styles.graphB6,
                  { transform: [{ scaleY: graph }] },
                ]}
              />
              <Animated.View
                style={[
                  styles.graphBar,
                  styles.graphB7,
                  { transform: [{ scaleY: graph }] },
                ]}
              />
            </View>

            <View style={styles.graphLabels}>
              <Text>0</Text>
              <Text>1</Text>
              <Text>2</Text>
              <Text>3</Text>
              <Text>4</Text>
              <Text>5 KM</Text>
            </View>
          </View>

          <View style={{ height: 130 }} />
        </ScrollView>

        <View style={styles.summaryActions}>
          <AnimatedPressable
            onPress={onSave}
            style={styles.saveRunButton}
            accessibilityLabel="Save run"
          >
            <Icon name="check" size={19} color={COLORS.bg} />
            <Text style={styles.saveRunText}>SAVE RUN</Text>
          </AnimatedPressable>

          <View style={styles.summarySecondaryActions}>
            <AnimatedPressable
              onPress={onShare}
              style={styles.summarySecondaryButton}
              accessibilityLabel="Share run"
            >
              <Text style={styles.summarySecondaryText}>SHARE</Text>
            </AnimatedPressable>

            <AnimatedPressable
              onPress={onDone}
              style={styles.summarySecondaryButton}
              accessibilityLabel="Done"
            >
              <Text style={styles.summarySecondaryText}>DONE</Text>
            </AnimatedPressable>
          </View>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

function SummaryMetric({ label, value }) {
  return (
    <View style={styles.summaryMetric}>
      <Text style={styles.summaryMetricValue}>{value}</Text>
      <Text style={styles.summaryMetricLabel}>{label}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*                              ACTIVITY SCREEN                                */
/* -------------------------------------------------------------------------- */

function ActivityScreen({
  activities,
  onActivityDetails,
  onStartRun,
}) {
  const [filter, setFilter] = useState('All');
  const [period, setPeriod] = useState('Week');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return activities.filter((activity) => {
      const matchesFilter =
        filter === 'All' ||
        (filter === 'Runs' && activity.type === 'Runs') ||
        (filter === 'Walking' && activity.type === 'Walking') ||
        (filter === 'Other' && activity.type === 'Other');

      const matchesSearch =
        !query ||
        activity.title.toLowerCase().includes(query) ||
        activity.date.toLowerCase().includes(query);

      return matchesFilter && matchesSearch;
    });
  }, [activities, filter, search]);

  const distance = getActivityTotal(filtered, 'distance');
  const calories = getActivityTotal(filtered, 'calories');
  const duration = getActivityTotal(filtered, 'duration');

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={COLORS.bg}
        translucent={false}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <TopHeader title="Activity" subtitle="Your movement history" />

        <FadeSlideIn delay={50}>
          <View style={styles.segmentedControl}>
            {['Week', 'Month', 'Year'].map((item) => (
              <Pressable
                key={item}
                onPress={() => setPeriod(item)}
                style={[
                  styles.segment,
                  period === item && styles.segmentActive,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${item} activity filter`}
              >
                <Text
                  style={[
                    styles.segmentText,
                    period === item && styles.segmentTextActive,
                  ]}
                >
                  {item}
                </Text>
              </Pressable>
            ))}
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={100}>
          <View style={styles.activitySummaryCard}>
            <ActivitySummary
              value={`${distance.toFixed(1)} km`}
              label="DISTANCE"
            />
            <ActivitySummary value={filtered.length} label="RUNS" />
            <ActivitySummary
              value={formatDuration(duration)}
              label="TIME"
            />
            <ActivitySummary
              value={`${Math.round(calories)}`}
              label="CALORIES"
            />
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={150}>
          <View style={styles.searchBox}>
            <Icon name="search" size={18} color={COLORS.muted} />

            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search activity"
              placeholderTextColor={COLORS.muted}
              style={styles.searchInput}
              returnKeyType="search"
              selectionColor={COLORS.green}
              accessibilityLabel="Search activity"
            />

            {search.length > 0 ? (
              <Pressable
                onPress={() => setSearch('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Icon name="close" size={16} color={COLORS.secondary} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScroll}
          >
            {['All', 'Runs', 'Walking', 'Other'].map((item) => (
              <Pressable
                key={item}
                onPress={() => setFilter(item)}
                style={[
                  styles.filterPill,
                  filter === item && styles.filterPillActive,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Filter ${item}`}
              >
                <Text
                  style={[
                    styles.filterPillText,
                    filter === item && styles.filterPillTextActive,
                  ]}
                >
                  {item}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </FadeSlideIn>

        <FadeSlideIn delay={200}>
          <SectionHeader title="Your activities" />

          <View style={styles.activityCard}>
            {filtered.map((activity, index) => (
              <React.Fragment key={activity.id}>
                <ActivityRow
                  activity={activity}
                  onPress={() => onActivityDetails(activity)}
                />
                {index < filtered.length - 1 ? (
                  <View style={styles.rowDivider} />
                ) : null}
              </React.Fragment>
            ))}

            {filtered.length === 0 ? (
              <EmptyActivity onStart={onStartRun} />
            ) : null}
          </View>
        </FadeSlideIn>

        <View style={{ height: 130 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ActivitySummary({ value, label }) {
  return (
    <View style={styles.activitySummaryItem}>
      <Text style={styles.activitySummaryValue}>{value}</Text>
      <Text style={styles.activitySummaryLabel}>{label}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*                                STATS SCREEN                                 */
/* -------------------------------------------------------------------------- */

function StatsScreen({ activities, weeklyGoal }) {
  const totalDistance = getActivityTotal(activities, 'distance');
  const totalRuns = activities.length;
  const totalCalories = getActivityTotal(activities, 'calories');
  const totalTime = getActivityTotal(activities, 'duration');

  const averagePace = useMemo(() => {
    if (!totalDistance || !totalTime) return 0;
    return getPace(totalDistance, totalTime);
  }, [totalDistance, totalTime]);

  const bestPace = useMemo(() => {
    if (!activities.length) return 0;
    return Math.min(...activities.map((item) => item.pace || Infinity));
  }, [activities]);

  const longestRun = useMemo(() => {
    if (!activities.length) return 0;
    return Math.max(...activities.map((item) => item.distance || 0));
  }, [activities]);

  const weeklyBars = useMemo(() => {
    const values = DAYS.map((_, index) =>
      activities
        .filter((item) => item.dayIndex === index)
        .reduce((sum, item) => sum + item.distance, 0)
    );

    const max = Math.max(...values, 1);

    return values.map((value) => ({
      value,
      ratio: value / max,
    }));
  }, [activities]);

  const strongestDayIndex = useMemo(() => {
    let bestIndex = 0;
    let bestValue = -1;

    weeklyBars.forEach((item, index) => {
      if (item.value > bestValue) {
        bestValue = item.value;
        bestIndex = index;
      }
    });

    return bestValue > 0 ? bestIndex : 0;
  }, [weeklyBars]);

  const goalRemaining = Math.max(weeklyGoal.target - totalDistance, 0);

  const insight = useMemo(() => {
    if (!activities.length) {
      return 'Your first run will start building your performance story.';
    }

    if (goalRemaining <= 0) {
      return 'You have completed your weekly goal. Keep the momentum going.';
    }

    return `You are ${goalRemaining.toFixed(
      1
    )} km away from your weekly goal.`;
  }, [activities.length, goalRemaining]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={COLORS.bg}
        translucent={false}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <TopHeader title="Stats" subtitle="Performance, quantified" />

        <FadeSlideIn delay={50}>
          <View style={styles.statsHero}>
            <View>
              <Text style={styles.statsHeroEyebrow}>ALL-TIME DISTANCE</Text>
              <Text style={styles.statsHeroValue}>
                {totalDistance.toFixed(1)}
                <Text style={styles.statsHeroUnit}> KM</Text>
              </Text>
              <Text style={styles.statsHeroSub}>
                {totalRuns} runs • {formatDuration(totalTime)}
              </Text>
            </View>

            <View style={styles.statsOrb}>
              <Icon name="stats" size={28} color={COLORS.green} />
            </View>
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={120}>
          <SectionHeader title="Weekly distance" />

          <View style={styles.chartCard}>
            <View style={styles.chartHeader}>
              <View>
                <Text style={styles.chartValue}>
                  {totalDistance.toFixed(1)} km
                </Text>
                <Text style={styles.chartSub}>This running period</Text>
              </View>

              <View style={styles.chartTrend}>
                <Text style={styles.chartTrendText}>+6%</Text>
              </View>
            </View>

            <View style={styles.barChart}>
              {weeklyBars.map((bar, index) => (
                <Bar
                  key={DAYS[index]}
                  label={DAYS[index]}
                  value={bar.value}
                  ratio={bar.ratio}
                  active={index === strongestDayIndex}
                />
              ))}
            </View>
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={190}>
          <View style={styles.statsGrid}>
            <StatCard
              label="AVG PACE"
              value={averagePace ? `${formatPace(averagePace)}/km` : '--'}
              icon="run"
              accent={COLORS.green}
            />
            <StatCard
              label="BEST PACE"
              value={bestPace ? `${formatPace(bestPace)}/km` : '--'}
              icon="target"
              accent={COLORS.blue}
            />
            <StatCard
              label="LONGEST RUN"
              value={`${longestRun.toFixed(2)} km`}
              icon="run"
              accent={COLORS.cyan}
            />
            <StatCard
              label="TOTAL CALORIES"
              value={`${Math.round(totalCalories)}`}
              icon="flame"
              accent={COLORS.orange}
            />
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={260}>
          <SectionHeader title="Performance insights" />

          <View style={styles.insightCard}>
            <Insight
              number="01"
              title="Pace momentum"
              text="Your recent running rhythm is trending faster than your earlier sessions."
              accent={COLORS.green}
            />

            <View style={styles.insightDivider} />

            <Insight
              number="02"
              title={`${DAYS[strongestDayIndex]} is your strongest day`}
              text={`That's when you covered the most distance in this period.`}
              accent={COLORS.blue}
            />

            <View style={styles.insightDivider} />

            <Insight
              number="03"
              title="Goal distance"
              text={insight}
              accent={COLORS.cyan}
            />
          </View>
        </FadeSlideIn>

        <View style={{ height: 130 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Bar({ label, value, ratio, active }) {
  const height = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(height, {
      toValue: ratio,
      duration: 700,
      delay: Math.random() * 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [height, ratio]);

  return (
    <View style={styles.barColumn}>
      <View style={styles.barTrack}>
        <Animated.View
          style={[
            styles.barFill,
            active && styles.barFillActive,
            {
              height: height.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>

      <Text style={[styles.barLabel, active && styles.barLabelActive]}>
        {label}
      </Text>

      <Text style={styles.barValue}>{value ? value.toFixed(1) : '—'}</Text>
    </View>
  );
}

function StatCard({ label, value, icon, accent }) {
  return (
    <View style={styles.statCard}>
      <View
        style={[
          styles.statIcon,
          {
            backgroundColor: `${accent}12`,
            borderColor: `${accent}22`,
          },
        ]}
      >
        <Icon name={icon} size={16} color={accent} />
      </View>

      <Text style={styles.statCardValue}>{value}</Text>
      <Text style={styles.statCardLabel}>{label}</Text>
    </View>
  );
}

function Insight({ number, title, text, accent }) {
  return (
    <View style={styles.insightRow}>
      <View
        style={[
          styles.insightNumber,
          {
            borderColor: `${accent}40`,
            backgroundColor: `${accent}10`,
          },
        ]}
      >
        <Text style={[styles.insightNumberText, { color: accent }]}>
          {number}
        </Text>
      </View>

      <View style={styles.insightContent}>
        <Text style={styles.insightTitle}>{title}</Text>
        <Text style={styles.insightText}>{text}</Text>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*                              PROFILE SCREEN                                 */
/* -------------------------------------------------------------------------- */

function ProfileScreen({
  user,
  activities,
  weeklyGoal,
  settings,
  onSettings,
  onGoalEdit,
  onNotifications,
}) {
  const distance = getActivityTotal(activities, 'distance');

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={COLORS.bg}
        translucent={false}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <TopHeader
          title="Profile"
          subtitle="Your running identity"
          onNotification={onNotifications}
        />

        <FadeSlideIn delay={50}>
          <View style={styles.profileHero}>
            <View style={styles.profileAvatarWrap}>
              <Avatar size={82} />
              <View style={styles.profileOnlineDot} />
            </View>

            <Text style={styles.profileName}>{user.name}</Text>
            <Text style={styles.profileTag}>RUNNER • LEVEL 07</Text>

            <View style={styles.profileStats}>
              <ProfileStat value={activities.length} label="RUNS" />
              <View style={styles.profileStatDivider} />
              <ProfileStat value={distance.toFixed(1)} label="KM" />
              <View style={styles.profileStatDivider} />
              <ProfileStat value="4" label="STREAK" />
            </View>
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={120}>
          <SectionHeader title="Training" />

          <View style={styles.settingsCard}>
            <ProfileRow
              icon="target"
              title="Running Goal"
              value={`${weeklyGoal.target} km / week`}
              onPress={onGoalEdit}
            />

            <View style={styles.rowDivider} />

            <ProfileRow
              icon="stats"
              title="Weekly Target"
              value={`${weeklyGoal.target} km`}
              onPress={onGoalEdit}
            />

            <View style={styles.rowDivider} />

            <ProfileRow
              icon="run"
              title="Preferred Distance"
              value="5–10 km"
              onPress={() => {}}
            />
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={190}>
          <SectionHeader title="Preferences" />

          <View style={styles.settingsCard}>
            <ProfileRow
              icon="stats"
              title="Units"
              value={settings.distanceUnit.toUpperCase()}
              onPress={onSettings}
            />

            <View style={styles.rowDivider} />

            <ProfileRow
              icon="bell"
              title="Notifications"
              value={settings.notifications ? 'On' : 'Off'}
              onPress={onSettings}
            />

            <View style={styles.rowDivider} />

            <ProfileRow
              icon="target"
              title="Appearance"
              value="Dark"
              onPress={onSettings}
            />
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={260}>
          <SectionHeader title="More" />

          <View style={styles.settingsCard}>
            <ProfileRow
              icon="stats"
              title="Settings"
              value=""
              onPress={onSettings}
            />

            <View style={styles.rowDivider} />

            <ProfileRow
              icon="check"
              title="About RAFTAAR"
              value="v1.0"
              onPress={() => {}}
            />
          </View>
        </FadeSlideIn>

        <View style={{ height: 130 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileStat({ value, label }) {
  return (
    <View style={styles.profileStat}>
      <Text style={styles.profileStatValue}>{value}</Text>
      <Text style={styles.profileStatLabel}>{label}</Text>
    </View>
  );
}

function ProfileRow({ icon, title, value, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.profileRow}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.profileRowIcon}>
        <Icon name={icon} size={17} color={COLORS.green} />
      </View>

      <Text style={styles.profileRowTitle}>{title}</Text>

      {value ? <Text style={styles.profileRowValue}>{value}</Text> : null}

      <Icon name="chevron" size={14} color={COLORS.muted} />
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/*                              BOTTOM NAV                                     */
/* -------------------------------------------------------------------------- */

const TABS = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'run', label: 'Run', icon: 'run' },
  { key: 'activity', label: 'Activity', icon: 'activity' },
  { key: 'stats', label: 'Stats', icon: 'stats' },
  { key: 'profile', label: 'Profile', icon: 'profile' },
];

function BottomNav({ activeTab, onChange, onRun }) {
  return (
    <View pointerEvents="box-none" style={styles.bottomNavContainer}>
      <View style={styles.bottomNav}>
        {TABS.map((tab) => {
          const selected = activeTab === tab.key;

          return (
            <Pressable
              key={tab.key}
              onPress={() => {
                if (tab.key === 'run') {
                  onRun();
                } else {
                  onChange(tab.key);
                }
              }}
              style={styles.navItem}
              accessibilityRole="button"
              accessibilityLabel={`${tab.label} tab`}
              accessibilityState={{ selected }}
            >
              <Animated.View
                style={[
                  styles.navIconWrap,
                  selected && styles.navIconWrapActive,
                ]}
              >
                <Icon
                  name={tab.icon}
                  size={20}
                  color={selected ? COLORS.green : COLORS.muted}
                />
              </Animated.View>

              <Text
                style={[
                  styles.navLabel,
                  selected && styles.navLabelActive,
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*                              MAIN APP                                       */
/* -------------------------------------------------------------------------- */

export default function App() {
  const { width } = useWindowDimensions();

  const [activeTab, setActiveTab] = useState('home');
  const [screen, setScreen] = useState('main');

  const [user] = useState({
    name: 'Shiva',
  });

  const [activities, setActivities] = useState(INITIAL_ACTIVITIES);
  const [weeklyGoal, setWeeklyGoal] = useState({
    target: 25,
  });

  const [settings, setSettings] = useState(INITIAL_SETTINGS);
  const [notifications, setNotifications] = useState(INITIAL_NOTIFICATIONS);

  const [selectedActivity, setSelectedActivity] = useState(null);
  const [runSummary, setRunSummary] = useState(null);

  const [showFinishConfirm, setShowFinishConfirm] = useState(false);
  const [pendingSummary, setPendingSummary] = useState(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showGoalEdit, setShowGoalEdit] = useState(false);
  const [goalInput, setGoalInput] = useState(String(weeklyGoal.target));

  const [toast, setToast] = useState('');

  const toastTimer = useRef(null);

  const showToast = useCallback((message) => {
    setToast(message);

    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
    }

    toastTimer.current = setTimeout(() => {
      setToast('');
    }, 2400);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const unreadCount = notifications.filter((item) => item.unread).length;

  const goToMainTab = useCallback((tab) => {
    setScreen('main');
    setActiveTab(tab);
  }, []);

  const startRun = useCallback(() => {
    triggerHaptic(settings, 'impact');
    setScreen('run');
  }, [settings]);

  const handleRunFinished = useCallback((summary) => {
    setPendingSummary(summary);
    setShowFinishConfirm(true);
  }, []);

  const confirmFinishRun = useCallback(() => {
    setShowFinishConfirm(false);

    if (pendingSummary) {
      setRunSummary(pendingSummary);
      setPendingSummary(null);
      setScreen('summary');
    }
  }, [pendingSummary]);

  const saveRun = useCallback(() => {
    if (!runSummary) return;

    const newActivity = {
      id: `run-${Date.now()}`,
      title: 'Fresh Run',
      type: 'Runs',
      date: 'Today',
      dayIndex: 1,
      distance: Number(runSummary.distance.toFixed(2)),
      duration: runSummary.duration,
      pace: runSummary.pace,
      calories: runSummary.calories,
      heartRate: runSummary.heartRate,
    };

    setActivities((prev) => [newActivity, ...prev]);
    setNotifications((prev) => [
      {
        id: `notification-${Date.now()}`,
        title: 'Run saved',
        message: `Great job! You ran ${newActivity.distance.toFixed(1)} km.`,
        time: 'Now',
        unread: true,
      },
      ...prev,
    ]);

    triggerHaptic(settings, 'success');
    showToast('Run saved to your activity');

    setScreen('main');
    setActiveTab('home');
    setRunSummary(null);
  }, [runSummary, settings, showToast]);

  const shareRun = useCallback(() => {
    triggerHaptic(settings, 'selection');
    showToast('Run card ready to share');
  }, [settings, showToast]);

  const doneSummary = useCallback(() => {
    setRunSummary(null);
    setScreen('main');
    setActiveTab('home');
  }, []);

  const openNotifications = useCallback(() => {
    setShowNotifications(true);

    setNotifications((prev) =>
      prev.map((item) => ({
        ...item,
        unread: false,
      }))
    );
  }, []);

  const updateSetting = useCallback((key, value) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const saveGoal = useCallback(() => {
    const parsed = Number(goalInput);

    if (!Number.isFinite(parsed) || parsed < 1) {
      showToast('Enter a valid weekly target');
      return;
    }

    setWeeklyGoal({
      target: clamp(Math.round(parsed * 10) / 10, 1, 200),
    });

    setShowGoalEdit(false);
    triggerHaptic(settings, 'success');
    showToast('Weekly goal updated');
  }, [goalInput, settings, showToast]);

  const renderMainScreen = () => {
    if (activeTab === 'home') {
      return (
        <HomeScreen
          user={user}
          activities={activities}
          weeklyGoal={weeklyGoal}
          onStartRun={startRun}
          onActivityDetails={setSelectedActivity}
          onNotifications={openNotifications}
          onProfile={() => goToMainTab('profile')}
          onGoalEdit={() => {
            setGoalInput(String(weeklyGoal.target));
            setShowGoalEdit(true);
          }}
          onSeeAllActivity={() => goToMainTab('activity')}
          unread={unreadCount > 0}
        />
      );
    }

    if (activeTab === 'activity') {
      return (
        <ActivityScreen
          activities={activities}
          onActivityDetails={setSelectedActivity}
          onStartRun={startRun}
        />
      );
    }

    if (activeTab === 'stats') {
      return (
        <StatsScreen activities={activities} weeklyGoal={weeklyGoal} />
      );
    }

    if (activeTab === 'profile') {
      return (
        <ProfileScreen
          user={user}
          activities={activities}
          weeklyGoal={weeklyGoal}
          settings={settings}
          onSettings={() => setShowSettings(true)}
          onGoalEdit={() => {
            setGoalInput(String(weeklyGoal.target));
            setShowGoalEdit(true);
          }}
          onNotifications={openNotifications}
        />
      );
    }

    return (
      <HomeScreen
        user={user}
        activities={activities}
        weeklyGoal={weeklyGoal}
        onStartRun={startRun}
        onActivityDetails={setSelectedActivity}
        onNotifications={openNotifications}
        onProfile={() => goToMainTab('profile')}
        onGoalEdit={() => {
          setGoalInput(String(weeklyGoal.target));
          setShowGoalEdit(true);
        }}
        onSeeAllActivity={() => goToMainTab('activity')}
        unread={unreadCount > 0}
      />
    );
  };

  if (screen === 'run') {
    return (
      <View style={styles.appRoot}>
        <RunTrackingScreen
          settings={settings}
          onBack={() => {
            setScreen('main');
            setActiveTab('home');
          }}
          onFinished={handleRunFinished}
        />

        <FinishConfirmModal
          visible={showFinishConfirm}
          onCancel={() => setShowFinishConfirm(false)}
          onFinish={confirmFinishRun}
        />
      </View>
    );
  }

  if (screen === 'summary' && runSummary) {
    return (
      <View style={styles.appRoot}>
        <RunSummaryScreen
          summary={runSummary}
          settings={settings}
          onSave={saveRun}
          onShare={shareRun}
          onDone={doneSummary}
        />
      </View>
    );
  }

  return (
    <View style={styles.appRoot}>
      <View style={{ flex: 1, width: Math.min(width, 900) }}>
        {renderMainScreen()}
      </View>

      <BottomNav
        activeTab={activeTab}
        onChange={goToMainTab}
        onRun={startRun}
      />

      <ActivityDetailModal
        activity={selectedActivity}
        visible={!!selectedActivity}
        onClose={() => setSelectedActivity(null)}
      />

      <NotificationsModal
        notifications={notifications}
        visible={showNotifications}
        onClose={() => setShowNotifications(false)}
      />

      <SettingsModal
        visible={showSettings}
        settings={settings}
        onClose={() => setShowSettings(false)}
        onChange={updateSetting}
      />

      <GoalModal
        visible={showGoalEdit}
        value={goalInput}
        onChange={setGoalInput}
        onClose={() => setShowGoalEdit(false)}
        onSave={saveGoal}
      />

      {toast ? (
        <View pointerEvents="none" style={styles.toastContainer}>
          <View style={styles.toast}>
            <View style={styles.toastIcon}>
              <Icon name="check" size={14} color={COLORS.bg} />
            </View>
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*                               MODAL SCREENS                                 */
/* -------------------------------------------------------------------------- */

function FinishConfirmModal({ visible, onCancel, onFinish }) {
  return (
    <ModalSheet
      visible={visible}
      onClose={onCancel}
      title="Finish this run?"
    >
      <View style={styles.confirmIcon}>
        <Icon name="check" size={28} color={COLORS.green} />
      </View>

      <Text style={styles.confirmTitle}>Ready to wrap it up?</Text>
      <Text style={styles.confirmText}>
        Your run will be shown in your summary. You can save it to your activity
        history afterwards.
      </Text>

      <AnimatedPressable
        onPress={onFinish}
        style={styles.sheetPrimaryButton}
        accessibilityLabel="Finish run"
      >
        <Text style={styles.sheetPrimaryText}>FINISH RUN</Text>
      </AnimatedPressable>

      <AnimatedPressable
        onPress={onCancel}
        style={styles.sheetSecondaryButton}
        accessibilityLabel="Cancel finish run"
      >
        <Text style={styles.sheetSecondaryText}>CANCEL</Text>
      </AnimatedPressable>
    </ModalSheet>
  );
}

function ActivityDetailModal({ activity, visible, onClose }) {
  if (!activity) return null;

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title="Run details"
    >
      <View style={styles.detailTop}>
        <View style={styles.detailIcon}>
          <Icon name="run" size={25} color={COLORS.green} />
        </View>

        <View style={styles.detailHeading}>
          <Text style={styles.detailTitle}>{activity.title}</Text>
          <Text style={styles.detailDate}>{activity.date}</Text>
        </View>
      </View>

      <View style={styles.detailGrid}>
        <DetailMetric
          label="DISTANCE"
          value={`${activity.distance.toFixed(2)} km`}
        />
        <DetailMetric
          label="DURATION"
          value={formatDuration(activity.duration)}
        />
        <DetailMetric
          label="PACE"
          value={`${formatPace(activity.pace)}/km`}
        />
        <DetailMetric
          label="CALORIES"
          value={`${activity.calories} kcal`}
        />
        <DetailMetric
          label="HEART RATE"
          value={`${activity.heartRate} bpm`}
        />
        <DetailMetric label="TYPE" value={activity.type} />
      </View>

      <View style={styles.detailGraphCard}>
        <Text style={styles.detailGraphTitle}>PACE PROFILE</Text>
        <View style={styles.detailGraph}>
          {[38, 55, 48, 68, 61, 78, 65, 86, 72, 82].map((height, index) => (
            <View
              key={index}
              style={[
                styles.detailGraphBar,
                {
                  height,
                  opacity: 0.4 + index * 0.05,
                },
              ]}
            />
          ))}
        </View>
      </View>

      <AnimatedPressable
        onPress={onClose}
        style={styles.sheetPrimaryButton}
        accessibilityLabel="Close run details"
      >
        <Text style={styles.sheetPrimaryText}>DONE</Text>
      </AnimatedPressable>
    </ModalSheet>
  );
}

function DetailMetric({ label, value }) {
  return (
    <View style={styles.detailMetric}>
      <Text style={styles.detailMetricValue}>{value}</Text>
      <Text style={styles.detailMetricLabel}>{label}</Text>
    </View>
  );
}

function NotificationsModal({ notifications, visible, onClose }) {
  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title="Notifications"
      height="72%"
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 30 }}
      >
        {notifications.map((notification, index) => (
          <View
            key={notification.id}
            style={[
              styles.notificationRow,
              index < notifications.length - 1 && styles.notificationBorder,
            ]}
          >
            <View
              style={[
                styles.notificationIcon,
                notification.unread && styles.notificationIconUnread,
              ]}
            >
              <Icon
                name={notification.title === 'Weekly goal' ? 'target' : 'run'}
                size={18}
                color={notification.unread ? COLORS.green : COLORS.secondary}
              />
            </View>

            <View style={styles.notificationContent}>
              <View style={styles.notificationTitleRow}>
                <Text style={styles.notificationTitle}>
                  {notification.title}
                </Text>
                <Text style={styles.notificationTime}>
                  {notification.time}
                </Text>
              </View>

              <Text style={styles.notificationMessage}>
                {notification.message}
              </Text>
            </View>

            {notification.unread ? (
              <View style={styles.notificationUnread} />
            ) : null}
          </View>
        ))}

        {notifications.length === 0 ? (
          <View style={styles.emptyNotifications}>
            <Icon name="bell" size={30} color={COLORS.muted} />
            <Text style={styles.emptyTitle}>All caught up</Text>
            <Text style={styles.emptyText}>No new notifications.</Text>
          </View>
        ) : null}
      </ScrollView>
    </ModalSheet>
  );
}

function SettingsModal({
  visible,
  settings,
  onClose,
  onChange,
}) {
  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title="Settings"
      height="82%"
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 30 }}
      >
        <Text style={styles.settingsSectionTitle}>RUN EXPERIENCE</Text>

        <View style={styles.settingsCard}>
          <SettingSwitch
            title="Notifications"
            subtitle="Training reminders and milestones"
            value={settings.notifications}
            onChange={(value) => onChange('notifications', value)}
          />

          <View style={styles.rowDivider} />

          <SettingSwitch
            title="Sound"
            subtitle="Audio feedback during runs"
            value={settings.sound}
            onChange={(value) => onChange('sound', value)}
          />

          <View style={styles.rowDivider} />

          <SettingSwitch
            title="Haptic Feedback"
            subtitle="Subtle feedback for important actions"
            value={settings.haptics}
            onChange={(value) => onChange('haptics', value)}
          />

          <View style={styles.rowDivider} />

          <SettingSwitch
            title="Dark Mode"
            subtitle="RAFTAAR's cinematic dark appearance"
            value={settings.darkMode}
            onChange={(value) => onChange('darkMode', value)}
          />
        </View>

        <Text style={styles.settingsSectionTitle}>MEASUREMENTS</Text>

        <View style={styles.settingsCard}>
          <SettingChoice
            title="Distance Unit"
            value={settings.distanceUnit}
            options={['km', 'mi']}
            onChange={(value) => onChange('distanceUnit', value)}
          />

          <View style={styles.rowDivider} />

          <SettingChoice
            title="Pace Unit"
            value={settings.paceUnit}
            options={['/km', '/mi']}
            onChange={(value) => onChange('paceUnit', value)}
          />
        </View>

        <View style={styles.settingsFooter}>
          <Text style={styles.settingsFooterBrand}>RAFTAAR</Text>
          <Text style={styles.settingsFooterText}>
            Move faster. Live stronger.
          </Text>
        </View>
      </ScrollView>
    </ModalSheet>
  );
}

function SettingSwitch({
  title,
  subtitle,
  value,
  onChange,
}) {
  return (
    <View style={styles.settingSwitchRow}>
      <View style={styles.settingSwitchText}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingSubtitle}>{subtitle}</Text>
      </View>

      <Switch
        value={!!value}
        onValueChange={onChange}
        trackColor={{
          false: '#26312D',
          true: '#315E3D',
        }}
        thumbColor={value ? COLORS.green : '#87938E'}
        ios_backgroundColor="#26312D"
        accessibilityLabel={title}
      />
    </View>
  );
}

function SettingChoice({
  title,
  value,
  options,
  onChange,
}) {
  return (
    <View style={styles.settingChoiceRow}>
      <Text style={styles.settingChoiceTitle}>{title}</Text>

      <View style={styles.choicePills}>
        {options.map((option) => (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            style={[
              styles.choicePill,
              value === option && styles.choicePillActive,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${title} ${option}`}
          >
            <Text
              style={[
                styles.choicePillText,
                value === option && styles.choicePillTextActive,
              ]}
            >
              {option}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function GoalModal({
  visible,
  value,
  onChange,
  onClose,
  onSave,
}) {
  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title="Weekly goal"
    >
      <View style={styles.goalEditHero}>
        <View style={styles.goalEditIcon}>
          <Icon name="target" size={27} color={COLORS.green} />
        </View>

        <Text style={styles.goalEditTitle}>Set your weekly target</Text>
        <Text style={styles.goalEditText}>
          A realistic target keeps momentum without turning every run into a
          race.
        </Text>
      </View>

      <Text style={styles.inputLabel}>DISTANCE PER WEEK</Text>

      <View style={styles.goalInputRow}>
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          style={styles.goalInput}
          selectionColor={COLORS.green}
          accessibilityLabel="Weekly target distance"
        />

        <Text style={styles.goalInputUnit}>KM</Text>
      </View>

      <View style={styles.goalPresets}>
        {[15, 20, 25, 30, 40].map((preset) => (
          <Pressable
            key={preset}
            onPress={() => onChange(String(preset))}
            style={[
              styles.goalPreset,
              Number(value) === preset && styles.goalPresetActive,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Set goal to ${preset} kilometers`}
          >
            <Text
              style={[
                styles.goalPresetText,
                Number(value) === preset && styles.goalPresetTextActive,
              ]}
            >
              {preset}
            </Text>
          </Pressable>
        ))}
      </View>

      <AnimatedPressable
        onPress={onSave}
        style={styles.sheetPrimaryButton}
        accessibilityLabel="Save weekly goal"
      >
        <Text style={styles.sheetPrimaryText}>SAVE GOAL</Text>
      </AnimatedPressable>
    </ModalSheet>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   STYLES                                   */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  appRoot: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  safe: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: Platform.OS === 'android' ? 8 : 4,
    paddingBottom: 20,
  },

  /* Header */

  topHeader: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },

  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },

  headerBack: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
    marginRight: 2,
  },

  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  headerIconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },

  unreadDot: {
    position: 'absolute',
    right: 9,
    top: 8,
    width: 6,
    height: 6,
    borderRadius: 4,
    backgroundColor: COLORS.green,
  },

  eyebrow: {
    color: COLORS.secondary,
    fontSize: 12,
    letterSpacing: 0.7,
    fontWeight: '600',
    marginBottom: 2,
  },

  pageTitle: {
    color: COLORS.white,
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.8,
  },

  /* Hero */

  homeHeroCard: {
    minHeight: 375,
    borderRadius: 28,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    padding: 21,
    position: 'relative',
  },

  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },

  heroEyebrow: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.3,
  },

  heroTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 5,
  },

  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    height: 27,
    borderRadius: 20,
    backgroundColor: `${COLORS.green}0C`,
    borderWidth: 1,
    borderColor: `${COLORS.green}22`,
  },

  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 5,
    backgroundColor: COLORS.green,
    marginRight: 6,
  },

  liveDotRunning: {
    backgroundColor: COLORS.cyan,
  },

  liveText: {
    color: COLORS.green,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },

  heroDataRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },

  heroMainMetric: {
    flex: 1,
    justifyContent: 'center',
  },

  heroDistance: {
    color: COLORS.white,
    fontSize: 53,
    fontWeight: '900',
    letterSpacing: -3,
  },

  heroUnit: {
    color: COLORS.green,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 2.2,
    marginTop: -5,
  },

  heroSecondaryMetrics: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
  },

  heroSmallValue: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '800',
  },

  heroSmallLabel: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: '800',
    marginTop: 3,
    letterSpacing: 1,
  },

  heroMetricDivider: {
    width: 1,
    height: 25,
    backgroundColor: COLORS.borderStrong,
    marginHorizontal: 16,
  },

  heroVisual: {
    width: 172,
    height: 172,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },

  heroGlowOne: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 100,
    backgroundColor: `${COLORS.blue}12`,
  },

  heroGlowTwo: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 100,
    backgroundColor: `${COLORS.green}12`,
  },

  heroCircleOuter: {
    width: 135,
    height: 135,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(92,255,138,0.14)',
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ rotate: '-20deg' }],
  },

  heroCircleProgress: {
    position: 'absolute',
    width: 135,
    height: 135,
    borderRadius: 100,
    borderWidth: 4,
    borderColor: COLORS.green,
    borderLeftColor: 'transparent',
    borderBottomColor: 'transparent',
  },

  heroCircleInner: {
    width: 94,
    height: 94,
    borderRadius: 60,
    backgroundColor: '#0A1311',
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },

  heroPulse: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 50,
    backgroundColor: `${COLORS.green}0A`,
  },

  heroRunIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: `${COLORS.green}12`,
    borderWidth: 1,
    borderColor: `${COLORS.green}26`,
    justifyContent: 'center',
    alignItems: 'center',
  },

  routeOrbit: {
    position: 'absolute',
    width: 162,
    height: 162,
    borderRadius: 100,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: `${COLORS.cyan}24`,
  },

  routeNode: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 5,
    backgroundColor: COLORS.cyan,
  },

  routeNodeOne: {
    top: 10,
    left: 36,
  },

  routeNodeTwo: {
    right: 8,
    top: 72,
  },

  routeNodeThree: {
    bottom: 18,
    left: 36,
  },

  routeLine: {
    position: 'absolute',
    height: 1,
    backgroundColor: `${COLORS.green}1B`,
    transform: [{ rotate: '-30deg' }],
  },

  routeLineA: {
    width: 80,
    right: -30,
    top: 92,
  },

  routeLineB: {
    width: 65,
    left: -22,
    bottom: 85,
    transform: [{ rotate: '35deg' }],
  },

  heroBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 10,
  },

  heroBottomLabel: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },

  heroBottomValue: {
    color: COLORS.secondary,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 3,
  },

  heroPercentage: {
    color: COLORS.green,
    fontSize: 18,
    fontWeight: '900',
  },

  /* Metrics */

  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 11,
  },

  metricCard: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 112,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    justifyContent: 'space-between',
  },

  metricIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  metricValue: {
    color: COLORS.white,
    fontSize: 21,
    fontWeight: '850',
    marginTop: 8,
  },

  metricSuffix: {
    color: COLORS.secondary,
    fontSize: 11,
    fontWeight: '700',
  },

  metricLabel: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 2,
  },

  /* Section */

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 27,
    marginBottom: 11,
  },

  sectionTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },

  sectionAction: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: '800',
  },

  /* Goal */

  goalCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 24,
    padding: 18,
  },

  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },

  goalTitle: {
    color: COLORS.muted,
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: '800',
  },

  goalDistance: {
    color: COLORS.white,
    fontSize: 27,
    fontWeight: '900',
    marginTop: 5,
  },

  goalTarget: {
    color: COLORS.secondary,
    fontSize: 14,
    fontWeight: '700',
  },

  goalBadge: {
    width: 47,
    height: 47,
    borderRadius: 24,
    backgroundColor: `${COLORS.green}10`,
    borderWidth: 1,
    borderColor: `${COLORS.green}25`,
    justifyContent: 'center',
    alignItems: 'center',
  },

  goalBadgeText: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: '900',
  },

  progressTrack: {
    width: '100%',
    backgroundColor: '#18211E',
    borderRadius: 999,
    overflow: 'hidden',
  },

  progressFill: {
    borderRadius: 999,
    backgroundColor: COLORS.green,
    shadowColor: COLORS.green,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },

  daysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 17,
  },

  dayItem: {
    alignItems: 'center',
  },

  dayText: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 8,
  },

  dayTextActive: {
    color: COLORS.secondary,
  },

  dayDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },

  dayDotActive: {
    backgroundColor: COLORS.green,
    borderColor: COLORS.green,
  },

  /* Plan */

  planCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
  },

  planIcon: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: `${COLORS.green}0D`,
    borderWidth: 1,
    borderColor: `${COLORS.green}20`,
    alignItems: 'center',
    justifyContent: 'center',
  },

  planInfo: {
    flex: 1,
    marginLeft: 14,
  },

  planEyebrow: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },

  planTitle: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 3,
  },

  planMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },

  planMetaText: {
    color: COLORS.secondary,
    fontSize: 12,
    fontWeight: '600',
  },

  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 3,
    backgroundColor: COLORS.muted,
    marginHorizontal: 8,
  },

  primaryCircleButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.green,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.green,
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },

  /* Activity */

  activityCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 24,
    overflow: 'hidden',
  },

  activityRow: {
    minHeight: 79,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
  },

  activityIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: `${COLORS.green}0D`,
    borderWidth: 1,
    borderColor: `${COLORS.green}1D`,
    justifyContent: 'center',
    alignItems: 'center',
  },

  activityMain: {
    flex: 1,
    marginLeft: 12,
  },

  activityTitle: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '750',
  },

  activityDate: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },

  activityNumbers: {
    alignItems: 'flex-end',
    marginRight: 9,
  },

  activityDistance: {
    color: COLORS.secondary,
    fontSize: 12,
    fontWeight: '800',
  },

  activityPace: {
    color: COLORS.muted,
    fontSize: 10,
    marginTop: 4,
  },

  rowDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginLeft: 68,
  },

  /* Empty */

  emptyState: {
    padding: 35,
    alignItems: 'center',
  },

  emptyStateCompact: {
    paddingVertical: 25,
  },

  emptyIcon: {
    width: 62,
    height: 62,
    borderRadius: 22,
    backgroundColor: `${COLORS.green}0B`,
    borderWidth: 1,
    borderColor: `${COLORS.green}20`,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },

  emptyTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '800',
  },

  emptyText: {
    color: COLORS.muted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },

  emptyButton: {
    marginTop: 18,
    paddingHorizontal: 17,
    minHeight: 42,
    borderRadius: 15,
    backgroundColor: `${COLORS.green}12`,
    borderWidth: 1,
    borderColor: `${COLORS.green}25`,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyButtonText: {
    color: COLORS.green,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },

  /* Run */

  runScreen: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  runHeader: {
    minHeight: 70,
    paddingHorizontal: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  runBack: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  liveRunHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 30,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  liveRunText: {
    color: COLORS.secondary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginLeft: 6,
  },

  runHeaderPlaceholder: {
    width: 44,
  },

  runScrollContent: {
    paddingHorizontal: 18,
    paddingTop: 8,
  },

  runHero: {
    height: 290,
    alignItems: 'center',
    justifyContent: 'center',
  },

  runPulseRing: {
    position: 'absolute',
    width: 235,
    height: 235,
    borderRadius: 130,
    borderWidth: 1,
    borderColor: `${COLORS.green}20`,
    backgroundColor: `${COLORS.green}04`,
  },

  runCircle: {
    width: 210,
    height: 210,
    borderRadius: 120,
    borderWidth: 1,
    borderColor: `${COLORS.green}2A`,
    backgroundColor: '#09100E',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.green,
    shadowOpacity: 0.1,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
  },

  runCircleInner: {
    width: 178,
    height: 178,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  runDistance: {
    color: COLORS.white,
    fontSize: 50,
    fontWeight: '900',
    letterSpacing: -2,
  },

  runDistanceUnit: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: -4,
  },

  runMiniLine: {
    width: 30,
    height: 1,
    backgroundColor: COLORS.borderStrong,
    marginVertical: 13,
  },

  runTime: {
    color: COLORS.secondary,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  runStatsGrid: {
    flexDirection: 'row',
    gap: 9,
  },

  runStat: {
    flex: 1,
    minHeight: 100,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 19,
    padding: 12,
  },

  runStatIcon: {
    width: 27,
    height: 27,
    borderRadius: 9,
    backgroundColor: COLORS.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },

  runStatValue: {
    color: COLORS.white,
    fontSize: 17,
    fontWeight: '850',
    marginTop: 9,
  },

  runStatSuffix: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: '800',
  },

  runStatLabel: {
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginTop: 3,
  },

  runRouteCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 23,
    marginTop: 12,
    padding: 15,
    overflow: 'hidden',
  },

  routeCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  routeCardEyebrow: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },

  routeCardTitle: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '750',
    marginTop: 4,
  },

  gpsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    height: 27,
    borderRadius: 20,
    backgroundColor: `${COLORS.green}0A`,
    borderWidth: 1,
    borderColor: `${COLORS.green}1D`,
  },

  gpsDot: {
    width: 5,
    height: 5,
    borderRadius: 5,
    backgroundColor: COLORS.green,
    marginRight: 5,
  },

  gpsText: {
    color: COLORS.green,
    fontSize: 8,
    fontWeight: '900',
  },

  fakeMap: {
    height: 150,
    backgroundColor: '#0A1210',
    borderRadius: 17,
    marginTop: 13,
    overflow: 'hidden',
    position: 'relative',
  },

  mapGridLineOne: {
    position: 'absolute',
    left: -30,
    top: 48,
    width: 320,
    height: 1,
    backgroundColor: '#17231F',
    transform: [{ rotate: '18deg' }],
  },

  mapGridLineTwo: {
    position: 'absolute',
    left: -20,
    top: 106,
    width: 330,
    height: 1,
    backgroundColor: '#17231F',
    transform: [{ rotate: '-13deg' }],
  },

  mapRoadOne: {
    position: 'absolute',
    left: 20,
    top: -30,
    width: 1,
    height: 220,
    backgroundColor: '#15211D',
    transform: [{ rotate: '31deg' }],
  },

  mapRoadTwo: {
    position: 'absolute',
    left: 160,
    top: -20,
    width: 1,
    height: 210,
    backgroundColor: '#15211D',
    transform: [{ rotate: '-25deg' }],
  },

  mapRoadThree: {
    position: 'absolute',
    left: 245,
    top: -30,
    width: 1,
    height: 230,
    backgroundColor: '#15211D',
    transform: [{ rotate: '44deg' }],
  },

  mapRoute: {
    position: 'absolute',
    left: 35,
    top: 25,
    width: 220,
    height: 105,
  },

  mapSegment: {
    position: 'absolute',
    height: 3,
    borderRadius: 4,
    backgroundColor: COLORS.green,
    shadowColor: COLORS.green,
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },

  s1: {
    width: 58,
    left: 0,
    top: 70,
    transform: [{ rotate: '-12deg' }],
  },

  s2: {
    width: 65,
    left: 52,
    top: 54,
    transform: [{ rotate: '28deg' }],
  },

  s3: {
    width: 57,
    left: 109,
    top: 74,
    transform: [{ rotate: '-28deg' }],
  },

  s4: {
    width: 62,
    left: 154,
    top: 55,
    transform: [{ rotate: '18deg' }],
  },

  mapStartDot: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 6,
    backgroundColor: COLORS.blue,
    left: 0,
    top: 66,
  },

  mapCurrentDot: {
    position: 'absolute',
    width: 13,
    height: 13,
    borderRadius: 8,
    backgroundColor: COLORS.green,
    borderWidth: 3,
    borderColor: '#13271C',
    left: 209,
    top: 51,
  },

  runGoalMini: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    marginTop: 11,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
  },

  runGoalLabel: {
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },

  runGoalValue: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 4,
  },

  runGoalProgressWrap: {
    flex: 1,
    marginLeft: 22,
  },

  runGoalTrack: {
    height: 7,
    borderRadius: 5,
    backgroundColor: '#1A2521',
    overflow: 'hidden',
  },

  runGoalFill: {
    height: 7,
    borderRadius: 5,
    backgroundColor: COLORS.green,
  },

  runControls: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: Platform.OS === 'android' ? 12 : 16,
  },

  startRunLarge: {
    height: 66,
    borderRadius: 21,
    backgroundColor: COLORS.green,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    shadowColor: COLORS.green,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },

  startRunLargeText: {
    color: COLORS.bg,
    fontSize: 14,
    fontWeight: '950',
    letterSpacing: 1,
  },

  activeControls: {
    flexDirection: 'row',
    gap: 11,
  },

  pauseButton: {
    height: 66,
    width: 66,
    borderRadius: 21,
    backgroundColor: COLORS.green,
    justifyContent: 'center',
    alignItems: 'center',
  },

  endRunButton: {
    flex: 1,
    height: 66,
    borderRadius: 21,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },

  endRunDot: {
    width: 8,
    height: 8,
    borderRadius: 3,
    backgroundColor: COLORS.danger,
  },

  endRunText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1,
  },

  /* Summary */

  summaryScreen: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  summaryContent: {
    padding: 18,
  },

  summaryTop: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 25,
  },

  completeIcon: {
    width: 72,
    height: 72,
    borderRadius: 25,
    backgroundColor: COLORS.green,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.green,
    shadowOpacity: 0.3,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 0 },
  },

  summaryEyebrow: {
    color: COLORS.green,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.6,
    marginTop: 20,
  },

  summaryTitle: {
    color: COLORS.white,
    fontSize: 35,
    fontWeight: '900',
    letterSpacing: -1.2,
    marginTop: 3,
  },

  summarySubtitle: {
    color: COLORS.muted,
    fontSize: 13,
    marginTop: 5,
  },

  summaryMainCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 27,
    padding: 22,
    alignItems: 'center',
  },

  summaryDistance: {
    color: COLORS.white,
    fontSize: 53,
    fontWeight: '900',
    letterSpacing: -2.5,
  },

  summaryDistanceUnit: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.6,
  },

  summaryTime: {
    color: COLORS.secondary,
    fontSize: 21,
    fontWeight: '750',
    marginTop: 1,
  },

  summaryDivider: {
    width: '80%',
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 20,
  },

  summaryMetrics: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
  },

  summaryMetric: {
    alignItems: 'center',
    flex: 1,
  },

  summaryMetricValue: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '800',
  },

  summaryMetricLabel: {
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
    marginTop: 5,
  },

  performanceCard: {
    marginTop: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 25,
    padding: 18,
  },

  performanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  performanceEyebrow: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },

  performanceTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 3,
  },

  performanceScore: {
    color: COLORS.green,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },

  performanceGraph: {
    height: 150,
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 7,
    position: 'relative',
  },

  graphHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: COLORS.border,
  },

  h1: {
    top: 30,
  },

  h2: {
    top: 75,
  },

  h3: {
    top: 120,
  },

  graphBar: {
    width: '8%',
    borderRadius: 6,
    backgroundColor: COLORS.green,
    transformOrigin: 'bottom',
  },

  graphB1: {
    height: 45,
  },

  graphB2: {
    height: 67,
  },

  graphB3: {
    height: 58,
  },

  graphB4: {
    height: 91,
  },

  graphB5: {
    height: 79,
  },

  graphB6: {
    height: 110,
  },

  graphB7: {
    height: 98,
  },

  graphLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },

  graphLabels: {
    color: COLORS.muted,
    fontSize: 8,
  },

  summaryActions: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: Platform.OS === 'android' ? 12 : 16,
  },

  saveRunButton: {
    height: 59,
    borderRadius: 19,
    backgroundColor: COLORS.green,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 9,
  },

  saveRunText: {
    color: COLORS.bg,
    fontSize: 12,
    fontWeight: '950',
    letterSpacing: 1,
  },

  summarySecondaryActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 9,
  },

  summarySecondaryButton: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  summarySecondaryText: {
    color: COLORS.secondary,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },

  /* Activity page */

  segmentedControl: {
    height: 46,
    borderRadius: 15,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    padding: 4,
  },

  segment: {
    flex: 1,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },

  segmentActive: {
    backgroundColor: COLORS.elevated2,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },

  segmentText: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '750',
  },

  segmentTextActive: {
    color: COLORS.white,
  },

  activitySummaryCard: {
    marginTop: 11,
    padding: 15,
    backgroundColor: COLORS.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
  },

  activitySummaryItem: {
    flex: 1,
    alignItems: 'center',
  },

  activitySummaryValue: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '850',
  },

  activitySummaryLabel: {
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
    marginTop: 4,
  },

  searchBox: {
    marginTop: 12,
    height: 50,
    borderRadius: 17,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },

  searchInput: {
    flex: 1,
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 9,
    paddingVertical: 0,
  },

  filterScroll: {
    gap: 8,
    paddingVertical: 12,
  },

  filterPill: {
    height: 36,
    paddingHorizontal: 15,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },

  filterPillActive: {
    backgroundColor: `${COLORS.green}12`,
    borderColor: `${COLORS.green}30`,
  },

  filterPillText: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '750',
  },

  filterPillTextActive: {
    color: COLORS.green,
  },

  /* Stats */

  statsHero: {
    minHeight: 165,
    borderRadius: 26,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    overflow: 'hidden',
  },

  statsHeroEyebrow: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.1,
  },

  statsHeroValue: {
    color: COLORS.white,
    fontSize: 46,
    fontWeight: '900',
    letterSpacing: -2,
    marginTop: 7,
  },

  statsHeroUnit: {
    color: COLORS.green,
    fontSize: 12,
    letterSpacing: 1,
  },

  statsHeroSub: {
    color: COLORS.secondary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 5,
  },

  statsOrb: {
    width: 72,
    height: 72,
    borderRadius: 30,
    backgroundColor: `${COLORS.green}0D`,
    borderWidth: 1,
    borderColor: `${COLORS.green}24`,
    justifyContent: 'center',
    alignItems: 'center',
  },

  chartCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 25,
    padding: 18,
  },

  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },

  chartValue: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: '850',
  },

  chartSub: {
    color: COLORS.muted,
    fontSize: 10,
    marginTop: 3,
  },

  chartTrend: {
    height: 29,
    paddingHorizontal: 9,
    borderRadius: 15,
    backgroundColor: `${COLORS.green}0D`,
    borderWidth: 1,
    borderColor: `${COLORS.green}20`,
    justifyContent: 'center',
  },

  chartTrendText: {
    color: COLORS.green,
    fontSize: 10,
    fontWeight: '900',
  },

  barChart: {
    height: 210,
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },

  barColumn: {
    height: '100%',
    width: '11%',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },

  barTrack: {
    height: 150,
    width: 14,
    borderRadius: 8,
    backgroundColor: '#18221F',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },

  barFill: {
    width: '100%',
    borderRadius: 8,
    backgroundColor: '#365240',
  },

  barFillActive: {
    backgroundColor: COLORS.green,
  },

  barLabel: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: '750',
    marginTop: 8,
  },

  barLabelActive: {
    color: COLORS.green,
  },

  barValue: {
    color: COLORS.muted,
    fontSize: 8,
    marginTop: 3,
  },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 11,
  },

  statCard: {
    flexBasis: '48%',
    flexGrow: 1,
    minHeight: 125,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 21,
    padding: 14,
  },

  statIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  statCardValue: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '850',
    marginTop: 12,
  },

  statCardLabel: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginTop: 4,
  },

  insightCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 24,
    padding: 17,
  },

  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },

  insightNumber: {
    width: 38,
    height: 38,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  insightNumberText: {
    fontSize: 9,
    fontWeight: '900',
  },

  insightContent: {
    flex: 1,
    marginLeft: 12,
  },

  insightTitle: {
    color: COLORS.white,
    fontSize: 14,
    fontWeight: '800',
  },

  insightText: {
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 18,
    marginTop: 4,
  },

  insightDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 15,
    marginLeft: 50,
  },

  /* Profile */

  profileHero: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 27,
    paddingTop: 24,
    paddingBottom: 20,
  },

  profileAvatarWrap: {
    position: 'relative',
  },

  profileOnlineDot: {
    position: 'absolute',
    width: 13,
    height: 13,
    borderRadius: 8,
    backgroundColor: COLORS.green,
    borderWidth: 3,
    borderColor: COLORS.surface,
    right: 1,
    bottom: 4,
  },

  profileName: {
    color: COLORS.white,
    fontSize: 25,
    fontWeight: '900',
    marginTop: 12,
  },

  profileTag: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginTop: 4,
  },

  profileStats: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '82%',
    marginTop: 21,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },

  profileStat: {
    flex: 1,
    alignItems: 'center',
  },

  profileStatValue: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '850',
  },

  profileStatLabel: {
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginTop: 4,
  },

  profileStatDivider: {
    width: 1,
    height: 26,
    backgroundColor: COLORS.border,
  },

  settingsCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 22,
    overflow: 'hidden',
  },

  profileRow: {
    minHeight: 64,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
  },

  profileRowIcon: {
    width: 35,
    height: 35,
    borderRadius: 11,
    backgroundColor: `${COLORS.green}0B`,
    alignItems: 'center',
    justifyContent: 'center',
  },

  profileRowTitle: {
    flex: 1,
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 11,
  },

  profileRowValue: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: '600',
    marginRight: 8,
  },

  /* Avatar */

  avatar: {
    backgroundColor: '#15241D',
    borderWidth: 1,
    borderColor: `${COLORS.green}35`,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },

  avatarGlow: {
    position: 'absolute',
    backgroundColor: `${COLORS.green}13`,
  },

  avatarText: {
    color: COLORS.green,
    fontWeight: '900',
  },

  /* Bottom navigation */

  bottomNavContainer: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: Platform.OS === 'android' ? 9 : 8,
    alignItems: 'center',
  },

  bottomNav: {
    width: '100%',
    maxWidth: 540,
    minHeight: 70,
    borderRadius: 25,
    backgroundColor: 'rgba(13,21,19,0.97)',
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    flexDirection: 'row',
    paddingHorizontal: 5,
    paddingTop: 5,
    paddingBottom: Platform.OS === 'android' ? 7 : 6,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 8 },
    elevation: 18,
  },

  navItem: {
    flex: 1,
    minHeight: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },

  navIconWrap: {
    width: 39,
    height: 34,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },

  navIconWrapActive: {
    backgroundColor: `${COLORS.green}11`,
    borderWidth: 1,
    borderColor: `${COLORS.green}1C`,
  },

  navLabel: {
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: '750',
    marginTop: 2,
  },

  navLabelActive: {
    color: COLORS.green,
  },

  /* Modal */

  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },

  modalBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.72)',
  },

  sheet: {
    maxHeight: '90%',
    backgroundColor: '#0A110F',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: COLORS.borderStrong,
    paddingBottom: Platform.OS === 'android' ? 18 : 30,
    overflow: 'hidden',
  },

  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 5,
    backgroundColor: '#2A3531',
    alignSelf: 'center',
    marginTop: 10,
  },

  sheetHeader: {
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  sheetTitle: {
    color: COLORS.white,
    fontSize: 21,
    fontWeight: '850',
  },

  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },

  sheetContent: {
    paddingHorizontal: 20,
  },

  confirmIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: `${COLORS.green}0D`,
    borderWidth: 1,
    borderColor: `${COLORS.green}25`,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },

  confirmTitle: {
    color: COLORS.white,
    fontSize: 20,
    fontWeight: '850',
    marginTop: 17,
  },

  confirmText: {
    color: COLORS.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 7,
    maxWidth: 340,
  },

  sheetPrimaryButton: {
    minHeight: 55,
    borderRadius: 18,
    backgroundColor: COLORS.green,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 22,
  },

  sheetPrimaryText: {
    color: COLORS.bg,
    fontSize: 11,
    fontWeight: '950',
    letterSpacing: 1,
  },

  sheetSecondaryButton: {
    minHeight: 52,
    borderRadius: 17,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 9,
  },

  sheetSecondaryText: {
    color: COLORS.secondary,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },

  /* Detail */

  detailTop: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 5,
  },

  detailIcon: {
    width: 55,
    height: 55,
    borderRadius: 18,
    backgroundColor: `${COLORS.green}0D`,
    borderWidth: 1,
    borderColor: `${COLORS.green}22`,
    alignItems: 'center',
    justifyContent: 'center',
  },

  detailHeading: {
    marginLeft: 13,
  },

  detailTitle: {
    color: COLORS.white,
    fontSize: 18,
    fontWeight: '850',
  },

  detailDate: {
    color: COLORS.muted,
    fontSize: 11,
    marginTop: 4,
  },

  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    marginTop: 17,
  },

  detailMetric: {
    flexBasis: '31%',
    flexGrow: 1,
    minHeight: 72,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 16,
    padding: 11,
    justifyContent: 'center',
  },

  detailMetricValue: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: '800',
  },

  detailMetricLabel: {
    color: COLORS.muted,
    fontSize: 7,
    fontWeight: '900',
    letterSpacing: 0.7,
    marginTop: 5,
  },

  detailGraphCard: {
    marginTop: 10,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 19,
    padding: 14,
  },

  detailGraphTitle: {
    color: COLORS.muted,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },

  detailGraph: {
    height: 90,
    marginTop: 11,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },

  detailGraphBar: {
    width: '7%',
    borderRadius: 5,
    backgroundColor: COLORS.green,
  },

  /* Notifications */

  notificationRow: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },

  notificationBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },

  notificationIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },

  notificationIconUnread: {
    backgroundColor: `${COLORS.green}0D`,
    borderColor: `${COLORS.green}25`,
  },

  notificationContent: {
    flex: 1,
    marginLeft: 12,
    paddingRight: 15,
  },

  notificationTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  notificationTitle: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '800',
  },

  notificationTime: {
    color: COLORS.muted,
    fontSize: 9,
  },

  notificationMessage: {
    color: COLORS.secondary,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 4,
  },

  notificationUnread: {
    position: 'absolute',
    right: 0,
    width: 6,
    height: 6,
    borderRadius: 5,
    backgroundColor: COLORS.green,
  },

  emptyNotifications: {
    alignItems: 'center',
    paddingVertical: 60,
  },

  /* Settings */

  settingsSectionTitle: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginTop: 9,
    marginBottom: 8,
  },

  settingSwitchRow: {
    minHeight: 70,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  settingSwitchText: {
    flex: 1,
    paddingRight: 14,
  },

  settingTitle: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '750',
  },

  settingSubtitle: {
    color: COLORS.muted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
  },

  settingChoiceRow: {
    minHeight: 70,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  settingChoiceTitle: {
    color: COLORS.white,
    fontSize: 13,
    fontWeight: '750',
  },

  choicePills: {
    flexDirection: 'row',
    gap: 6,
  },

  choicePill: {
    minWidth: 45,
    height: 33,
    paddingHorizontal: 9,
    borderRadius: 11,
    backgroundColor: COLORS.elevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  choicePillActive: {
    backgroundColor: `${COLORS.green}13`,
    borderColor: `${COLORS.green}30`,
  },

  choicePillText: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '800',
  },

  choicePillTextActive: {
    color: COLORS.green,
  },

  settingsFooter: {
    alignItems: 'center',
    paddingVertical: 30,
  },

  settingsFooterBrand: {
    color: COLORS.green,
    fontSize: 12,
    fontWeight: '950',
    letterSpacing: 3,
  },

  settingsFooterText: {
    color: COLORS.muted,
    fontSize: 10,
    marginTop: 6,
  },

  /* Goal edit */

  goalEditHero: {
    alignItems: 'center',
    paddingTop: 5,
  },

  goalEditIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: `${COLORS.green}0D`,
    borderWidth: 1,
    borderColor: `${COLORS.green}22`,
    alignItems: 'center',
    justifyContent: 'center',
  },

  goalEditTitle: {
    color: COLORS.white,
    fontSize: 19,
    fontWeight: '850',
    marginTop: 13,
  },

  goalEditText: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 6,
    maxWidth: 330,
  },

  inputLabel: {
    color: COLORS.muted,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    marginTop: 23,
    marginBottom: 8,
  },

  goalInputRow: {
    height: 61,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },

  goalInput: {
    flex: 1,
    color: COLORS.white,
    fontSize: 25,
    fontWeight: '850',
    padding: 0,
  },

  goalInputUnit: {
    color: COLORS.green,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
  },

  goalPresets: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 10,
  },

  goalPreset: {
    flex: 1,
    minHeight: 40,
    borderRadius: 13,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  goalPresetActive: {
    backgroundColor: `${COLORS.green}12`,
    borderColor: `${COLORS.green}30`,
  },

  goalPresetText: {
    color: COLORS.muted,
    fontSize: 10,
    fontWeight: '800',
  },

  goalPresetTextActive: {
    color: COLORS.green,
  },

  /* Toast */

  toastContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: Platform.OS === 'android' ? 94 : 102,
    alignItems: 'center',
  },

  toast: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: '#16221E',
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 6 },
  },

  toastIcon: {
    width: 25,
    height: 25,
    borderRadius: 9,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 9,
  },

  toastText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: '700',
  },

  /* Icons */

  iconBox: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },

  homeRoof: {
    position: 'absolute',
    width: '62%',
    height: '62%',
    top: '8%',
    transform: [{ rotate: '45deg' }],
  },

  homeBody: {
    position: 'absolute',
    width: '58%',
    height: '45%',
    bottom: '7%',
    borderRadius: 4,
  },

  runnerHead: {
    position: 'absolute',
    borderRadius: 10,
    top: '7%',
    left: '47%',
  },

  runnerBody: {
    position: 'absolute',
    borderRadius: 4,
  },

  runnerArm: {
    position: 'absolute',
    borderRadius: 4,
  },

  runnerLeg: {
    position: 'absolute',
    borderRadius: 4,
  },

  rowIcon: {
    flexDirection: 'row',
  },
});
