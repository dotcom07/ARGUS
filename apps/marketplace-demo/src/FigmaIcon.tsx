import React from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

const FIGMA_ICONS = {
  bell: {
    viewBox: "0 0 24 24",
    path: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
  },
  camera: {
    viewBox: "0 0 24 24",
    path: "M14.5 4l1.5 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l1.5-2h5zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  },
  cart: {
    viewBox: "0 0 24 24",
    path: "M6 6h15l-2 8H8L6 3H3M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2M18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2",
  },
  check: {
    viewBox: "0 0 24 24",
    path: "M20 6L9 17l-5-5",
  },
  filter: {
    viewBox: "0 0 24 24",
    path: "M3 5h18M6 12h12M10 19h4",
  },
  heart: {
    viewBox: "0 0 24 24",
    path: "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z",
  },
  home: {
    viewBox: "0 0 24 24",
    path: "M3 10.5L12 3l9 7.5V21h-6v-6H9v6H3V10.5z",
  },
  plusSquare: {
    viewBox: "0 0 24 24",
    path: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12 8v8M8 12h8",
  },
  profile: {
    viewBox: "0 0 24 24",
    path: "M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
  },
  search: {
    viewBox: "0 0 24 24",
    path: "M21 21l-4.35-4.35M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z",
  },
  shield: {
    viewBox: "0 0 24 24",
    path: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  },
  shieldCheck: {
    viewBox: "0 0 24 24",
    path: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-5",
  },
  tag: {
    viewBox: "0 0 24 24",
    path: "M20 12l-8 8-9-9V3h8l9 9zM7.5 7.5h.01",
  },
  upload: {
    viewBox: "0 0 24 24",
    path: "M12 3v12M7 8l5-5 5 5M5 21h14",
  },
} as const;

export type FigmaIconName = keyof typeof FIGMA_ICONS;

export function FigmaIcon({
  color = "#111827",
  name,
  size = 24,
  style,
}: {
  color?: string;
  name: FigmaIconName;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const icon = FIGMA_ICONS[name];

  return (
    <Svg fill="none" height={size} style={style} viewBox={icon.viewBox} width={size}>
      <Path
        d={icon.path}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </Svg>
  );
}
