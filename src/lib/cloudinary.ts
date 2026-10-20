import "server-only";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { env } from "./env";

let configured = false;
function client() {
  if (!configured) {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
}

/**
 * Upload a file as an *authenticated* asset: it can only be fetched through a URL signed with
 * our API secret, and those URLs are only ever built on the server (see /api/media).
 * PDFs are stored with resource_type "image" so Cloudinary can render page thumbnails.
 */
export function uploadPrivate(buffer: Buffer, folder: string): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    client()
      .uploader.upload_stream(
        { type: "authenticated", resource_type: "image", folder, overwrite: false },
        (error, result) => (error || !result ? reject(error ?? new Error("Upload failed")) : resolve(result)),
      )
      .end(buffer);
  });
}

export async function deletePrivate(publicIds: string[]): Promise<void> {
  // The Admin API accepts at most 100 ids per call.
  for (let i = 0; i < publicIds.length; i += 100) {
    await client().api.delete_resources(publicIds.slice(i, i + 100), {
      type: "authenticated",
      resource_type: "image",
    });
  }
}

/** Server-side only: the private image's bytes as JPEG (max 1600px), e.g. as a face-comparison reference. */
export async function fetchPrivateImage(publicId: string): Promise<Uint8Array> {
  const res = await fetch(signedUrl(publicId, { size: "full" }), {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Could not fetch stored image (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export type MediaSize = "thumb" | "full";

/**
 * Signed delivery URL. Server-side only: never send this URL to the browser,
 * because a signed URL does not expire.
 */
export function signedUrl(publicId: string, opts: { size: MediaSize; isPdf?: boolean }): string {
  const transformation =
    opts.size === "thumb"
      ? [{ width: 320, height: 320, crop: "fill", gravity: "auto", quality: "auto", page: opts.isPdf ? 1 : undefined }]
      : [{ width: 1600, crop: "limit", quality: "auto" }];
  return client().url(publicId, {
    type: "authenticated",
    resource_type: "image",
    sign_url: true,
    secure: true,
    // Full-size PDFs are served as PDFs; everything else (incl. PDF thumbnails) as JPEG.
    format: opts.isPdf && opts.size === "full" ? "pdf" : "jpg",
    transformation: opts.isPdf && opts.size === "full" ? undefined : transformation,
  });
}
