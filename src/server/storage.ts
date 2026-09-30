import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

/** Abstraction de stockage objet : permet de changer de fournisseur (R2, S3, MinIO…) sans toucher au métier. */
export interface StorageProvider {
  put(bucket: Bucket, key: string, body: Buffer, contentType: string): Promise<void>;
  get(bucket: Bucket, key: string): Promise<Buffer>;
  remove(bucket: Bucket, key: string): Promise<void>;
  copy(bucket: Bucket, fromKey: string, toKey: string): Promise<void>;
  signedDownloadUrl(key: string, filename: string, seconds?: number): Promise<string>;
  ping(): Promise<void>;
}
export type Bucket = "private" | "public";

class S3Storage implements StorageProvider {
  private client: S3Client;
  constructor() {
    const e = env();
    this.client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT,
      forcePathStyle: Boolean(e.S3_ENDPOINT),
      credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
    });
  }
  private name(b: Bucket) {
    return b === "private" ? env().S3_BUCKET_PRIVATE : env().S3_BUCKET_PUBLIC;
  }
  async put(bucket: Bucket, key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.name(bucket), Key: key, Body: body, ContentType: contentType,
      CacheControl: bucket === "public" ? "public, max-age=31536000, immutable" : "private, no-store",
      ...(env().S3_ENDPOINT ? {} : { ServerSideEncryption: "AES256" as const }),
    }));
  }
  async get(bucket: Bucket, key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.name(bucket), Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async remove(bucket: Bucket, key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.name(bucket), Key: key }));
  }
  async copy(bucket: Bucket, fromKey: string, toKey: string) {
    const b = this.name(bucket);
    await this.client.send(new CopyObjectCommand({ Bucket: b, Key: toKey, CopySource: `${b}/${encodeURIComponent(fromKey)}` }));
  }
  async signedDownloadUrl(key: string, filename: string, seconds = 120) {
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.name("private"), Key: key,
      ResponseContentDisposition: `attachment; filename="${filename.replace(/[^\w.\-]/g, "_")}"`,
    }), { expiresIn: seconds });
  }
  async ping() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.name("private") }));
  }
}

let provider: StorageProvider | null = null;
export const storage = (): StorageProvider => (provider ??= new S3Storage());
export function setStorageProvider(p: StorageProvider) {
  provider = p;
}
