import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { FloatingTabBar } from '../../components/FloatingTabBar';
import { useTheme } from '../../state/settings';

type TabIcon = keyof typeof Ionicons.glyphMap;

// FloatingTabBar passes theme colours, which are always strings.
const icon =
  (active: TabIcon, inactive: TabIcon) =>
  ({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) => (
    <Ionicons name={focused ? active : inactive} size={size} color={color as string} />
  );

export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Today', tabBarIcon: icon('flash', 'flash-outline') }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: 'Plan',
          tabBarIcon: icon('calendar', 'calendar-outline'),
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: 'Coach',
          tabBarIcon: icon('chatbubble-ellipses', 'chatbubble-ellipses-outline'),
        }}
      />
      <Tabs.Screen
        name="you"
        options={{ title: 'You', tabBarIcon: icon('person-circle', 'person-circle-outline') }}
      />
    </Tabs>
  );
}
