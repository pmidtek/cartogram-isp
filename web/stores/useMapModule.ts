import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { useFeature } from "~/stores/useFeature";
import type { titleEnum, typeFeatureEnum } from "~/stores/useFeature";

export type MapModuleSlug =
  | "market-potential"
  | "backhaul"
  | "fwa-access"
  | "ftth-mapping";

export interface MapModuleConfig {
  slug: MapModuleSlug;
  name: string;
  titleFeature: titleEnum;
  typeFeature: typeFeatureEnum;
  routeParam: string;
  description: string;
  landingRoute?: string;
  tools: string[];
}

const MODULES: MapModuleConfig[] = [
  {
    slug: "market-potential",
    name: "Market Potential",
    titleFeature: "Market Potential Analysis Map",
    typeFeature: "market-potential",
    routeParam: "market-potential",
    description:
      "Analyze market opportunities and identify high-potential areas for network expansion.",
    tools: [],
  },
  {
    slug: "backhaul",
    name: "Backhaul Optimal Planning and Asset Management",
    titleFeature: "Asset Management Map",
    typeFeature: "backhaul",
    routeParam: "backhaul",
    description:
      "Precision routing for resilient, effective and cost-efficient backhaul connectivity.",
    tools: ["buffer_line", "route_analysis"],
  },
  {
    slug: "fwa-access",
    name: "FWA Access Opportunity Assessment",
    titleFeature: "Fixed Wireless Access (FWA) Opportunity Assessment",
    typeFeature: "FWA",
    routeParam: "fwa-access",
    description:
      "Identify high-value FWA deployment zones through network and market insights.",
    landingRoute: "/landing/business-planning/FWA",
    tools: ["upload", "specific"],
  },
  {
    slug: "ftth-mapping",
    name: "FTTH Mapping",
    titleFeature: "FTTH Mapping",
    typeFeature: "ftth-mapping",
    routeParam: "ftth-mapping",
    description:
      "Visualize and manage Fiber-to-the-Home network infrastructure and coverage.",
    tools: [],
  },
];

export const useMapModule = defineStore("mapModule", () => {
  const activeSlug = ref<MapModuleSlug | null>(null);

  const modules = computed(() => MODULES);

  const currentModule = computed(
    () => MODULES.find((module) => module.slug === activeSlug.value) || null,
  );

  const planningSlugs: MapModuleSlug[] = [
    "market-potential",
    "backhaul",
    "fwa-access",
  ];

  const planningModules = computed(() =>
    MODULES.filter((module) => planningSlugs.includes(module.slug)),
  );

  const operationSlugs: MapModuleSlug[] = ["ftth-mapping"];

  const operationModules = computed(() =>
    MODULES.filter((module) => operationSlugs.includes(module.slug)),
  );

  function setActiveModule(slug: MapModuleSlug) {
    const module = MODULES.find((entry) => entry.slug === slug);
    if (!module) return;
    activeSlug.value = module.slug;
    const featureStore = useFeature();
    const { titleFeature, typeFeature } = storeToRefs(featureStore);
    titleFeature.value = module.titleFeature;
    typeFeature.value = module.typeFeature;
  }

  function clearActiveModule() {
    activeSlug.value = null;
  }

  function setActiveModuleByRouteParam(param: string) {
    const module = MODULES.find((entry) => entry.routeParam === param);
    if (module) {
      setActiveModule(module.slug);
    }
    return module || null;
  }

  function getModule(slug: MapModuleSlug) {
    return MODULES.find((module) => module.slug === slug) || null;
  }

  function resolveRoute(module: MapModuleConfig) {
    return `/map/${module.routeParam}`;
  }

  return {
    modules,
    currentModule,
    planningModules,
    operationModules,
    setActiveModule,
    clearActiveModule,
    setActiveModuleByRouteParam,
    getModule,
    resolveRoute,
  };
});
