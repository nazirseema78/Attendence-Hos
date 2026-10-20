import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}

/** Read lazily so `next build` works without secrets; a missing value fails on first use. */
export const env = {
  get DATABASE_URL() {
    return required("DATABASE_URL");
  },
  get CLOUDINARY_CLOUD_NAME() {
    return required("CLOUDINARY_CLOUD_NAME");
  },
  get CLOUDINARY_API_KEY() {
    return required("CLOUDINARY_API_KEY");
  },
  get CLOUDINARY_API_SECRET() {
    return required("CLOUDINARY_API_SECRET");
  },
  get CRON_SECRET() {
    return required("CRON_SECRET");
  },
};
