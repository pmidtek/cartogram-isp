export interface CoreColorScheme {
  main: string;
  muted: string;
  bg: string;
  mutedBg: string;
  textColor: string;
}

const CORE_COLORS: Record<number, CoreColorScheme> = {
  1: {
    main: "#0000FF", // Blue (bright)
    muted: "#00008B", // Blue (muted/dark)
    bg: "#DBEAFE", // Light blue background (enabled)
    mutedBg: "#BFDBFE", // Blue background (used)
    textColor: "#FFFFFF", // Black text for contrast
  },
  2: {
    main: "#FFA500", // Orange (bright)
    muted: "#CC8400", // Orange (muted)
    bg: "#FFEDD5", // Light orange background (enabled)
    mutedBg: "#FED7AA", // Orange background (used)
    textColor: "#000000", // Black text
  },
  3: {
    main: "#00FF00", // Green (bright)
    muted: "#00CC00", // Green (muted)
    bg: "#D1FAE5", // Light green background (enabled)
    mutedBg: "#A7F3D0", // Green background (used)
    textColor: "#000000", // Black text
  },
  4: {
    main: "#8B4513", // Brown
    muted: "#5C2E0A", // Brown (darker)
    bg: "#F5E6D3", // Light brown background (enabled)
    mutedBg: "#DCC5A3", // Brown background (used)
    textColor: "#FFFFFF", // Black text
  },
  5: {
    main: "#C0C0C0", // Slate/Gray
    muted: "#4A5568", // Slate (darker)
    bg: "#E2E8F0", // Light gray background (enabled)
    mutedBg: "#CBD5E1", // Gray background (used)
    textColor: "#000000", // Black text
  },
  6: {
    main: "#FFFFFF", // White
    muted: "#E5E5E5", // White (slightly gray)
    bg: "#FAFAFA", // Very light gray background (enabled)
    mutedBg: "#F5F5F5", // Light gray background (used)
    textColor: "#000000", // Black text for contrast
  },
  7: {
    main: "#FF0000", // Red (bright)
    muted: "#CC0000", // Red (muted)
    bg: "#FEE2E2", // Light red background (enabled)
    mutedBg: "#FECACA", // Red background (used)
    textColor: "#000000", // Black text
  },
  8: {
    main: "#000000", // Black
    muted: "#1A1A1A", // Black (slightly lighter)
    bg: "#E5E7EB", // Light gray background (enabled)
    mutedBg: "#D1D5DB", // Gray background (used)
    textColor: "#FFFFFF", // Black text
  },
  9: {
    main: "#FFFF00", // Yellow (bright)
    muted: "#CCCC00", // Yellow (muted)
    bg: "#FEF9C3", // Light yellow background (enabled)
    mutedBg: "#FEF08A", // Yellow background (used)
    textColor: "#000000", // Black text
  },
  10: {
    main: "#800080", // Violet (bright)
    muted: "#6A00CC", // Violet (muted)
    bg: "#EDE9FE", // Light violet background (enabled)
    mutedBg: "#DDD6FE", // Violet background (used)
    textColor: "#000000", // Black text
  },
  11: {
    main: "#FFC0CB", // Rose/Pink
    muted: "#FF91A4", // Rose (darker)
    bg: "#FCE7F3", // Light pink background (enabled)
    mutedBg: "#FBCFE8", // Pink background (used)
    textColor: "#000000", // Black text
  },
  12: {
    main: "#00FFFF", // Aqua/Cyan (bright)
    muted: "#00CCCC", // Aqua (muted)
    bg: "#CFFAFE", // Light cyan   background (enabled)
    mutedBg: "#A5F3FC", // Cyan background (used)
    textColor: "#000000", // Black text
  },
};

export function getCoreColor(
  coreNumber: number,
  status: "enabled" | "used" = "enabled",
): string {
  const colorScheme = CORE_COLORS[coreNumber];

  if (!colorScheme) {
    // Fallback to green for invalid core numbers
    return status === "enabled" ? "#10B981" : "#6B7280";
  }

  return status === "enabled" ? colorScheme.main : colorScheme.muted;
}

export function getCoreBgColor(
  coreNumber: number,
  status: "enabled" | "used" = "enabled",
): string {
  const colorScheme = CORE_COLORS[coreNumber];

  if (!colorScheme) {
    // Fallback to light green for invalid core numbers
    return status === "enabled" ? "#F0FDF4" : "#F3F4F6";
  }

  return status === "enabled" ? colorScheme.main : colorScheme.mutedBg;
}

export function getCoreTextColor(coreNumber: number): string {
  const colorScheme = CORE_COLORS[coreNumber];

  if (!colorScheme) {
    return "#000000"; // Default to black text
  }

  return colorScheme.textColor;
}

export function getCoreColorScheme(
  coreNumber: number,
  status: "enabled" | "used" = "enabled",
) {
  return {
    color: getCoreColor(coreNumber, status),
    bgColor: getCoreBgColor(coreNumber, status),
    textColor: getCoreTextColor(coreNumber),
  };
}
