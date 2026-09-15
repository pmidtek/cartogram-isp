import { Client as MinioClient } from "minio";

let parsedUrl;
try {
  parsedUrl = new URL(process.env.STORAGE_S3_ENDPOINT);
} catch (error) {}

const minioClient = new MinioClient({
  endPoint: parsedUrl?.hostname || process.env.STORAGE_S3_ENDPOINT,
  port: parsedUrl?.port && Number(parsedUrl.port),
  accessKey: process.env.STORAGE_S3_KEY,
  secretKey: process.env.STORAGE_S3_SECRET,
  region: process.env.STORAGE_S3_REGION,
  useSSL: parsedUrl?.protocol === "http:" ? false : true,
});

export default minioClient;
