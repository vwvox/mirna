import { Stack, useLocalSearchParams } from "expo-router";

import { ReviewScreen } from "@/lesson/review-screen";
import { Focus } from "@/lesson/review-pieces";

export default function ReviewRoute() {
  const { id, length, extra } = useLocalSearchParams<{
    id: string;
    length?: string;
    extra?: string;
  }>();
  return (
    <>
      <Stack.Screen
        options={{
          animation: "fade",
          gestureEnabled: false,
          contentStyle: { backgroundColor: Focus.background },
        }}
      />
      <ReviewScreen
        key={`${id}:${length}:${extra}`}
        sessionId={id}
        length={length === "10" ? 10 : 5}
        extra={extra === "1"}
      />
    </>
  );
}
