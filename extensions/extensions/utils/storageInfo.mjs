const storageLoc = (process.env.STORAGE_LOCATIONS || "s3").toUpperCase();
const storageRt = process.env[`STORAGE_${storageLoc}_ROOT`];

export const storageLocation = process.env.STORAGE_LOCATIONS;
export const storageBucket = process.env[`STORAGE_${storageLoc}_BUCKET`];
export const storageRoot = storageRt ? storageRt + "/" : "";
