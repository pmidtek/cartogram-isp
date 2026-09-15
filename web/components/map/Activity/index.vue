<script setup lang="ts">
import { useAuth } from "~/stores/useAuth";
import { useMapRef } from "~/stores/useMapRef";
import bbox from "@turf/bbox";

interface ActivityItem {
  id: number;
  geom?: any;
}

interface Activity {
  id: number;
  timestamp: string;
  action: string;
  collection: string;
  item: string;
  item_info: ActivityItem;
}

const authStore = useAuth();
const mapStore = useMapRef();
const activities = ref<Activity[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

const fetchActivities = async () => {
  loading.value = true;
  error.value = null;

  try {
    const response = await $fetch("/panel/data/activity", {
      params: {
        limit: 10,
        sort: "-timestamp",
      },
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });

    activities.value = response.data || [];
  } catch (err) {
    console.error("Failed to fetch activities:", err);
    error.value = "Failed to load activity log";
  } finally {
    loading.value = false;
  }
};

const handleActivityClick = async (activity: Activity) => {
  if (!mapStore.map || !activity.item_info?.geom) {
    console.warn("Map not ready or no geometry available");
    return;
  }

  try {
    const geom = activity.item_info.geom;
    const bounds = bbox(geom);

    // Fly to the feature bounds
    mapStore.map.fitBounds(bounds, {
      padding: 100,
      duration: 3000,
    });

    // Highlight the feature by adding a temporary layer
    const sourceId = `highlight-${activity.id}`;
    const layerId = `highlight-layer-${activity.id}`;

    // Remove existing highlight if any
    if (mapStore.map.getLayer(layerId)) {
      mapStore.map.removeLayer(layerId);
    }
    if (mapStore.map.getSource(sourceId)) {
      mapStore.map.removeSource(sourceId);
    }

    // Add highlight source and layer
    mapStore.map.addSource(sourceId, {
      type: "geojson",
      data: {
        type: "Feature",
        geometry: geom,
        properties: {},
      },
    });

    const geomType = geom.type;
    if (geomType === "Point" || geomType === "MultiPoint") {
      mapStore.map.addLayer({
        id: layerId,
        type: "circle",
        source: sourceId,
        paint: {
          "circle-radius": 10,
          "circle-color": "#3b82f6",
          "circle-opacity": 0.6,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#1d4ed8",
        },
      });
    } else if (geomType === "LineString" || geomType === "MultiLineString") {
      mapStore.map.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#3b82f6",
          "line-width": 4,
          "line-opacity": 0.8,
        },
      });
    } else if (geomType === "Polygon" || geomType === "MultiPolygon") {
      mapStore.map.addLayer({
        id: layerId,
        type: "fill",
        source: sourceId,
        paint: {
          "fill-color": "#3b82f6",
          "fill-opacity": 0.3,
          "fill-outline-color": "#1d4ed8",
        },
      });
    }

    // Remove highlight after 3 seconds
    setTimeout(() => {
      if (mapStore.map?.getLayer(layerId)) {
        mapStore.map.removeLayer(layerId);
      }
      if (mapStore.map?.getSource(sourceId)) {
        mapStore.map.removeSource(sourceId);
      }
    }, 3000);
  } catch (err) {
    console.error("Failed to fly to feature:", err);
  }
};

const getActionColor = (action: string) => {
  const colors: Record<string, string> = {
    create: "bg-green-100 text-green-700",
    update: "bg-blue-100 text-blue-700",
    delete: "bg-red-100 text-red-700",
  };
  return colors[action] || "bg-gray-100 text-gray-700";
};

const formatTimestamp = (timestamp: string) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

onMounted(() => {
  fetchActivities();
});
</script>

<template>
  <div class="p-3 space-y-1">
    <h2 class="text-md text-black">Activity Log</h2>
    <p
      class="text-[10px] font-normal font-['Raleway'] leading-none text-grey-700"
    >
      View recent actions and processing status
    </p>
  </div>
  <hr class="mx-3" />

  <div class="p-3 space-y-2 max-h-[calc(100vh-16.5rem)] overflow-y-auto">
    <!-- Loading State -->
    <div v-if="loading" class="text-center py-4">
      <p class="text-xs text-gray-500">Loading activities...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="text-center py-4">
      <p class="text-xs text-red-500">{{ error }}</p>
    </div>

    <!-- Activity List -->
    <div v-else-if="activities.length > 0" class="space-y-2">
      <div
        v-for="activity in activities"
        :key="activity.id"
        @click="handleActivityClick(activity)"
        class="bg-white border border-gray-200 rounded-xxs p-2 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer"
      >
        <div class="flex items-center justify-between gap-2 mb-1">
          <div class="flex items-center gap-2">
            <span
              :class="getActionColor(activity.action)"
              class="text-xs font-semibold px-2 py-1 rounded-xxs"
            >
              {{ activity.action }}
            </span>
            <span class="text-xs text-gray-700 font-medium">{{
              activity.collection
            }}</span>
          </div>

          <div class="text-xs text-gray-500">#{{ activity.item }}</div>
        </div>

        <p class="text-[10px] text-gray-500">
          {{ formatTimestamp(activity.timestamp) }}
        </p>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="text-center py-8">
      <p class="text-xs text-gray-500">No activities found</p>
    </div>
  </div>
</template>
