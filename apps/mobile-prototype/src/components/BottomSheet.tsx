import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Dimensions, Easing, Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../state/settings';
import { Text } from './ui';

/** A minimal bottom sheet that works the same in Expo Go and on web. */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => finished && setMounted(false));
    }
  }, [visible, progress]);

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: theme.colors.overlay,
            opacity: progress,
          }}
        >
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          style={{
            backgroundColor: theme.colors.surface,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingTop: 10,
            paddingHorizontal: 20,
            paddingBottom: Math.max(insets.bottom, 16) + 8,
            maxHeight: Dimensions.get('window').height * 0.85,
            borderWidth: 1,
            borderBottomWidth: 0,
            borderColor: theme.colors.border,
            transform: [
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) },
            ],
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 38,
              height: 5,
              borderRadius: 3,
              backgroundColor: theme.colors.border,
              marginBottom: 14,
            }}
          />
          {title ? (
            <Text variant="heading" style={{ marginBottom: 12 }}>
              {title}
            </Text>
          ) : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}
