/**
 * API helpers for FTTH manual-add. Each feature is POSTed to its real endpoint,
 * scoped to the active project via `projects.create`. Asset types/groups are
 * filtered to FTTH (`is_ftth`).
 */

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

const projectsCreate = (projectId: number) => ({
  create: [{ project_id: projectId }],
});

// FTTH site point type id.
export const FTTH_SITE_POINT_TYPE_ID = 5;

export interface SitePointInput {
  coordinates: [number, number];
}

export async function postSitePoints(
  projectId: number,
  points: SitePointInput[],
  token: string,
): Promise<any> {
  const body = points.map((p) => ({
    site_point_type_id: FTTH_SITE_POINT_TYPE_ID,
    geom: { type: "Point", coordinates: p.coordinates },
    projects: projectsCreate(projectId),
  }));
  return $fetch("/panel/data/site_points", {
    method: "POST",
    headers: authHeaders(token),
    body,
  });
}

export interface RouteInput {
  route_type_id: number;
  site_from: number | string;
  site_to: number | string;
  length_m: number;
  geom: GeoJSON.LineString;
}

export async function postRoute(
  projectId: number,
  route: RouteInput,
  token: string,
): Promise<any> {
  return $fetch("/panel/items/routes", {
    method: "POST",
    headers: authHeaders(token),
    body: [{ ...route, projects: projectsCreate(projectId) }],
  });
}

export interface CableInput {
  site_from: number | string;
  site_to: number | string;
  cable_type_id: number;
  cable_net_length_m: number;
  route_ids: number[];
}

export async function postCable(
  projectId: number,
  cable: CableInput,
  token: string,
): Promise<any> {
  return $fetch("/panel/items/cables", {
    method: "POST",
    headers: authHeaders(token),
    body: [
      {
        site_from: cable.site_from,
        site_to: cable.site_to,
        cable_type_id: cable.cable_type_id,
        cable_net_length_m: cable.cable_net_length_m,
        routes: { create: cable.route_ids.map((id) => ({ route_id: id })) },
        projects: projectsCreate(projectId),
      },
    ],
  });
}

export interface AssetInput {
  site_point_id: number | string;
  asset_type_id: number;
  asset_group_id: string | null;
  name: string;
  code: string;
}

export async function postAssets(
  projectId: number,
  assets: AssetInput[],
  token: string,
): Promise<any> {
  const body = assets.map((a) => ({
    site_point_id: a.site_point_id,
    asset_type_id: a.asset_type_id,
    asset_group_id: a.asset_group_id,
    name: a.name,
    code: a.code,
    projects: projectsCreate(projectId),
  }));
  return $fetch("/panel/items/assets", {
    method: "POST",
    headers: authHeaders(token),
    body,
  });
}

// === Reference data ===
export async function fetchFtthAssetTypes(
  token: string,
): Promise<Array<{ id: number; name: string }>> {
  const res = await $fetch<{ data: Array<{ id: number; name: string }> }>(
    "/panel/items/asset_types?filter[is_ftth][_eq]=true&sort=name",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return res?.data ?? [];
}

export interface AssetGroup {
  id: string;
  name?: string;
}

export async function fetchAssetGroups(
  assetTypeId: number | string,
  token: string,
): Promise<AssetGroup[]> {
  const res = await $fetch<{ data: AssetGroup[] }>(
    `/panel/items/asset_groups?filter[asset_type_id][_eq]=${assetTypeId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return res?.data ?? [];
}
