ALTER TYPE "public"."attempt_state" ADD VALUE 'error';--> statement-breakpoint
ALTER TABLE "attendance_attempts" ADD COLUMN "counted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "face_enrollments" ADD COLUMN "descriptor" real[];--> statement-breakpoint
ALTER TABLE "face_enrollments" ADD COLUMN "model" text;