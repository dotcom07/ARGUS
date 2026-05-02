import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { createCaptureProof } from "./createCaptureProof";
import type { ArgusProof, ArgusUseCase } from "./types";

type ArgusCameraProps = {
  partnerId: string;
  useCase: ArgusUseCase;
  metadata: Record<string, string | number | boolean | null>;
  onNativeProofCreated?(proof: ArgusProof): void;
  onProofCreated(proof: ArgusProof): void;
  onError?(error: Error): void;
};

// kr: ArgusCamera는 파트너 앱이 native verified camera flow를 버튼 하나로 붙이게 해주는 컴포넌트입니다.
// en: ArgusCamera lets partner apps attach the native verified camera flow with one button.
export function ArgusCamera(props: ArgusCameraProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [statusLabel, setStatusLabel] = useState("Capture with Argus SDK");
  const [pendingDotCount, setPendingDotCount] = useState(1);
  const pendingDots = isCapturing ? ".".repeat(pendingDotCount) : "";

  useEffect(() => {
    if (!isCapturing) {
      setPendingDotCount(1);
      return undefined;
    }

    const intervalId = setInterval(() => {
      setPendingDotCount((current) => (current % 3) + 1);
    }, 420);

    return () => clearInterval(intervalId);
  }, [isCapturing]);

  async function handlePress() {
    setIsCapturing(true);
    setStatusLabel("Opening camera");

    try {
      const proof = await createCaptureProof(
        {
          partnerId: props.partnerId,
          useCase: props.useCase,
          metadata: props.metadata,
        },
        {
          onNativeProofCreated(proof) {
            setStatusLabel("Verifying with Argus");
            props.onNativeProofCreated?.(proof);
          },
        },
      );
      props.onProofCreated(proof);
    } catch (error) {
      props.onError?.(error as Error);
    } finally {
      setIsCapturing(false);
      setStatusLabel("Capture with Argus SDK");
    }
  }

  return (
    <View>
      <Pressable
        disabled={isCapturing}
        onPress={handlePress}
        style={{
          alignItems: "center",
          backgroundColor: isCapturing ? "#9aa3af" : "#3665f3",
          borderRadius: 22,
          minHeight: 44,
          justifyContent: "center",
          paddingHorizontal: 16,
        }}
      >
        <Text style={{ color: "#ffffff", fontSize: 15, fontWeight: "800" }}>
          {statusLabel}{pendingDots}
        </Text>
      </Pressable>
    </View>
  );
}
