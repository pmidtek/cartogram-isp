import { defineStore } from "pinia";

import type { LoadedGeoJson } from "~/utils/types";

interface LoadedGeoJsonData extends LoadedGeoJson {
  data: GeoJSON.GeoJSON;
}

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open("geodashboard", 1);
    request.onerror = (e) => {
      console.error("Error opening database");
      reject(e);
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      db.onerror = (e) => {
        console.error("Error creating database");
        reject(e);
      };
      db.createObjectStore("loadedGeoJsonData", {
        keyPath: "layer_id",
      });
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
  });

export const useIDB = defineStore("iDB", () => {
  const iDB = ref<IDBDatabase | null>(null);

  const getDb = async () => {
    if (iDB.value) return iDB.value;
    const db = await openDb();
    iDB.value = db;
    return db;
  };

  const addLoadedGeoJsonData = async (data: LoadedGeoJsonData) => {
    const db = await getDb();
    return new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(["loadedGeoJsonData"], "readwrite")
        .objectStore("loadedGeoJsonData")
        .add(data);
      request.onerror = (e) => {
        console.error("Failed to fetch data");
        reject(e);
      };
      request.onsuccess = () => {
        resolve();
      };
    });
  };

  const getLoadedGeoJsonData = async (layerId: string) => {
    const db = await getDb();
    return new Promise<LoadedGeoJsonData | undefined>((resolve, reject) => {
      const request = db
        .transaction(["loadedGeoJsonData"])
        .objectStore("loadedGeoJsonData")
        .get(layerId);
      request.onerror = (e) => {
        console.error("Failed to fetch data");
        reject(e);
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
  };

  const getAllLoadedGeoJsonData = async () => {
    const db = await getDb();
    return new Promise<LoadedGeoJsonData[]>((resolve, reject) => {
      const request = db
        .transaction(["loadedGeoJsonData"])
        .objectStore("loadedGeoJsonData")
        .getAll();
      request.onerror = (e) => {
        console.error("Failed to fetch data");
        reject(e);
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
  };

  const deleteLoadedGeoJsonData = async (layerId: string) => {
    const db = await getDb();
    return new Promise<void>((resolve, reject) => {
      const request = db
        .transaction(["loadedGeoJsonData"], "readwrite")
        .objectStore("loadedGeoJsonData")
        .delete(layerId);
      request.onerror = (e) => {
        console.error("Failed to fetch data");
        reject(e);
      };
      request.onsuccess = () => {
        resolve();
      };
    });
  };

  return {
    getDb,
    addLoadedGeoJsonData,
    getLoadedGeoJsonData,
    getAllLoadedGeoJsonData,
    deleteLoadedGeoJsonData,
  };
});
