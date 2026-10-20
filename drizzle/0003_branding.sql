CREATE TABLE "branding" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"org_name" text NOT NULL,
	"primary_color" text NOT NULL,
	"logo_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_admin_id" uuid
);
--> statement-breakpoint
ALTER TABLE "branding" ADD CONSTRAINT "branding_updated_by_admin_id_admins_id_fk" FOREIGN KEY ("updated_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;