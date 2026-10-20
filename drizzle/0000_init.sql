CREATE TYPE "public"."attendance_status" AS ENUM('on_time', 'late');--> statement-breakpoint
CREATE TYPE "public"."user_type" AS ENUM('admin', 'student');--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "allowed_ips" (
	"id" serial PRIMARY KEY NOT NULL,
	"cidr" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allowed_ips_cidr_unique" UNIQUE("cidr")
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"session_id" integer NOT NULL,
	"session_date" date NOT NULL,
	"status" "attendance_status" NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text NOT NULL,
	"selfie_id" text,
	"selfie_deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "attendance_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_minute" integer NOT NULL,
	"end_minute" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_type" "user_type" NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rejected_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"grace_minutes" integer DEFAULT 30 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"guardian_phone" text NOT NULL,
	"password_hash" text NOT NULL,
	"photo_id" text,
	"id_card_id" text,
	"id_card_format" text,
	"device_token_hash" text,
	"device_bound_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "students_phone_unique" UNIQUE("phone"),
	CONSTRAINT "students_device_token_hash_unique" UNIQUE("device_token_hash")
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rejected_attempts" ADD CONSTRAINT "rejected_attempts_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_once_per_session" ON "attendance" USING btree ("student_id","session_id","session_date");--> statement-breakpoint
CREATE INDEX "attendance_date_idx" ON "attendance" USING btree ("session_date","session_id");--> statement-breakpoint
CREATE INDEX "attendance_marked_at_idx" ON "attendance" USING btree ("marked_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_type","user_id");--> statement-breakpoint
CREATE INDEX "rejected_attempts_at_idx" ON "rejected_attempts" USING btree ("at");