declare global {
  interface Window {
    EyeDropper: any;
  }
}

import type { GeoJSONFeature } from "maplibre-gl";
import type {
  geomTypeCircle,
  geomTypeLine,
  geomTypePolygon,
} from "~/constants";

export type CircleStyles = {
  layout_visibility?: string;
  layout_circle_sort_key?: number;
  paint_circle_blur?: number;
  paint_circle_color?: string;
  paint_circle_opacity?: string;
  paint_circle_pitch_alignment?: string;
  paint_circle_pitch_scale?: string;
  paint_circle_radius?: number;
  paint_circle_stroke_color?: string;
  paint_circle_stroke_opacity?: string;
  paint_circle_stroke_width?: number;
};

export interface CircleStylesConfig extends CircleStyles {
  id: string;
  name: string;
}

export type SymbolStyles = {
  layout_icon_allow_overlap?: boolean;
  layout_icon_anchor?:
    | "center"
    | "left"
    | "right"
    | "top"
    | "bottom"
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right";
  layout_icon_ignore_placement?: boolean;
  layout_icon_image?: { id: string; title: string };
  layout_icon_keep_upright?: boolean;
  layout_icon_offset?: number[];
  layout_icon_optional?: boolean;
  layout_icon_overlap?: "never" | "always" | "cooperative";
  layout_icon_padding?: number[];
  layout_icon_pitch_alignment?: "map" | "viewport" | "auto";
  layout_icon_rotate?: number;
  layout_icon_rotation_alignment?: "map" | "viewport" | "auto";
  layout_icon_size?: number;
  layout_icon_text_fit?: "none" | "width" | "height" | "both";
  layout_icon_text_fit_padding?: number[];
  layout_symbol_avoid_edges?: boolean;
  layout_symbol_placement?: "point" | "line" | "line-center";
  layout_symbol_sort_key?: number;
  layout_symbol_spacing?: number;
  layout_symbol_z_order?: "auto" | "viewport-y" | "source";
  layout_text_allow_overlap?: boolean;
  layout_text_anchor?:
    | "center"
    | "left"
    | "right"
    | "top"
    | "bottom"
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right";
  layout_text_field?: string;
  layout_text_font?: string[];
  layout_text_ignore_placement?: boolean;
  layout_text_justify?: "auto" | "left" | "center" | "right";
  layout_text_keep_upright?: boolean;
  layout_text_letter_spacing?: number;
  layout_text_line_height?: number;
  layout_text_max_angle?: number;
  layout_text_max_width?: number;
  layout_text_offset?: number[];
  layout_text_optional?: boolean;
  layout_text_overlap?: "never" | "always" | "cooperative";
  layout_text_padding?: number;
  layout_text_pitch_alignment?: "map" | "viewport" | "auto";
  layout_text_radial_offset?: number;
  layout_text_rotate?: number;
  layout_text_rotation_alignment?:
    | "map"
    | "viewport"
    | "viewport-glyph"
    | "auto";
  layout_text_size?: number;
  layout_text_transform?: "none" | "uppercase" | "lowercase";
  layout_text_variable_anchor?:
    | "center"
    | "left"
    | "right"
    | "top"
    | "bottom"
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right";
  layout_text_variable_anchor_offset?: any[];
  layout_text_writing_mode?: "horizontal" | "vertical";
  layout_visibility?: "visible" | "none";
  paint_icon_color?: string | any[]; // Allow MapLibre expressions (arrays)
  paint_icon_halo_blur?: number;
  paint_icon_halo_color?: string;
  paint_icon_halo_width?: number;
  paint_icon_opacity?: string;
  paint_icon_translate?: number[];
  paint_icon_translate_anchor?: "map" | "viewport";
  paint_text_color?: string;
  paint_text_halo_blur?: number;
  paint_text_halo_color?: string;
  paint_text_halo_width?: number;
  paint_text_opacity?: string;
  paint_text_translate?: number[];
  paint_text_translate_anchor?: "map" | "viewport";
};

export interface SymbolStylesAdjusted extends SymbolStyles {
  icon_image_title?: string;
  icon_image_id?: string;
}

export interface SymbolStylesConfig extends SymbolStyles {
  id: string;
  name: string;
}

export type FillStyles = {
  layout_visibility?: string;
  layout_circle_sort_key?: number;
  paint_fill_antialias?: boolean;
  paint_fill_color?: string;
  paint_fill_opacity?: string;
  paint_fill_outline_color?: string;
  paint_fill_pattern?: string;
  paint_fill_translate?: string;
  paint_fill_translate_anchor?: string;
};

export interface FillStylesConfig extends FillStyles {
  id: string;
  name: string;
}

export type LineStyles = {
  layout_visibility?: string;
  layout_line_cap?: string;
  layout_line_join?: string;
  layout_line_miter_limit?: number;
  layout_line_round_limit?: number;
  layout_line_sort_key?: number;
  paint_line_blur?: number;
  paint_line_color?: string;
  paint_line_dasharray?: string;
  paint_line_gap_width?: number;
  paint_line_gradient?: string;
  paint_line_offset?: number;
  paint_line_pattern?: string;
  paint_line_translate?: string;
  paint_line_translate_anchor?: string;
  paint_line_width?: number;
  paint_line_opacity?: string;
};

export interface LineStylesConfig extends LineStyles {
  id: string;
  name: string;
}

export type RasterStyles = { layout_visibility: string };

export type VectorTiles = {
  source: "vector_tiles";
  bounds: GeoJSON.Polygon;
  category?: any;
  layer_style: CircleStyles | FillStyles | LineStyles | SymbolStylesAdjusted;
  geometry_type: string;
  layer_alias?: string;
  layer_id: string;
  layer_name: string;
  minzoom?: number;
  maxzoom?: number;
  click_popup_columns?: string[];
  image_columns?: string[];
  feature_detail_columns?: string[];
  dimension: string;
  is_ftth?: boolean;
  filter?: any[]; // MapLibre GL filter expression for client-side filtering
};

export type VectorTilesConfig = {
  layer_id: string;
  layer_name: string;
  bounds: GeoJSON.Polygon;
  geometry_type: string;
  category?: { parent?: string };
  circle_style?: CircleStylesConfig;
  symbol_style?: SymbolStylesConfig;
  fill_style?: FillStylesConfig;
  line_style?: LineStylesConfig;
  layer_alias?: string;
  minzoom?: number;
  maxzoom?: number;
  click_popup_columns?: string[];
  image_columns?: string[];
  feature_detail_columns?: string[];
};

export type RasterTiles = {
  source: "raster_tiles";
  opacity: number;
  layer_style: RasterStyles;
  bounds: GeoJSON.Polygon;
  category?: { category_name?: string };
  geometry_type: string;
  layer_alias: string;
  layer_id: string;
  minzoom: number;
  maxzoom: number;
  terrain_rgb: boolean;
  dimension: string;
  click_popup_columns?: string[];
  image_columns?: string[];
  feature_detail_columns?: string[];
};

export type RasterTilesConfig = {
  layer_id: string;
  bounds: GeoJSON.Polygon;
  minzoom: number;
  maxzoom: number;
  terrain_rgb: boolean;
  layer_alias: string;
  active: boolean;
  visible: boolean;
  category?: { category_name?: string };
};

export type ThreeDTiles = {
  source: "three_d_tiles";
  opacity: number;
  point_size?: number;
  point_color?: string;
  layer_style: { layout_visibility: string };
  geometry_type: string;
  layer_alias: string;
  layer_id: string;
  category: { category_name: string };
  dimension: string;
  click_popup_columns?: string[];
  image_columns?: string[];
  feature_detail_columns?: string[];
};

export type ThreeDTilesConfig = {
  active: boolean;
  layer_alias: string;
  layer_id: string;
  opacity: number;
  point_size?: number;
  point_color?: string;
  visible: boolean;
};

export type LayerConfigLists = (
  | VectorTilesConfig
  | RasterTilesConfig
  | ThreeDTilesConfig
)[];

export type LoadedGeoJson = {
  source: "loaded_geojson";
  layer_name: string;
  layer_id: string;
  layer_alias: string;
  description: string;
  preview: File | null;
  layer_style: CircleStyles | FillStyles | LineStyles;
  bounds: GeoJSON.Polygon;
  category: { category_name: string | null };
  geometry_type:
    | typeof geomTypeCircle
    | typeof geomTypeLine
    | typeof geomTypePolygon;
  dimension: "2D";
};

export type LayerLists =
  | VectorTiles
  | RasterTiles
  | ThreeDTiles
  | LoadedGeoJson;

export type LayerGroupedByCategory = {
  label: string;
  layerLists: LayerLists[];
  defaultOpen: boolean;
};

export type Attachment = {
  title: string;
  description: string;
  url: string;
  icon: "link" | "form";
};

export type MapData = {
  data: {
    title: string;
    subtitle: string;
    information: string;
    initial_map_view: GeoJSON.Feature;
    information_attachments?: Attachment[];
  };
};

export type ChartData = {
  class_ts: string;
  count: number;
};

export type GeneralSettings = {
  data: {
    help_center_url?: string;
    project_descriptor?: string;
    project_logo_horizontal?: string;
    project_name: string;
    public_favicon?: string;
    public_background?: string;
    basemaps?: { name: string; type: string; url: string; tileSize?: number }[];
  };
};

export type AuthPayload = {
  access_token: string;
  refresh_token: string;
  expires: number;
};

export type ToolItem = {
  id: string;
  label: string;
  labelCard?: string;
  icon?: string;
  action?: (item?: ToolItem) => void;
};

export type ThreeDLayerCenter = {
  id: string;
  center: [number, number];
  zoom: number;
};

export type UploadModeEnum = "loadlocal" | "upload" | "";

export type TableColumn = { key: string; label: string; type: string };

export type AnalysisResult = {
  date: string;
  description: string;
  layer: string;
  result: { category: string; count: string }[];
};

export type DigitizeResult = {
  name: string;
  id: number;
  layer: any;
  area: any;
  coordinates: any;
  data: any;
  layerId?: any;
  selectLayer?: any;
  selectTargetLayer?: any;
  invert?: any;
};

export type Uploader = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  status: string;
  role: string;
  last_access: Date;
  last_page: string;
  provider: string;
  email_notifications: boolean;
};

export type Message = {
  args: any[];
  kwargs: Record<string, string>;
  options: any;
  actor_name: string;
  message_id: string;
  queue_name: string;
  message_timestamp: string;
};

export type Queue = {
  message_id: string;
  queue_name: string;
  state: string;
  mtime: Date;
  message: Message;
  result: Record<string, any>;
  result_ttl: Date;
  uploader: Uploader;
  filename: null;
  status: string;
  file_report: string | null;
};

export interface FtthResponse {
  success: boolean;
  summary: FtthSummary;
  network_created: boolean;
  edges_table: string;
}

export interface FtthSummary {
  from_coordinates: string; // "lon, lat"
  to_coordinates: string; // "lon, lat"
  start_intersects_network: boolean;
  end_intersects_network: boolean;
  path_shaft_ids: string[];
  start_shaft_id: number;
  end_shaft_id: number;
  start_offset_distance: number;
  end_offset_distance: number;
  network_distance: number; // meters
  total_distance: string; // "28.699 km"
  total_loss_db: number; // dB
  shortest_path: string; // WKT MULTILINESTRING
}

type SummaryItem = {
  group: string;
  count: number;
};

export type MarketAnalysisData = {
  code: string;
  geojson_source: GeoJSONFeature;
  geojson_buffer: GeoJSONFeature;
  result: {
    buffer: {
      length_m: number;
      area_m2: number;
    };
    layer: {
      house_of_class: {
        sumary: SummaryItem[];
        geojson: GeoJSONFeature;
      };
      poi: {
        sumary: SummaryItem[];
        geojson: GeoJSONFeature;
      };
      telecomunication: {
        sumary: SummaryItem[];
        geojson: GeoJSONFeature;
      };
    };
  };
};

export interface ResponseListLayerData {
  data: {
    site_points: SitePointType[];
    assets: AssetType[];
    routes: RouteType[];
    cables: CableType[];
    towers?: Tower[];
  };
}

export interface SubType {
  sub_type_key: string;
  sub_type_name: string;
  site_points?: SitePoint[];
  assets?: Asset[];
  routes?: Route[];
  cables?: Cable[];
  isvisible: boolean;
}

export interface SitePointType {
  site_point_type_id: number;
  site_point_type_name: string;
  is_have_sub: boolean;
  site_points: SitePoint[];
  sub_types?: SubType[];
  isvisible: boolean;
}

export interface SitePoint {
  id: number;
  name: string;
  isvisible: boolean;
}

export interface SitePointListItem {
  id: number;
  name: string;
  code: string | null;
  site_point_type_id: { id: number; name: string } | null;
  area_city_id: { city: string; province: string } | null;
  date_created: string | null;
  geom: GeoJSON.Point | null;
}

export interface RouteOption {
  id: number;
  label: string;
  source: string;
  profile: string;
  distance: number;
  duration: number | null;
  geojson_route: GeoJSON.FeatureCollection;
}

// Matches the /panel/boq-bom/feeder-simple/generate-boq-bom response shape.
export interface BoqBomRow {
  code: string;
  uom: string | null;
  qty: number;
  price: number;
  total: number;
  description: string | null;
  formula: string | null;
}

export interface BoqBomGroup {
  group_name: string;
  group_total: number;
  groups: { name: string; rows: BoqBomRow[]; total: number }[];
  description?: Record<string, number | string | null>;
  summary?: { total_cost?: number; [key: string]: unknown };
}

export interface BoqBomGenerateResult {
  boq: {
    material: BoqBomGroup;
    services: BoqBomGroup;
  };
  bom: null;
}

export interface AssetType {
  asset_type_id: number;
  asset_type_name: string;
  is_have_sub?: boolean;
  assets: Asset[];
  sub_types?: SubType[];
  isvisible: boolean;
}

export interface Asset {
  id: number;
  name: string;
  site_point_id: number;
  isvisible: boolean;
}

export interface RouteType {
  route_type_id: number;
  route_type_name: string;
  is_have_sub?: boolean;
  routes: Route[];
  sub_types?: SubType[];
  isvisible: boolean;
}

export interface Route {
  id: number;
  name: string;
  site_from: number;
  site_to: number;
  isvisible: boolean;
}

export interface CableType {
  cable_type_id: number;
  cable_type_name: string;
  is_have_sub?: boolean;
  cables: Cable[];
  sub_types?: SubType[];
  isvisible: boolean;
}

export interface Cable {
  id: number;
  name: string;
  site_from: number;
  site_to: number;
  isvisible: boolean;
}

export interface Tower {
  id?: number;
  name?: string;
  owner: string;
  isvisible: boolean;
}

interface TransactionTypeInfo {
  id: number;
  name: string;
  code: string;
  cable_type_name?: string;
  asset_type_name?: string;
}

export interface TransactionItemTypeInfo {
  id: number;
  path: string;
  number: number;
  port_type?: string;
  tube?: number;
  core?: number;
  tube_color?: string;
  core_color?: string;
  remarks?: string | null;
}

export interface Transaction {
  id: string;
  type: "cables" | "assets";
  type_id: number;
  type_info: TransactionTypeInfo;
  item_type: "cable_cores" | "asset_ports";
  item_type_id: number;
  item_type_info: TransactionItemTypeInfo;
}

export interface PortConnection {
  id: number;
  path: string;
  number: number;
  port_type: string;
  type_info: { asset_type_name: string; cable_type_name: string; name: string };
  transactions: Transaction[];
  core: number;
  tube: number;
  side?: string;
  tube_color?: string;
  core_color?: string;
  remarks?: string | null;
}

export interface CoreConnectionResponse {
  data: PortConnection[];
}

// Types
export interface TowerOwner {
  owner: string;
  count: number;
  percentage: number;
}

export interface TowerCountResponse {
  data: {
    bbox: number[];
    total: number;
    list: TowerOwner[];
  };
}

export interface SelectOption {
  value: number | string;
  label: string;
}

export interface ProvinceArea {
  area_id: string | null;
  area_name: string;
  count: number;
  percentage: number;
}

export interface CityArea {
  area_id: string | null;
  area_name: string;
  count: number;
  percentage: number;
  province_id: string;
  province: string;
}

export interface Top10Response {
  data: {
    bbox: number[];
    total: number;
    list: ProvinceArea[];
    group_by: string;
  };
}

export interface CityDetailResponse {
  data: {
    bbox: number[];
    total: number;
    list: CityArea[];
    group_by: string;
  };
}
