CREATE TYPE "public"."attempt_state" AS ENUM('created', 'verifying', 'succeeded', 'failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."attendance_state" AS ENUM('present', 'absent');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('pending', 'active', 'rejected', 'retired');--> statement-breakpoint
CREATE TYPE "public"."mark_method" AS ENUM('self', 'staff');--> statement-breakpoint
CREATE TABLE "attendance_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"session_id" integer NOT NULL,
	"session_date" date NOT NULL,
	"occurrence_start" timestamp with time zone NOT NULL,
	"occurrence_end" timestamp with time zone NOT NULL,
	"state" "attempt_state" DEFAULT 'created' NOT NULL,
	"liveness_session_id" text,
	"enrollment_id" uuid,
	"ip" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"failure_reason" text,
	"verification" jsonb,
	CONSTRAINT "attendance_attempts_liveness_session_id_unique" UNIQUE("liveness_session_id")
);
--> statement-breakpoint
CREATE TABLE "attendance_corrections" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"session_id" integer NOT NULL,
	"session_date" date NOT NULL,
	"admin_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"previous" jsonb,
	"next" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biometric_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"notice_version" integer NOT NULL,
	"given_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"withdrawn_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "face_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"image_id" text NOT NULL,
	"status" "enrollment_status" NOT NULL,
	"status_reason" text,
	"quality" jsonb,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "login_failures" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance" ALTER COLUMN "status" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "state" "attendance_state" DEFAULT 'present' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "method" "mark_method" DEFAULT 'self' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "marked_by_admin_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "occurrence_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "occurrence_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "verification" jsonb;--> statement-breakpoint
ALTER TABLE "rejected_attempts" ADD COLUMN "attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance_attempts" ADD CONSTRAINT "attendance_attempts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_attempts" ADD CONSTRAINT "attendance_attempts_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_attempts" ADD CONSTRAINT "attendance_attempts_enrollment_id_face_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."face_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "biometric_consents" ADD CONSTRAINT "biometric_consents_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_enrollments" ADD CONSTRAINT "face_enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_enrollments" ADD CONSTRAINT "face_enrollments_created_by_admin_id_admins_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_attempts_student_idx" ON "attendance_attempts" USING btree ("student_id","session_id","session_date");--> statement-breakpoint
CREATE INDEX "attendance_attempts_state_idx" ON "attendance_attempts" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX "attendance_corrections_occurrence_idx" ON "attendance_corrections" USING btree ("student_id","session_id","session_date");--> statement-breakpoint
CREATE INDEX "biometric_consents_student_idx" ON "biometric_consents" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "face_enrollments_version" ON "face_enrollments" USING btree ("student_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "face_enrollments_one_active" ON "face_enrollments" USING btree ("student_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "face_enrollments_student_idx" ON "face_enrollments" USING btree ("student_id","status");--> statement-breakpoint
CREATE INDEX "login_failures_key_idx" ON "login_failures" USING btree ("key","at");--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_attempt_id_attendance_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attendance_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_marked_by_admin_id_admins_id_fk" FOREIGN KEY ("marked_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_attempt_id_unique" UNIQUE("attempt_id");--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_present_has_status" CHECK (state <> 'present' OR status IS NOT NULL);