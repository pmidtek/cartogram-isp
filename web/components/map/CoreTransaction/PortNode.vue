<script setup lang="ts">
import { Handle, Position } from "@vue-flow/core";
import {
  getCoreColor,
  getCoreBgColor,
  getCoreTextColor,
} from "~/utils/coreColors";

interface Props {
  data: {
    label: string;
    color: string;
    status: "enabled" | "used" | "selected";
    side: "left" | "right";
    type?: "port" | "core";
    coreNumber?: number;
    tubeColor?: string | null;
    coreColor?: string | null;
  };
}

const props = defineProps<Props>();

const getStatusColor = (status: string) => {
  // If this is a core node and we have a core number, use core-specific colors
  if (props.data.type === "core" && props.data.coreNumber) {
    return getCoreColor(props.data.coreNumber, status as "enabled" | "used");
  }

  // Fallback to default status colors for ports
  switch (status) {
    case "enabled":
      return "#10B981"; // Green
    case "used":
      return "#6B7280"; // Gray
    default:
      return "#10B981"; // Default green
  }
};

const getStatusBgColor = (status: string) => {
  if (props.data.coreColor) {
    return props.data.coreColor;
  }

  if (props.data.type === "core" && props.data.coreNumber) {
    return getCoreBgColor(props.data.coreNumber, status as "enabled" | "used");
  }

  // Fallback to default status background colors for ports
  switch (status) {
    case "enabled":
      return "#F0FDF4"; // Light green background
    case "used":
      return "#F3F4F6"; // Light gray background
    default:
      return "#F0FDF4"; // Default light green
  }
};

const getBorderStyle = () => {
  if (props.data.tubeColor) {
    return `3px solid ${props.data.tubeColor}`;
  }
  return "";
};

const getTextColor = () => {
  // If this is a core node and we have a core number, use appropriate text color
  if (props.data.type === "core" && props.data.coreNumber) {
    return getCoreTextColor(props.data.coreNumber);
  }

  // Default text color for ports
  return "#374151"; // gray-700
};
</script>

<template>
  <div
    class="port-node rounded-xxs shadow-sm px-3 py-2 min-w-[200px] min-h-[20px]"
    :class="{ 'border border-grey-300': !data.tubeColor }"
    :style="{ backgroundColor: getStatusBgColor(data.status), border: getBorderStyle() }"
  >
    <div class="flex items-center gap-2 text-xs">
      <span
        class="w-full font-mono font-semibold whitespace-pre-line"
        :class="props.data.side === 'left' ? 'text-right' : 'text-left'"
        :style="{ color: getTextColor() }"
      >{{ data.type === "core" ? "Core" : "Port" }} {{ data.label }}</span>

      <!-- Target Handle (left side) -->
      <Handle
        type="target"
        :position="Position.Left"
        :style="{
          left: '-8px',
          top: '50%',
          transform: 'translateY(-50%)',
          background: data.color || getStatusColor(data.status),
          width: '12px',
          height: '12px',
          border: '2px solid white',
        }"
      />

      <!-- Source Handle (right side) -->
      <Handle
        type="source"
        :position="Position.Right"
        :style="{
          right: '-8px',
          top: '50%',
          transform: 'translateY(-50%)',
          background: data.color || getStatusColor(data.status),
          width: '12px',
          height: '12px',
          border: '2px solid white',
        }"
      />
    </div>
  </div>
</template>

<style scoped>
.port-node {
  font-family: "Courier New", monospace;
}
</style>
